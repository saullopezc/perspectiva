#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_edicion.py — QA en navegador real de la edicion general: ajustes por imagen,
# arrastre del lienzo, ventana de la salida (zoom hacia el cursor, arrastre, ajustar),
# modos "imagen completa" y "recorte" (pixeles 1:1) y seguimiento de puntos al
# capturar un fotograma suelto. Cada caso con su control.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_edicion.py DIR_IMAGENES
#       DIR_IMAGENES: DIR_BASE/muestras de tests/web/generar_insumos.py
# Author: Saul López
# Date:   2026-11-19
# -----------------------------------------------------------------------------
import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
_HTML = os.environ.get("QA_HTML", "perspectiva.html")  # absoluta: probar otra copia (p. ej. la carpeta publicada)
HTML = Path(_HTML) if os.path.isabs(_HTML) else RAIZ / "tools" / "web" / _HTML
CHROME = Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
NAV = os.environ.get("QA_NAV", "chromium")
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_edicion_{NAV}"
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:400]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre}  {detalle}")


def main(dir_img):
    d = Path(dir_img).resolve()
    a, b = d / "muestra_a.png", d / "muestra_b.png"
    SALIDA.mkdir(parents=True)
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        ctx = nav.new_context(viewport={"width": 1600, "height": 1000})
        pg = ctx.new_page()
        errores = []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" and "downloadable font" not in m.text and "fuentes_embebidas" not in m.text else None)
        pg.goto(HTML.as_uri()); pg.wait_for_timeout(1200)
        pg.evaluate("() => document.querySelectorAll('#panel details.bloque').forEach(x => (x.open = true))")
        poner = lambda sel, v: pg.evaluate("([s, v]) => { const el = document.querySelector(s); if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }", [sel, v])
        espera = lambda: pg.wait_for_timeout(350)
        modo = lambda m: (pg.click(f"label:has(input[name=modoGeo][value={m}])"), espera())

        # ---------------- inicio: el panel se ve aunque la ultima vez se ocultara
        pg.evaluate("() => localStorage.setItem('perspectiva.interfaz', JSON.stringify({ dock: 'right', oculto: true, ancho: 380, alto: 300 }))")
        pg.reload(); pg.wait_for_timeout(1000)
        caso("inicio", "el panel se muestra al abrir aunque se hubiera ocultado", not pg.evaluate("() => document.body.classList.contains('panel-oculto')"))
        pg.evaluate("() => document.querySelectorAll('#panel details.bloque').forEach(x => (x.open = true))")
        # ---------------- aviso de carga con el logo: aparece durante la carga y se va al terminar
        pg.evaluate("""() => { window.__vistoCargando = false; new MutationObserver(() => { if (!document.getElementById('cargando').hidden) window.__vistoCargando = true; })
            .observe(document.getElementById('cargando'), { attributes: true }); }""")
        # ---------------- C: los ajustes son de la imagen actual (por defecto)
        pg.set_input_files("#archivo", [str(a), str(b)]); pg.wait_for_timeout(1200)
        caso("carga", "el aviso de carga (con logo) aparece al cargar y desaparece al terminar",
             pg.evaluate("() => window.__vistoCargando && document.getElementById('cargando').hidden && !!document.querySelector('#cargando .logo')"))
        caso("ajustes", "por defecto: 'solo la imagen actual'", pg.input_value("#modoConfig") == "cero")
        pg.evaluate("() => seleccionar(0)"); espera(); poner("[data-p=negativo]", True); espera()
        pg.evaluate("() => seleccionar(1)"); espera(); n2 = pg.is_checked("[data-p=negativo]")
        pg.evaluate("() => seleccionar(0)"); espera(); n1 = pg.is_checked("[data-p=negativo]")
        caso("ajustes", "negativo en la imagen 1 no pasa a la 2 y la 1 lo conserva", n1 and not n2, f"imagen1 {n1} · imagen2 {n2}")
        pg.select_option("#modoConfig", "mantener"); espera(); pg.evaluate("() => seleccionar(1)"); espera()
        caso("ajustes", "control: con 'los mismos ajustes para todas' el negativo si pasa", pg.is_checked("[data-p=negativo]"))
        poner("[data-p=negativo]", False); pg.select_option("#modoConfig", "cero"); espera()

        # ---------------- D: imagen completa = los pixeles originales
        pg.evaluate("() => seleccionar(0)"); espera(); pg.click("#btnResetTodo"); espera()  # la imagen 1 conserva su negativo (caso C)
        modo("completa"); pg.wait_for_function("() => limpia", timeout=5000)
        comp = pg.evaluate("""() => { const F = F0(), L = limpia; let dif = 0;
            for (let i = 0; i < F.w * F.h * 4; i += 4) dif += Math.abs(L.data[i] - F.datos.data[i]) + Math.abs(L.data[i + 1] - F.datos.data[i + 1]) + Math.abs(L.data[i + 2] - F.datos.data[i + 2]);
            return { w: L.width, h: L.height, Fw: F.w, Fh: F.h, dif }; }""")
        caso("completa", "imagen completa: salida del mismo tamano y pixeles identicos", comp["w"] == comp["Fw"] and comp["h"] == comp["Fh"] and comp["dif"] == 0, comp)
        poner("[data-p=negativo]", True); espera()
        neg = pg.evaluate("() => { const F = F0(); return [limpia.data[0], 255 - F.datos.data[0]]; }")
        caso("completa", "control: un ajuste (negativo) se aplica a la imagen entera", neg[0] == neg[1], neg)
        poner("[data-p=negativo]", False); espera()
        # recorte por dos clics
        modo("recorte")
        clic = lambda x, y: pg.mouse.click(*pg.evaluate("([x, y]) => { const r = cvF.getBoundingClientRect(), dp = devicePixelRatio || 1; const [u, v] = aCanvas(x, y); return [r.left + u / dp, r.top + v / dp]; }", [x, y]))
        clic(100, 60); clic(300, 200); pg.wait_for_function("() => limpia && F0().recorte.length === 2", timeout=5000)
        rec = pg.evaluate("""() => { const F = F0(), E = esquinas(F), L = limpia, [x0, y0] = E[0].map(Math.round); let dif = 0;
            for (let y = 0; y < L.height; y++) for (let x = 0; x < L.width; x++) { const o = (y * L.width + x) * 4, q = ((y0 + y) * F.w + x0 + x) * 4; dif += Math.abs(L.data[o] - F.datos.data[q]); }
            return { w: L.width, h: L.height, E: E.map(p => p.map(Math.round)), dif }; }""")
        ew, eh = rec["E"][1][0] - rec["E"][0][0], rec["E"][3][1] - rec["E"][0][1]
        caso("recorte", "recorte: la salida es exactamente esa zona (tamano y pixeles)", abs(rec["w"] - ew) <= 1 and abs(rec["h"] - eh) <= 1 and rec["dif"] == 0, rec)

        # ---------------- E: arrastrar el lienzo mueve la vista y no pone puntos; clic sin mover si
        modo("esquinas"); pg.click("#btnReiniciar"); espera()
        bb = pg.locator("#fuente").bounding_box(); cx, cy = bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2
        ox0 = pg.evaluate("() => vista.ox")
        pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 60, cy + 10, steps=6); pg.mouse.move(cx + 120, cy + 20, steps=6); pg.mouse.up(); espera()
        arr = pg.evaluate("() => ({ dx: vista.ox, puntos: F0().esquinas.length, dpr: devicePixelRatio || 1 })")
        caso("lienzo", "arrastrar con el boton izquierdo mueve la imagen 120 px y no anade puntos",
             abs((arr["dx"] - ox0) / arr["dpr"] - 120) < 2 and arr["puntos"] == 0, f"{(arr['dx'] - ox0) / arr['dpr']:.1f} px · puntos {arr['puntos']}")
        pg.mouse.click(cx, cy); espera()
        caso("lienzo", "control: un clic sin mover si anade un punto", pg.evaluate("() => F0().esquinas.length") == 1)

        # ---------------- E: ventana de la salida
        pg.click("#btnReiniciar"); modo("completa"); pg.wait_for_function("() => limpia", timeout=5000)
        pg.click("#btnAjustarSalida"); pg.wait_for_timeout(500)
        aj = pg.evaluate("() => { const w = document.getElementById('salidaWrap'); return { cw: cvS.width, ch: cvS.height, W: w.clientWidth, H: w.clientHeight }; }")
        caso("salida", "ajustar: la imagen entera cabe en la ventana", aj["cw"] <= aj["W"] and aj["ch"] <= aj["H"] and (aj["cw"] > 0.9 * aj["W"] or aj["ch"] > 0.9 * aj["H"]), aj)
        wb = pg.locator("#salidaWrap").bounding_box(); mx, my = wb["x"] + wb["width"] * 0.3, wb["y"] + wb["height"] * 0.4
        antes = pg.evaluate("([mx, my]) => { const r = document.getElementById('salidaWrap').getBoundingClientRect(), z = cvS.width / limpia.width; return { u: (mx - r.left - vistaSalida.x) / z, v: (my - r.top - vistaSalida.y) / z, z }; }", [mx, my])
        cab = pg.evaluate("() => { const w = document.getElementById('salidaWrap'); return { y: vistaSalida.y, centrado: (w.clientHeight - cvS.height) / 2 }; }")
        caso("salida", "si la imagen cabe en una dimension, queda centrada en ella", abs(cab["y"] - cab["centrado"]) < 1, cab)
        mx, my = wb["x"] + wb["width"] * 0.5, wb["y"] + wb["height"] * 0.5
        pg.mouse.move(mx, my); pg.mouse.wheel(0, -120); pg.wait_for_timeout(500); pg.mouse.wheel(0, -120); pg.wait_for_timeout(500)  # que desborde en las dos
        antes = pg.evaluate("([mx, my]) => { const r = document.getElementById('salidaWrap').getBoundingClientRect(), z = cvS.width / limpia.width; return { u: (mx - r.left - vistaSalida.x) / z, v: (my - r.top - vistaSalida.y) / z, z }; }", [mx, my])
        mx2, my2 = wb["x"] + wb["width"] * 0.4, wb["y"] + wb["height"] * 0.45
        antes = pg.evaluate("([mx, my]) => { const r = document.getElementById('salidaWrap').getBoundingClientRect(), z = cvS.width / limpia.width; return { u: (mx - r.left - vistaSalida.x) / z, v: (my - r.top - vistaSalida.y) / z, z }; }", [mx2, my2])
        mx, my = mx2, my2
        pg.mouse.move(mx, my); pg.mouse.wheel(0, -120); pg.wait_for_timeout(700)
        despues = pg.evaluate("([mx, my]) => { const r = document.getElementById('salidaWrap').getBoundingClientRect(), z = cvS.width / limpia.width; return { u: (mx - r.left - vistaSalida.x) / z, v: (my - r.top - vistaSalida.y) / z, z }; }", [mx, my])
        caso("salida", "rueda: amplia hacia el cursor (el punto bajo el cursor no se mueve)", despues["z"] > antes["z"] * 1.2 and abs(despues["u"] - antes["u"]) < 1.5 and abs(despues["v"] - antes["v"]) < 1.5,
             f"z {antes['z']:.2f}->{despues['z']:.2f} · u {antes['u']:.1f}->{despues['u']:.1f} · v {antes['v']:.1f}->{despues['v']:.1f}")
        x0 = pg.evaluate("() => vistaSalida.x")
        pg.mouse.move(mx, my); pg.mouse.down(); pg.mouse.move(mx - 80, my, steps=8); pg.mouse.up(); pg.wait_for_timeout(200)
        caso("salida", "arrastrar mueve la imagen dentro de la ventana", abs(pg.evaluate("() => vistaSalida.x") - (x0 - 80)) < 2, f"{x0} -> {pg.evaluate('() => vistaSalida.x')}")
        caso("salida", "la ventana no crece con el zoom (el marco es fijo)", abs(pg.locator("#salidaWrap").bounding_box()["height"] - wb["height"]) < 1)

        # ---------------- F: seguir puntos al capturar un fotograma suelto del mismo video (emulado con una copia desplazada)
        modo("esquinas")
        b64 = pg.evaluate("""() => { const F = F0(), c = document.createElement('canvas'); c.width = F.w; c.height = F.h;
            const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, F.w, F.h); x.drawImage(F.img, 4, -3); return c.toDataURL('image/png').split(',')[1]; }""")
        desp = SALIDA / "desplazada_+4_-3.png"; desp.write_bytes(base64.b64decode(b64))
        i_ref = pg.evaluate("() => actual")
        pg.evaluate("() => { const F = F0(); F.esquinas = [[150, 110], [590, 110], [590, 300], [150, 300]]; F.origen = { sha256Video: 'v1', video: 'v', t: 0, fotograma: 0 }; }")
        pg.set_input_files("#archivo", str(desp)); pg.wait_for_timeout(900)
        sg = pg.evaluate("""(iref) => { const ref = fuentes[iref], nuevo = F0(); nuevo.origen = { sha256Video: 'v1', video: 'v', t: 0.033, fotograma: 1 };
            trasCaptura(ref, nuevo); return { err: Math.max(...ref.esquinas.map((p, i) => Math.hypot(nuevo.esquinas[i][0] - p[0] - 4, nuevo.esquinas[i][1] - p[1] + 3))), info: document.getElementById('infoSeguir').textContent }; }""", i_ref)
        caso("seguir", "captura suelta del mismo video: los puntos siguen el desplazamiento (+4, -3) con error < 0.25 px", sg["err"] < 0.25, f"error {sg['err']:.3f} px · {sg['info']}")
        otro = pg.evaluate("""(iref) => { const ref = fuentes[iref], nuevo = F0(); nuevo.origen.sha256Video = 'otro'; const antes = JSON.stringify(nuevo.esquinas);
            nuevo.esquinas = ref.esquinas.map(p => [...p]); trasCaptura(ref, nuevo); return JSON.stringify(nuevo.esquinas) === JSON.stringify(ref.esquinas); }""", i_ref)
        caso("seguir", "control: de otro video no se siguen (se quedan las coordenadas copiadas)", otro)
        # ---------------- lienzo plegado: la salida gana el espacio
        w0 = pg.locator("#salidaWrap").bounding_box()["width"]
        pg.click("#btnAmpliarSalida"); pg.wait_for_timeout(500)
        w1 = pg.locator("#salidaWrap").bounding_box()["width"]; plegado = not pg.evaluate("() => document.getElementById('bloqueLienzo').open")
        caso("salida", "⤢ pliega el lienzo y la salida ocupa todo el ancho", plegado and w1 > 1.6 * w0, f"{w0:.0f} -> {w1:.0f} px")
        pg.click("#btnAmpliarSalida"); pg.wait_for_timeout(500)
        caso("salida", "⤢ otra vez vuelve a mostrar el lienzo", pg.evaluate("() => document.getElementById('bloqueLienzo').open") and abs(pg.locator("#salidaWrap").bounding_box()["width"] - w0) < 2)
        # ---------------- analisis de archivo: codecs y estructura en la interfaz
        ins = d.parent / "estructura"  # generar_insumos.py deja estructura/ junto a muestras/
        if ins.is_dir():
            pg.set_input_files("#archivo", str(ins / "h264_aac.mp4")); pg.wait_for_timeout(1200)
            pg.wait_for_function("() => document.getElementById('hexInfo').textContent.includes('Pista 1')", timeout=8000)
            t = pg.text_content("#hexInfo")
            caso("archivo", "video: codec, perfil, nivel y audio en Analisis de archivo",
                 "H.264 / AVC (avc1) · perfil High · nivel 4.0" in t and "AAC LC · 48000 Hz · 2 canales" in t and "moov" in t, t[:160].replace("\n", " | "))
            caso("archivo", "grafico de entropia visible", pg.evaluate("() => !document.getElementById('entropia').hidden && document.getElementById('entropia').width > 0"))
            pg.set_input_files("#archivo", str(ins / "imagen_con_extension.jpg")); pg.wait_for_timeout(900)
            pg.wait_for_function("() => document.getElementById('hexInfo').textContent.includes('Entropia')", timeout=8000)
            caso("archivo", "control: PNG con extension .jpg -> aviso", "no corresponde al contenido (PNG)" in pg.text_content("#hexInfo"))
        # ---------------- video: el panel salta al bloque Video, abierto y a la vista
        pg.click("#btnPanel"); pg.wait_for_timeout(200)  # oculto a proposito
        pg.evaluate("() => document.querySelector('#panel .contenido').scrollTop = 0")
        pg.set_input_files("#archivo", str(d / "clip.webm")); pg.wait_for_timeout(1500)
        v = pg.evaluate("""() => { const b = document.getElementById('bloqueVideo'), c = document.querySelector('#panel .contenido'), rb = b.getBoundingClientRect(), rc = c.getBoundingClientRect();
            return { panel: !document.body.classList.contains('panel-oculto'), abierto: b.open, visible: !b.hidden, aLaVista: rb.top >= rc.top - 2 && rb.top < rc.bottom - 40 }; }""")
        caso("video", "al cargar un video el panel se muestra en el bloque Video, abierto y a la vista", all(v.values()), v)
        caso("errores", "sin errores de JS", not errores, errores[:5])
        pg.screenshot(path=str(SALIDA / "edicion.png"))
        nav.close()
    fallos = [x for x in res if not x["ok"]]
    (SALIDA / "REPORTE.md").write_text(f"# QA edicion — {NAV}\n\n{len(res)} casos, {len(fallos)} fallos\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n"
                                       + "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/')} |" for x in res) + "\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
