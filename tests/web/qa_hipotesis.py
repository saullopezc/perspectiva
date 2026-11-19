#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_hipotesis.py — QA en navegador real (Playwright) de la plantilla deformable,
# el aplanado sin ajustes (aspecto automatico, N puntos de control) y la
# comparacion por sintesis de tools/web/perspectiva.html. Verifica EFECTOS
# medidos (pixeles, cm, residuos, ranking), con control positivo en cada caso.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_hipotesis.py DIR_INSUMOS
#       DIR_INSUMOS: sintetica_sat_persp.png + .json y muestras (tests/web/generar_insumos.py)
# Resultados en _local/qa/<TS>_web_hipotesis_<nav>/
# Author: Saul López
# Date:   2026-11-15
# Modified By:   Saul López
# Modified Date: 2026-11-19
# -----------------------------------------------------------------------------
import base64
import hashlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
HTML = RAIZ / "tools" / "web" / "perspectiva.html"
CHROME = Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
NAV = os.environ.get("QA_NAV", "chromium")
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_hipotesis_{NAV}"
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:400]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre}  {detalle}")


def main(insumos):
    insumos = Path(insumos).resolve()
    sint = json.loads((insumos / "sintetica_sat_persp.json").read_text())
    SALIDA.mkdir(parents=True)
    with sync_playwright() as p:
        if NAV == "firefox":
            nav = p.firefox.launch(headless=True)
        else:
            nav = p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        ctx = nav.new_context(accept_downloads=True, viewport={"width": 1600, "height": 1000})
        pg = ctx.new_page()
        errores = []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" and "downloadable font" not in m.text else None)  # avisos del saneador de fuentes de Firefox sobre FE.TTF local
        pg.goto(HTML.as_uri())
        pg.wait_for_timeout(1500)
        pg.evaluate("""() => { window.__poner = (sel, v) => { const el = document.querySelector(sel);
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v;
            el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }; }""")
        poner = lambda sel, v: pg.evaluate("([s, v]) => __poner(s, v)", [sel, v])
        pg.evaluate("() => document.querySelectorAll('#panel details.bloque').forEach(d => (d.open = true))")
        texto = lambda sel: pg.inner_text(sel)

        def clic_img(x, y):
            cx, cy = pg.evaluate("([x, y]) => { const r = cvF.getBoundingClientRect(), d = devicePixelRatio || 1; const [a, b] = aCanvas(x, y); return [r.left + a / d, r.top + b / d]; }", [x, y])
            pg.mouse.click(cx, cy)

        # ---------------- fase 1: fuentes libres y plantilla deformable (medida en pixeles)
        grupos = pg.eval_on_selector_all("#fuenteTxt optgroup", "gs => gs.map(g => [g.label, [...g.children].map(o => o.textContent)])")
        libres = dict(grupos).get("libres (OFL)", [])
        caso("fuentes", "5 fuentes libres en el selector", len(libres) == 5 and "Oswald" in libres and "Barlow" in libres, libres)
        caso("fuentes", "FontFace Oswald cargada (y control: una inexistente no)",
             pg.evaluate("() => document.fonts.check('20px \"Oswald\"') && [...document.fonts].some(f => f.family.replace(/\"/g, '') === 'Oswald')")
             and not pg.evaluate("() => [...document.fonts].some(f => f.family === 'NoExiste123')"))
        medir = """([txt, o]) => { const { lienzo } = RP.renderHipotesis(600, 300, txt, o); const d = lienzo.getContext('2d').getImageData(0, 0, 600, 300).data;
            let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
            for (let y = 0; y < 300; y++) for (let x = 0; x < 600; x++) if (d[(y * 600 + x) * 4 + 3] > 127) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            return { n, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }"""
        base = {"altoPct": 30, "fuente": "Barlow", "negrita": False}
        m0 = pg.evaluate(medir, ["P123BCD", base])
        m2 = pg.evaluate(medir, ["P123BCD", {**base, "estVPct": 200}])
        caso("plantilla", "estirar ↕ 200%: el alto se dobla y el ancho no cambia", abs(m2["h"] / m0["h"] - 2) < 0.1 and abs(m2["w"] - m0["w"]) <= 2, f"{m0} -> {m2}")
        mg = pg.evaluate(medir, ["P123BCD", {**base, "grosorPct": 5}])
        mf = pg.evaluate(medir, ["P123BCD", {**base, "grosorPct": -3}])
        caso("plantilla", "grosor +5%: mas tinta; -3%: menos tinta", mg["n"] > 1.2 * m0["n"] and mf["n"] < 0.85 * m0["n"], f"tinta {m0['n']} / +5 {mg['n']} / -3 {mf['n']}")
        mb = pg.evaluate(medir, ["P123BCD", {**base, "negrita": True}])
        caso("plantilla", "negrita cambia el render", mb["n"] != m0["n"], f"{m0['n']} vs {mb['n']}")
        mo = pg.evaluate(medir, ["P123BCD", {**base, "fuente": "Oswald"}])
        caso("plantilla", "otra fuente (Oswald) cambia el render", mo != m0, f"{m0} vs {mo}")

        # ---------------- fase 2: aspecto automatico sobre la sintetica (camara conocida f=900, rectangulo 30x15)
        pg.set_input_files("#archivo", str(insumos / "sintetica_sat_persp.png")); pg.wait_for_timeout(1000)
        for x, y in sint["esquinas_SI_SD_ID_II"]:
            clic_img(x, y)
        pg.wait_for_timeout(400)
        # la estimacion se valida con las esquinas exactas (el raton cuantiza a pixeles de pantalla, ~1.4 px de imagen)
        pg.evaluate("(E) => { F0().esquinas = E.map(p => [...p]); dibujarFuente(); procesar(); }", sint["esquinas_SI_SD_ID_II"])
        poner("#preset", "30x15"); pg.wait_for_timeout(300)
        aparente = pg.evaluate("() => RP.aspectoAparente(esquinas())")
        poner("#preset", "auto"); pg.wait_for_timeout(500)
        ancho = float(pg.input_value("[data-p=anchoCm]"))
        caso("aspecto", "automatico: ancho estimado 30 cm (±1%) con alto 15", abs(ancho / 30 - 1) < 0.01, f"ancho {ancho} cm; info: {texto('#infoGeo')}")
        caso("aspecto", "control positivo: el aspecto aparente de las esquinas NO es 2", abs(aparente - 2) > 0.1, f"aparente {aparente:.3f}")
        pg.screenshot(path=str(SALIDA / "01_aspecto_auto.png"), full_page=True)
        # salida rectificada frente al rotulo original (NCC en luminancia)
        nccs = pg.evaluate("""async (url) => { const im = new Image(); im.src = url; await im.decode();
            const c = document.createElement('canvas'); c.width = limpia.width; c.height = limpia.height; const x = c.getContext('2d');
            x.drawImage(im, 152, 121, 432, 209, 0, 0, c.width, c.height); const a = x.getImageData(0, 0, c.width, c.height).data, b = limpia.data;
            const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; let sa = 0, sb = 0, n = a.length / 4;
            for (let i = 0; i < a.length; i += 4) { sa += L(a, i); sb += L(b, i); } const ma = sa / n, mb = sb / n; let sab = 0, saa = 0, sbb = 0;
            for (let i = 0; i < a.length; i += 4) { const u = L(a, i) - ma, v = L(b, i) - mb; sab += u * v; saa += u * u; sbb += v * v; }
            return sab / Math.sqrt(saa * sbb); }""", "data:image/png;base64," + base64.b64encode((insumos / "diagrama.png").read_bytes()).decode())
        caso("aspecto", "la salida rectificada coincide con el rotulo original (NCC > 0.9)", nccs > 0.9, f"NCC {nccs:.3f}")

        # ---------------- fase 2: N puntos de control (4 esquinas + franja azul), residuo y punto mal marcado
        pg.click("label:has(input[name=modoGeo][value=control])"); pg.wait_for_timeout(300)
        poner("#preset", "30x15"); pg.wait_for_timeout(200)
        caso("control", "barra de referencia visible en modo N puntos", pg.is_visible("#refControl"))
        pg.click("label:has(input[name=modoGeo][value=esquinas])"); pg.wait_for_timeout(200)
        caso("control", "control: en modo 4 esquinas la barra de referencia NO se ve", not pg.is_visible("#refControl"))
        pg.click("label:has(input[name=modoGeo][value=control])"); pg.wait_for_timeout(200)
        pts = sint["esquinas_SI_SD_ID_II"] + [sint["franja_FI"], sint["franja_FD"]]
        for x, y in pts:
            clic_img(x, y)
        pg.wait_for_timeout(500)
        r = pg.evaluate("() => ({ res: F0().controlRes, refs: F0().controlRef.map(c => c.id), E: esquinas(), P: F0().control, s: vista.s / (devicePixelRatio || 1) })")
        dist = lambda a, b: ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
        errE = max(dist(a, b) for a, b in zip(r["E"], sint["esquinas_SI_SD_ID_II"]))
        errClic = max(dist(a, b) for a, b in zip(r["P"], pts))  # el raton solo cae en pixeles de pantalla
        caso("control", "6 puntos: referencias asignadas en orden SI,SD,ID,II,FI,FD", r["refs"] == ["SI", "SD", "ID", "II", "FI", "FD"], r["refs"])
        caso("control", "6 puntos: residuo rms < 1 px y esquinas a menos de 2 clics de pantalla de las reales",
             r["res"] and r["res"]["rms"] < 1 and errE < max(1, 2 / r["s"]),
             f"rms {r['res'] and r['res']['rms']:.3f} px, esquinas a {errE:.3f} px; clics a {errClic:.3f} px (1 px de pantalla = {1 / r['s']:.2f} px de imagen)")
        pg.screenshot(path=str(SALIDA / "02_control_6.png"), full_page=True)
        # control positivo: un 7.o punto marcado como "esquina sup. izq." pero en el centro del rotulo
        poner("#refControl", "SI"); pg.wait_for_timeout(100)
        cxp = sum(p[0] for p in sint["esquinas_SI_SD_ID_II"]) / 4; cyp = sum(p[1] for p in sint["esquinas_SI_SD_ID_II"]) / 4
        clic_img(cxp, cyp); pg.wait_for_timeout(400)
        r7 = pg.evaluate("() => F0().controlRes")
        caso("control", "control positivo: punto con referencia equivocada -> residuo max > 3 px y aviso",
             r7["max"] > 3 and r7["r"].index(r7["max"]) == 6 and "revisa el punto" in texto("#infoControl"), f"max {r7['max']:.1f} px en el punto {r7['r'].index(r7['max'])}")
        pg.evaluate("() => { document.querySelector('#tablaPts').closest('details').open = true; }"); pg.wait_for_timeout(100)
        pg.click("[data-quitar='6']"); pg.wait_for_timeout(300)
        caso("control", "quitar el punto malo devuelve el residuo bajo", pg.evaluate("() => F0().controlRes.rms") < 1)

        # registro JSON: incluye control y plantilla; reproducirlo deja la misma salida
        pg.fill("#plantilla", "P123BCD"); poner("#estVTxt", "130"); poner("#grosorTxt", "2"); pg.wait_for_timeout(300)
        huella = lambda: pg.evaluate("() => limpia ? limpia.width + 'x' + limpia.height + ':' + Array.from(limpia.data).reduce((h, v, i) => (h * 31 + v + i) % 2147483647, 7) : null")
        h0 = huella()
        with pg.expect_download() as d:
            pg.click("#btnJson")
        ruta = SALIDA / d.value.suggested_filename; d.value.save_as(ruta)
        reg = json.loads(ruta.read_text())
        caso("json", "registro con puntos de control, residuo y parametros de plantilla",
             len(reg["geometria"]["control_marcados"]) == 6 and reg["geometria"]["control_residuo"]["rms"] < 1 and reg["plantillaParametros"]["estVPct"] == 130 and reg["plantillaParametros"]["grosorPct"] == 2,
             {k: reg["plantillaParametros"][k] for k in ("estVPct", "grosorPct", "fuente")})
        pg.click("#btnReiniciar"); poner("#estVTxt", "100"); pg.wait_for_timeout(300)
        caso("json", "control positivo: tras reiniciar la salida desaparece", huella() is None)
        pg.set_input_files("#cargarJson", str(ruta)); pg.wait_for_timeout(800)
        caso("json", "reproducir JSON devuelve la misma salida y la plantilla", huella() == h0 and pg.input_value("#estVTxt") == "130", f"{huella()} vs {h0}")

        # seguimiento en modo N puntos: los puntos y sus referencias en cm pasan al otro fotograma
        pg.set_input_files("#archivo", str(insumos / "sintetica_sat_persp.png")); pg.wait_for_timeout(800)
        pg.evaluate("() => { seleccionar(fuentes.length - 2); }"); pg.wait_for_timeout(300)
        pg.click("#btnSeguir"); pg.wait_for_timeout(800)
        sg = pg.evaluate("() => { const a = fuentes[fuentes.length - 2], b = fuentes[fuentes.length - 1]; seleccionar(fuentes.length - 1); return { n: b.control.length, refs: b.controlRef.map(c => c.id), aristas: b.aristas.length, d: Math.max(...esquinas(a).map((p, i) => Math.hypot(p[0] - esquinas(b)[i][0], p[1] - esquinas(b)[i][1]))), info: document.getElementById('infoSeguir').textContent }; }")
        caso("control", "seguir puntos en modo N puntos: el otro fotograma recibe los 6 puntos y sus referencias", sg["n"] == 6 and sg["refs"] == ["SI", "SD", "ID", "II", "FI", "FD"] and sg["aristas"] == 0 and sg["d"] < 0.5, sg)
        # camino del video: tras capturar un rango, seguir y apilar con la geometria marcada en N puntos
        pg.set_input_files("#archivo", str(insumos / "sintetica_sat_persp.png")); pg.wait_for_timeout(800)
        ap = pg.evaluate("""() => { const ref = fuentes[fuentes.length - 3], nuevos = fuentes.slice(-2);
            nuevos.forEach(F => { F.control = []; F.controlRef = []; }); seleccionar(fuentes.indexOf(ref));
            document.getElementById('autoSeguir').checked = true; document.getElementById('autoApilar').checked = true;
            trasRango(ref, nuevos); return { pila: pila.length, ver: document.getElementById('verPila').checked, info: document.getElementById('infoSeguir').textContent, n: document.getElementById('nPila').textContent }; }""")
        caso("control", "rango de video en modo N puntos: sigue y apila la referencia y los 2 capturados", ap["pila"] == 3 and ap["ver"], ap)
        # hashes: los que muestra la herramienta = los de hashlib sobre el mismo fichero (y los del exportado)
        muestra = insumos / "muestra_b.png"; b = muestra.read_bytes()
        esperado = {k: hashlib.new(k, b).hexdigest() for k in ("md5", "sha1", "sha256", "sha512")}
        pg.set_input_files("#archivo", str(muestra))
        # se espera al MD5 DE ESTE fichero: "MD5" ya estaba en pantalla por el anterior (en la CI, mas lenta, se leia antes de tiempo)
        pg.wait_for_function("(m) => document.getElementById('metaInfo').textContent.includes(m)", arg=esperado["md5"], timeout=15000)
        meta = pg.text_content("#metaInfo")
        caso("hashes", "Metadatos muestra MD5, SHA-1, SHA-256 y SHA-512 iguales a hashlib", all(v in meta for v in esperado.values()) and f"({len(b)} bytes)" in meta,
             {k: v[:12] for k, v in esperado.items()})
        caso("hashes", "control: el MD5 de otro fichero no aparece", hashlib.md5(b + b"x").hexdigest() not in meta)
        pg.evaluate("(E) => { F0().esquinas = E; procesarYa(); }", [[100, 60], [600, 60], [600, 300], [100, 300]])
        pg.select_option("#formatoExp", "png"); pg.select_option("#contenidoExp", "salida")
        with pg.expect_download() as d:
            pg.click("#btnExportar")
        exp = SALIDA / d.value.suggested_filename; d.value.save_as(exp)
        li = pg.get_attribute("#listaExport li", "title") or ""
        caso("hashes", "exportacion: MD5/SHA-1/SHA-512 del registro = hashlib del fichero descargado",
             all(hashlib.new(k, exp.read_bytes()).hexdigest() in li for k in ("md5", "sha1", "sha256", "sha512")), li[:120])
        with pg.expect_download() as d:
            pg.click("#btnJson")
        regh = json.loads(d.value.path().read_text())
        caso("hashes", "registro JSON: hashes del archivo de la fuente", (regh["fuente"]["hashesArchivo"] or {}).get("md5") == esperado["md5"]
             and regh["exportaciones"][-1]["md5"] == hashlib.md5(exp.read_bytes()).hexdigest(), regh["fuente"]["hashesArchivo"] and regh["fuente"]["hashesArchivo"]["md5"])
        caso("errores", "sin errores de JS", not errores, errores[:5])
        nav.close()
    fallos = [x for x in res if not x["ok"]]
    (SALIDA / "resultados.json").write_text(json.dumps(res, indent=2, ensure_ascii=False))
    (SALIDA / "REPORTE.md").write_text(f"# QA hipotesis y aplanado — {NAV}\n\n{len(res)} casos, {len(fallos)} fallos\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n"
                                       + "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/')} |" for x in res) + "\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
