#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_navegador.py — QA funcional de tools/web/perspectiva.html en Chromium real
# (Playwright). Acciona cada control y verifica su EFECTO: huella de la salida antes/
# despues, firma de cada descarga, clases del panel, carrusel, video y reproduccion
# desde JSON. Captura errores de JS. Resultados en _local/qa/<TS>_web_qa/.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_navegador.py IMG_1 IMG_2 VIDEO_WEBM
#       (QA_NAV: chromium por defecto; firefox con 'playwright install firefox')
# Author: Saul López
# Date:   2026-11-13
# Modified By:   Saul López
# Modified Date: 2026-11-19
# -----------------------------------------------------------------------------
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
HTML = RAIZ / "tools" / "web" / "perspectiva.html"
CHROME = Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
NAV = os.environ.get("QA_NAV", "chromium")
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_qa_{NAV}"
FIRMAS = {"png": b"\x89PNG", "tif": b"II*\x00", "bmp": b"BM", "ppm": b"P6\n", "pgm": b"P5\n", "jpg": b"\xff\xd8\xff",
          "webp": b"RIFF", "avif": b"\x00\x00\x00", "json": b"{"}
res = []


def caso(grupo, nombre, ok, detalle=""):
    res.append({"grupo": grupo, "control": nombre, "ok": bool(ok), "detalle": str(detalle)[:300]})
    print(f"{'OK   ' if ok else 'FALLO'} [{grupo}] {nombre} {detalle if not ok else ''}")


def main(img1, img2, video):
    SALIDA.mkdir(parents=True)
    with sync_playwright() as p:
        if NAV == "firefox":
            nav = p.firefox.launch(headless=True)
            ctx = nav.new_context(accept_downloads=True, viewport={"width": 1600, "height": 1000})
        else:
            nav = p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
            ctx = nav.new_context(accept_downloads=True, viewport={"width": 1600, "height": 1000}, permissions=["clipboard-read", "clipboard-write"])
        pg = ctx.new_page()
        errores = []
        pg.on("pageerror", lambda e: errores.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errores.append(f"console.{m.type}: {m.text}") if m.type == "error" and "downloadable font" not in m.text else None)
        pg.goto(HTML.as_uri())
        pg.wait_for_timeout(500)
        # recarga con controles cambiados: el navegador (Firefox) puede restaurarlos; la herramienta debe volver a los del HTML
        # (sin imagen las herramientas de imagen estan inactivas: se carga una antes, como haria el usuario)
        caso("inicio", "sin imagen: herramientas de imagen inactivas", pg.evaluate("document.body.classList.contains('sin-imagen')"))
        pg.set_input_files("#archivo", img1); pg.wait_for_timeout(800)
        pg.check("[data-p=gris]"); pg.select_option("[data-p=interp]", "bicubica"); pg.reload(); pg.wait_for_timeout(700)
        rec = pg.evaluate("() => ({gris: document.querySelector('[data-p=gris]').checked, interp: document.querySelector('[data-p=interp]').value, defGris: DEFECTO.gris})")
        caso("inicio", "tras recargar vuelve a los valores del HTML (no a los restaurados)", not rec["gris"] and rec["interp"] == "vecino" and not rec["defGris"], rec)
        pg.evaluate("""() => { window.__poner = (sel, v) => { const el = document.querySelector(sel);
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v;
            el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }; }""")

        def esperar():
            pg.wait_for_timeout(120)
            prev = None
            for _ in range(40):
                h = huella()
                if h == prev:
                    return h
                prev = h
                pg.wait_for_timeout(120)
            return prev

        def huella():
            return pg.evaluate("() => limpia ? limpia.width + 'x' + limpia.height + ':' + Array.from(limpia.data).reduce((h, v, i) => (h * 31 + v + i) % 2147483647, 7) : null")

        def poner(sel, v):
            pg.evaluate("([s, v]) => __poner(s, v)", [sel, v])

        def clic_img(x, y):
            cx, cy = pg.evaluate("([x, y]) => { const r = cvF.getBoundingClientRect(), d = devicePixelRatio || 1; const [a, b] = aCanvas(x, y); return [r.left + a / d, r.top + b / d]; }", [x, y])
            pg.mouse.click(cx, cy)

        texto = lambda sel: pg.inner_text(sel)

        # ---------------- valores iniciales neutros (la salida inicial = pixeles originales)
        ini = pg.evaluate("() => ({interp: document.querySelector('[data-p=interp]').value, gris: document.querySelector('[data-p=gris]').checked, auto: document.querySelector('[data-p=autoNiveles]').checked})")
        caso("inicio", "interpolacion inicial 'ninguna' (vecino)", ini["interp"] == "vecino", ini)
        caso("inicio", "sin gris ni auto-niveles al inicio", not ini["gris"] and not ini["auto"], ini)

        # ---------------- carga y carrusel
        pg.set_input_files("#archivo", [img1, img2])
        pg.wait_for_timeout(800)
        caso("carga", "dos imagenes", "2/2" in texto("#estado"), texto("#estado"))
        caso("carga", "analisis hex de la fuente", "firma: PNG" in pg.text_content("#hexInfo"), pg.text_content("#hexInfo")[:80])
        caso("carrusel", "hojas renderizadas", pg.locator("#carrusel figure.hoja").count() == 2)
        pg.click("#btnAnterior"); pg.wait_for_timeout(300)
        caso("carrusel", "boton anterior", "1/2" in texto("#estado"), texto("#estado"))
        pg.keyboard.press("."); pg.wait_for_timeout(300)
        caso("carrusel", "tecla '.' siguiente", "2/2" in texto("#estado"), texto("#estado"))
        pg.locator("#carrusel figure.hoja:not(.actual)").first.click(); pg.wait_for_timeout(400)
        caso("carrusel", "clic en hoja", "1/2" in texto("#estado"), texto("#estado"))
        pg.mouse.move(800, 140); pg.mouse.wheel(0, 120); pg.wait_for_timeout(400)
        caso("carrusel", "rueda", "2/2" in texto("#estado"), texto("#estado"))
        pg.click("#btnAnterior"); pg.wait_for_timeout(300)

        # ---------------- geometria: esquinas (desordenadas) en el rotulo de la imagen
        E = [[288, 210], [140, 125], [290, 130], [138, 205]]
        for x, y in E:
            clic_img(x, y)
        h0 = esperar()
        caso("geometria", "4 esquinas -> salida", h0 is not None, texto("#infoSalida"))
        croma = pg.evaluate("() => { const d = limpia.data; let s = 0; for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]); return s / (d.length / 4); }")
        caso("color", "salida en color por defecto (no gris)", croma > 2, f"croma media {croma:.2f}")
        orden = pg.evaluate("() => esquinas().map(p => p.map(Math.round))")
        esperado = [[140, 125], [290, 130], [288, 210], [138, 205]]
        caso("geometria", "ordenar esquinas", all(abs(a - b) <= 1 for p, q in zip(orden, esperado) for a, b in zip(p, q)), f"{orden}")
        poner("#tablaPts input[data-i='0'][data-k='0']", "292")
        caso("geometria", "edicion numerica de punto", esperar() != h0)
        poner("#tablaPts input[data-i='0'][data-k='0']", "288"); esperar()
        z0 = texto("#zNivel"); pg.click("#zMas"); z1 = texto("#zNivel")
        caso("zoom", "boton +", z1 != z0, f"{z0}->{z1}")
        pg.click("#zMenos"); caso("zoom", "boton -", texto("#zNivel") == z0, texto("#zNivel"))
        pg.click("#z11"); caso("zoom", "1:1", texto("#zNivel") == "100%", texto("#zNivel"))
        pg.click("#zAjustar"); caso("zoom", "ajustar", texto("#zNivel") == z0, texto("#zNivel"))
        bb = pg.locator("#fuente").bounding_box(); pg.mouse.move(bb["x"] + 200, bb["y"] + 200); pg.mouse.wheel(0, -200)
        caso("zoom", "rueda en lienzo", texto("#zNivel") != z0, texto("#zNivel")); pg.click("#zAjustar")
        pg.click("label:has(input[name=modoGeo][value=aristas])"); pg.wait_for_timeout(200)
        pg.click("#btnReiniciar")
        A = [[150, 127], [270, 129], [289, 150], [289, 195], [270, 208], [150, 206], [139, 195], [139, 150]]
        for x, y in A:
            clic_img(x, y)
        ha = esperar()
        caso("geometria", "modo aristas (8 puntos) -> salida", ha is not None and "esquinas:" in pg.text_content("#tablaPts"), texto("#infoGeo"))
        pg.click("label:has(input[name=modoGeo][value=esquinas])"); h0 = esperar()
        pg.screenshot(path=str(SALIDA / "01_esquinas.png"), full_page=True)

        # ---------------- bloques plegables
        b = pg.locator("#panel details.bloque", has_text="Ruido y movimiento").first
        estado0 = b.evaluate("d => d.open"); b.locator("summary").click(position={"x": 40, "y": 15}); pg.wait_for_timeout(150)
        caso("interfaz", "plegar/desplegar bloque", b.evaluate("d => d.open") != estado0)
        sb = b.locator("summary").bounding_box(); rb = b.locator("summary button.reset").bounding_box()
        caso("interfaz", "boton ↺ al extremo derecho de la cabecera", rb["x"] + rb["width"] > sb["x"] + sb["width"] - 40, f"{rb} en {sb}")
        pg.evaluate("() => document.querySelectorAll('details').forEach(d => d.open = true)")

        # ---------------- cada parametro: efecto sobre la salida

        def restaurar():
            # como el usuario (↺ todo): reponer cada control con eventos 'input' sinteticos simula que se MUEVE, y
            # mover el mezclador cambia a modo mezcla y marca gris (comportamiento buscado al mover, no al restaurar)
            pg.evaluate("() => document.getElementById('btnResetTodo').click()")
            esperar()
            caso_ok = pg.evaluate("() => Object.entries(DEFECTO).every(([k, v]) => k.startsWith('__') || String(leerConfig()[k]) === String(v))")
            if not caso_ok:
                caso("parametro", "restaurar deja todo en los valores del HTML", False, pg.evaluate("() => leerConfig()"))

        pruebas = [  # (parametro, valor, prerequisitos)
            ("altoPx", "200", {}), ("anchoCm", "40", {}), ("altoCm", "20", {}), ("margenPct", "10", {}),
            ("giroFino", "5", {}), ("giroFino", "135", {}), ("espejo", True, {}), ("espejoV", True, {}),
            ("trapH", "15", {}), ("trapH", "-15", {}), ("trapV", "12", {}), ("trapV", "-12", {}),
            ("interp", "bicubica", {}), ("interp", "bilineal", {}), ("interp", "lanczos3", {}), ("interp", "mitchell", {}),
            ("interp", "bspline", {}), ("interp", "escalera", {}),
            ("gananciaR", "2", {}), ("gananciaG", "0.3", {}), ("gananciaB", "2.5", {}), ("temperatura", "80", {}),
            ("saturacion", "2.5", {"gris": False}), ("tono", "90", {"gris": False}),
            ("modoGris", "R", {"gris": True}), ("modoGris", "B", {"gris": True}), ("mezclaR", "-1", {"gris": True, "modoGris": "mezcla"}),
            ("mezclaG", "1", {"gris": True, "modoGris": "mezcla"}), ("mezclaB", "1", {"gris": True, "modoGris": "mezcla"}),
            ("ruido", "mediana", {}), ("ruido", "gaussiano", {}), ("ruido", "bilateral", {}),
            ("ruidoRadio", "3", {"ruido": "mediana"}), ("ruidoRango", "70", {"ruido": "bilateral", "ruidoRadio": "2"}),
            ("movimiento", True, {}), ("movLong", "15", {"movimiento": True}), ("movAng", "45", {"movimiento": True}),
            ("movIters", "40", {"movimiento": True}),
            ("gris", True, {}), ("vista", "sobel", {}), ("campoPlano", "dividir", {}), ("campoPlano", "restar", {}),
            ("campoSigma", "40", {"campoPlano": "dividir"}), ("clahe", True, {}), ("claheClip", "6", {"clahe": True}),
            ("claheTx", "8", {"clahe": True}), ("claheTy", "4", {"clahe": True}), ("autoNiveles", True, {}),
            ("negro", "80", {}), ("blanco", "150", {}), ("gamma", "2", {}), ("brillo", "60", {}), ("contraste", "120", {}),
            ("enfoque", "200", {}), ("radioEnf", "6", {"enfoque": "150"}), ("binarizar", True, {}),
            ("umbral", "60", {"binarizar": True}), ("negativo", True, {}),
        ]
        for k, v, pre in pruebas:
            restaurar()
            for pk, pv in pre.items():
                poner(f"[data-p='{pk}']", pv)
            antes = esperar()
            poner(f"[data-p='{k}']", v)
            despues = esperar()
            caso("parametro", f"{k}={v}" + (f" (con {pre})" if pre else ""), despues is not None and despues != antes, f"{antes} == {despues}")
        restaurar()

        # ---------------- espejo H + V = giro 180 (equivalencia exacta con vecino)
        poner("[data-p=espejo]", True); poner("[data-p=espejoV]", True); hev = esperar()
        poner("[data-p=espejo]", False); poner("[data-p=espejoV]", False); poner("[data-p=giroFino]", "180"); h180 = esperar()
        caso("geometria", "espejo horizontal + vertical = rotacion 180", hev == h180, f"{hev} vs {h180}")
        restaurar()

        # ---------------- botones de giro, preset, color, zoom salida
        h = esperar(); pg.click("#btnMas90"); h90 = esperar()
        caso("giro", "+90 intercambia dimensiones", h90 and h and h90.split(":")[0] == "x".join(reversed(h.split(":")[0].split("x"))), f"{h} -> {h90}")
        pg.click("#btnMenos90"); caso("giro", "-90 vuelve", esperar() == h)
        pg.select_option("#preset", "52x11"); esperar()
        caso("forma", "preset UE 52x11", pg.input_value("[data-p=anchoCm]") == "52" and huella().startswith(f"{round(160 * 52 / 11)}x160"), huella()[:12])
        pg.select_option("#preset", "30x15"); esperar()
        poner("[data-p=gananciaR]", "2"); pg.click("#btnColorNeutro"); esperar()
        caso("color", "restablecer color", pg.input_value("[data-p=gananciaR]") == "1" and huella() == h, pg.input_value("[data-p=gananciaR]"))
        w0 = pg.evaluate("() => cvS.width"); poner("#zoomSalida", "6"); pg.wait_for_timeout(300)
        caso("salida", "zoom de vista", pg.evaluate("() => cvS.width") == w0 * 2, f"{w0} -> {pg.evaluate('() => cvS.width')}")
        poner("#zoomSalida", "3"); esperar()

        # ---------------- restablecer: por bloque y todo
        poner("[data-p=gamma]", "2.2"); poner("[data-p=brillo]", "40"); poner("[data-p=gananciaR]", "1.8"); esperar()
        pg.locator("#panel details.bloque", has_text="Luminancia y nitidez").first.locator("summary button.reset").click(); pg.wait_for_timeout(200)
        caso("restablecer", "↺ del bloque Luminancia solo afecta a su bloque", pg.input_value("[data-p=gamma]") == "1" and pg.input_value("[data-p=brillo]") == "0" and pg.input_value("[data-p=gananciaR]") == "1.8")
        pg.click("#btnMas90"); pg.click("#btnResetTodo"); esperar()
        caso("restablecer", "↺ todo (incluye giro 90)", pg.input_value("[data-p=gananciaR]") == "1" and huella() == h, f"{huella()} vs {h}")

        # ---------------- configuracion entre imagenes
        # por defecto cada imagen guarda sus ajustes al visitarla: se parte de imagenes sin ajustes guardados, como recien cargadas
        pg.evaluate("() => fuentes.forEach(F => delete F.config)")
        pg.select_option("#modoConfig", "copiar"); poner("[data-p=contraste]", "80"); esperar()
        pg.click("#btnSiguiente"); pg.wait_for_timeout(400)
        caso("entre imagenes", "copiar: la nueva parte de la anterior", pg.input_value("[data-p=contraste]") == "80")
        poner("[data-p=contraste]", "20"); pg.click("#btnAnterior"); pg.wait_for_timeout(400)
        caso("entre imagenes", "por imagen: la 1 conserva la suya", pg.input_value("[data-p=contraste]") == "80", pg.input_value("[data-p=contraste]"))
        pg.click("#btnSiguiente"); pg.wait_for_timeout(400)
        caso("entre imagenes", "por imagen: la 2 conserva la suya", pg.input_value("[data-p=contraste]") == "20", pg.input_value("[data-p=contraste]"))
        pg.select_option("#modoConfig", "mantener"); poner("[data-p=contraste]", "55"); pg.click("#btnAnterior"); pg.wait_for_timeout(400)
        caso("entre imagenes", "mantener: misma configuracion al cambiar", pg.input_value("[data-p=contraste]") == "55")
        pg.click("#btnResetTodo"); esperar()

        # ---------------- plantilla y fuentes locales
        pg.fill("#plantilla", "P123BCD"); pg.wait_for_timeout(300)
        caso("plantilla", "formato valido", texto("#formato") == "formato GT valido", texto("#formato"))
        pg.fill("#plantilla", "P123ABC"); pg.wait_for_timeout(300)
        caso("plantilla", "formato invalido (vocal)", "NO valido" in texto("#formato"), texto("#formato"))
        opciones = pg.eval_on_selector_all("#fuenteTxt option", "os => os.map(o => o.textContent)")
        caso("fuentes", "fuentes libres incluidas en el selector", all(f in opciones for f in ("Barlow", "Oswald", "Overpass")), opciones)
        caso("fuentes", "FontFace cargada", pg.evaluate("() => document.fonts.check('20px \"Oswald\"')"))
        caso("fuentes", "sin ?fuentes=locales no se piden las fuentes locales", not any("(_local)" in o or ".TTF)" in o for o in opciones))
        if (RAIZ / "_local" / "fonts" / "fuentes_embebidas.js").is_file():  # solo en un equipo que las tenga
            pl = ctx.new_page(); pl.goto(HTML.as_uri() + "?fuentes=locales"); pl.wait_for_timeout(1500)
            ol = pl.eval_on_selector_all("#fuenteTxt option", "os => os.map(o => o.textContent)")
            caso("fuentes", "con ?fuentes=locales aparecen las fuentes locales", any(".TTF)" in o for o in ol), ol); pl.close()
        vista_px = lambda: pg.evaluate("() => { const d = ctxS.getImageData(0, 0, cvS.width, cvS.height).data; let h = 7; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) % 2147483647; return h; }")
        pg.fill("#plantilla", "P123BCD"); pg.wait_for_timeout(300); v0 = vista_px()
        poner("#anchoTxt", "40"); pg.wait_for_timeout(300); v1 = vista_px()
        caso("plantilla", "ancho del texto reduce la hipotesis", v1 != v0 and texto("#vAnchoTxt") == "40")
        poner("#altoTxt", "8"); pg.wait_for_timeout(300)
        caso("plantilla", "alto del texto hasta 8%", vista_px() != v1 and texto("#vAltoTxt") == "8")
        poner("#anchoTxt", "100"); poner("#altoTxt", "55")
        pg.check("#celdas"); pg.wait_for_timeout(300); pg.fill("#plantilla", "")

        # ---------------- apilado
        pg.click("#btnApilar"); pg.click("#btnApilar")
        caso("apilado", "anadir", texto("#nPila") == "2 en pila", texto("#nPila"))
        pg.check("#verPila"); esperar(); caso("apilado", "ver apilado", huella() is not None)
        pg.click("#btnApilarTodos"); caso("apilado", "anadir todos", texto("#nPila").startswith("4"), texto("#nPila"))
        pg.click("#btnVaciar"); pg.uncheck("#verPila"); caso("apilado", "vaciar", texto("#nPila") == "0 en pila")
        # copia desplazada (+4,-3) generada en el navegador y cargada como fichero (en Firefox un 'paste' sintetico llega sin datos)
        b64 = pg.evaluate("""() => { const F = F0(), c = document.createElement('canvas'); c.width = F.w; c.height = F.h;
            const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, F.w, F.h); x.drawImage(F.img, 4, -3); return c.toDataURL('image/png').split(',')[1]; }""")
        desp = SALIDA / "desplazada_+4_-3.png"; desp.write_bytes(__import__("base64").b64decode(b64))
        pg.set_input_files("#archivo", str(desp)); pg.wait_for_timeout(900)
        n_f = pg.evaluate("() => fuentes.length")
        pg.evaluate("() => { fuentes[n_f_menos1()].esquinas = []; }".replace("n_f_menos1()", str(n_f - 1)))
        pg.evaluate("() => seleccionar(0)"); pg.wait_for_timeout(300)
        pg.click("#btnSeguir"); pg.wait_for_timeout(500)
        err = pg.evaluate(f"() => {{ const a = fuentes[0].esquinas, b = fuentes[{n_f - 1}].esquinas; return Math.max(...a.map((p, i) => Math.hypot(b[i][0] - p[0] - 4, b[i][1] - p[1] + 3))); }}")
        caso("apilado", "seguir puntos: copia desplazada (+4,-3) encontrada con error < 0.25 px", err < 0.25, f"error max {err:.3f} px · {texto('#infoSeguir')}")
        poner("#alinPila", "subpixel"); pg.click("#btnSeguirApilar"); pg.wait_for_timeout(600)
        caso("apilado", "seguir y apilar -> pila con la referencia y los seguidos", texto("#nPila").startswith("2 en pila") and pg.is_checked("#verPila"), texto("#nPila"))
        for m in ["mediana", "recortada"]:
            antes = esperar(); poner("#modoPila", m); caso("apilado", f"mezcla {m} cambia la salida o es igual con 2", esperar() is not None, m)
        # con la mezcla "recortada" el subconjunto puede dar legitimamente el mismo valor (si casi todos los fotogramas
        # son iguales, descartar min y max deja ese valor): el efecto de "nitidos %" se mide con la media
        poner("#modoPila", "media")
        pg.click("#btnApilarTodos"); n_p = int(texto("#nPila").split()[0]); antes = esperar()
        poner("#mejoresPila", "50"); despues = esperar()
        sel = pg.evaluate("() => { const u = usados(ultimaPlana), todos = pila.map(p => p.nitidez).sort((a, b) => b - a); return { k: u.length, minUsado: Math.min(...u.map(p => p.nitidez)), corte: todos[u.length - 1] }; }")
        caso("apilado", "usar los mas nitidos (50%): usa ceil(n/2), los de mayor nitidez, y la media cambia",
             sel["k"] == -(-n_p // 2) and sel["minUsado"] == sel["corte"] and f"usa {sel['k']}" in texto("#nPila") and despues != antes, f"{texto('#nPila')} · {sel}")
        poner("#mejoresPila", "100"); poner("#modoPila", "media"); poner("#alinPila", "entero")
        pg.click("#btnVaciar"); pg.uncheck("#verPila")

        # ---------------- exportacion: cada formato soportado + contenidos + escala
        formatos = pg.eval_on_selector_all("#formatoExp option", "os => os.map(o => o.value)")
        for f in formatos:
            pg.select_option("#formatoExp", f)
            with pg.expect_download() as d:
                pg.click("#btnExportar")
            dest = SALIDA / d.value.suggested_filename
            d.value.save_as(dest)
            cab, ext = dest.read_bytes()[:12], dest.suffix.lstrip(".")
            ok = cab.startswith(FIRMAS.get(ext, b"?")) and (ext != "avif" or b"ftyp" in cab)
            caso("exportar", f"formato {f} -> .{ext}", ok, cab[:8])
        pg.select_option("#formatoExp", "bmp")
        for c in ["fuente", "salidaPlantilla", "pila"]:
            if c == "pila":
                pg.click("#btnApilar")
            pg.select_option("#contenidoExp", c)
            with pg.expect_download() as d:
                pg.click("#btnExportar")
            dest = SALIDA / d.value.suggested_filename; d.value.save_as(dest)
            caso("exportar", f"contenido {c}", dest.read_bytes()[:2] == b"BM" and dest.stat().st_size > 54, dest.stat().st_size)
        pg.select_option("#contenidoExp", "salida"); pg.select_option("#escalaExp", "2")
        with pg.expect_download() as d:
            pg.click("#btnExportarRapido")
        dest = SALIDA / d.value.suggested_filename; d.value.save_as(dest)
        ancho = int.from_bytes(dest.read_bytes()[18:22], "little")
        caso("exportar", "escala 2x + boton rapido", ancho == 2 * int(huella().split("x")[0]), f"ancho {ancho}")
        caso("exportar", "lista con sha256", pg.locator("#listaExport li").count() >= len(formatos) + 4)
        pg.select_option("#escalaExp", "1"); pg.click("#btnVaciar")

        # ---------------- portapapeles
        pg.select_option("#contenidoExp", "salida")
        if NAV == "firefox":
            caso("portapapeles", "NO PROBADO en Firefox headless: Copiar, Pegar y Ctrl+V (Firefox no deja leer el portapapeles por script ni rellenar un 'paste' sintetico)", True)
        else:
            pg.click("#btnCopiar"); pg.wait_for_timeout(600)
            tipos = pg.evaluate("async () => { try { return (await navigator.clipboard.read()).flatMap(i => i.types); } catch (e) { return ['ERROR ' + e.message]; } }")
            caso("portapapeles", "copiar salida como PNG", "image/png" in tipos, tipos)
            n_antes = len(pg.eval_on_selector_all("#carrusel figure.hoja", "x => x"))
            e_antes = texto("#estado")
            pg.click("#btnPegar"); pg.wait_for_timeout(900)
            caso("portapapeles", "boton Pegar carga la imagen", "portapapeles_" in texto("#estado") and texto("#estado") != e_antes, texto("#estado"))
            pg.evaluate("""async () => { const c = document.createElement('canvas'); c.width = 20; c.height = 10; c.getContext('2d').fillRect(0, 0, 10, 10);
                const b = await new Promise(ok => c.toBlob(ok, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'image.png', {type: 'image/png'}));
                document.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt})); }""")
            pg.wait_for_timeout(900)
            caso("portapapeles", "Ctrl+V (evento paste) carga la imagen", "20x10" in texto("#estado") and "portapapeles_" in texto("#estado"), texto("#estado"))
            pg.click("#btnAnterior"); pg.click("#btnAnterior"); pg.wait_for_timeout(400)

        # ---------------- registro JSON y reproduccion
        poner("[data-p=contraste]", "50"); poner("[data-p=interp]", "lanczos3"); href = esperar()
        with pg.expect_download() as d:
            pg.click("#btnJson")
        js = SALIDA / d.value.suggested_filename; d.value.save_as(js)
        reg = json.loads(js.read_text())
        caso("registro", "JSON con exportaciones y geometria", len(reg.get("exportaciones", [])) >= len(formatos) and reg["geometria"]["modo"] == "esquinas")
        restaurar(); poner("[data-p=giroFino]", "7"); esperar()
        pg.set_input_files("#cargarJson", str(js)); pg.wait_for_timeout(600)
        caso("registro", "reproducir desde JSON = misma salida", esperar() == href, f"{huella()} vs {href}")
        restaurar()

        # ---------------- panel acoplable
        for lado in ["left", "top", "bottom", "right"]:
            pg.click(f"[data-dock={lado}]"); pg.wait_for_timeout(250)
            caso("panel", f"acoplar {lado}", pg.evaluate("() => document.body.className").startswith(f"dock-{lado}"))
            desb = pg.evaluate("""() => [...document.querySelectorAll('#panel details.bloque:not([hidden])')].flatMap(b => {
                const r = b.getBoundingClientRect(), out = [];
                b.querySelectorAll('.cuerpo *').forEach(e => { const q = e.getBoundingClientRect();
                  if (q.width && (q.right > r.right + 1 || q.left < r.left - 1)) out.push((b.querySelector('summary').textContent.trim().slice(0, 20)) + ' > ' + e.tagName + (e.id ? '#' + e.id : '')); });
                return out; })""")
            caso("panel", f"sin desbordamiento horizontal ({lado})", not desb, desb[:6])
            pg.screenshot(path=str(SALIDA / f"02_panel_{lado}.png"))
        pg.click("#btnPanel"); pg.wait_for_timeout(200)
        caso("panel", "ocultar", "panel-oculto" in pg.evaluate("() => document.body.className"))
        pg.click("body", position={"x": 5, "y": 300}); pg.keyboard.press("p"); pg.wait_for_timeout(200)
        caso("panel", "tecla P muestra", "panel-oculto" not in pg.evaluate("() => document.body.className"))
        pg.evaluate("() => { const c = document.querySelector('#panel .contenido'); c.scrollTop = c.scrollHeight; }")  # caso real: panel desplazado
        a0 = pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--panel-ancho')")
        bb = pg.locator("#asa").bounding_box(); pg.mouse.move(bb["x"] + 2, bb["y"] + 200); pg.mouse.down(); pg.mouse.move(bb["x"] - 120, bb["y"] + 200, steps=4); pg.mouse.up()
        a1 = pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--panel-ancho')")
        caso("panel", "redimensionar con asa", a0 != a1, f"{a0} -> {a1}")
        caso("lienzo", "redibujo tras cambio de panel", pg.evaluate("() => cvF.width > 0 && cvF.height > 0"))

        # ---------------- video
        caso("video", "soporte H.264 en este navegador (informativo)", True, pg.evaluate("() => document.createElement('video').canPlayType('video/mp4; codecs=\"avc1.42E01E\"') || 'NO'"))
        n0 = pg.locator("#carrusel figure.hoja").count()
        pg.set_input_files("#archivo", video); pg.wait_for_timeout(1500)
        caso("video", "carga y panel visible", pg.is_visible("#video"), texto("#tVideo"))
        caso("video", "analisis hex del video", "firma: MKV/WebM" in texto("#hexInfo"), texto("#hexInfo")[:60])
        fot = lambda: int(pg.text_content("#fotVideo").split()[1])
        pg.click("#btnFotSig"); pg.wait_for_timeout(600); f1 = fot()
        pg.click("#btnFotSig"); pg.wait_for_timeout(600); pg.click("#btnFotSig"); pg.wait_for_timeout(600)
        caso("video", "+1 fotograma x2 avanza exactamente 2", fot() == f1 + 2, f"{f1} -> {fot()}")
        pg.click("#btnFotAnt"); pg.wait_for_timeout(600)
        caso("video", "-1 fotograma retrocede exactamente 1", fot() == f1 + 1, f"{fot()}")
        caso("video", "indicador = indice del fotograma en video.currentTime", fot() == pg.evaluate("() => RP.indiceFotograma(video.currentTime, 30)"), pg.text_content("#tVideo"))
        idn = pg.evaluate("""async () => { const fps = 30, n = 5, h = async (t) => { await RP.irA(video, t); return (await RP.capturar(video, null)).sha256Pixeles; };
            return { a: await h((n + 0.2) / fps), d: await h((n + 0.5) / fps), b: await h((n + 0.8) / fps), c: await h((n + 1.5) / fps) }; }""")
        caso("video", "rejilla: (n+0.2), (n+0.5) y (n+0.8)/fps = mismo fotograma (pixeles)", idn["a"] == idn["b"] == idn["d"], idn)
        caso("video", "rejilla: (n+1.5)/fps = otro fotograma (control negativo)", idn["c"] != idn["a"], idn)
        pg.click("#btnCapturar"); pg.wait_for_timeout(800)
        caso("video", "capturar fotograma -> carrusel", pg.locator("#carrusel figure.hoja").count() == min(n0 + 1, 13) or "@" in texto("#estado"), texto("#estado"))
        poner("#rDesde", "0.2"); poner("#rHasta", "0.3"); poner("#rPaso", "1"); pg.click("#btnRango"); pg.wait_for_timeout(3000)
        caso("video", "capturar rango", texto("#estado").startswith(f"{n0 + 1 + 4}/") or texto("#estado").startswith(f"{n0 + 1 + 3}/"), texto("#estado"))
        caso("video", "fotograma capturado con origen", "fotograma de" in texto("#hashInfo"), texto("#hashInfo")[:60])
        pg.evaluate("() => video.play()"); pg.wait_for_timeout(700); pg.evaluate("() => video.pause()"); pg.wait_for_timeout(300)
        f_rep = int(pg.text_content("#fotVideo").split()[1])
        caso("video", "indicador avanza durante la reproduccion", f_rep > f1 + 3, pg.text_content("#fotVideo"))
        caso("video", "fps medidos durante la reproduccion", "29." in texto("#fpsMedido") or "30." in texto("#fpsMedido"), texto("#fpsMedido"))
        pg.click("#btnDesdeAqui")
        caso("video", "desde aqui fija el inicio del rango", abs(float(pg.input_value("#rDesde")) - pg.evaluate("() => video.currentTime")) < 0.002, pg.input_value("#rDesde"))
        pg.click("#btnHastaAqui")
        caso("video", "hasta aqui fija el fin del rango", abs(float(pg.input_value("#rHasta")) - pg.evaluate("() => video.currentTime")) < 0.002, pg.input_value("#rHasta"))
        n_est = int(texto("#estado").split("/")[1].split()[0]); poner("#nRango", "3"); pg.click("#btnRangoAqui"); pg.wait_for_timeout(2500)
        caso("video", "capturar N=3 desde el fotograma actual", texto("#estado").startswith(f"{n_est + 3}/{n_est + 3}"), texto("#estado"))
        ult = pg.evaluate("() => fuentes.slice(-3).map(F => F.origen.fotograma)")
        caso("video", "N=3 capturados son fotogramas consecutivos", ult == list(range(ult[0], ult[0] + 3)), ult)
        pg.evaluate("() => { const F = F0(); F.esquinas = [[F.w*.3, F.h*.35], [F.w*.7, F.h*.35], [F.w*.7, F.h*.65], [F.w*.3, F.h*.65]]; dibujarFuente(); procesar(); }")
        pg.check("#autoSeguir"); pg.check("#autoApilar"); pg.click("#btnVaciar")
        poner("#nRango", "4"); pg.click("#btnRangoAqui"); pg.wait_for_timeout(3500)
        seg = pg.evaluate("() => fuentes.slice(-4).map(F => F.seguimiento && F.seguimiento.ncc.length)")
        caso("video", "rango con 'seguir puntos': cada fotograma nuevo trae su seguimiento", all(x == 4 for x in seg), f"{seg} · {texto('#infoSeguir')}")
        caso("video", "rango con 'apilarlos': pila = referencia + seguidos validos", texto("#nPila").split()[0].isdigit() and int(texto("#nPila").split()[0]) >= 2 and pg.is_checked("#verPila"), f"{texto('#nPila')} · {texto('#infoSeguir')}")
        pg.uncheck("#autoSeguir"); pg.uncheck("#autoApilar"); pg.click("#btnVaciar"); pg.uncheck("#verPila")
        # modo "desde cero" + sin copiar geometria en un fotograma nuevo
        poner("[data-p=contraste]", "90"); pg.select_option("#modoConfig", "cero"); pg.uncheck("#copiarGeo")
        pg.click("#btnCapturar"); pg.wait_for_timeout(900)
        caso("entre imagenes", "desde cero: fotograma nuevo con valores por defecto", pg.input_value("[data-p=contraste]") == "0", pg.input_value("[data-p=contraste]"))
        caso("entre imagenes", "sin copiar geometria", pg.evaluate("() => F0().esquinas.length + F0().aristas.length") == 0)
        pg.screenshot(path=str(SALIDA / "03_video.png"), full_page=True)

        caso("errores", "sin errores de JavaScript", not errores, errores[:5])
        nav.close()
    fallos = [r for r in res if not r["ok"]]
    (SALIDA / "resultados.json").write_text(json.dumps(res, indent=2, ensure_ascii=False))
    L = ["# QA navegador — perspectiva.html", "", f"{len(res)} casos, {len(fallos)} fallos · {NAV}" + (f" {CHROME.parent.parent.name}" if NAV == "chromium" else ""), "",
         "| grupo | control | resultado | detalle |", "|---|---|---|---|"]
    L += [f"| {r['grupo']} | {r['control']} | {'OK' if r['ok'] else 'FALLO'} | {'' if r['ok'] else r['detalle']} |" for r in res]
    (SALIDA / "REPORTE.md").write_text("\n".join(L) + "\n")
    print(f"\n{len(res)} casos, {len(fallos)} fallos -> {SALIDA}")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main(*sys.argv[1:4])
