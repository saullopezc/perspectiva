#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# qa_maqueta.py — Auditoria de maqueta de tools/web/perspectiva.html en navegador real:
# con todos los bloques abiertos, en las cuatro posiciones del panel y a varios anchos
# de ventana, lista cada elemento visible que se sale de su bloque (o del panel / area)
# y cada contenedor con desplazamiento horizontal. Sin hallazgos = maqueta contenida.
#
# Uso:  [QA_NAV=firefox] .venv-qa/bin/python tests/web/qa_maqueta.py IMAGEN
# Author: Saul López
# Date:   2026-11-19
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
SALIDA = RAIZ / "_local" / "qa" / f"{datetime.now():%Y%m%d_%H%M%S}_web_maqueta_{NAV}"

AUDITAR = """() => {
  const out = [], visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const nombre = (el) => el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").filter(Boolean).join(".") : "") + (el.textContent ? ` «${el.textContent.trim().slice(0, 28)}»` : "");
  // contenedor de referencia: el cuerpo del bloque, o el panel / el area / la cabecera
  const caja = (el) => el.closest("details.bloque > .cuerpo") || el.closest("details.bloque") || el.closest("#panel .contenido") || el.closest("#area") || el.closest("header");
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || el.closest("#ayuda") || el.closest("#carrusel")) continue;
    const c = caja(el); if (!c || c === el) continue;
    // lo que recorta a proposito un marco intermedio (overflow distinto de visible) no se sale: lo esconde el marco
    let recortado = false; for (let a = el.parentElement; a && a !== c; a = a.parentElement) if (getComputedStyle(a).overflowX !== "visible") { recortado = true; break; }
    if (recortado) continue;
    const r = el.getBoundingClientRect(), rc = c.getBoundingClientRect();
    const sale = Math.max(r.right - rc.right, rc.left - r.left);
    if (sale > 1.5) out.push({ elemento: nombre(el), contenedor: nombre(c).slice(0, 40), sale_px: Math.round(sale) });
  }
  // con el panel arriba o abajo los bloques van en fila y .contenido se desplaza en horizontal a proposito
  const filaPanel = document.body.classList.contains("dock-top") || document.body.classList.contains("dock-bottom");
  for (const el of document.querySelectorAll("#panel, #panel .contenido, details.bloque, details.bloque > .cuerpo, #area, header"))
    if (!(filaPanel && el.matches("#panel .contenido")))
    if (visible(el) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") out.push({ elemento: nombre(el).slice(0, 50), contenedor: "(desplazamiento horizontal)", sale_px: el.scrollWidth - el.clientWidth });
  // quitar repetidos (un hijo de algo que ya se sale)
  const vistos = new Set(); return out.filter((x) => { const k = x.elemento + "|" + x.contenedor; if (vistos.has(k)) return false; vistos.add(k); return true; });
}"""


def main(imagen):
    SALIDA.mkdir(parents=True)
    resultados, total = {}, 0
    with sync_playwright() as p:
        nav = p.firefox.launch(headless=True) if NAV == "firefox" else p.chromium.launch(**({"executable_path": str(CHROME)} if CHROME.exists() else {}), headless=True)
        for ancho, alto in ((1920, 1080), (1600, 1000), (1366, 768), (1100, 800)):
            pg = nav.new_page(viewport={"width": ancho, "height": alto})
            pg.goto(HTML.as_uri()); pg.wait_for_timeout(1000)
            pg.set_input_files("#archivo", str(Path(imagen).resolve())); pg.wait_for_timeout(900)
            pg.evaluate("() => { F0().esquinas = [[100, 60], [500, 60], [500, 300], [100, 300]]; procesarYa(); }")
            for lado in ("right", "left", "top", "bottom"):
                pg.click(f"[data-dock={lado}]"); pg.wait_for_timeout(250)
                pg.evaluate("() => document.querySelectorAll('details').forEach(d => (d.open = true))"); pg.wait_for_timeout(250)
                h = pg.evaluate(AUDITAR)
                resultados[f"{ancho}x{alto} panel {lado}"] = h; total += len(h)
                print(f"{ancho}x{alto} panel {lado}: {len(h)} hallazgos")
                for x in h[:12]:
                    print(f"    {x['elemento'][:60]:60s} sale {x['sale_px']:4d} px de {x['contenedor']}")
                if h:
                    pg.screenshot(path=str(SALIDA / f"{ancho}x{alto}_{lado}.png"), full_page=True)
            pg.close()
        nav.close()
    (SALIDA / "hallazgos.json").write_text(json.dumps(resultados, indent=2, ensure_ascii=False))
    print(f"\n{total} hallazgos -> {SALIDA}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
