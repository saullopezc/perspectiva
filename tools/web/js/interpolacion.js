// -----------------------------------------------------------------------------
// interpolacion.js — Nucleos de interpolacion y re-escalado (incl. en escalera).
// Todos son metodos abiertos y documentados; los comerciales (S-Spline,
// Genuine Fractals) no se implementan: no son reproducibles ni auditables.
// Author: Saul López
// Date:   2026-11-13
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// Familia BC de Mitchell-Netravali: (B=0,C=0.5) Catmull-Rom; (1/3,1/3) Mitchell; (1,0) B-spline cubica
const bc = (B, C) => (t) => {
  const x = Math.abs(t);
  if (x < 1) return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x ** 2 + (6 - 2 * B)) / 6;
  if (x < 2) return ((-B - 6 * C) * x ** 3 + (6 * B + 30 * C) * x ** 2 + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
  return 0;
};
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

RP.NUCLEOS = {
  vecino:   { r: 0, desc: "copia el pixel mas cercano (rapido, pixelado)" },
  bilineal: { r: 1, k: (t) => Math.max(0, 1 - Math.abs(t)), desc: "promedio ponderado de 4 vecinos" },
  bicubica: { r: 2, k: bc(0, 0.5), desc: "Catmull-Rom, 16 vecinos" },
  mitchell: { r: 2, k: bc(1 / 3, 1 / 3), desc: "Mitchell-Netravali, compromiso nitidez/artefactos" },
  bspline:  { r: 2, k: bc(1, 0), desc: "B-spline cubica: suave, preserva formas (alternativa abierta a S-Spline)" },
  lanczos3: { r: 3, k: (t) => (Math.abs(t) < 3 ? sinc(t) * sinc(t / 3) : 0), desc: "ventana sinc de 6x6, mas nitidez" },
};

// Devuelve f(x, y, out[3]) que muestrea `data` (stride 3 o 4) con el nucleo elegido
RP.muestreador = (data, w, h, stride, nombre) => {
  const N = RP.NUCLEOS[nombre] || RP.NUCLEOS.bicubica;
  const px = (x, y, c) => data[((y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)) * stride + c];
  if (N.r === 0) {
    return (x, y, out) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      for (let c = 0; c < 3; c++) out[c] = px(xi, yi, c);
    };
  }
  const r = N.r, wx = new Float32Array(2 * r), wy = new Float32Array(2 * r);
  return (x, y, out) => {
    x -= 0.5; y -= 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    let sx = 0, sy = 0;
    for (let i = 0; i < 2 * r; i++) { wx[i] = N.k(i - r + 1 - fx); sx += wx[i]; wy[i] = N.k(i - r + 1 - fy); sy += wy[i]; }
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let j = 0; j < 2 * r; j++) {
        let fila = 0;
        for (let i = 0; i < 2 * r; i++) fila += px(x0 + i - r + 1, y0 + j - r + 1, c) * wx[i];
        s += fila * wy[j];
      }
      out[c] = s / (sx * sy);
    }
  };
};

// Re-escalado de un plano RGB float (stride 3)
RP.redimensionar = (rgb, w, h, W, H, nombre) => {
  const m = RP.muestreador(rgb, w, h, 3, nombre), out = new Float32Array(W * H * 3), t = [0, 0, 0];
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    m((u + 0.5) * w / W, (v + 0.5) * h / H, t);
    const k = (v * W + u) * 3; out[k] = t[0]; out[k + 1] = t[1]; out[k + 2] = t[2];
  }
  return out;
};

// Reduccion a la mitad promediando bloques 2x2 (paso de la escalera descendente)
const mitad = (rgb, w, h) => {
  const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1), out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    const g = (xx, yy) => rgb[(Math.min(h - 1, yy) * w + Math.min(w - 1, xx)) * 3 + c];
    out[(y * W + x) * 3 + c] = (g(2 * x, 2 * y) + g(2 * x + 1, 2 * y) + g(2 * x, 2 * y + 1) + g(2 * x + 1, 2 * y + 1)) / 4;
  }
  return { rgb: out, w: W, h: H };
};

// Interpolacion en escalera: pasos x2 (o /2) con bicubica hasta acercarse, y ajuste final
RP.escalera = (rgb, w, h, W, H) => {
  const pasos = [];
  let p = { rgb, w, h };
  while (p.w * 2 <= W && p.h * 2 <= H) {
    p = { rgb: RP.redimensionar(p.rgb, p.w, p.h, p.w * 2, p.h * 2, "bicubica"), w: p.w * 2, h: p.h * 2 };
    pasos.push("x2");
  }
  while (p.w / 2 >= W && p.h / 2 >= H) { p = mitad(p.rgb, p.w, p.h); pasos.push("/2"); }
  if (p.w !== W || p.h !== H) { p = { rgb: RP.redimensionar(p.rgb, p.w, p.h, W, H, "bicubica"), w: W, h: H }; pasos.push("ajuste"); }
  return { ...p, pasos };
};
