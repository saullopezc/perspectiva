#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_integridad.py — QA en navegador real del bloque "Integridad de la imagen" de
# tools/web/perspectiva.html, con casos fabricados de verdad conocida:
#   calidad_q{50,75,90,95}.jpg (libjpeg) -> calidad exacta; tablas_propias.jpg -> no estandar;
#   montaje_q70.jpg (zona pegada sin comprimir) -> ELA mayor en la zona; doble_q70.jpg -> control;
#   miniatura_distinta.jpg -> DIFIERE; miniatura_coincide.jpg -> coincide.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_integridad.py DIR_INSUMOS
#       DIR_INSUMOS: _local/qa/insumos_integridad (generar_insumos_integridad.py, imagen Docker)
# Author: Saul López
# Date:   2026-11-15
# Modified By:   Saul López
# Modified Date: 2026-11-19
# -----------------------------------------------------------------------------
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
Q_ELA = int(os.environ.get('QA_Q_ELA', '0'))
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_integridad_{NAV}"
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:400]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre}  {detalle}")


def main(insumos):
    insumos = Path(insumos).resolve()
    SALIDA.mkdir(parents=True)
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        ctx = nav.new_context(accept_downloads=True, viewport={"width": 1600, "height": 1000})
        pg = ctx.new_page()
        errores = []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" and "downloadable font" not in m.text else None)
        pg.goto(HTML.as_uri()); pg.wait_for_timeout(1200)
        pg.evaluate("() => document.querySelectorAll('#panel details.bloque').forEach(d => (d.open = true))")

        def abrir(nombre):
            pg.set_input_files("#archivo", str(insumos / nombre)); pg.wait_for_timeout(700)
            pg.click("#btnIntegridad"); pg.wait_for_function("() => !document.getElementById('integInfo').textContent.startsWith('(sin')", timeout=5000)
            pg.wait_for_timeout(300)
            return pg.text_content("#integInfo")

        for q in (50, 75, 90, 95):
            t = abrir(f"calidad_q{q}.jpg")
            caso("cuantizacion", f"libjpeg q{q}: tablas estandar a calidad {q}", t.count(f"calidad {q} EXACTA") == 2 and "la ultima escritura la hizo software" in t, t.splitlines()[2][:90])
        t = abrir("tablas_propias.jpg")
        caso("cuantizacion", "control: tablas propias -> NO estandar", t.count("NO estandar") == 2 and "tablas propias" in t, t.splitlines()[2][:90])
        t = abrir("../muestras/muestra_b.png")
        caso("cuantizacion", "PNG: sin tablas, lo dice", "no es JPEG" in t, t.splitlines()[1][:90])

        # miniatura EXIF
        t = abrir("miniatura_distinta.jpg"); md = pg.evaluate("() => F0().archivo.integridad.miniatura")
        caso("miniatura", "miniatura de la version original frente a la editada -> DIFIERE", "DIFIERE" in t and md and not md["coincide"], md)
        pg.screenshot(path=str(SALIDA / "01_miniatura_distinta.png"), full_page=True)
        t = abrir("miniatura_coincide.jpg"); mc = pg.evaluate("() => F0().archivo.integridad.miniatura")
        caso("miniatura", "control: miniatura de la misma imagen -> coincide", "coincide con la imagen principal" in t and mc and mc["coincide"], mc)
        t = abrir("calidad_q75.jpg")
        caso("miniatura", "sin miniatura: lo dice y no deja a la vista la comparacion de la imagen anterior", "no tiene" in t and pg.evaluate("() => document.getElementById('miniCanvas').hidden"))

        # ELA: la zona pegada (comprimida una vez) frente al resto (dos veces), y el control sin montaje
        rect = json.loads((insumos / "montaje_q70.json").read_text())["rect_pegado_x0y0x1y1"]
        medir = """(r) => { const e = ultimoELA, [x0, y0, x1, y1] = r, dentro = RP.mediaZona(e.orig, e.recomp, e.w, x0, y0, x1, y1);
            const total = RP.mediaZona(e.orig, e.recomp, e.w, 0, 0, e.w, e.h), n = e.w * e.h, nz = (x1 - x0) * (y1 - y0);
            return { dentro, fuera: (total * n - dentro * nz) / (n - nz) }; }"""
        ratios, absolutos = {}, {}
        for nombre in ("montaje_q70.jpg", "doble_q70.jpg"):  # flujo del usuario: Analizar (fija la calidad estimada) y ELA
            pg.set_input_files("#archivo", str(insumos / nombre)); pg.wait_for_timeout(700)
            pg.click("#btnIntegridad"); pg.wait_for_timeout(400)
            if Q_ELA != 0:  # QA_Q_ELA=N fuerza otra calidad (para medir); 0 = la que fija Analizar
                pg.evaluate(f"() => {{ document.getElementById('elaCalidad').value = {Q_ELA}; }}")
            qe = int(pg.input_value("#elaCalidad"))
            pg.click("#btnELA"); pg.wait_for_function(f"() => ultimoELA && ultimoELA.calidad === {qe} && document.getElementById('elaInfo').textContent.includes('error medio')", timeout=8000)
            m = pg.evaluate(medir, rect); ratios[nombre] = m["dentro"] / max(m["fuera"], 1e-6); absolutos[nombre] = m
            pg.locator("#elaCanvas").screenshot(path=str(SALIDA / f"03_mapa_ela_{nombre}.png"))
            pg.screenshot(path=str(SALIDA / f"02_ela_{nombre}.png"), full_page=True)
            pg.evaluate("() => { ultimoELA = null; }")
        # en niveles absolutos (no solo cociente: con recompresion casi idempotente el denominador es ~0)
        am, ad = absolutos["montaje_q70.jpg"], absolutos["doble_q70.jpg"]
        # criterio relativo: el nivel absoluto depende de cuantos bordes tenga la zona (0.29 en una foto, 0.06 en el sintetico)
        caso("ELA", f"montaje (ELA a q{qe}): la zona pegada destaca (x5 sobre el resto y x10 sobre la misma zona sin montaje)",
             ratios["montaje_q70.jpg"] > 5 and am["dentro"] > 10 * max(ad["dentro"], 0.001),
             f"dentro {am['dentro']:.3f} · fuera {am['fuera']:.3f} niveles · x{ratios['montaje_q70.jpg']:.1f}")
        caso("ELA", f"control (ELA a q{qe}): sin montaje la misma zona no destaca (< 0.05 niveles)", ad["dentro"] < 0.05,
             f"dentro {ad['dentro']:.3f} · fuera {ad['fuera']:.3f} niveles")
        caso("ELA", "Analizar fija la calidad del ELA en la estimada (70)", qe == 70 or Q_ELA != 0, qe)
        pg.click("#btnELA"); pg.wait_for_function("() => ultimoELA", timeout=8000)
        n0 = pg.evaluate("() => fuentes.length"); pg.click("#btnElaAbrir"); pg.wait_for_timeout(500)
        d = pg.evaluate("() => ({ n: fuentes.length, der: F0().derivado, nombre: F0().nombre })")
        caso("ELA", "abrir ELA como imagen: nueva fuente derivada con su origen", d["n"] == n0 + 1 and d["der"]["analisis"] == "ELA", d)
        with pg.expect_download() as dl:
            pg.click("#btnJson")
        reg = json.loads(dl.value.path().read_text())
        caso("registro", "el registro JSON lleva el origen derivado", reg["fuente"]["derivado"]["analisis"] == "ELA", reg["fuente"]["derivado"])
        # ---------------- mapas de calor con montajes de verdad conocida (generar_insumos.py) y sus controles
        def mapa(nombre, boton, q=None):
            pg.set_input_files("#archivo", str(insumos / nombre)); pg.wait_for_timeout(700)
            if q: pg.evaluate(f"() => {{ document.getElementById('ghostQ').value = {q}; }}")
            pg.click(boton); pg.wait_for_function("() => ultimoMapa && !document.getElementById('mapaCanvas').hidden", timeout=30000)
        dentro_fuera = """(r) => { const m = ultimoMapa, [x0, y0, x1, y1] = r, F = F0();
            const din = RP.mediaBloquesRect(m.vals, m.gw, m.B, x0, y0, x1, y1);
            let s = 0, n = 0; for (let by = 0; by < Math.floor(F.h / m.B); by++) for (let bx = 0; bx < Math.floor(F.w / m.B); bx++) {
              const X0 = bx * m.B, Y0 = by * m.B; if (X0 + m.B <= x0 || X0 >= x1 || Y0 + m.B <= y0 || Y0 >= y1) { s += m.vals[by * m.gw + bx]; n++; } }
            return { dentro: din, fuera: s / n }; }"""
        if (insumos / "ruido_montaje.json").is_file():
            zr = json.loads((insumos / "ruido_montaje.json").read_text())["rect_x0y0x1y1"]
            mapa("ruido_montaje.png", "#btnMapaRuido"); r1 = pg.evaluate(dentro_fuera, zr)
            caso("mapas", "ruido: la zona con ruido x4 destaca (razon dentro > 2.5x fuera)", r1["dentro"] > 2.5 * r1["fuera"], f"dentro {r1['dentro']:.2f} · fuera {r1['fuera']:.2f}")
            mapa("ruido_control.png", "#btnMapaRuido"); r0 = pg.evaluate(dentro_fuera, zr)
            caso("mapas", "control ruido: sin montaje la misma zona no destaca (0.75-1.33)", 0.75 < r0["dentro"] / r0["fuera"] < 1.33, f"dentro {r0['dentro']:.2f} · fuera {r0['fuera']:.2f}")
            pg.locator("#mapaCanvas").screenshot(path=str(SALIDA / "04_mapa_ruido_control.png"))
            zg = json.loads((insumos / "ghost_montaje.json").read_text())["rect_x0y0x1y1"]
            mapa("ghost_montaje.jpg", "#btnGhost", 60); g1 = pg.evaluate(dentro_fuera, zg)
            pg.locator("#mapaCanvas").screenshot(path=str(SALIDA / "05_ghost_q60_montaje.png"))
            caso("mapas", "JPEG ghost a q60: la zona comprimida antes a q60 sale oscura (dentro < 0.5x fuera)", g1["dentro"] < 0.5 * g1["fuera"], f"dentro {g1['dentro']:.3f} · fuera {g1['fuera']:.3f}")
            mapa("ghost_control.jpg", "#btnGhost", 60); g0 = pg.evaluate(dentro_fuera, zg)
            caso("mapas", "control ghost: sin montaje la misma zona no se oscurece a q60 (dentro > 0.7x fuera)", g0["dentro"] > 0.7 * g0["fuera"], f"dentro {g0['dentro']:.3f} · fuera {g0['fuera']:.3f}")
        caso("errores", "sin errores de JS", not errores, errores[:5])
        nav.close()
    fallos = [x for x in res if not x["ok"]]
    (SALIDA / "resultados.json").write_text(json.dumps({"casos": res, "ratios_ela": ratios, "ela_absoluto": absolutos, "miniatura": {"distinta": md, "coincide": mc}}, indent=2, ensure_ascii=False))
    (SALIDA / "REPORTE.md").write_text(f"# QA integridad — {NAV}\n\n{len(res)} casos, {len(fallos)} fallos\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n"
                                       + "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/')} |" for x in res) + "\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
