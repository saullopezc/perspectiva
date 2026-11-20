#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_superres.py — Superresolucion con varios fotogramas frente a una verdad conocida
# (tests/web/generar_insumos.py superres(): 12 fotogramas reducidos x3 y desplazados
# tercios de pixel). Mide la NCC de luminancia de la salida con la verdad para: un
# fotograma solo, la media de la pila y la superresolucion (sin y con deconvolucion);
# la superresolucion tiene que superar a la media. Luego lo mismo con los puntos
# SEGUIDOS desde el primer fotograma (no los exactos), como en el uso real. La comparacion
# justa es con la media mas LA MISMA deconvolucion: la mayor parte de la ganancia viene de
# deshacer el promedio del sensor; volver a los pixeles originales anade el resto.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_superres.py DIR_SUPERRES
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
CHROME = Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
NAV = os.environ.get("QA_NAV", "chromium")
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_superres_{NAV}"
HTML = RAIZ / "tools" / "web" / "perspectiva.html"
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:400]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre}  {detalle}")


# NCC de luminancia entre la salida (limpia) y la verdad, decodificada en el propio navegador
NCC = """async (b64) => {
  const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
  const c = document.createElement('canvas'); c.width = limpia.width; c.height = limpia.height;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height); const v = x.getImageData(0, 0, c.width, c.height).data, s = limpia.data;
  let n = 0, a = 0, b = 0, aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < s.length; i += 4) { const p = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2], q = 0.299 * v[i] + 0.587 * v[i + 1] + 0.114 * v[i + 2];
    n++; a += p; b += q; aa += p * p; bb += q * q; ab += p * q; }
  return (ab - a * b / n) / Math.sqrt((aa - a * a / n) * (bb - b * b / n)); }"""


def main(d):
    d = Path(d).resolve(); SALIDA.mkdir(parents=True)
    meta = json.loads((d / "superres.json").read_text()); W, H = meta["verdad_wh"]
    verdad = base64.b64encode((d / meta["verdad"]).read_bytes()).decode()
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        pg = nav.new_page(viewport={"width": 1600, "height": 1000}); errores = []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        pg.goto(HTML.as_uri()); pg.wait_for_timeout(800)
        pg.set_input_files("#archivo", [str(d / f["nombre"]) for f in meta["fotogramas"]]); pg.wait_for_function(f"() => fuentes.length === {len(meta['fotogramas'])}", timeout=20000)
        poner_esquinas = """(lista) => { lista.forEach((E, i) => { fuentes[i].esquinas = E.map(p => [...p]); }); seleccionar(0); procesarYa(); }"""
        pg.evaluate(poner_esquinas, [f["esquinas_SI_SD_ID_II"] for f in meta["fotogramas"]])
        # salida del tamano de la verdad (W x H): alto en px y proporcion (despues de seleccionar: cada imagen guarda sus ajustes)
        pg.evaluate("""([h, an, al]) => { for (const [k, v] of [['altoPx', h], ['anchoCm', an], ['altoCm', al]]) { const e = document.querySelector(`[data-p=${k}]`); e.value = v; e.dispatchEvent(new Event('input')); } procesarYa(); }""",
                    [H, W / 10, H / 10])
        dims = pg.evaluate("() => [limpia.width, limpia.height]")
        caso("preparacion", "la salida tiene el tamano de la verdad", dims == [W, H], dims)

        def medir(modo, iter_=8, sigma=0.3, alin="no"):
            pg.evaluate("""([modo, it, sg, al]) => { const s = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); };
                s('alinPila', al); s('srIter', it); s('srSigma', sg); s('modoPila', modo === 'solo' ? 'media' : modo);
                if (modo !== 'solo' && !pila.length) { apilarLista(fuentes, false); }
                document.getElementById('verPila').checked = modo !== 'solo'; procesarYa(); }""", [modo, iter_, sigma, alin])
            return 1 - pg.evaluate(NCC, verdad)  # error: 1 - NCC (cuanto menos, mas parecido a la verdad)

        # la comparacion justa: la media de la pila con LA MISMA deconvolucion (misma PSF e iteraciones) que la superresolucion
        MEDIA_RL = """(it) => { const n = limpia.width * limpia.height, w = limpia.width, h = limpia.height, s = ultimoSR.sigmaPsf;
            const m = RP.mezclarPila(usados(ultimaPlana).map(p => p.rgb), n * 3, 'media'), o = new Float32Array(n * 3);
            for (let c = 0; c < 3; c++) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = m[i * 3 + c]; const r = RP.rlGaussiano(a, w, h, s, it); for (let i = 0; i < n; i++) o[i * 3 + c] = r[i]; }
            const im = RP.cadenaAjustes({ w, h, rgb: o }, parametros()); limpia = im; }"""

        solo = medir("solo")
        media = medir("media")
        sr0 = medir("superres", 0)
        sr8 = medir("superres", 8)
        info = pg.text_content("#infoSR")
        pg.locator("#salida").screenshot(path=str(SALIDA / "01_superres_exactos.png"))
        pg.evaluate(MEDIA_RL, 8); media_rl = 1 - pg.evaluate(NCC, verdad)
        caso("exactos", "la media de 12 fotogramas mejora a uno solo", media < solo, f"error uno {solo:.5f} · media {media:.5f}")
        caso("exactos", "superresolucion + deconvolucion: menos de la mitad de error que la media", sr8 < 0.5 * media, f"media {media:.5f} · superres sin deconvolucion {sr0:.5f} · con RL8 {sr8:.5f}")
        caso("exactos", "comparacion justa: supera a la media con la misma deconvolucion (misma PSF e iteraciones)", sr8 < media_rl, f"media+RL8 {media_rl:.5f} · superres+RL8 {sr8:.5f} ({100 * (1 - sr8 / media_rl):.0f} % menos error)")
        caso("exactos", "informa fotogramas y pixeles de salida por pixel original (3)", "12 fotogramas" in info and "3.00 px de salida" in info, info)
        # cache: mover un ajuste que no es de la superresolucion no la recalcula
        t = pg.evaluate("() => { const a = ultimoSR.ms; const e = document.querySelector('[data-p=gamma]') || document.querySelector('[data-p=brillo]'); if (e) { e.value = +e.value + 0.01; e.dispatchEvent(new Event('input')); } procesarYa(); return [a, ultimoSR.ms, !!e]; }")
        caso("cache", "un ajuste de color no recalcula la superresolucion (cache)", t[2] and t[0] == t[1], t)

        # seguimiento real: esquinas exactas solo en el primero; las demas se buscan por correlacion
        pg.evaluate("() => { pila.length = 0; fuentes.forEach((F, i) => { if (i) { F.esquinas = []; delete F.seguimiento; } }); procesarYa(); }")
        r = pg.evaluate("() => seguirReferencias(F0(), fuentes)")
        err = pg.evaluate("(L) => Math.max(...fuentes.map((F, i) => Math.max(...F.esquinas.map((p, k) => Math.hypot(p[0] - L[i][k][0], p[1] - L[i][k][1]))))) ", [f["esquinas_SI_SD_ID_II"] for f in meta["fotogramas"]])
        caso("seguidos", "el seguimiento encuentra los 11 y con error < 0.15 px", r["ok"] == 11 and err < 0.15, f"{r} · error max {err:.3f} px")
        pg.evaluate("() => { apilarLista(fuentes); }")
        media_s, sr_s = medir("media"), medir("superres", 8)
        pg.locator("#salida").screenshot(path=str(SALIDA / "02_superres_seguidos.png"))
        caso("seguidos", "con puntos seguidos: superresolucion + deconvolucion con menos de la mitad de error que la media", sr_s < 0.5 * media_s, f"media {media_s:.5f} · superres+RL8 {sr_s:.5f}")
        caso("errores", "sin errores de JS", not errores, errores[:5])
        nav.close()
    fallos = [x for x in res if not x["ok"]]
    (SALIDA / "REPORTE.md").write_text(f"# QA superresolucion — {NAV}\n\n{len(res)} casos, {len(fallos)} fallos\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n"
                                       + "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/')} |" for x in res) + "\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
