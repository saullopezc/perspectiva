#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_sintesis.py — Experimento y QA de la comparacion por sintesis en navegador real.
# Sobre el rotulo sintetico (texto conocido P 123ABC) reducida a varias resoluciones:
#   1) calibra la degradacion con REFERENCIA (texto claro sobre la franja azul),
#   2) fija la degradacion y encaja la plantilla del numero,
#   3) compara 30 candidatas (P1?3ABC y P123A?C) y mide el puesto de la real y el margen.
# Controles: a 2x la real debe ganar; el desenfoque anadido (sigma 1.2) debe detectarse en
# la calibracion. Las demas escalas se MIDEN y se informan (no se maquillan).
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_sintesis.py DIR_INSUMOS
#       DIR_INSUMOS: sintetica_x{2,6,10,14}.png/.json y sintetica_x6_gauss1.2 (generar_reducidas.py)
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
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_sintesis_{NAV}"
REAL = "P123ABC"
res, medidas = [], []

GRID = """([txt, base, g]) => { const m = modeloDegradacion(); let mejor = null;
  for (const altoPct of g.alto) for (const anchoPct of g.ancho) for (const dyPct of g.dy) {
    const p = { ...base, altoPct, anchoPct, dyPct };
    let v; try { v = puntuar(contextoSintesis(txt, p), txt, p, m).ncc; } catch (e) { continue; }
    if (!mejor || v > mejor.v) mejor = { v, p };
  }
  for (const k of ['altoPct', 'anchoPct', 'dyPct', 'dxPct']) document.getElementById({ altoPct: 'altoTxt', anchoPct: 'anchoTxt', dyPct: 'dyTxt', dxPct: 'dxTxt' }[k]).value = mejor.p[k];
  return mejor.v; }"""


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:500]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre}  {detalle}")


def sesion(nav, img, meta, encaje_numero=None, encaje_guate=None):
    """Una imagen: calibra con REFERENCIA, encaja el numero y compara. Devuelve medidas."""
    ctx = nav.new_context(viewport={"width": 1600, "height": 1000})
    pg = ctx.new_page()
    errores = []
    pg.on("pageerror", lambda e: errores.append(str(e)))
    pg.goto(HTML.as_uri()); pg.wait_for_timeout(1200)
    pg.evaluate("() => document.querySelectorAll('#panel details.bloque').forEach(d => (d.open = true))")
    pg.set_input_files("#archivo", str(img)); pg.wait_for_timeout(600)
    pg.evaluate("(E) => { F0().esquinas = E.map(p => [...p]); dibujarFuente(); procesarYa(); }", meta["esquinas_SI_SD_ID_II"])
    poner = lambda sel, v: pg.evaluate("([s, v]) => { const el = document.querySelector(s); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }", [sel, v])
    texto = lambda sel: pg.text_content(sel)
    # 1) calibracion con texto conocido: REFERENCIA, claro sobre la franja azul
    poner("#negritaTxt", False); poner("#fuenteTxt", "Barlow Semi Condensed"); poner("#textoClaro", True)
    poner("#degTipo", "gauss"); poner("#degFijar", False); poner("#degSigma", "0.8"); poner("#espTxt", "0")
    pg.fill("#plantilla", "REFERENCIA")
    base = pg.evaluate("() => plantillaParams()")
    if encaje_guate is None:
        pg.evaluate(GRID, ["REFERENCIA", {**base, "dxPct": 0}, {"alto": list(range(10, 26, 2)), "ancho": list(range(60, 150, 10)), "dy": list(range(-44, -31, 2))}])
    else:  # la misma colocacion a mano que en otra imagen con la misma geometria
        for k, i in (("altoPct", "#altoTxt"), ("anchoPct", "#anchoTxt"), ("dyPct", "#dyTxt"), ("dxPct", "#dxTxt"), ("esp", "#espTxt"), ("grosorPct", "#grosorTxt")):
            poner(i, str(encaje_guate[k]))
    pg.click("#btnAjustar"); pg.wait_for_timeout(200)
    guate = pg.evaluate("() => plantillaParams()")
    cal = texto("#infoComparar")
    sigma = float(pg.input_value("#degSigma"))
    ncc_cal = float(cal.split("NCC ")[1].split()[0]) if "NCC " in cal else None
    # 2) numero: degradacion fijada, texto oscuro, encaje (rejilla gruesa = acercarla a mano; se reutiliza)
    poner("#degFijar", True); poner("#textoClaro", False); poner("#fuenteTxt", "Oswald")
    pg.fill("#plantilla", "P 123ABC")
    if encaje_numero is None:
        b = pg.evaluate("() => plantillaParams()")
        pg.evaluate(GRID, ["P 123ABC", {**b, "dxPct": 0}, {"alto": list(range(50, 86, 5)), "ancho": list(range(60, 160, 10)), "dy": list(range(-6, 7, 2))}])
    else:
        for k, i in (("altoPct", "#altoTxt"), ("anchoPct", "#anchoTxt"), ("dyPct", "#dyTxt"), ("dxPct", "#dxTxt"), ("esp", "#espTxt"), ("grosorPct", "#grosorTxt")):
            poner(i, str(encaje_numero[k]))
    pg.click("#btnAjustar"); pg.wait_for_timeout(200)
    ajuste_num = texto("#infoComparar")
    encaje = pg.evaluate("() => plantillaParams()")
    # 3) candidatas
    pg.fill("#candidatos", "P1?3ABC\nP123A?C")
    pg.click("#btnComparar"); pg.wait_for_timeout(300)
    info = texto("#infoComparar")
    filas = pg.eval_on_selector_all("#tablaRanking tr", "trs => trs.map(t => [...t.children].map(c => c.textContent))")
    ranking = pg.evaluate("() => ultimoRanking")
    pg.screenshot(path=str(SALIDA / f"{img.stem}.png"), full_page=True)
    ctx.close()
    puesto = next((i + 1 for i, f in enumerate(filas) if f[1].replace(" ", "") == REAL), None)
    return {"imagen": img.name, "px_rotulo": None, "sigma_cal": sigma, "ncc_cal": ncc_cal, "calibracion": cal, "ajuste_numero": ajuste_num,
            "puesto_real": puesto, "top3": [f[1] + " " + f[2] for f in filas[:3]], "info": info, "ranking": ranking, "encaje": encaje, "encaje_guate": guate, "errores": errores}


def main(insumos):
    insumos = Path(insumos).resolve()
    SALIDA.mkdir(parents=True)
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        encaje = None
        for s in (2, 6, 10, 14):
            meta = json.loads((insumos / f"sintetica_x{s}.json").read_text())
            E = meta["esquinas_SI_SD_ID_II"]
            ancho_rotulo = ((E[1][0] - E[0][0]) ** 2 + (E[1][1] - E[0][1]) ** 2) ** 0.5
            m = sesion(nav, insumos / f"sintetica_x{s}.png", meta, encaje)
            if s == 2:
                encaje = m["encaje"]
            m["px_rotulo"] = round(ancho_rotulo, 1); m["px_por_caracter"] = round(ancho_rotulo * 0.926 / 7.6, 1)
            medidas.append(m)
            print(f"x{s}: rotulo {m['px_rotulo']} px de ancho (~{m['px_por_caracter']} px/caracter) · sigma cal {m['sigma_cal']} · NCC cal {m['ncc_cal']} · puesto real {m['puesto_real']} · {m['top3']}")
            caso("errores", f"x{s}: sin errores de JS", not m["errores"], m["errores"][:3])
        g = sesion(nav, insumos / "sintetica_x6_gauss1.2.png", json.loads((insumos / "sintetica_x6_gauss1.2.json").read_text()), medidas[1]["encaje"], medidas[1]["encaje_guate"])
        g["px_rotulo"] = medidas[1]["px_rotulo"]; g["px_por_caracter"] = medidas[1]["px_por_caracter"]
        medidas.append(g)
        print(f"x6 + gauss 1.2: sigma cal {g['sigma_cal']} · puesto real {g['puesto_real']} · {g['top3']}")
        nav.close()
    m2, m6 = medidas[0], medidas[1]
    caso("calibracion", "REFERENCIA encaja a x2 (NCC > 0.5)", (m2["ncc_cal"] or 0) > 0.5, m2["calibracion"])
    # criterio relativo: el valor absoluto depende de como rasteriza el texto cada navegador (Firefox suaviza mas los
    # bordes de la plantilla y estima menos sigma: medido 0.35 -> 0.75 en Firefox, 0.35 -> 1.6 en Chromium)
    caso("calibracion", "control positivo: el desenfoque anadido (sigma 1.2) sube la sigma calibrada (+0.3 y x1.5)",
         g["sigma_cal"] - m6["sigma_cal"] >= 0.3 and g["sigma_cal"] >= 1.5 * max(m6["sigma_cal"], 0.1), f"x6 {m6['sigma_cal']} -> x6+gauss {g['sigma_cal']}")
    caso("ranking", "a x2 el texto real queda primero", m2["puesto_real"] == 1, f"{m2['top3']} · {m2['info']}")
    caso("ranking", "el informe dice si hay empate o el margen", all(("EMPATE" in x["info"]) or ("margen" in x["info"]) for x in medidas), "")
    (SALIDA / "medidas.json").write_text(json.dumps(medidas, indent=2, ensure_ascii=False))
    fallos = [x for x in res if not x["ok"]]
    tabla = "\n".join(f"| {x['imagen']} | {x['px_rotulo']} | {x['px_por_caracter']} | {x['sigma_cal']} | {x['ncc_cal']} | {x['puesto_real']} | {' · '.join(x['top3'])} |" for x in medidas)
    (SALIDA / "REPORTE.md").write_text(
        f"# QA comparacion por sintesis — {NAV}\n\n{len(res)} casos, {len(fallos)} fallos\n\n"
        "## Medidas (no son pass/fail salvo los casos de abajo)\n\n| imagen | ancho del rotulo px | px/caracter aprox. | sigma calibrada | NCC calibracion | puesto de P123ABC (de 30) | top 3 (NCC) |\n|---|---|---|---|---|---|---|\n"
        + tabla + "\n\n## Casos\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n"
        + "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/')} |" for x in res) + "\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
