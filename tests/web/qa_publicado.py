#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_publicado.py — Prueba la carpeta publicable (tools/publicar_web.py) servida por
# HTTP como en un alojamiento real: carga sin errores, ninguna peticion sale de su
# origen, no aparecen terminos retirados en lo que se ve, una imagen se procesa, la
# ayuda abre, el informe se descarga y el boton Actualizar detecta una version nueva.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_publicado.py CARPETA_PUBLICADA IMAGEN
# Author: Saul López
# Date:   2026-11-19
# Modified By:   Saul López
# Modified Date: 2026-11-19
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
        lic = pg.evaluate("""async () => { const enlaces = [...document.querySelectorAll('#ayudaCuerpo a[href^="fuentes/"]')].map(a => a.getAttribute('href'));
            const ok = []; for (const h of enlaces) ok.push((await fetch(h)).ok);
            const t = async (u) => { const r = await fetch(u); return r.ok ? (await r.text()).slice(0, 60) : null; };
            return { seccion: !!document.getElementById('ay-licencias'), fuentes: enlaces.length, fuentesOk: ok.every(Boolean), licencia: await t('LICENSE.txt'), aviso: await t('NOTICE.txt') }; }""")
        caso("licencias", "la Ayuda trae la seccion Licencias y las 5 licencias OFL de las fuentes responden", lic["seccion"] and lic["fuentes"] == 5 and lic["fuentesOk"], lic)
        caso("licencias", "el sitio sirve LICENSE.txt (Apache 2.0) y NOTICE.txt", lic["licencia"] and "Apache License" in lic["licencia"] and lic["aviso"] and "Perspectiva" in lic["aviso"], lic["licencia"])
        gh = pg.evaluate("() => { const a = document.getElementById('enlaceRepo'); return a && { href: a.href, target: a.target, rel: a.rel }; }")
        caso("licencias", "enlace a GitHub en la cabecera, en otra pestana y con noopener", gh and gh["href"].startswith("https://github.com/") and gh["target"] == "_blank" and "noopener" in gh["rel"], gh)
        pg.keyboard.press("Escape")
        pg.evaluate("() => document.querySelectorAll('#panel details.bloque').forEach(d => (d.open = true))")
        with pg.expect_download() as d:
            pg.click("#btnInforme")
        t = d.value.path().read_text(encoding="utf-8")
        caso("informe", "el informe se descarga, tiene sus secciones y no usa esos terminos",
             "Archivos cargados" in t and "Registro JSON" in t and not re.search(r"forens|peric|perit|dictamen|evidencia", t, re.I))
        # boton Actualizar: primero al dia (la version incrustada coincide con version.json), luego una publicacion
        # nueva simulada (version.json interceptado): pregunta, avisa de lo que se pierde y recarga con ?v=<nueva>
        propia = pg.get_attribute('meta[name="perspectiva-version"]', "content")
        servida = json.loads((carpeta / "version.json").read_text())["version"]
        caso("version", "index.html lleva la version publicada en version.json", propia == servida and propia != "desarrollo", f"{propia} / {servida}")
        pg.click("#btnVersion"); pg.wait_for_function("() => /Al dia|No se pudo/.test(document.getElementById('estado').textContent)", timeout=5000)
        caso("version", "con la version publicada dice que esta al dia", "Al dia" in pg.text_content("#estado"), pg.text_content("#estado"))
        pg.route("**/version.json*", lambda r: r.fulfill(status=200, content_type="application/json", body='{"version": "0123456789abcdef"}'))
        dialogos = []
        def responder(d):
            dialogos.append(d.message); d.dismiss() if len(dialogos) == 1 else d.accept()
        pg.on("dialog", responder)
        pg.click("#btnVersion"); pg.wait_for_function("() => /sin cargar/.test(document.getElementById('estado').textContent)", timeout=5000)
        caso("version", "con una version nueva pregunta y avisa de que se pierde lo cargado; si se cancela no recarga",
             dialogos and "0123456789abcdef" in dialogos[0] and "descarta" in dialogos[0] and pg.evaluate("() => limpia.width") > 0, dialogos[:1])
        with pg.expect_navigation():
            pg.click("#btnVersion")
        pg.wait_for_timeout(800)
        caso("version", "si se acepta, recarga con ?v=<version nueva>", "?v=0123456789abcdef" in pg.url and pg.title() == "Perspectiva", pg.url)
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
