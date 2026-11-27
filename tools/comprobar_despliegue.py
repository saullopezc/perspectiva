#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# comprobar_despliegue.py — Comprueba que el sitio publicado corresponde a un commit de main.
# No basta con mirar version.json: tras un push, el trabajo "pagina" puede seguir en cola y
# el sitio servir todavia la version anterior (eso ya hizo dar por buena una version que no
# lo era). Por eso, en orden:
#   1. espera a que termine la ejecucion de "pruebas" lanzada por el push de ese commit;
#   2. exige que su trabajo "pagina" (el que despliega) haya terminado en success;
#   3. publica ESE commit en limpio (git archive + tools/publicar_web.py, sin la copia de
#      trabajo, que puede tener otros finales de linea) y obtiene la version esperada;
#   4. la compara con version.json del sitio (con reintentos: la cache tarda en renovarse).
# Se ejecuta desde un clon del repositorio publicado. Necesita git y gh (autenticado).
#
# Uso:  python3 -I tools/comprobar_despliegue.py [COMMIT] [--repo DUENO/NOMBRE] [--url URL] [--espera SEG]
#       COMMIT por defecto: origin/main (tras git fetch). Repo: el de gh. URL: https://DUENO.github.io/NOMBRE/
# Salida: 0 coincide · 1 el sitio sirve otra version · 2 la CI o el despliegue fallaron · 3 se agoto la espera
# Author: Saul López
# Date:   2026-11-20
# -----------------------------------------------------------------------------
import argparse
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PAUSA = 20  # segundos entre consultas


def ejecutar(*cmd, binario=False):
    r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, check=True)
    return r.stdout if binario else r.stdout.decode().strip()


def gh_json(ruta):
    return json.loads(ejecutar("gh", "api", ruta))


def esperar_pruebas(repo, sha, limite):
    """Devuelve la ejecucion de "pruebas" del push de sha ya terminada, o None si se agota la espera."""
    while True:
        runs = [r for r in gh_json(f"repos/{repo}/actions/runs?head_sha={sha}&event=push")["workflow_runs"] if r["name"] == "pruebas"]
        if runs and runs[0]["status"] == "completed":
            return runs[0]
        estado = runs[0]["status"] if runs else "sin ejecucion todavia"
        if time.monotonic() > limite:
            print(f"pruebas de {sha[:7]}: {estado} al agotarse la espera")
            return None
        print(f"pruebas de {sha[:7]}: {estado}; nueva consulta en {PAUSA} s")
        time.sleep(PAUSA)


def version_esperada(sha):
    """Publica el commit en limpio y devuelve su version (la misma huella que calcula la CI)."""
    with tempfile.TemporaryDirectory() as tmp:
        fuente, destino = Path(tmp) / "fuente", Path(tmp) / "publicado"
        with tarfile.open(fileobj=io.BytesIO(ejecutar("git", "archive", sha, binario=True))) as t:
            t.extractall(fuente, filter="data")
        subprocess.run([sys.executable, "-I", str(fuente / "tools" / "publicar_web.py"), str(destino)], check=True, capture_output=True)
        return json.loads((destino / "version.json").read_text(encoding="utf-8"))["version"]


def version_publicada(url):
    with urllib.request.urlopen(f"{url.rstrip('/')}/version.json?t={time.time_ns()}", timeout=30) as r:
        return json.loads(r.read().decode())["version"]


def main():
    ap = argparse.ArgumentParser(description="Comprueba que el sitio publicado corresponde a un commit de main.")
    ap.add_argument("commit", nargs="?", default="origin/main")
    ap.add_argument("--repo", help="DUENO/NOMBRE (por defecto, el del clon segun gh)")
    ap.add_argument("--url", help="raiz del sitio (por defecto https://DUENO.github.io/NOMBRE/)")
    ap.add_argument("--espera", type=int, default=1800, help="segundos maximos de espera (por defecto 1800)")
    a = ap.parse_args()
    limite = time.monotonic() + a.espera
    if a.commit == "origin/main":
        ejecutar("git", "fetch", "-q", "origin", "main")
    sha = ejecutar("git", "rev-parse", "--verify", a.commit + "^{commit}")
    repo = a.repo or ejecutar("gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner")
    dueno, nombre = repo.split("/")
    url = a.url or f"https://{dueno}.github.io/{nombre}/"

    run = esperar_pruebas(repo, sha, limite)
    if run is None:
        return 3
    trabajos = {j["name"]: j["conclusion"] for j in gh_json(f"repos/{repo}/actions/runs/{run['id']}/jobs")["jobs"]}
    print(f"pruebas de {sha[:7]}: {run['conclusion']} · " + " · ".join(f"{n} {c}" for n, c in sorted(trabajos.items())))
    if trabajos.get("pagina") != "success":
        print(f"FALLO: el trabajo pagina termino en {trabajos.get('pagina')}: el sitio no se desplego desde {sha[:7]}")
        return 2

    esperada = version_esperada(sha)
    while True:
        publicada = version_publicada(url)
        if publicada == esperada:
            print(f"OK: {url} sirve {publicada}, la version de {sha[:7]}")
            return 0
        if time.monotonic() > limite:
            print(f"FALLO: {url} sirve {publicada}; la de {sha[:7]} es {esperada}")
            return 1
        print(f"el sitio sirve {publicada}, se espera {esperada}; nueva consulta en {PAUSA} s")
        time.sleep(PAUSA)


if __name__ == "__main__":
    sys.exit(main())
