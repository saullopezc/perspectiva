// -----------------------------------------------------------------------------
// vistas.js — Ventana de la salida: la imagen se amplia y se mueve DENTRO de un
// marco fijo (rueda: zoom hacia el cursor; arrastrar: mover; doble clic o
// "ajustar": cabe entera). El zoom es el del deslizador (pixeles replicados, sin
// suavizar), asi que lo exportado como "salida + plantilla" es lo mismo que se ve.
// Usa el estado de app.js (cvS, limpia, procesar).
// Author: Saul López
// Date:   2026-11-19
// Modified By: Saul López
// Modified Date: 2026-11-27
// -----------------------------------------------------------------------------
"use strict";

const vistaSalida = { x: null, y: null, ancla: null, dims: "" };
const wrapSalida = $("salidaWrap");

// Coloca la salida en su ventana tras cada render: centrada si cabe, sin dejar huecos si no cabe
function colocarSalida() {
  const W = wrapSalida.clientWidth, H = wrapSalida.clientHeight, w = cvS.width, h = cvS.height, z = +$("zoomSalida").value;
  const dims = limpia ? `${limpia.width}x${limpia.height}` : "";
  if (dims !== vistaSalida.dims) { vistaSalida.dims = dims; vistaSalida.x = null; } // otra imagen u otro tamano: centrar
  if (vistaSalida.ancla) { const a = vistaSalida.ancla; vistaSalida.x = a.mx - a.u * z; vistaSalida.y = a.my - a.v * z; vistaSalida.ancla = null; }
  if (vistaSalida.x === null) { vistaSalida.x = (W - w) / 2; vistaSalida.y = (H - h) / 2; }
  const ajusta = (p, total, tam) => (tam <= total ? (total - tam) / 2 : Math.min(0, Math.max(total - tam, p)));
  vistaSalida.x = ajusta(vistaSalida.x, W, w); vistaSalida.y = ajusta(vistaSalida.y, H, h);
  cvS.style.left = `${vistaSalida.x}px`; cvS.style.top = `${vistaSalida.y}px`;
}

function zoomSalidaEn(factor, mx = wrapSalida.clientWidth / 2, my = wrapSalida.clientHeight / 2, absoluto = false) {
  if (!limpia) return;
  const z = +$("zoomSalida").value, zn = Math.min(16, Math.max(0.25, absoluto ? factor : z * factor));
  vistaSalida.ancla = { mx, my, u: (mx - vistaSalida.x) / z, v: (my - vistaSalida.y) / z }; // el punto bajo el cursor se queda quieto
  $("zoomSalida").value = zn; procesar();
}
function ajustarSalida() {
  if (!limpia) return;
  const z = Math.max(0.25, Math.min(16, Math.min(wrapSalida.clientWidth / limpia.width, wrapSalida.clientHeight / limpia.height) * 0.98));
  vistaSalida.x = null; vistaSalida.ancla = null; $("zoomSalida").value = z; procesar();
}

wrapSalida.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = wrapSalida.getBoundingClientRect();
  zoomSalidaEn(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let arrastreSalida = null;
wrapSalida.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !e.isPrimary || !limpia) return;
  arrastreSalida = { mx: e.clientX, my: e.clientY, x: vistaSalida.x, y: vistaSalida.y }; wrapSalida.classList.add("arrastrando"); e.preventDefault();
});
window.addEventListener("pointermove", (e) => {
  if (!arrastreSalida || !e.isPrimary) return;
  vistaSalida.x = arrastreSalida.x + e.clientX - arrastreSalida.mx; vistaSalida.y = arrastreSalida.y + e.clientY - arrastreSalida.my; colocarSalida();
});
const soltarSalida = () => { if (arrastreSalida) { arrastreSalida = null; wrapSalida.classList.remove("arrastrando"); } };
window.addEventListener("pointerup", soltarSalida); window.addEventListener("pointercancel", soltarSalida);
wrapSalida.addEventListener("dblclick", ajustarSalida);
$("btnAjustarSalida").onclick = ajustarSalida;
// plegar o desplegar el lienzo: la salida ocupa todo el espacio y se reencuadra
$("btnAmpliarSalida").onclick = () => { const b = $("bloqueLienzo"); b.open = !b.open; };
$("bloqueLienzo").addEventListener("toggle", () => requestAnimationFrame(() => { ajustarSalida(); if ($("bloqueLienzo").open) dibujarFuente(); }));
// el deslizador amplia hacia el centro de la ventana
$("zoomSalida").addEventListener("input", () => {
  if (!limpia) return;
  const W = wrapSalida.clientWidth / 2, H = wrapSalida.clientHeight / 2, z = cvS.width / limpia.width;
  vistaSalida.ancla = { mx: W, my: H, u: (W - vistaSalida.x) / z, v: (H - vistaSalida.y) / z };
});
new ResizeObserver(() => { if (limpia) colocarSalida(); }).observe(wrapSalida);

// ---------------------------------------------------------------- lo que se ve, para exportarlo o documentarlo
// la salida tal como se ve en su marco (zoom y encuadre actuales)
RP.capturaSalidaVisible = () => {
  if (!limpia || !cvS.width) return null;
  const W = wrapSalida.clientWidth, H = wrapSalida.clientHeight, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); x.fillStyle = getComputedStyle(wrapSalida).backgroundColor || "#000"; x.fillRect(0, 0, W, H);
  x.imageSmoothingEnabled = false; x.drawImage(cvS, vistaSalida.x, vistaSalida.y);
  return c;
};
// el lienzo tal como se ve (zoom, encuadre y puntos marcados), en pixeles de pantalla
RP.capturaLienzo = () => { if (!cvF.width) return null; const c = document.createElement("canvas"); c.width = cvF.width; c.height = cvF.height; c.getContext("2d").drawImage(cvF, 0, 0); return c; };
// configuracion del navegador y de la vista en el momento de la captura
RP.datosVista = () => {
  const zl = +$("zoomSalida").value;
  return {
    navegador: navigator.userAgent, idioma: navigator.language, zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ventana: `${innerWidth} x ${innerHeight} px`, pantalla: `${screen.width} x ${screen.height} px · ${screen.colorDepth} bits de color`,
    densidadPixeles: devicePixelRatio, // cambia con el zoom del navegador (Ctrl + / Ctrl -)
    tema: matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro",
    panel: [...document.body.classList].find((k) => k.startsWith("dock-"))?.slice(5) + (document.body.classList.contains("panel-oculto") ? " (oculto)" : ""),
    lienzo: { zoom: +(vista.s / (devicePixelRatio || 1)).toFixed(4), desplazamiento: [Math.round(vista.ox), Math.round(vista.oy)], tamano: `${cvF.width} x ${cvF.height} px de pantalla` },
    salida: { zoom: +zl.toFixed(4), encuadre: [Math.round(vistaSalida.x ?? 0), Math.round(vistaSalida.y ?? 0)], marco: `${wrapSalida.clientWidth} x ${wrapSalida.clientHeight} px`,
      lienzoPlegado: !$("bloqueLienzo").open },
  };
};
