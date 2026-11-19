#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# generar_insumos_metadatos.py — Ficheros sinteticos con metadatos conocidos para el QA
# del bloque Metadatos de tools/web/perspectiva.html, y su referencia leida con
# herramientas INDEPENDIENTES de la herramienta web (Pillow y ffprobe).
#
# Uso:  python3 -I tests/web/generar_insumos_metadatos.py DIR_SALIDA
#       (Pillow en el python del sistema; ffmpeg/ffprobe en PATH)
# Author: Saul López
# Date:   2026-11-15
# Modified By:   Saul López
# Modified Date: 2026-11-19
# -----------------------------------------------------------------------------
import io
import json
import os
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

from PIL import Image, PngImagePlugin
from PIL.TiffImagePlugin import IFDRational

LAT, LON = 14.634915, -90.506882  # sinteticos


def dms(v):
    v = abs(v); g = int(v); m = int((v - g) * 60); s = round(((v - g) * 60 - m) * 60 * 10000)
    return (IFDRational(g, 1), IFDRational(m, 1), IFDRational(s, 10000))


def imagen(w=96, h=48):
    im = Image.new("RGB", (w, h), (240, 240, 240))
    for x in range(w):
        for y in range(h):
            if (x // 8 + y // 8) % 2:
                im.putpixel((x, y), (20, 40, 160))
    return im


def jpeg_exif(dst):
    im = imagen(); ex = Image.Exif()
    ex[0x010F] = "FabricantePrueba"; ex[0x0110] = "ModeloX 3000"; ex[0x013B] = "Autor EXIF"; ex[0x0131] = "SoftwarePrueba 1.2"
    ex[0x9C9C] = "comentario XP ñ".encode("utf-16le") + b"\0\0"
    sub = ex.get_ifd(0x8769); sub[0x9003] = "2026:11:01 10:20:30"; sub[0x9286] = b"ASCII\0\0\0" + b"nota de usuario"
    gps = ex.get_ifd(0x8825); gps[1] = "N"; gps[2] = dms(LAT); gps[3] = "W"; gps[4] = dms(LON)
    im.save(dst, "JPEG", exif=ex.tobytes(), comment=b"comentario COM de prueba", quality=90)


def png_textos(dst):
    info = PngImagePlugin.PngInfo()
    info.add_text("Author", "Autor PNG"); info.add_text("Comment", "texto comprimido zTXt " * 3, zip=True)
    info.add_itxt("Description", "descripcion iTXt con acentos áéí", lang="es", zip=False)
    imagen().save(dst, "PNG", pnginfo=info)


def png_crc_alterado(src, dst):
    b = bytearray(Path(src).read_bytes())
    b[20:24] = (64).to_bytes(4, "big")  # alto de IHDR cambiado sin recalcular el CRC
    Path(dst).write_bytes(b)


def main(salida):
    d = Path(salida); d.mkdir(parents=True, exist_ok=True)
    ref = {}
    jpeg_exif(d / "exif_gps.jpg")
    e = Image.open(d / "exif_gps.jpg").getexif()
    g = e.get_ifd(0x8825)
    dec = lambda t, r: (float(t[0]) + float(t[1]) / 60 + float(t[2]) / 3600) * (-1 if r in "SW" else 1)
    ref["exif_gps.jpg"] = {"Make": e[0x010F], "Model": e[0x0110], "Artist": e[0x013B], "Software": e[0x0131],
                           "DateTimeOriginal": e.get_ifd(0x8769)[0x9003], "lat": dec(g[2], g[1]), "lon": dec(g[4], g[3]),
                           "COM": Image.open(d / "exif_gps.jpg").info.get("comment", b"").decode()}
    png_textos(d / "textos.png")
    t = Image.open(d / "textos.png"); t.load()
    ref["textos.png"] = {k: v for k, v in t.text.items()}
    png_crc_alterado(d / "textos.png", d / "crc_alterado.png")
    im = imagen(); im.info["comment"] = b"comentario GIF"; im.save(d / "comentario.gif", "GIF", comment=b"comentario GIF")
    ref["comentario.gif"] = {"comment": Image.open(d / "comentario.gif").info.get("comment", b"").decode()}
    ex = Image.Exif(); ex[0x010F] = "FabricanteWebp"
    imagen().save(d / "exif.webp", "WEBP", exif=ex.tobytes(), lossless=True)
    ref["exif.webp"] = {"Make": Image.open(d / "exif.webp").getexif()[0x010F]}
    imagen().save(d / "descripcion.tif", "TIFF", tiffinfo={270: "descripcion TIFF", 305: "SoftTIFF"})
    ref["descripcion.tif"] = {"ImageDescription": Image.open(d / "descripcion.tif").tag_v2[270]}
    # PNG renombrado: se debe decodificar por su contenido
    (d / "imagen_renombrada.txt").write_bytes((d / "textos.png").read_bytes())
    (d / "texto.txt").write_text("solo texto, sin imagen\n" * 20)
    # binario con un PNG incrustado en 0x3e8 (y un JPEG detras de un PNG: poliglota)
    (d / "datos.bin").write_bytes(os.urandom(1000).replace(b"\x89PNG", b"xxxx").replace(b"\xff\xd8\xff", b"xxx") + (d / "textos.png").read_bytes() + os.urandom(64))
    (d / "png_con_jpeg.png").write_bytes((d / "textos.png").read_bytes() + (d / "exif_gps.jpg").read_bytes())
    ref["datos.bin"] = {"png_off": 1000}
    ref["png_con_jpeg.png"] = {"jpeg_off": (d / "textos.png").stat().st_size}
    # PDF con Info (titulo UTF-16 en hexadecimal), JavaScript y una actualizacion incremental
    titulo = "Título PDF".encode("utf-16-be")
    pdf = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction 4 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
           b"3 0 obj<</Type /Page/Parent 2 0 R>>endobj\n4 0 obj<</S/JavaScript/JS(app.alert\\(1\\))>>endobj\n"
           b"5 0 obj<</Author(Autor PDF)/Title<FEFF" + titulo.hex().upper().encode() + b">/CreationDate(D:20261101102030Z)>>endobj\n"
           b"trailer<</Root 1 0 R/Info 5 0 R>>\n%%EOF\n6 0 obj<</Author(Autor Revisado)>>endobj\ntrailer<</Root 1 0 R/Info 6 0 R>>\n%%EOF\n")
    (d / "documento.pdf").write_bytes(pdf)
    ref["documento.pdf"] = {"Author": ["Autor PDF", "Autor Revisado"], "Title": "Título PDF", "eof": 2}
    # DOCX minimo con docProps/core.xml comprimido
    core = ('<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z">'
            "<dc:creator>Autor Office</dc:creator><cp:lastModifiedBy>Revisor Office</cp:lastModifiedBy>"
            "<dcterms:created>2026-11-01T10:20:30Z</dcterms:created></cp:coreProperties>")
    with zipfile.ZipFile(d / "documento.docx", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>"); z.writestr("docProps/core.xml", core); z.comment = b"comentario ZIP"
    ref["documento.docx"] = {"dc:creator": "Autor Office", "cp:lastModifiedBy": "Revisor Office", "comment": "comentario ZIP"}
    # videos: MP4 (H.264, 25 fps, titulo, ubicacion, fecha) y WebM (VP9, 24 fps, titulo)
    comun = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate={r}:duration=2"]
    subprocess.run([a.format(r=25) for a in comun] + ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-metadata", "title=Titulo MP4",
                    "-metadata", "location=+14.6349-090.5069/", "-metadata", "creation_time=2026-11-01T10:20:30Z", str(d / "clip_meta.mp4")], check=True)
    subprocess.run([a.format(r=24) for a in comun] + ["-c:v", "libvpx-vp9", "-b:v", "200k", "-metadata", "title=Titulo WebM", str(d / "clip_meta.webm")], check=True)
    for v in ("clip_meta.mp4", "clip_meta.webm"):
        p = json.loads(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_format", "-show_streams", "-of", "json", str(d / v)],
                                      check=True, capture_output=True, text=True).stdout)
        s = p["streams"][0]; n, m = map(int, s["r_frame_rate"].split("/"))
        ref[v] = {"fps": n / m, "frames": int(s.get("nb_read_frames", 0)), "tags": p["format"].get("tags", {}),
                  "duracion": float(p["format"]["duration"]), "ancho": s["width"], "alto": s["height"]}
    (d / "referencia.json").write_text(json.dumps(ref, indent=2, ensure_ascii=False, default=str))
    print(json.dumps(ref, indent=1, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main(sys.argv[1])
