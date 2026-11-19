#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_metadatos.py — QA del bloque Metadatos y de la activacion de herramientas por tipo
# de fichero en tools/web/perspectiva.html, en navegador real (Playwright).
# Compara lo que muestra la herramienta con referencia.json, leida con Pillow y ffprobe
# (generar_insumos_metadatos.py): no con la propia herramienta. Cada afirmacion
# negativa lleva su control positivo. Resultados en _local/qa/<TS>_web_qa_metadatos_<nav>/.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_metadatos.py DIR_INSUMOS
# Author: Saul López
# Date:   2026-11-15
# Modified By:   Saul López
# Modified Date: 2026-11-19
# -----------------------------------------------------------------------------
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
HTML = RAIZ / "tools" / "web" / "perspectiva.html"
CHROME = Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
NAV = os.environ.get("QA_NAV", "chromium")
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_qa_metadatos_{NAV}"
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:300]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre} {detalle if not ok else ''}")


def main(insumos):
    D = Path(insumos); ref = json.loads((D / "referencia.json").read_text())
    SALIDA.mkdir(parents=True)
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        pg = nav.new_page(viewport={"width": 1600, "height": 1000})
        errores = []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" and "downloadable font" not in m.text else None)
        pg.goto(HTML.as_uri()); pg.wait_for_timeout(500)
        txt = lambda s: pg.inner_text(s)
        sin_imagen = lambda: pg.evaluate("document.body.classList.contains('sin-imagen')")
        nfuentes = lambda: pg.evaluate("fuentes.length")

        def cargar(nombre, espera=900):
            pg.set_input_files("#archivo", str(D / nombre)); pg.wait_for_timeout(espera)
            return txt("#metaInfo")

        def valor(meta, clave):  # valor de la primera linea "clave: valor"
            m = re.search(r"^" + re.escape(clave) + r": (.*)$", meta, re.M)
            return m.group(1) if m else None

        # ---------------- estado inicial y archivo que no es imagen
        caso("activacion", "sin archivos: herramientas de imagen inactivas", sin_imagen())
        caso("activacion", "sin archivos: panel de video oculto", not pg.is_visible("#bloqueVideo"))
        caso("activacion", "aceptar cualquier fichero (sin filtro accept)", pg.get_attribute("#archivo", "accept") in (None, ""), pg.get_attribute("#archivo", "accept"))
        m = cargar("texto.txt")
        caso("archivo", "texto: clase archivo", txt("#tMeta").startswith("archivo"), txt("#tMeta"))
        caso("archivo", "texto: herramientas de imagen siguen inactivas", sin_imagen() and nfuentes() == 0)
        caso("archivo", "texto: aviso visible", "no es una imagen" in txt("#avisoHerramientas"), txt("#avisoHerramientas"))
        caso("archivo", "texto: clic en el lienzo no hace nada (pointer-events)", pg.evaluate("getComputedStyle(document.querySelector('.trabajo')).pointerEvents") == "none")
        caso("archivo", "texto: sin imagenes incrustadas (negativo)", pg.locator("#incrustables button").count() == 0)
        caso("archivo", "texto: analisis hex del texto", "firma: desconocido" in pg.text_content("#hexInfo"), pg.text_content("#hexInfo")[:80])

        # ---------------- binario con PNG incrustado: control positivo del anterior
        cargar("datos.bin")
        b = pg.locator("#incrustables button")
        caso("incrustado", "binario: boton para el PNG incrustado en su offset", b.count() == 1 and f"@0x{ref['datos.bin']['png_off']:x}" in b.first.inner_text(), txt("#incrustables"))
        caso("incrustado", "binario: aviso menciona la imagen incrustada", "incrustada" in txt("#avisoHerramientas"), txt("#avisoHerramientas"))
        b.first.click(); pg.wait_for_timeout(900)
        caso("incrustado", "abrir incrustado: activa las herramientas de imagen", not sin_imagen() and nfuentes() == 1, txt("#estado"))
        caso("incrustado", "abrir incrustado: metadatos del recorte (IHDR)", "IHDR: 96x48" in txt("#metaInfo"), txt("#metaInfo")[:120])
        caso("incrustado", "abrir incrustado: nombre con el offset", "@0x3e8" in txt("#estado"), txt("#estado"))
        caso("activacion", "con imagen: aviso vacio", txt("#avisoHerramientas") == "", txt("#avisoHerramientas"))

        # ---------------- JPEG con EXIF/GPS/COM
        r = ref["exif_gps.jpg"]; m = cargar("exif_gps.jpg")
        for k in ("Make", "Model", "Artist", "Software", "DateTimeOriginal"):
            caso("exif", f"JPEG {k} = Pillow", valor(m, k) == r[k], f"{valor(m, k)!r} vs {r[k]!r}")
        caso("exif", "JPEG COM = Pillow", valor(m, "COM (comentario)") == r["COM"], valor(m, "COM (comentario)"))
        caso("exif", "JPEG XPComment (UCS-2)", valor(m, "XPComment") == "comentario XP ñ", valor(m, "XPComment"))
        caso("exif", "JPEG UserComment", valor(m, "UserComment") == "nota de usuario", valor(m, "UserComment"))
        pos = re.search(r"posicion decimal: (-?[\d.]+), (-?[\d.]+)", m)
        caso("exif", "GPS decimal = Pillow (±1e-5)", pos and abs(float(pos[1]) - r["lat"]) < 1e-5 and abs(float(pos[2]) - r["lon"]) < 1e-5, pos and pos.group(0))
        caso("exif", "segmentos JPEG con nombre", "APP0 APP1 COM DQT" in m, valor(m, "segmentos"))

        # ---------------- PNG: textos, CRC, control negativo de GPS
        r = ref["textos.png"]; m = cargar("textos.png")
        caso("png", "tEXt Author = Pillow", valor(m, "Author") == r["Author"], valor(m, "Author"))
        caso("png", "zTXt Comment descomprimido = Pillow", valor(m, "Comment (zTXt)") == r["Comment"].rstrip() or valor(m, "Comment (zTXt)").rstrip() == r["Comment"].rstrip(), valor(m, "Comment (zTXt)"))
        caso("png", "iTXt Description UTF-8 = Pillow", valor(m, "Description (iTXt)") == r["Description"], valor(m, "Description (iTXt)"))
        caso("png", "CRC correctos", valor(m, "CRC") == "todos coinciden", valor(m, "CRC"))
        caso("png", "sin GPS (negativo; positivo en el JPEG)", "— GPS —" not in m)
        m = cargar("crc_alterado.png")
        caso("png", "IHDR alterado: CRC detectado", "CRC no coinciden: IHDR@0x8" in m and "dimensiones" in m, valor(m, "CRC"))
        caso("png", "IHDR alterado: alto leido 64 (el escrito)", "IHDR: 96x64" in m, valor(m, "IHDR"))
        r = ref["png_con_jpeg.png"]; m = cargar("png_con_jpeg.png")
        caso("png", "poliglota PNG+JPEG: boton del JPEG en su offset", f"@0x{r['jpeg_off']:x}" in txt("#incrustables"), txt("#incrustables"))
        n0 = nfuentes(); pg.locator("#incrustables button").first.click(); pg.wait_for_timeout(900)
        caso("png", "poliglota: el JPEG se abre como imagen con su EXIF", nfuentes() == n0 + 1 and valor(txt("#metaInfo"), "Make") == "FabricantePrueba", txt("#estado"))

        # ---------------- otros formatos
        m = cargar("comentario.gif")
        caso("gif", "comentario = Pillow", valor(m, "comentario") == ref["comentario.gif"]["comment"], valor(m, "comentario"))
        m = cargar("exif.webp")
        caso("webp", "EXIF Make = Pillow", valor(m, "Make") == ref["exif.webp"]["Make"], valor(m, "Make"))
        m = cargar("descripcion.tif")
        caso("tiff", "ImageDescription = Pillow", valor(m, "ImageDescription") == ref["descripcion.tif"]["ImageDescription"], valor(m, "ImageDescription"))
        caso("tiff", "clase (informativo: el navegador decodifica TIFF?)", True, txt("#tMeta"))
        r = ref["documento.pdf"]; m = cargar("documento.pdf")
        autores = re.findall(r"^Author: (.*)$", m, re.M)
        caso("pdf", "Author: las dos versiones", autores == r["Author"], autores)
        caso("pdf", "Title UTF-16 hexadecimal", valor(m, "Title") == r["Title"], valor(m, "Title"))
        caso("pdf", "actualizacion incremental detectada", "%%EOF: 2 (ATENCION" in m, valor(m, "%%EOF"))
        caso("pdf", "JavaScript/OpenAction detectados", "/JavaScript x1" in m and "/OpenAction x1" in m, valor(m, "claves de interes"))
        caso("pdf", "clase archivo", txt("#tMeta").startswith("archivo"), txt("#tMeta"))
        r = ref["documento.docx"]; m = cargar("documento.docx")
        caso("zip", "docProps dc:creator", valor(m, "dc:creator") == r["dc:creator"], valor(m, "dc:creator"))
        caso("zip", "docProps cp:lastModifiedBy", valor(m, "cp:lastModifiedBy") == r["cp:lastModifiedBy"], valor(m, "cp:lastModifiedBy"))
        caso("zip", "comentario del ZIP", valor(m, "comentario del archivo") == r["comment"], valor(m, "comentario del archivo"))
        m = cargar("imagen_renombrada.txt")
        caso("archivo", "PNG con extension .txt: se abre como imagen (por contenido)", txt("#tMeta").startswith("imagen"), txt("#tMeta"))

        # ---------------- selector de archivo
        pg.select_option("#selArchivo", index=0); pg.wait_for_timeout(300)
        caso("selector", "volver al primer archivo (texto) muestra sus metadatos", "texto.txt" in txt("#metaInfo"), txt("#metaInfo")[:60])

        # ---------------- videos: MP4 (metadatos) y WebM (fps del contenedor y captura)
        r = ref["clip_meta.mp4"]; m = cargar("clip_meta.mp4", 1500)
        caso("mp4", "clase video y panel de captura visible", txt("#tMeta").startswith("video") and pg.is_visible("#bloqueVideo"), txt("#tMeta"))
        caso("mp4", "titulo = ffprobe", valor(m, "©nam") == r["tags"]["title"], valor(m, "©nam"))
        cre = valor(m, "creacion (mvhd, UTC)") or ""
        caso("mp4", "creacion = ffprobe creation_time", cre[:19] == r["tags"]["creation_time"][:19], f"{cre} vs {r['tags']['creation_time']}")
        loc = re.search(r"loci \(ubicacion 3GPP\): (-?[\d.]+), (-?[\d.]+)", m)
        caso("mp4", "ubicacion = ffprobe location (±1e-3)", loc and abs(float(loc[1]) - 14.6349) < 1e-3 and abs(float(loc[2]) + 90.5069) < 1e-3, loc and loc.group(0))
        fot = re.search(r"fotogramas: (\d+) · ([\d.]+) fps", m)
        caso("mp4", "fotogramas y fps = ffprobe", fot and int(fot[1]) == r["frames"] and abs(float(fot[2]) - r["fps"]) < 1e-3, fot and fot.group(0))
        caso("mp4", "fps del contenedor aplicados a la captura", abs(float(pg.input_value("#fps")) - r["fps"]) < 1e-3, pg.input_value("#fps"))
        r = ref["clip_meta.webm"]; m = cargar("clip_meta.webm", 1500)
        caso("webm", "titulo = ffprobe", valor(m, "Title") == r["tags"]["title"], valor(m, "Title"))
        caso("webm", "duracion = ffprobe", abs(float(re.search(r"duracion: ([\d.]+) s", m)[1]) - r["duracion"]) < 0.01, valor(m, "duracion"))
        caso("webm", "fps del contenedor (24) aplicados a la captura", abs(float(pg.input_value("#fps")) - r["fps"]) < 1e-3, f"{pg.input_value('#fps')} · {txt('#fpsContenedor')}")
        pg.wait_for_function("video.readyState >= 2", timeout=5000)
        n0 = nfuentes(); pg.click("#btnCapturar"); pg.wait_for_timeout(900)
        caso("webm", "capturar fotograma: nueva fuente", nfuentes() == n0 + 1, txt("#estado"))
        caso("webm", "fotograma: muestra los metadatos del video", "metadatos del video" in txt("#metaInfo") and "Titulo WebM" in txt("#metaInfo"), txt("#metaInfo")[:90])
        pg.click("#btnFotSig"); pg.wait_for_timeout(500)
        caso("webm", "paso de fotograma con fps del contenedor", "fot. 1" in txt("#tVideo") or "fot. 2" in txt("#tVideo"), txt("#tVideo"))
        pg.screenshot(path=str(SALIDA / "01_metadatos.png"), full_page=True)

        # pagina nueva: video solo -> herramientas inactivas hasta capturar (control del caso anterior)
        pg2 = nav.new_page(viewport={"width": 1600, "height": 1000}); pg2.goto(HTML.as_uri()); pg2.wait_for_timeout(400)
        pg2.set_input_files("#archivo", str(D / "clip_meta.webm")); pg2.wait_for_timeout(1500)
        caso("activacion", "solo video: herramientas de imagen inactivas", pg2.evaluate("document.body.classList.contains('sin-imagen')"))
        caso("activacion", "solo video: aviso de capturar", "captura un fotograma" in pg2.inner_text("#avisoHerramientas"), pg2.inner_text("#avisoHerramientas"))
        pg2.wait_for_function("video.readyState >= 2", timeout=5000); pg2.click("#btnCapturar"); pg2.wait_for_timeout(900)
        caso("activacion", "solo video: tras capturar se activan", not pg2.evaluate("document.body.classList.contains('sin-imagen')"))
        pg2.screenshot(path=str(SALIDA / "02_video_capturado.png"), full_page=True)

        caso("errores", "sin errores de JavaScript", not errores, errores[:5])
        nav.close()
    fallos = [x for x in res if not x["ok"]]
    (SALIDA / "resultados.json").write_text(json.dumps(res, indent=2, ensure_ascii=False))
    filas = "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/') if not x['ok'] or x['grupo'] == 'tiff' else ''} |" for x in res)
    (SALIDA / "REPORTE.md").write_text(f"# QA metadatos — perspectiva.html\n\n{len(res)} casos, {len(fallos)} fallos · {NAV}\n"
                                       f"Referencia: {D}/referencia.json (Pillow, ffprobe)\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n{filas}\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main(sys.argv[1])
