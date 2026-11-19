#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# publicar_web.py — Prepara la carpeta publicable de la herramienta web (Perspectiva):
# index.html + js/ + fuentes libres con sus licencias + LEEME.txt + SHA256SUMS.
# Solo copia una lista cerrada de ficheros de tools/web (nada fuera de la
# herramienta) y la barre antes de darla por buena: terminos que no deben aparecer, rutas
# del equipo, referencias a ficheros fuera de la carpeta. NO publica nada: subirla
# es decision de quien la use.
#
# Uso:  python3 -I tools/publicar_web.py [DESTINO]   (por defecto _local/publicar/<fecha>_perspectiva)
# Author: Saul López
# Date:   2026-11-19
# -----------------------------------------------------------------------------
import hashlib
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "tools" / "web"
PROHIBIDOS = re.compile(r"forens|peric|perit|dictamen|evidencia", re.I)
RUTAS_EQUIPO = re.compile(r"/home/|_local/|__restriccion|C:\\\\Users", re.I)
LEEME = """Perspectiva — herramienta de navegador para analizar y mejorar imagenes y fotogramas de video.

Publicar: subir el CONTENIDO de esta carpeta a cualquier alojamiento de paginas estaticas (servidor web propio,
GitHub Pages, Netlify...). No necesita servidor de aplicaciones ni base de datos. La pagina de entrada es index.html.
Tambien funciona abriendo index.html directamente en Chromium o Firefox, sin conexion.

Privacidad: los archivos que se cargan se procesan en el navegador de quien usa la pagina; la herramienta no los envia
a ningun sitio. Quien aloja la pagina sirve el codigo: para trabajar con archivos sensibles, usar una copia propia
cuya integridad se pueda comprobar con SHA256SUMS (sha256sum -c SHA256SUMS).

Ayuda: boton "Ayuda" de la pagina (o F1).

Licencias: las fuentes de fuentes/ son SIL Open Font License 1.1 (texto en fuentes/<familia>/OFL.txt).
"""


def main():
    destino = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "_local" / "publicar" / f"{datetime.now():%Y%m%d_%H%M%S}_perspectiva"
    if destino.exists():
        sys.exit(f"ERROR: {destino} ya existe (no se sobrescribe)")
    ficheros = {"index.html": WEB / "perspectiva.html"}
    ficheros.update({f"js/{p.name}": p for p in sorted((WEB / "js").glob("*.js"))})
    ficheros["fuentes/fuentes_libres.js"] = WEB / "fuentes" / "fuentes_libres.js"
    ficheros.update({f"fuentes/{p.parent.name}/OFL.txt": p for p in sorted((WEB / "fuentes").glob("*/OFL.txt"))})
    for rel, src in ficheros.items():
        (destino / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, destino / rel)
    (destino / "LEEME.txt").write_text(LEEME, encoding="utf-8")
    # cada modulo se enlaza con la huella de su contenido (?v=...): el alojamiento cachea cada fichero por separado
    # (GitHub Pages: max-age=600) y, tras un despliegue, un index.html nuevo podia juntarse con modulos viejos
    idx = destino / "index.html"
    html_idx = re.sub(r'<script src="([^"?]+)"></script>',
                      lambda m: f'<script src="{m.group(1)}?v={hashlib.sha256((destino / m.group(1)).read_bytes()).hexdigest()[:12]}"></script>'
                      if (destino / m.group(1)).is_file() else m.group(0), idx.read_text(encoding="utf-8"))
    idx.write_text(html_idx, encoding="utf-8")
    # barrido de lo que se va a publicar
    problemas = []
    html = (destino / "index.html").read_text(encoding="utf-8")
    for ref in re.findall(r'<script src="([^"]+)"', html):
        ref = ref.split("?")[0]
        if not (destino / ref).is_file():
            problemas.append(f"index.html carga {ref}, que no esta en la carpeta")
    for f in sorted(destino.rglob("*")):
        if not f.is_file() or f.name == "OFL.txt" or f.name == "fuentes_libres.js":  # licencias y fuentes en base64: texto ajeno
            continue
        t = f.read_text(encoding="utf-8")
        for n, linea in enumerate(t.splitlines(), 1):
            if PROHIBIDOS.search(linea):
                problemas.append(f"{f.relative_to(destino)}:{n}: termino no permitido: {linea.strip()[:100]}")
            m = RUTAS_EQUIPO.search(linea)
            if m and not (f.name == "app.js" and "_local/fonts/fuentes_embebidas.js" in linea):  # solo se pide en file:// (ver app.js)
                problemas.append(f"{f.relative_to(destino)}:{n}: ruta del equipo: {linea.strip()[:100]}")
    sumas = []
    for f in sorted(destino.rglob("*")):
        if f.is_file():
            sumas.append(f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.relative_to(destino).as_posix()}")
    (destino / "SHA256SUMS").write_text("\n".join(sumas) + "\n", encoding="utf-8")
    total = sum(f.stat().st_size for f in destino.rglob("*") if f.is_file())
    print(f"{len(sumas)} ficheros, {total / 1024:.0f} KiB -> {destino}")
    if problemas:
        print("NO PUBLICABLE:\n  " + "\n  ".join(problemas))
        return 1
    print("barrido sin hallazgos (terminos, rutas del equipo, scripts que falten)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
