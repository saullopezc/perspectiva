// -----------------------------------------------------------------------------
// vistas.js — Ventana de la salida: la imagen se amplia y se mueve DENTRO de un
// marco fijo (rueda: zoom hacia el cursor; arrastrar: mover; doble clic o
// "ajustar": cabe entera). El zoom es el del deslizador (pixeles replicados, sin
// suavizar), asi que lo exportado como "salida + plantilla" es lo mismo que se ve.
// Usa el estado de app.js (cvS, limpia, procesar).
// Author: Saul López
// Date:   2026-11-19
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
wrapSalida.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !limpia) return;
  arrastreSalida = { mx: e.clientX, my: e.clientY, x: vistaSalida.x, y: vistaSalida.y }; wrapSalida.classList.add("arrastrando"); e.preventDefault();
});
window.addEventListener("mousemove", (e) => {
  if (!arrastreSalida) return;
  vistaSalida.x = arrastreSalida.x + e.clientX - arrastreSalida.mx; vistaSalida.y = arrastreSalida.y + e.clientY - arrastreSalida.my; colocarSalida();
});
window.addEventListener("mouseup", () => { if (arrastreSalida) { arrastreSalida = null; wrapSalida.classList.remove("arrastrando"); } });
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
