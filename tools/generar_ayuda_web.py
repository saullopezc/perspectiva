#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# generar_ayuda_web.py — Convierte el manual (docs/MANUAL_perspectiva.md) en la
# ayuda integrada de tools/web/perspectiva.html: tools/web/js/ayuda_contenido.js
# (HTML ya escapado + SHA-256 del manual de origen, para detectar una ayuda desfasada).
# Una sola fuente: el manual. Conversor minimo del Markdown que usa el manual
# (titulos, parrafos, listas con un nivel de anidado, tablas, negrita, cursiva,
# codigo y enlaces, estos sin destino porque fuera de la pagina no existen).
#
# Uso:  python3 -I tools/generar_ayuda_web.py
# Author: Saul López
# Date:   2026-11-16
# Modified By:   Saul López
# Modified Date: 2026-11-19
# -----------------------------------------------------------------------------
import hashlib
import html
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MANUAL = RAIZ / "docs" / "MANUAL_perspectiva.md"
SALIDA = RAIZ / "tools" / "web" / "js" / "ayuda_contenido.js"
RE_ITEM = re.compile(r"^(\s*)(-|\d+\.) (.*)")


def en_linea(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])", r"<i>\1</i>", t)
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"<span class='ref' title='\2'>\1</span>", t)


def lista(lineas, i):
    """Lista (con un nivel de subelementos) desde la linea i. Devuelve (html, siguiente i)."""
    m = RE_ITEM.match(lineas[i]); base = len(m.group(1)); ordenada = m.group(2) != "-"
    items = []  # [texto, [subelementos]]
    while i < len(lineas):
        mi = RE_ITEM.match(lineas[i])
        if mi and len(mi.group(1)) == base:
            items.append([mi.group(3), []])
        elif mi and len(mi.group(1)) > base and items:
            items[-1][1].append(mi.group(3))
        elif lineas[i].startswith(" ") and lineas[i].strip() and items:  # continuacion de la linea anterior
            if items[-1][1]:
                items[-1][1][-1] += " " + lineas[i].strip()
            else:
                items[-1][0] += " " + lineas[i].strip()
        else:
            break
        i += 1
    et = "ol" if ordenada else "ul"
    cuerpo = "".join(f"<li>{en_linea(t)}" + (f"<ul>{''.join(f'<li>{en_linea(s)}</li>' for s in subs)}</ul>" if subs else "") + "</li>"
                     for t, subs in items)
    return f"<{et}>{cuerpo}</{et}>", i


def convertir(md):
    lineas = md.splitlines()
    if lineas and lineas[0] == "---":  # cabecera YAML del documento
        lineas = lineas[lineas.index("---", 1) + 1:]
    out, i, n = [], 0, len(lineas)
    while i < n:
        l = lineas[i]
        if not l.strip():
            i += 1
        elif (m := re.match(r"^(#{1,4}) (.*)", l)):
            nivel = min(6, len(m.group(1)) + 1)  # el titulo de la ventana de ayuda hace de h1
            ident = re.sub(r"[^a-z0-9]+", "-", m.group(2).lower()).strip("-")
            out.append(f"<h{nivel} id='ay-{ident}'>{en_linea(m.group(2))}</h{nivel}>")
            i += 1
        elif l.startswith("|"):
            filas = []
            while i < n and lineas[i].startswith("|"):
                if not re.match(r"^\|[\s:|-]+\|$", lineas[i]):
                    filas.append([c.strip() for c in lineas[i].strip().strip("|").split("|")])
                i += 1
            cab, *cuerpo = filas
            out.append("<table><tr>" + "".join(f"<th>{en_linea(c)}</th>" for c in cab) + "</tr>"
                       + "".join("<tr>" + "".join(f"<td>{en_linea(c)}</td>" for c in f) + "</tr>" for f in cuerpo) + "</table>")
        elif RE_ITEM.match(l):
            h, i = lista(lineas, i)
            out.append(h)
        else:
            parrafo = []
            while i < n and lineas[i].strip() and not re.match(r"^(#{1,4} |\|)", lineas[i]) and not RE_ITEM.match(lineas[i]):
                parrafo.append(lineas[i].strip())
                i += 1
            out.append(f"<p>{en_linea(' '.join(parrafo))}</p>")
    return "\n".join(out)


def main():
    cuerpo = convertir(MANUAL.read_text(encoding="utf-8"))
    sha = hashlib.sha256(MANUAL.read_bytes()).hexdigest()
    SALIDA.write_text(
        "// Generado por tools/generar_ayuda_web.py desde docs/MANUAL_perspectiva.md. NO editar a mano:\n"
        "// se edita el manual y se regenera (test_logica.js compara sha256Manual con el manual actual).\n"
        "window.RP = window.RP || {};\n"
        f"RP.AYUDA = {json.dumps({'sha256Manual': sha, 'html': cuerpo}, ensure_ascii=False)};\n", encoding="utf-8")
    print(f"ayuda -> {SALIDA.relative_to(RAIZ)} ({len(cuerpo)} caracteres, manual sha256 {sha[:16]}…)")


if __name__ == "__main__":
    main()
