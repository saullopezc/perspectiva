#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_color.py — QA del bloque Color de tools/web/perspectiva.html en navegador real.
# No mide "la huella cambio": compara PIXEL A PIXEL la salida con lo que cada control
# significa (ganancia k -> canal x k; saturacion 0 -> luma BT.601; tono 180 -> 2Y - c...),
# calculado aqui en Python sobre la entrada al ajuste (ultimaPlana). Ademas: interaccion
# con los filtros posteriores, gris por canal, interfaz (etiquetas, restablecer, recarga,
# configuracion por imagen) y que lo exportado sea lo que se ve.
# Imagen de prueba: 32 parches de color generados aqui (PNG sin dependencias).
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_color.py
# Author: Saul López
# Date:   2026-11-15
# Modified By:   Saul López
# Modified Date: 2026-11-19
# -----------------------------------------------------------------------------
import json
import math
import os
import struct
import sys
import zlib
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
HTML = RAIZ / "tools" / "web" / "perspectiva.html"
CHROME = Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
NAV = os.environ.get("QA_NAV", "chromium")
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_qa_color_{NAV}"
W, H = 80, 40
PARCHES = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (0, 255, 255), (255, 0, 255), (255, 255, 255), (0, 0, 0),
           (128, 128, 128), (30, 60, 160), (240, 240, 235), (200, 150, 120), (90, 40, 20), (20, 90, 40), (10, 10, 60), (250, 200, 30),
           (60, 60, 60), (190, 30, 40), (40, 120, 200), (230, 120, 0), (100, 0, 100), (0, 100, 100), (160, 200, 60), (220, 220, 20),
           (15, 15, 15), (245, 245, 245), (120, 80, 200), (80, 200, 120), (200, 80, 120), (128, 64, 32), (32, 64, 128), (64, 128, 32)]
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:400]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre} {detalle if not ok else ''}")


def png_parches():
    filas = b""
    for y in range(H):
        filas += b"\0" + b"".join(bytes(PARCHES[(y // 10) * 8 + x // 10]) for x in range(W))
    trozo = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + trozo(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)) + trozo(b"IDAT", zlib.compress(filas)) + trozo(b"IEND", b"")


cl = lambda v: 0 if v < 0 else 255 if v > 255 else v
Y = lambda r, g, b: 0.299 * r + 0.587 * g + 0.114 * b


def main():
    SALIDA.mkdir(parents=True)
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        pg = nav.new_page(viewport={"width": 1600, "height": 1000})
        errores = []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" and "downloadable font" not in m.text else None)
        pg.goto(HTML.as_uri()); pg.wait_for_timeout(500)
        abrir = lambda: pg.evaluate("() => document.querySelectorAll('details.bloque').forEach((d) => (d.open = true))")  # plegado = no visible
        abrir()
        pg.evaluate("""() => { window.__poner = (sel, v) => { const el = document.querySelector(sel);
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v;
            el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }; }""")
        poner = lambda k, v: pg.evaluate("([s, v]) => __poner(s, v)", [f"[data-p={k}]", v])

        def cargar(nombre):
            pg.set_input_files("#archivo", files=[{"name": nombre, "mimeType": "image/png", "buffer": png_parches()}]); pg.wait_for_timeout(700)
            pg.evaluate(f"() => {{ F0().esquinas = [[0,0],[{W},0],[{W},{H}],[0,{H}]]; procesarYa(); }}")

        def estado():  # entrada al ajuste de color (ultimaPlana) y salida (limpia), tras procesar
            pg.evaluate("() => procesarYa()")
            return pg.evaluate("() => ({w: limpia.width, h: limpia.height, ent: Array.from(ultimaPlana.rgb), sal: Array.from(limpia.data)})")

        def neutro():
            pg.click("#btnResetTodo"); poner("altoPx", str(H)); pg.wait_for_timeout(150)  # salida W x H: un pixel por pixel

        def comparar(nombre, fn, ajustes, tol=1.0, grupo="pixel", solo_sin_recorte=False):
            neutro()
            for k, v in ajustes.items():
                poner(k, v)
            e = estado(); n = e["w"] * e["h"]; peor, malos, usados = 0.0, 0, 0
            for i in range(n):
                r, g, b = e["ent"][i * 3:i * 3 + 3]; esp = fn(r, g, b)
                if solo_sin_recorte and any(v < 0 or v > 255 for v in esp):
                    continue
                usados += 1
                for c in range(3):
                    d = abs(cl(esp[c]) - e["sal"][i * 4 + c]); peor = max(peor, d)
                    if d > tol: malos += 1
            caso(grupo, nombre, malos == 0 and usados > 0, f"{malos} valores fuera de ±{tol} (peor {peor:.2f}) · {usados} px · ajustes {ajustes}")
            return e

        cargar("parches.png"); neutro()
        e = estado()
        ident = all(e["ent"][(y * W + x) * 3 + c] == PARCHES[(y // 10) * 8 + x // 10][c] for y in range(H) for x in range(W) for c in range(3))
        caso("base", f"geometria identidad: la entrada al color son los parches ({e['w']}x{e['h']})", ident and e["w"] == W)

        # ---------------- cada control, contra su significado
        comparar("todo neutro = entrada (tolerancia 0)", lambda r, g, b: (r, g, b), {}, tol=0)
        comparar("ganancia R 2 -> R x2, G y B intactos", lambda r, g, b: (2 * r, g, b), {"gananciaR": "2"})
        comparar("ganancia G 0.3 -> G x0.3", lambda r, g, b: (r, 0.3 * g, b), {"gananciaG": "0.3"})
        comparar("ganancia B 2.5 -> B x2.5", lambda r, g, b: (r, g, 2.5 * b), {"gananciaB": "2.5"})
        comparar("ganancia G 0 -> canal G a cero", lambda r, g, b: (r, 0, b), {"gananciaG": "0"})
        comparar("temperatura +80 (calido) -> R x1.24, B x0.76", lambda r, g, b: (1.24 * r, g, 0.76 * b), {"temperatura": "80"})
        comparar("temperatura -50 (frio) -> R x0.85, B x1.15", lambda r, g, b: (0.85 * r, g, 1.15 * b), {"temperatura": "-50"})
        comparar("saturacion 0 -> R=G=B=luma BT.601", lambda r, g, b: (Y(r, g, b),) * 3, {"saturacion": "0"})
        comparar("saturacion 2.5 -> Y + 2.5 (c - Y)", lambda r, g, b: tuple(Y(r, g, b) + 2.5 * (c - Y(r, g, b)) for c in (r, g, b)), {"saturacion": "2.5"})
        comparar("tono 180 -> complementario 2Y - c", lambda r, g, b: tuple(2 * Y(r, g, b) - c for c in (r, g, b)), {"tono": "180"})
        comparar("tono -180 = tono 180", lambda r, g, b: tuple(2 * Y(r, g, b) - c for c in (r, g, b)), {"tono": "-180"})
        comparar("ganancia R 2 + saturacion 0 -> luma del ganado", lambda r, g, b: (Y(2 * r, g, b),) * 3, {"gananciaR": "2", "saturacion": "0"})
        # tono 90: conserva luma y modulo de croma (YIQ estandar NTSC), gira la croma 90 grados
        I = lambda r, g, b: 0.596 * r - 0.274 * g - 0.322 * b
        Q = lambda r, g, b: 0.211 * r - 0.523 * g + 0.312 * b
        for ang in (90, -90, 45):
            neutro(); poner("tono", str(ang)); e = estado(); peor_y, peor_a, usados = 0, 0, 0
            for i in range(e["w"] * e["h"]):
                ent, sal = e["ent"][i * 3:i * 3 + 3], e["sal"][i * 4:i * 4 + 3]
                if any(v in (0, 255) for v in sal) or math.hypot(I(*ent), Q(*ent)) < 20:
                    continue  # recortado o casi gris: el angulo no se puede medir
                usados += 1; peor_y = max(peor_y, abs(Y(*ent) - Y(*sal)))
                giro = math.degrees(math.atan2(Q(*sal), I(*sal)) - math.atan2(Q(*ent), I(*ent)))
                peor_a = max(peor_a, abs((giro - ang + 180) % 360 - 180))
            caso("pixel", f"tono {ang}: luma conservada y croma girada {ang} grados", usados > 0 and peor_y < 1.5 and peor_a < 3, f"peor luma {peor_y:.2f} · peor angulo {peor_a:.2f} · {usados} px")

        # ---------------- gris por canal / mezclador (con 'escala de grises' marcada)
        comparar("gris BT.601", lambda r, g, b: (Y(r, g, b),) * 3, {"gris": True, "modoGris": "bt601"}, grupo="gris")
        for c, k in (("R", 0), ("G", 1), ("B", 2)):
            comparar(f"gris desde canal {c}", lambda r, g, b, k=k: ((r, g, b)[k],) * 3, {"gris": True, "modoGris": c}, grupo="gris")
        comparar("gris canal R tras ganancia R 2", lambda r, g, b: (2 * r,) * 3, {"gris": True, "modoGris": "R", "gananciaR": "2"}, grupo="gris")
        comparar("mezclador (1,1,0) -> (R+G)/2", lambda r, g, b: ((r + g) / 2,) * 3, {"gris": True, "modoGris": "mezcla", "mezclaR": "1", "mezclaG": "1", "mezclaB": "0"}, grupo="gris")
        comparar("mezclador (-1,1,0) -> (G-R)/2", lambda r, g, b: ((g - r) / 2,) * 3, {"gris": True, "modoGris": "mezcla", "mezclaR": "-1", "mezclaG": "1", "mezclaB": "0"}, grupo="gris")
        comparar("mezclador (1,0,0) = canal R", lambda r, g, b: (r,) * 3, {"gris": True, "modoGris": "mezcla"}, grupo="gris")

        # ---------------- usabilidad: 'gris desde' sin marcar 'escala de grises' (el selector esta en Color, la casilla en Luminancia)
        neutro(); e0 = estado()["sal"]; poner("modoGris", "R"); e1 = estado()["sal"]
        caso("usabilidad", "elegir 'gris desde: canal R' cambia la salida (sin tocar la casilla de Luminancia)", e0 != e1,
             "NO cambia: el selector solo actua con 'escala de grises' marcada en otro bloque" if e0 == e1 else "")
        caso("usabilidad", "... y la salida es la del canal R (gris marcado solo)", pg.is_checked("[data-p=gris]") and all(e1[i * 4] == e1[i * 4 + 1] == e1[i * 4 + 2] == round(estado()["ent"][i * 3]) for i in range(W * H)))
        neutro(); poner("mezclaG", "1")
        caso("usabilidad", "mover el mezclador pasa a 'mezcla' y marca gris", pg.input_value("[data-p=modoGris]") == "mezcla" and pg.is_checked("[data-p=gris]"), pg.input_value("[data-p=modoGris]"))
        neutro(); poner("modoGris", "bt601")
        caso("usabilidad", "elegir BT.601 marca gris (luminancia)", pg.is_checked("[data-p=gris]"))
        neutro(); e0 = estado()["sal"]; poner("modoGris", "R"); e1 = estado()["sal"]; poner("modoGris", "color"); e2 = estado()["sal"]
        caso("usabilidad", "volver a 'normal (color)' tras un canal desmarca gris y deja la salida neutra", not pg.is_checked("[data-p=gris]") and e2 == e0 and e1 != e0)

        # ---------------- interaccion con filtros posteriores (trabajan por canal)
        for filtro, aj in (("auto-niveles", {"autoNiveles": True}), ("CLAHE", {"clahe": True}), ("campo plano dividir", {"campoPlano": "dividir"})):
            for ctl, v in (("gananciaR", "2"), ("temperatura", "80"), ("gananciaB", "0.5")):
                neutro()
                for k, x in aj.items(): poner(k, x)
                a = estado()["sal"]; poner(ctl, v); b = estado()["sal"]
                dif = sum(abs(x - y) for x, y in zip(a, b)) / (W * H * 3)
                caso("interaccion", f"{ctl}={v} sigue teniendo efecto con {filtro}", dif > 1, f"diferencia media {dif:.3f} niveles por valor")
        neutro(); poner("gananciaR", "3"); poner("autoNiveles", True); e = estado()
        rojo_blanco = e["sal"][0:3]
        caso("interaccion", "ganancia R 3 + auto-niveles: el parche rojo puro sigue siendo rojo puro", rojo_blanco == [255, 0, 0], rojo_blanco)
        # auto-niveles = UN estiramiento 1-99 % comun a los canales (en color) o del canal unico (en gris)
        def estiramiento(valores):
            o = sorted(valores); lo, hi = o[int(len(o) * 0.01)], o[int(len(o) * 0.99)]
            return lambda v: (v - lo) * 255 / max(1, hi - lo)
        for nombre, aj in (("color + ganancia R 2", {"gananciaR": "2", "autoNiveles": True}), ("color + temperatura 60", {"temperatura": "60", "autoNiveles": True})):
            neutro()
            for k, v in aj.items(): poner(k, v)
            e = estado(); g = 2 if "gananciaR" in aj else 1; t = 0.6 if "temperatura" in aj else 0
            col = [(r * g * (1 + 0.3 * t), gg, b * (1 - 0.3 * t)) for r, gg, b in zip(e["ent"][0::3], e["ent"][1::3], e["ent"][2::3])]
            f = estiramiento([c for p in col for c in p])
            malos = sum(1 for i, p in enumerate(col) for c in range(3) if abs(cl(f(p[c])) - e["sal"][i * 4 + c]) > 1)
            caso("interaccion", f"auto-niveles comun a R, G y B ({nombre})", malos == 0, f"{malos} valores fuera de ±1")
        neutro(); poner("gris", True); poner("autoNiveles", True); e = estado()
        lum = [Y(*e["ent"][i * 3:i * 3 + 3]) for i in range(W * H)]; f = estiramiento(lum)
        malos = sum(1 for i in range(W * H) if abs(cl(f(lum[i])) - e["sal"][i * 4]) > 1)
        caso("interaccion", "auto-niveles en gris: igual que antes (un canal)", malos == 0, f"{malos} valores fuera de ±1")

        # ---------------- histograma: conteo independiente (Python) sobre los mismos pixeles de salida
        def histo_py(sal):
            h = {c: [0] * 256 for c in "RGBL"}
            for i in range(0, len(sal), 4):
                r, g, b = sal[i:i + 3]
                h["R"][r] += 1; h["G"][g] += 1; h["B"][b] += 1; h["L"][min(255, max(0, round(Y(r, g, b))))] += 1
            return h
        histo_js = lambda: pg.evaluate("() => ultimoHisto && ({R: Array.from(ultimoHisto.H.R), G: Array.from(ultimoHisto.H.G), B: Array.from(ultimoHisto.H.B), L: Array.from(ultimoHisto.H.L), e: ultimoHisto.e})")
        for nombre, aj in (("neutro", {}), ("ganancia R 2", {"gananciaR": "2"}), ("gris canal B", {"gris": True, "modoGris": "B"})):
            neutro()
            for k, v in aj.items(): poner(k, v)
            e = estado(); hj, hp = histo_js(), histo_py(e["sal"])
            dif = {c: sum(abs(a - b) for a, b in zip(hj[c], hp[c])) for c in "RGB"}
            difL = sum(abs(a - b) for a, b in zip(hj["L"], hp["L"]))
            caso("histograma", f"{nombre}: bins R, G, B = conteo independiente", all(v == 0 for v in dif.values()), dif)
            caso("histograma", f"{nombre}: bins de luminancia (±1 nivel por redondeo)", difL <= 2 * W * H * 0.02, f"diferencia {difL}")
        neutro(); poner("gananciaR", "2"); e = estado(); hj = histo_js()
        esp = 100 * sum(1 for i in range(0, len(e["sal"]), 4) if e["sal"][i] == 255) / (W * H)
        caso("histograma", "recorte alto de R con ganancia 2 = % de pixeles R=255", abs(hj["e"]["R"]["alto"] - esp) < 1e-6, f"{hj['e']['R']['alto']:.2f}% vs {esp:.2f}%")
        caso("histograma", "el texto muestra el recorte de R", f"{esp:.1f}%" in pg.inner_text("#histoInfo"), pg.inner_text("#histoInfo"))
        caso("histograma", "control: sin ganancia el recorte alto de G es el de los parches", abs(hj["e"]["G"]["alto"] - 100 * sum(1 for p in PARCHES if p[1] == 255) / 32) < 1e-6, hj["e"]["G"]["alto"])
        pinta = lambda: pg.evaluate("() => { const c = document.getElementById('histo'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; }")
        n1 = pinta(); pg.check("#histoRef"); pg.wait_for_timeout(100); n2 = pinta(); pg.check("#histoLog"); pg.wait_for_timeout(100); n3 = pinta()
        caso("histograma", "el lienzo dibuja; 'entrada' y 'log' cambian el dibujo", n1 > 0 and n2 != n1 and n3 != n2, f"{n1} / {n2} / {n3}")
        pg.uncheck("#histoRef"); pg.uncheck("#histoLog")
        # ambito: region parcial (2 columnas de parches) frente a imagen completa (los 32 parches, sin ajustes)
        neutro(); poner("gananciaR", "2")
        pg.evaluate(f"() => {{ F0().esquinas = [[0,0],[20,0],[20,{H}],[0,{H}]]; procesarYa(); }}")
        reg = histo_js()
        pg.select_option("#histoAmbito", "completa"); pg.wait_for_timeout(150); com = histo_js()
        esp = {c: [0] * 256 for c in "RGB"}
        for y in range(H):
            for x in range(W):
                for k, c in enumerate("RGB"): esp[c][PARCHES[(y // 10) * 8 + x // 10][k]] += 1
        caso("histograma", "imagen completa = conteo de los parches originales (sin la ganancia)", all(com[c] == esp[c] for c in "RGB"), {c: sum(abs(a - b) for a, b in zip(com[c], esp[c])) for c in "RGB"})
        caso("histograma", "control: la region parcial con ganancia es distinta de la completa", reg["R"] != com["R"])
        caso("histograma", "en 'completa' la casilla 'entrada' se desactiva", pg.is_disabled("#histoRef"))
        pg.select_option("#histoAmbito", "region"); pg.wait_for_timeout(150)
        caso("histograma", "volver a 'region' recupera el de la region", histo_js()["R"] == reg["R"] and not pg.is_disabled("#histoRef"))
        pg.evaluate(f"() => {{ F0().esquinas = [[0,0],[{W},0],[{W},{H}],[0,{H}]]; procesarYa(); }}")

        # ---------------- interfaz
        neutro()
        for k, v in (("gananciaR", "1.5"), ("temperatura", "-30"), ("saturacion", "0.4"), ("tono", "45"), ("mezclaG", "-0.5")):
            poner(k, v); pg.evaluate("() => procesarYa()")
            caso("interfaz", f"etiqueta de {k} muestra {v}", pg.inner_text(f"[data-v={k}]") == v, pg.inner_text(f"[data-v={k}]"))
        neutro(); base = estado()["sal"]
        for k, v in (("gananciaR", "2"), ("gananciaG", "0.5"), ("gananciaB", "2"), ("temperatura", "40"), ("saturacion", "0"), ("tono", "30"),
                     ("modoGris", "B"), ("mezclaR", "-1"), ("mezclaG", "1"), ("mezclaB", "1")):
            poner(k, v)
        pg.click("#btnColorNeutro"); pg.wait_for_timeout(150)
        vals = pg.evaluate("() => Object.fromEntries(['gananciaR','gananciaG','gananciaB','temperatura','saturacion','tono','modoGris','mezclaR','mezclaG','mezclaB'].map(k => [k, document.querySelector(`[data-p=${k}]`).value]))")
        caso("interfaz", "restablecer color: los 10 controles a su valor del HTML", vals == pg.evaluate("() => Object.fromEntries(Object.keys(DEFECTO).filter(k => /^(ganancia|temperatura|saturacion|tono|modoGris|mezcla)/.test(k)).map(k => [k, String(DEFECTO[k])]))"), vals)
        caso("interfaz", "restablecer color: salida = neutra (pixeles)", estado()["sal"] == base)
        caso("interfaz", "restablecer color: actualiza las etiquetas", pg.inner_text("[data-v=gananciaR]") == "1" and pg.inner_text("[data-v=tono]") == "0", pg.inner_text("[data-v=gananciaR]"))
        poner("gananciaR", "2"); poner("gamma", "2"); pg.click("details.bloque:has([data-p=gananciaR]) > summary .reset"); pg.wait_for_timeout(150)
        caso("interfaz", "↺ del bloque Color: restablece color y no la gamma", pg.input_value("[data-p=gananciaR]") == "1" and pg.input_value("[data-p=gamma]") == "2")
        # recarga: el navegador (Firefox) puede restaurar los controles; deben volver a los del HTML
        neutro(); poner("gananciaR", "2.5"); poner("saturacion", "0"); poner("modoGris", "R"); poner("mezclaR", "-1"); poner("tono", "60")
        pg.reload(); pg.wait_for_timeout(700); abrir()
        rec = pg.evaluate("() => ['gananciaR','saturacion','modoGris','mezclaR','tono'].map(k => document.querySelector(`[data-p=${k}]`).value)")
        caso("interfaz", "tras recargar, color vuelve a los valores del HTML", rec == ["1", "1", "color", "1", "0"], rec)
        pg.evaluate("""() => { window.__poner = (sel, v) => { const el = document.querySelector(sel);
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v;
            el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }; }""")
        # configuracion por imagen
        cargar("a.png"); cargar("b.png")
        pg.select_option("#modoConfig", "cero"); pg.wait_for_timeout(100)
        pg.evaluate("() => seleccionar(0)"); poner("gananciaR", "2"); sal_a = estado()["sal"]
        pg.evaluate("() => seleccionar(1)"); pg.wait_for_timeout(100)
        caso("por imagen", "modo 'cero': la otra imagen empieza neutra", pg.input_value("[data-p=gananciaR]") == "1", pg.input_value("[data-p=gananciaR]"))
        poner("tono", "90"); pg.evaluate("() => seleccionar(0)"); pg.wait_for_timeout(100)
        caso("por imagen", "volver a la primera: recupera SU color (controles y pixeles)", pg.input_value("[data-p=gananciaR]") == "2" and pg.input_value("[data-p=tono]") == "0" and estado()["sal"] == sal_a,
             f"gananciaR {pg.input_value('[data-p=gananciaR]')} tono {pg.input_value('[data-p=tono]')}")
        pg.select_option("#modoConfig", "mantener"); pg.wait_for_timeout(100); pg.evaluate("() => seleccionar(1)"); pg.wait_for_timeout(100)
        caso("por imagen", "modo 'mantener': la otra imagen usa el mismo color", pg.input_value("[data-p=gananciaR]") == "2", pg.input_value("[data-p=gananciaR]"))
        # lo exportado es lo que se ve (codifica a PNG y lo decodifica el navegador)
        neutro(); poner("gananciaB", "2"); poner("tono", "30"); pg.evaluate("() => procesarYa()")
        igual = pg.evaluate("""async () => { const {blob} = await RP.codificar(limpia, 'png'); const bm = await createImageBitmap(blob);
            const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
            const d = x.getImageData(0, 0, c.width, c.height).data; return d.length === limpia.data.length && d.every((v, i) => v === limpia.data[i]); }""")
        caso("exportar", "PNG exportado con color = pixeles de la salida", igual)
        fuente_ok = pg.evaluate("() => { const d = F0().datos.data; return d[0] === 255 && d[1] === 0 && d[2] === 0; }")
        caso("exportar", "el color no altera la fuente original (contenido 'fuente')", fuente_ok)
        pg.screenshot(path=str(SALIDA / "01_color.png"), full_page=True)
        caso("errores", "sin errores de JavaScript", not errores, errores[:5])
        nav.close()
    fallos = [x for x in res if not x["ok"]]
    (SALIDA / "resultados.json").write_text(json.dumps(res, indent=2, ensure_ascii=False))
    filas = "\n".join(f"| {x['grupo']} | {x['control']} | {'OK' if x['ok'] else 'FALLO'} | {x['detalle'].replace('|', '/')} |" for x in res)
    (SALIDA / "REPORTE.md").write_text(f"# QA color — perspectiva.html\n\n{len(res)} casos, {len(fallos)} fallos · {NAV}\n\n| grupo | control | resultado | detalle |\n|---|---|---|---|\n{filas}\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
