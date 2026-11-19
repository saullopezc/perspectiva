// -----------------------------------------------------------------------------
// histograma.js — Histograma de color (R, G, B y luminancia BT.601) de la salida que
// se ve, con la entrada al ajuste como referencia opcional, escala lineal o logaritmica,
// y estadisticas por canal: minimo, maximo, media y % recortado a 0 y a 255.
// Author: Saul López
// Date:   2026-11-15
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// fuente: ImageData (RGBA) o {rgb: Float32Array intercalado, w, h} (entrada al ajuste, sin recortar)
RP.histograma = (fuente) => {
  const H = { R: new Uint32Array(256), G: new Uint32Array(256), B: new Uint32Array(256), L: new Uint32Array(256), n: 0 };
  const rgba = !!fuente.data, d = rgba ? fuente.data : fuente.rgb, paso = rgba ? 4 : 3, n = d.length / paso;
  const q = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let i = 0; i < n; i++) {
    const r = q(d[i * paso]), g = q(d[i * paso + 1]), b = q(d[i * paso + 2]);
    H.R[r]++; H.G[g]++; H.B[b]++; H.L[q(0.299 * r + 0.587 * g + 0.114 * b)]++;
  }
  H.n = n;
  return H;
};

RP.estadisticasHisto = (H) => {
  const e = {};
  for (const c of ["R", "G", "B", "L"]) {
    const h = H[c]; let min = 255, max = 0, s = 0;
    for (let v = 0; v < 256; v++) if (h[v]) { if (v < min) min = v; if (v > max) max = v; s += v * h[v]; }
    e[c] = { min, max, media: H.n ? s / H.n : 0, bajo: H.n ? (100 * h[0]) / H.n : 0, alto: H.n ? (100 * h[255]) / H.n : 0 };
  }
  return e;
};

const COLOR = { R: "255,107,107", G: "107,230,160", B: "122,167,255" };
RP.dibujarHistograma = (cv, H, ref, log) => {
  const dpr = devicePixelRatio || 1, W = Math.max(1, Math.round(cv.clientWidth * dpr)), A = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== W || cv.height !== A) { cv.width = W; cv.height = A; }
  const x = cv.getContext("2d"); x.clearRect(0, 0, W, A);
  if (!H) return;
  const f = log ? (v) => Math.log1p(v) : (v) => v;
  const gris = H.R.every((v, i) => v === H.G[i] && v === H.B[i]); // salida en gris: un solo canal
  // la escala ignora los bins 0 y 255: un recorte grande aplastaria el resto (su peso va en el texto de recorte)
  let max = 1;
  for (const h of [H, ref].filter(Boolean)) for (const c of gris ? ["L"] : ["R", "G", "B"]) for (let v = 1; v < 255; v++) max = Math.max(max, f(h[c][v]));
  const alto = (n) => Math.min(1, f(n) / max) * (A - 2);
  const curva = (h, c) => { x.beginPath(); x.moveTo(0, A); for (let v = 0; v < 256; v++) x.lineTo(((v + 0.5) * W) / 256, A - alto(h[c][v])); x.lineTo(W, A); x.closePath(); };
  if (ref) { // entrada: solo contorno discontinuo
    x.save(); x.setLineDash([3 * dpr, 3 * dpr]); x.lineWidth = dpr;
    for (const c of gris ? ["L"] : ["R", "G", "B"]) { x.strokeStyle = gris ? "rgba(200,200,200,.6)" : `rgba(${COLOR[c]},.6)`; curva(ref, c); x.stroke(); }
    x.restore();
  }
  x.save(); x.globalCompositeOperation = "lighter";
  for (const c of gris ? ["L"] : ["R", "G", "B"]) { x.fillStyle = gris ? "rgba(200,200,200,.5)" : `rgba(${COLOR[c]},.45)`; curva(H, c); x.fill(); }
  x.restore();
  if (!gris) { x.strokeStyle = "rgba(230,232,235,.75)"; x.lineWidth = dpr; curva(H, "L"); x.stroke(); }
};
