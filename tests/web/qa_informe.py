#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_informe.py — QA en navegador real del informe de analisis (HTML) de
# tools/web/perspectiva.html: contenido contra datos independientes (hashlib),
# autocontenido (sin recursos externos), nombres hostiles escapados, registro JSON
# recuperable, hash del propio informe anotado, y que el informe abre sin errores.
#
# Uso:  [QA_NAV=firefox] python3 tests/web/qa_informe.py DIR_MUESTRAS
#       DIR_MUESTRAS: DIR_BASE/muestras de tests/web/generar_insumos.py (usa muestra_a.png y muestra_b.png)
# Author: Saul López
# Date:   2026-11-16
# Modified By:   Saul López
# Modified Date: 2026-11-19
# -----------------------------------------------------------------------------
import hashlib
import html
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
HTML = RAIZ / "tools" / "web" / "perspectiva.html"
CHROME = Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
NAV = os.environ.get("QA_NAV", "chromium")
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_informe_{NAV}"
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:400]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre}  {detalle}")


def main(muestras):
    muestras = Path(muestras).resolve()
    SALIDA.mkdir(parents=True)
    # nombre que, sin escapar, inyectaria HTML; fuera de SALIDA: los artefactos de GitHub no admiten < > " en los nombres
    hostil = Path(tempfile.mkdtemp(prefix="hostil_")) / 'imagen <b>x<i> & "q".png'
    shutil.copyfile(muestras / "muestra_b.png", hostil)
    b = hostil.read_bytes(); h = {k: hashlib.new(k, b).hexdigest() for k in ("md5", "sha1", "sha256")}
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        ctx = nav.new_context(accept_downloads=True, viewport={"width": 1600, "height": 1000})
        pg = ctx.new_page()
        errores = []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" and "downloadable font" not in m.text else None)
        pg.goto(HTML.as_uri()); pg.wait_for_timeout(1200)
        pg.evaluate("() => document.querySelectorAll('#panel details.bloque').forEach(d => (d.open = true))")
        poner = lambda sel, v: pg.evaluate("([s, v]) => { const el = document.querySelector(s); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }", [sel, v])
        pg.set_input_files("#archivo", str(hostil))
        pg.wait_for_function("() => document.getElementById('metaInfo').textContent.includes('MD5 ')", timeout=10000)
        pg.evaluate("() => { F0().esquinas = [[128, 92], [612, 92], [612, 330], [128, 330]]; procesarYa(); }")
        poner("[data-p=interp]", "bicubica")
        poner("#fuenteTxt", "Barlow"); pg.fill("#plantilla", "P 492GZC"); pg.fill("#candidatos", "P49?GZC")
        pg.click("#btnComparar"); pg.wait_for_function("() => ultimoRanking", timeout=20000)
        top = pg.evaluate("() => ultimoRanking.top[0].txt")
        pg.click("#btnIntegridad"); pg.wait_for_timeout(400); pg.click("#btnELA"); pg.wait_for_function("() => ultimoELA", timeout=8000)
        pg.select_option("#formatoExp", "png")
        with pg.expect_download() as d:
            pg.click("#btnExportar")
        d.value.save_as(SALIDA / d.value.suggested_filename)
        with pg.expect_download() as d:
            pg.click("#btnInforme")
        inf = SALIDA / d.value.suggested_filename; d.value.save_as(inf)
        t = inf.read_text(encoding="utf-8")
        li = pg.get_attribute("#listaExport li", "title") or ""
        caso("contenido", "aviso de documento de trabajo, sin terminos retirados (forense, pericial, perito, dictamen, evidencia)",
             "documento de trabajo" in t and not re.search(r"forens|peric|perit|dictamen|evidencia", t, re.I))
        caso("contenido", "MD5, SHA-1 y SHA-256 del archivo = hashlib", all(v in t for v in h.values()), {k: v[:12] for k, v in h.items()})
        caso("contenido", "control: un hash que no es del archivo no aparece", hashlib.md5(b + b"x").hexdigest() not in t)
        caso("seguridad", "nombre hostil escapado (sin <b> inyectado)", "imagen &lt;b&gt;x&lt;i&gt; &amp; &quot;q&quot;.png" in t and "<b>x<i>" not in t)
        recursos = re.findall(r'(?:src|href)\s*=\s*"([^"]*)"', t)
        caso("autocontenido", "todas las imagenes y recursos son data: (nada externo)", recursos and all(u.startswith("data:") for u in recursos), f"{len(recursos)} recursos")
        caso("contenido", "al menos 4 imagenes (original, salida, plantilla, ELA)", sum(u.startswith("data:image/png") for u in recursos) >= 4, sum(u.startswith("data:image/png") for u in recursos))
        caso("contenido", "parametros cambiados: interp bicubica frente a vecino", re.search(r"interp</td><td>vecino</td><td><b>bicubica</b>", t) is not None)
        caso("contenido", f"ranking por sintesis con la primera candidata ({top})", f"<b>{top}</b>" in t)
        m = re.search(r'<pre id="registro">(.*?)</pre>', t, re.S); reg = json.loads(html.unescape(m.group(1))) if m else {}
        caso("registro", "registro JSON incrustado recuperable y coherente", reg.get("fuente", {}).get("sha256") == h["sha256"] and reg.get("comparacion", {}).get("top", [{}])[0].get("txt") == top)
        caso("hash", "el hash del propio informe queda anotado en exportaciones", hashlib.sha256(inf.read_bytes()).hexdigest() in li and hashlib.md5(inf.read_bytes()).hexdigest() in li, li[:80])
        # el informe abierto por si mismo: sin errores y con las imagenes decodificadas
        pg2 = ctx.new_page(); err2 = []
        pg2.on("pageerror", lambda e: err2.append(str(e))); pg2.on("console", lambda m: err2.append(m.text) if m.type == "error" else None)
        pg2.goto(inf.as_uri()); pg2.wait_for_timeout(600)
        imgs = pg2.evaluate("() => [...document.images].map(i => i.complete && i.naturalWidth > 0)")
        caso("abrir", "el informe abre sin errores y todas sus imagenes cargan", not err2 and imgs and all(imgs), f"{len(imgs)} imagenes · {err2[:2]}")
        pg2.screenshot(path=str(SALIDA / "informe.png"), full_page=True)
        # ---------------- sesion: carrusel (quitar / anadir), documentos y ayuda
        nota = SALIDA / "nota.txt"; nota.write_text("documento de prueba\n")
        pg.set_input_files("#archivo", [str(muestras / "muestra_a.png"), str(nota)]); pg.wait_for_timeout(1000)
        inj = pg.evaluate("() => ({ etiquetas: document.querySelectorAll('#carrusel figcaption *').length, textos: [...document.querySelectorAll('#carrusel figcaption')].map(f => f.textContent) })")
        caso("sesion", "carrusel: el nombre hostil se muestra como texto (sin HTML inyectado)", inj["etiquetas"] == 0 and hostil.name in inj["textos"], inj)
        n0 = pg.evaluate("() => fuentes.length"); pg.click("#carrusel .hoja.actual .quitar"); pg.wait_for_timeout(400)
        q1 = pg.evaluate("() => ({ n: fuentes.length, ret: retiradas.map(r => r.nombre), opciones: [...document.getElementById('selArchivo').options].map(o => o.textContent) })")
        caso("sesion", "✕ quita la imagen actual del carrusel y su archivo de Metadatos, y lo anota", q1["n"] == n0 - 1 and "muestra_a.png" in q1["ret"] and not any("gt2004_azul" in o for o in q1["opciones"]), q1)
        pg.locator("body").click(position={"x": 5, "y": 5}); pg.keyboard.press("Delete"); pg.wait_for_function("() => fuentes.length === 0 && limpia === null", timeout=5000)
        q2 = pg.evaluate("() => ({ n: fuentes.length, vacio: !!document.querySelector('#carrusel .vacio'), limpia: limpia === null, tipo: limpia === null ? 'null' : typeof limpia + ' ' + (limpia && limpia.width), pend: pendiente, estado: document.getElementById('estado').textContent })")
        caso("sesion", "Supr quita la ultima imagen: carrusel vacio, sin salida", q2["n"] == 0 and q2["vacio"] and q2["limpia"] and "Sin imagenes" in q2["estado"], q2)
        idx = pg.evaluate("() => [...document.getElementById('selArchivo').options].find(o => o.textContent.includes('nota.txt')).value")
        pg.select_option("#selArchivo", idx); pg.click("#btnQuitarArchivo"); pg.wait_for_timeout(300)
        q3 = pg.evaluate("() => ({ ret: retiradas.map(r => r.nombre + '|' + r.clase), opciones: document.getElementById('selArchivo').options.length })")
        caso("sesion", "quitar un documento desde Metadatos lo anota con su clase", "nota.txt|archivo" in q3["ret"], q3)
        with pg.expect_file_chooser() as fc:
            pg.click("#btnAnadir")
        fc.value.set_files(str(muestras / "muestra_a.png")); pg.wait_for_timeout(900)
        caso("sesion", "＋ abre el selector y la imagen elegida entra al carrusel", pg.evaluate("() => fuentes.length") == 1)
        with pg.expect_download() as d:
            pg.click("#btnInforme")
        t2 = d.value.path().read_text(encoding="utf-8")
        caso("sesion", "el informe lista lo quitado de la sesion (nombre escapado, SHA-256)", "Quitados de la sesion" in t2 and "imagen &lt;b&gt;x&lt;i&gt;" in t2 and h["sha256"] in t2 and "nota.txt" in t2)
        # ayuda
        pg.click("#btnAyuda"); pg.wait_for_timeout(200)
        ay = pg.evaluate("() => ({ visible: !document.getElementById('ayuda').hidden, txt: document.getElementById('ayudaCuerpo').textContent, origen: document.getElementById('ayudaOrigen').textContent })")
        caso("ayuda", "Ayuda abre el manual completo con su origen", ay["visible"] and "5.7 Comparación por síntesis" in ay["txt"] and "8. Solución de problemas" in ay["txt"] and "sha256" in ay["origen"], ay["origen"])
        pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
        cerrada = pg.evaluate("() => document.getElementById('ayuda').hidden")
        pg.locator("body").click(position={"x": 5, "y": 5}); pg.keyboard.press("F1"); pg.wait_for_timeout(150)
        caso("ayuda", "Esc la cierra y F1 la vuelve a abrir", cerrada and not pg.evaluate("() => document.getElementById('ayuda').hidden"))
        pg.screenshot(path=str(SALIDA / "ayuda.png")); pg.keyboard.press("Escape")
        caso("errores", "sin errores de JS en la herramienta", not errores, errores[:5])
        nav.close()
    fallos = [x for x in res if not x["ok"]]
    (SALIDA / "REPORTE.md").write_text(f"# QA informe de analisis — {NAV}\n\n{len(res)} casos, {len(fallos)} fallos\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n"
                                       + "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/')} |" for x in res) + "\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
