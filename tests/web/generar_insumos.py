#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# generar_insumos.py — Fabrica TODOS los insumos de las pruebas de tools/web sin
# fotos externas: un rotulo sintetico dibujado con las fuentes libres de la propia
# herramienta (franja azul con REFERENCIA, codigo P 123ABC con paso fijo, TEXTO
# CONOCIDO abajo), sus vistas en perspectiva con camara conocida y a varias
# resoluciones, dos "fotos" de muestra, un clip de video con movimiento, los casos
# de integridad (calidades JPEG, tablas propias, montaje para ELA, miniaturas EXIF)
# y los de estructura (codificados con FFmpeg + su ffprobe como oraculo).
#
# Uso:  python3 -I tests/web/generar_insumos.py DIR_BASE
#       (Pillow y numpy; ffmpeg, ffprobe y exiftool en PATH)
#       DIR_BASE/muestras, DIR_BASE/integridad, DIR_BASE/estructura
# Author: Saul López
# Date:   2026-11-19
# -----------------------------------------------------------------------------
import base64
import io
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = Path(__file__).resolve().parents[2]
FUENTES_JS = RAIZ / "tools" / "web" / "fuentes" / "fuentes_libres.js"
TMP = Path(tempfile.mkdtemp(prefix="insumos_"))


def guardar_json(datos, ruta, **kw):  # cierra el fichero aunque falle la serializacion
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(datos, f, **kw)


def fuente(familia, tam):
    """Fuente libre incluida en la herramienta (base64 en fuentes_libres.js)."""
    lista = json.loads(re.search(r"RP\.FUENTES_LIBRES = (\[.*\]);", FUENTES_JS.read_text(encoding="utf-8"), re.S).group(1))
    f = next(x for x in lista if x["familia"] == familia)
    ruta = TMP / f["archivo"]
    if not ruta.exists():
        ruta.write_bytes(base64.b64decode(f["b64"]))
    return ImageFont.truetype(str(ruta), tam)


def rotulo(W=432, H=209):
    """Rotulo 30x15: franja azul (borde inferior a 0.215 del alto) con REFERENCIA en blanco, P 123ABC con paso fijo, TEXTO CONOCIDO."""
    im = Image.new("RGB", (W, H), (246, 246, 242)); d = ImageDraw.Draw(im)
    banda = round(0.215 * H)
    d.rectangle([0, 0, W - 1, banda - 1], fill=(24, 44, 168))
    f1 = fuente("Barlow Semi Condensed", int(banda * 0.78))
    d.text((W / 2, banda / 2), "REFERENCIA", font=f1, fill=(255, 255, 255), anchor="mm")
    texto, tam = "P 123ABC", int(H * 0.56)
    while True:  # el codigo ocupa como mucho el 90 % del ancho
        f2 = fuente("Oswald", tam); celda = f2.getlength("0") * 1.02
        anchos = [0.35 * celda if c == " " else celda for c in texto]
        if sum(anchos) <= 0.9 * W or tam < 10: break
        tam -= 2
    x = (W - sum(anchos)) / 2; y = H * 0.56
    for c, a in zip(texto, anchos):
        if c != " ":
            d.text((x + a / 2, y), c, font=f2, fill=(16, 16, 16), anchor="mm")
        x += a
    f3 = fuente("Barlow", int(H * 0.11))
    d.text((W / 2, H * 0.915), "TEXTO CONOCIDO", font=f3, fill=(16, 16, 16), anchor="mm")
    d.rectangle([0, 0, W - 1, H - 1], outline=(40, 40, 40), width=2)
    return im


def fondo(w, h, semilla):
    r = np.random.default_rng(semilla)
    base = np.zeros((h, w, 3), np.float32) + r.uniform(40, 90, 3)
    gy, gx = np.mgrid[0:h, 0:w]
    base += 30 * np.sin(gx / 37.0 + semilla)[..., None] + 20 * np.cos(gy / 23.0)[..., None] + r.normal(0, 6, (h, w, 3))
    return Image.fromarray(base.clip(0, 255).astype(np.uint8))


def homografia(dst, src):
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]; b += [u, v]
    return np.append(np.linalg.solve(np.array(A, float), np.array(b, float)), 1).reshape(3, 3)


def proyectar(imagen, esquinas, ow, oh, fondo_rgb=(40, 40, 40)):
    """Pinta la imagen (HxWx3) en el cuadrilatero esquinas (SI, SD, ID, II) de una imagen ow x oh (bilineal)."""
    src = np.asarray(imagen, np.float32); Hs, Ws = src.shape[:2]
    Hi = homografia(esquinas, [(0, 0), (Ws, 0), (Ws, Hs), (0, Hs)])
    yy, xx = np.mgrid[0:oh, 0:ow].astype(np.float64) + 0.5
    q = Hi @ np.stack([xx.ravel(), yy.ravel(), np.ones(xx.size)]); u, v = q[0] / q[2] - 0.5, q[1] / q[2] - 0.5
    dentro = (u >= 0) & (v >= 0) & (u < Ws - 1) & (v < Hs - 1)
    u0, v0 = np.clip(np.floor(u).astype(int), 0, Ws - 2), np.clip(np.floor(v).astype(int), 0, Hs - 2); du, dv = (u - u0)[:, None], (v - v0)[:, None]
    pix = src[v0, u0] * (1 - du) * (1 - dv) + src[v0, u0 + 1] * du * (1 - dv) + src[v0 + 1, u0] * (1 - du) * dv + src[v0 + 1, u0 + 1] * du * dv
    out = np.zeros((ow * oh, 3), np.float32) + fondo_rgb if not isinstance(fondo_rgb, Image.Image) else np.asarray(fondo_rgb, np.float32).reshape(-1, 3).copy()
    out[dentro] = pix[dentro]
    return Image.fromarray(out.reshape(oh, ow, 3).clip(0, 255).astype(np.uint8))


def camara(W, H, f, rx, ry, tz, cx, cy):
    def p(X, Y):
        x, y, z = X - W / 2, Y - H / 2, 0.0
        a, b = math.radians(rx), math.radians(ry)
        x, z = x * math.cos(b) + z * math.sin(b), -x * math.sin(b) + z * math.cos(b)
        y, z = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
        return cx + f * x / (z + tz), cy + f * y / (z + tz)
    return p


def muestras(d):
    d.mkdir(parents=True, exist_ok=True)
    pl = rotulo()
    # "diagrama": el rotulo frontal en x 152-584, y 121-330 de un lienzo 738x411 (las pruebas recortan esa zona)
    dg = Image.new("RGB", (738, 411), (230, 236, 244)); dg.paste(pl, (152, 121)); dg.save(d / "diagrama.png")
    # vista en perspectiva con camara conocida (f=900, punto principal centrado) y reducciones
    p = camara(30.0, 15.0, 900.0, 20, 35, 60.0, 400, 300)
    esq = [p(0, 0), p(30, 0), p(30, 15), p(0, 15)]
    s = proyectar(pl.resize((432, 216)), esq, 800, 600); s.save(d / "sintetica_sat_persp.png")
    guardar_json({"esquinas_SI_SD_ID_II": esq, "franja_FI": p(0, 0.215 * 15), "franja_FD": p(30, 0.215 * 15), "f": 900, "giro_grados": [20, 35],
               "fuente": "rotulo sintetico (tests/web/generar_insumos.py)"}, d / "sintetica_sat_persp.json", indent=1)
    for k in (2, 6, 10, 14):
        s.resize((800 // k, 600 // k), Image.BOX).save(d / f"sintetica_x{k}.png")
        guardar_json({"escala": k, "esquinas_SI_SD_ID_II": [[x / k, y / k] for x, y in esq]}, d / f"sintetica_x{k}.json")
    s.resize((800 // 6, 600 // 6), Image.BOX).filter(ImageFilter.GaussianBlur(1.2)).save(d / "sintetica_x6_gauss1.2.png")
    guardar_json({"escala": 6, "sigma": 1.2, "esquinas_SI_SD_ID_II": [[x / 6, y / 6] for x, y in esq]}, d / "sintetica_x6_gauss1.2.json")
    # dos "fotos": el rotulo sobre un fondo con textura, una casi frontal y otra algo girada
    proyectar(pl, [(128, 92), (612, 96), (610, 330), (126, 326)], 738, 369, fondo(738, 369, 1)).save(d / "muestra_b.png")
    proyectar(rotulo().transpose(Image.FLIP_TOP_BOTTOM).transpose(Image.FLIP_TOP_BOTTOM), [(150, 120), (520, 150), (505, 330), (140, 300)], 640, 480, fondo(640, 480, 2)).save(d / "muestra_a.png")
    # clip con movimiento (el rotulo se desplaza): para captura, seguimiento y apilado
    fr = TMP / "fotogramas"; fr.mkdir(exist_ok=True); bg = fondo(320, 240, 3)
    for i in range(45):  # 30 fps (las pruebas de video cuentan con 30), 1.5 s
        dx, dy = 40 + 1.7 * i, 70 + 0.5 * i
        proyectar(pl, [(dx, dy), (dx + 180, dy + 6), (dx + 178, dy + 92), (dx - 2, dy + 86)], 320, 240, bg).save(fr / f"f{i:03d}.png")
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-framerate", "30", "-i", str(fr / "f%03d.png"), "-c:v", "libvpx-vp9", "-b:v", "400k",
                    "-pix_fmt", "yuv420p", str(d / "clip.webm")], check=True)


def integridad(d, base):
    from PIL import Image as I
    d.mkdir(parents=True, exist_ok=True)
    im = I.open(base).convert("RGB")
    for q in (50, 75, 90, 95):
        im.save(d / f"calidad_q{q}.jpg", quality=q)
    im.save(d / "tablas_propias.jpg", qtables=[[3] * 64, [5] * 64])
    # ELA: base en gris (sin croma: con colores saturados y submuestreo 4:2:0 la recompresion no converge y todo da error)
    # y una zona con bordes nitidos de texto, sin comprimir, pegada (una zona plana apenas da error en el ELA)
    gris = im.convert("L").convert("RGB")
    b = io.BytesIO(); gris.save(b, "JPEG", quality=70); b1 = I.open(io.BytesIO(b.getvalue())).convert("RGB")
    b1.save(d / "doble_q70.jpg", quality=70)
    parche = rotulo().convert("L").convert("RGB").crop((60, 60, 290, 162))
    rect = [430, 150, 430 + parche.width, 150 + parche.height]
    m = b1.copy(); m.paste(parche, rect[:2]); m.save(d / "montaje_q70.jpg", quality=70)
    guardar_json({"rect_pegado_x0y0x1y1": rect, "calidad": 70}, d / "montaje_q70.json")
    # mapa de ruido: ruido gaussiano sigma 2 en toda la imagen y sigma 8 en una zona (PNG, sin perdida); control: sigma 2 en toda
    # base sin ruido propio (degradado + rotulo): si el fondo ya trae ruido distinto del rotulo, el mapa compara contenidos
    gy, gx = np.mgrid[0:im.height, 0:im.width]
    lisa = np.stack([90 + 60 * np.sin(gx / 90.0), 110 + 40 * np.cos(gy / 70.0), 130 + 30 * np.sin((gx + gy) / 120.0)], -1).astype(np.float32)
    lisa = np.asarray(proyectar(rotulo(), [(128, 92), (612, 96), (610, 330), (126, 326)], im.width, im.height, Image.fromarray(lisa.clip(0, 255).astype(np.uint8))), np.float32)
    r = np.random.default_rng(7); a = lisa; zr = [96, 64, 352, 256]
    ruido = r.normal(0, 2, a.shape); ruido[zr[1]:zr[3], zr[0]:zr[2]] = r.normal(0, 8, (zr[3] - zr[1], zr[2] - zr[0], 3))
    I.fromarray((a + ruido).clip(0, 255).astype(np.uint8)).save(d / "ruido_montaje.png")
    I.fromarray((a + r.normal(0, 2, a.shape)).clip(0, 255).astype(np.uint8)).save(d / "ruido_control.png")
    guardar_json({"rect_x0y0x1y1": zr, "sigma_fuera": 2, "sigma_dentro": 8}, d / "ruido_montaje.json")
    # JPEG ghost: una zona comprimida antes a q60, pegada y todo guardado a q95; control: todo guardado solo a q95
    b = io.BytesIO(); im.save(b, "JPEG", quality=60); q60 = I.open(io.BytesIO(b.getvalue())).convert("RGB")
    zg = [192, 96, 448, 288]; g = im.copy(); g.paste(q60.crop(zg), zg[:2]); g.save(d / "ghost_montaje.jpg", quality=95)
    im.save(d / "ghost_control.jpg", quality=95)
    guardar_json({"rect_x0y0x1y1": zg, "calidad_previa": 60, "calidad_final": 95}, d / "ghost_montaje.json")
    ed = im.copy(); ImageDraw.Draw(ed).rectangle([130, 120, 600, 250], fill=(240, 240, 240))
    exif = I.Exif(); exif[0x010f] = "QA-integridad"
    for nombre, principal, mini in (("miniatura_distinta", ed, im), ("miniatura_coincide", ed, ed)):
        principal.save(d / f"{nombre}.jpg", quality=92, exif=exif.tobytes())
        t = mini.copy(); t.thumbnail((160, 160)); t.save(d / f"_mini_{nombre}.jpg", quality=85)
        subprocess.run(["exiftool", "-q", "-overwrite_original", f"-ThumbnailImage<={d / f'_mini_{nombre}.jpg'}", str(d / f"{nombre}.jpg")], check=True)


def textura_natural(w, h, semilla):
    """Textura sin repeticiones (ruido fractal + manchas y trazos al azar): ningun trozo se parece a otro."""
    r = np.random.default_rng(semilla)
    acc = np.zeros((h, w, 3), np.float32)
    for o, amp in ((8, 60), (16, 40), (32, 25), (64, 15), (128, 8)):
        cap = r.uniform(0, 255, (max(2, h * o // 800), max(2, w * o // 800), 3)).astype(np.uint8)
        acc += amp * (np.asarray(Image.fromarray(cap).resize((w, h), Image.BICUBIC), np.float32) / 255 - 0.5)
    im = Image.fromarray((acc + 128).clip(0, 255).astype(np.uint8)); dr = ImageDraw.Draw(im)
    for _ in range(60):
        x, y, a, b = r.integers(0, w), r.integers(0, h), r.integers(4, 40), r.integers(4, 40)
        dr.ellipse([x - a, y - b, x + a, y + b], fill=tuple(int(v) for v in r.integers(30, 225, 3)))
    for _ in range(40):
        dr.line([tuple(int(v) for v in r.integers(0, (w, h))), tuple(int(v) for v in r.integers(0, (w, h)))], fill=tuple(int(v) for v in r.integers(0, 255, 3)), width=int(r.integers(1, 4)))
    return Image.fromarray((np.asarray(im, np.float32) + r.normal(0, 3, (h, w, 3))).clip(0, 255).astype(np.uint8))


def clonado(d):
    """Copy-move de verdad conocida: un trozo copiado en otra parte (traslacion, giro 10 grados, escala 1.1), JPEG q90; control sin clonar."""
    d.mkdir(parents=True, exist_ok=True)
    base = textura_natural(800, 600, 21)
    base.save(d / "clonado_control.jpg", quality=90)
    origen, destino, (pw, ph) = (90, 80), (520, 360), (150, 120)
    verdad = {}
    for nombre, giro, escala in (("traslacion", 0, 1.0), ("giro10", 10, 1.0), ("escala110", 0, 1.1)):
        m = 40  # margen para girar sin esquinas vacias
        trozo = base.crop((origen[0] - m, origen[1] - m, origen[0] + pw + m, origen[1] + ph + m))
        if giro:
            trozo = trozo.rotate(giro, resample=Image.BICUBIC)
        if escala != 1.0:
            trozo = trozo.resize((round(trozo.width * escala), round(trozo.height * escala)), Image.BICUBIC)
        cx, cy = trozo.width / 2, trozo.height / 2
        tw, th = round(pw * escala), round(ph * escala)
        trozo = trozo.crop((round(cx - tw / 2), round(cy - th / 2), round(cx - tw / 2) + tw, round(cy - th / 2) + th))
        im = base.copy(); im.paste(trozo, destino); im.save(d / f"clonado_{nombre}.jpg", quality=90)
        verdad[nombre] = {"origen_x0y0x1y1": [origen[0], origen[1], origen[0] + pw, origen[1] + ph],
                          "destino_x0y0x1y1": [destino[0], destino[1], destino[0] + tw, destino[1] + th], "giro": giro, "escala": escala}
    guardar_json(verdad, d / "clonado.json", indent=1)


def superres(d):
    """Superresolucion de verdad conocida: un rotulo a x3 (la verdad) desplazada 0, 1 o 2 px de alta resolucion en cada eje
    (9 combinaciones + 3 al azar) y reducida x3 por promedio de area (lo que hace el sensor) con ruido sigma 2: 12 fotogramas
    desplazados entre si tercios de pixel. Las esquinas del rotulo en cada fotograma se conocen exactamente."""
    d.mkdir(parents=True, exist_ok=True)
    F, M = 3, 60
    verdad = rotulo(288, 139).resize((288 * F, 139 * F), Image.LANCZOS)
    verdad.save(d / "verdad.png")
    W, H = verdad.width + 2 * M, verdad.height + 2 * M
    lienzo = Image.new("RGB", (W + F, H + F), (110, 110, 110)); lienzo.paste(verdad, (M, M))
    a = np.asarray(lienzo, np.float32)
    r = np.random.default_rng(5)
    desp = [(x, y) for y in range(F) for x in range(F)] + [tuple(int(v) for v in r.integers(0, F, 2)) for _ in range(3)]
    meta = {"factor": F, "verdad": "verdad.png", "verdad_wh": [verdad.width, verdad.height], "fotogramas": []}
    for i, (sx, sy) in enumerate(desp):
        c = a[sy:sy + H, sx:sx + W].reshape(H // F, F, W // F, F, 3).mean(axis=(1, 3))
        c = (c + r.normal(0, 2, c.shape)).clip(0, 255).astype(np.uint8)
        nombre = f"sr_{i:02d}.png"; Image.fromarray(c).save(d / nombre)
        x0, y0, x1, y1 = (M - sx) / F, (M - sy) / F, (M + verdad.width - sx) / F, (M + verdad.height - sy) / F
        meta["fotogramas"].append({"nombre": nombre, "desplazamiento_alta": [sx, sy], "esquinas_SI_SD_ID_II": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]})
    guardar_json(meta, d / "superres.json", indent=1)


def estructura(d, base):
    d.mkdir(parents=True, exist_ok=True)
    F = ["ffmpeg", "-nostdin", "-v", "error", "-y"]
    SRC = ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"]
    run = lambda *a: subprocess.run([*F, *a], check=True, cwd=d)
    run(*SRC, "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p", "-g", "25", "-c:a", "aac", "-ac", "2", "-b:a", "128k", "h264_aac.mp4")
    run(*SRC, "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0", "-pix_fmt", "yuv420p", "-g", "10", "-an", "_sinrot.mp4")
    run("-display_rotation", "90", "-i", "_sinrot.mp4", "-c", "copy", "h264_rot90.mp4"); (d / "_sinrot.mp4").unlink()
    run(*SRC, "-c:v", "libx265", "-x265-params", "log-level=error", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "1", "-ar", "44100", "hevc_aac.mp4")
    run(*SRC, "-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus", "-ac", "2", "vp9_opus.webm")
    run(*SRC, "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-c:a", "libmp3lame", "-ac", "1", "-ar", "22050", "h264_mp3.mkv")
    run("-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=16000:duration=1", "-c:a", "pcm_s16le", "-ac", "1", "tono.wav")
    for f in ("h264_aac.mp4", "h264_rot90.mp4", "hevc_aac.mp4", "vp9_opus.webm", "h264_mp3.mkv", "tono.wav"):
        j = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", f], check=True, cwd=d, capture_output=True, text=True).stdout
        (d / f"{f}.ffprobe.json").write_text(j)
    im = Image.open(base).convert("RGB")
    im.save(d / "base_420.jpg", quality=85, subsampling=2); im.save(d / "prog_444.jpg", quality=90, subsampling=0, progressive=True)
    im.save(d / "base_422.jpg", quality=80, subsampling=1); im.save(d / "rgb.png")
    (d / "imagen_con_extension.jpg").write_bytes(Path(base).read_bytes())  # PNG con extension .jpg


def main(base):
    base = Path(base)
    muestras(base / "muestras")
    integridad(base / "integridad", base / "muestras" / "muestra_b.png")
    clonado(base / "integridad")
    superres(base / "superres")
    estructura(base / "estructura", base / "muestras" / "muestra_b.png")
    for sub in ("muestras", "integridad", "estructura", "superres"):
        n = sorted(p.name for p in (base / sub).iterdir())
        print(f"{sub}: {len(n)} ficheros")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
