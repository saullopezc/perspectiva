#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_publicado.py — Prueba la carpeta publicable (tools/publicar_web.py) servida por
# HTTP como en un alojamiento real: carga sin errores, ninguna peticion sale de su
# origen, no aparecen terminos retirados en lo que se ve, una imagen se procesa, la
# ayuda abre y el informe se descarga.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_publicado.py CARPETA_PUBLICADA IMAGEN
# Author: Saul López
# Date:   2026-11-19
# -----------------------------------------------------------------------------
import functools
import http.server
import json
import os
import re
import sys
import threading
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
CHROME = Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
NAV = os.environ.get("QA_NAV", "chromium")
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_publicado_{NAV}"
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:400]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre}  {detalle}")


def main(carpeta, imagen):
    carpeta, imagen = Path(carpeta).resolve(), Path(imagen).resolve()
    SALIDA.mkdir(parents=True)
    manejador = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(carpeta))
    manejador.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), manejador)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origen = f"http://127.0.0.1:{srv.server_address[1]}"
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        ctx = nav.new_context(accept_downloads=True, viewport={"width": 1600, "height": 1000})
        pg = ctx.new_page()
        errores, peticiones = [], []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("request", lambda r: peticiones.append(r.url))
        pg.goto(origen + "/"); pg.wait_for_timeout(1500)
        caso("carga", "titulo de la pagina", pg.title() == "Perspectiva", pg.title())
        pg.set_input_files("#archivo", str(imagen)); pg.wait_for_timeout(1200)
        pg.click("label:has(input[name=modoGeo][value=completa])"); pg.wait_for_function("() => limpia", timeout=5000)
        caso("uso", "una imagen se carga y se procesa (imagen completa)", pg.evaluate("() => limpia.width") > 0)
        fuera = [u for u in peticiones if not (u.startswith(origen) or u.startswith("blob:") or u.startswith("data:"))]
        caso("privacidad", "ninguna peticion sale del origen de la pagina", not fuera, fuera[:5] or f"{len(peticiones)} peticiones, todas locales")
        caso("privacidad", "no pide las fuentes locales opcionales (_local) servida por HTTP", not any("_local" in u for u in peticiones))
        visible = pg.evaluate("() => document.body.innerText + ' ' + document.title")
        caso("textos", "lo que se ve no dice forense, pericial, perito, dictamen ni evidencia", not re.search(r"forens|peric|perit|dictamen|evidencia", visible, re.I))
        pg.click("#btnAyuda"); pg.wait_for_timeout(200)
        ay = pg.text_content("#ayudaCuerpo")
        caso("ayuda", "la ayuda abre y tampoco usa esos terminos", "Manual de uso" in ay and not re.search(r"forens|peric|perit|dictamen|evidencia", ay, re.I))
        pg.keyboard.press("Escape")
        pg.evaluate("() => document.querySelectorAll('#panel details.bloque').forEach(d => (d.open = true))")
        with pg.expect_download() as d:
            pg.click("#btnInforme")
        t = d.value.path().read_text(encoding="utf-8")
        caso("informe", "el informe se descarga, tiene sus secciones y no usa esos terminos",
             "Archivos cargados" in t and "Registro JSON" in t and not re.search(r"forens|peric|perit|dictamen|evidencia", t, re.I))
        caso("errores", "sin errores de JS", not errores, errores[:5])
        pg.screenshot(path=str(SALIDA / "publicado.png"))
        nav.close()
    srv.shutdown()
    fallos = [x for x in res if not x["ok"]]
    (SALIDA / "REPORTE.md").write_text(f"# QA carpeta publicada — {NAV}\n\nCarpeta: {carpeta}\n\n{len(res)} casos, {len(fallos)} fallos\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n"
                                       + "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/')} |" for x in res) + "\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
