// -----------------------------------------------------------------------------
// superres.js — Superresolucion con varios fotogramas (calculo, sin DOM).
// El apilado normal promedia fotogramas YA remuestreados a la salida: cada uno llega
// suavizado por la interpolacion y la media conserva ese suavizado. Aqui cada pixel de
// la salida se reconstruye con los pixeles ORIGINALES de todos los fotogramas,
// proyectados con la homografia propia de cada uno (sus puntos seguidos con precision
// subpixel): como cada fotograma cae desplazado una fraccion de pixel distinta, entre
// todos muestrean la escena mas fino que cualquiera de ellos.
//  1. Regresion por nucleo: cada pixel original pesa exp(-d^2 / 2 sigma^2) segun la
//     distancia d (en pixeles originales) entre su centro y el punto proyectado.
//  2. Deconvolucion de Richardson-Lucy opcional con la PSF del propio pixel del sensor
//     (caja de 1 pixel original) mas el nucleo: deshace el promedio que hace el sensor.
// Solo gana resolucion si la salida tiene mas pixeles que la zona original (alto px) y
// los fotogramas estan desplazados entre si fracciones de pixel distintas.
// Author: Saul López
// Date:   2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// desenfoque gaussiano separable de un canal (bordes replicados)
function gaussCanal(a, w, h, s) {
  if (s <= 0.05) return Float32Array.from(a);
  const r = Math.max(1, Math.ceil(3 * s)), k = new Float32Array(2 * r + 1); let t = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * s * s)); t += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= t;
  const tmp = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * a[y * w + Math.min(w - 1, Math.max(0, x + i))]; tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]; o[y * w + x] = v;
  }
  return o;
}

// Richardson-Lucy con PSF gaussiana simetrica: est <- est * G(obs / G(est)). Nombre propio: RP.richardsonLucy es
// la de movimiento (filtros.js), con otra firma
RP.rlGaussiano = (obs, w, h, s, iter) => {
  let est = Float32Array.from(obs, (v) => Math.max(v, 1));
  const q = new Float32Array(w * h);
  for (let it = 0; it < iter; it++) {
    const c = gaussCanal(est, w, h, s);
    for (let i = 0; i < q.length; i++) q[i] = obs[i] / Math.max(c[i], 1e-3);
    const g = gaussCanal(q, w, h, s);
    for (let i = 0; i < est.length; i++) est[i] *= g[i];
  }
  for (let i = 0; i < est.length; i++) est[i] = Math.min(255, Math.max(0, est[i]));
  return est;
};

// marcos: [{ datos: RGBA de la fuente, w, h, mapa: (x, y) -> [sx, sy], dx, dy }] (dx, dy: alineado fino del apilado, en px de
// salida). W x H: salida. o: { sigma (px originales), iter (Richardson-Lucy) }.
RP.superresolver = (marcos, W, H, o) => {
  const n = W * H, acc = new Float32Array(n * 3), pes = new Float32Array(n), s2 = 2 * o.sigma * o.sigma, k = o.sigma <= 0.5 ? 1 : 2;
  for (const M of marcos) {
    const d = M.datos;
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
      const [sx, sy] = M.mapa(u + 0.5 + M.dx, v + 0.5 + M.dy), bx = Math.floor(sx - 0.5), by = Math.floor(sy - 0.5), p = v * W + u;
      for (let j = 1 - k; j <= k; j++) {
        const Y = by + j; if (Y < 0 || Y >= M.h) continue;
        for (let i = 1 - k; i <= k; i++) {
          const X = bx + i; if (X < 0 || X >= M.w) continue;
          const ex = sx - X - 0.5, ey = sy - Y - 0.5, g = Math.exp(-(ex * ex + ey * ey) / s2), q = (Y * M.w + X) * 4;
          acc[p * 3] += g * d[q]; acc[p * 3 + 1] += g * d[q + 1]; acc[p * 3 + 2] += g * d[q + 2]; pes[p] += g;
        }
      }
    }
  }
  const rgb = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) { const t = pes[p] || 1; rgb[p * 3] = acc[p * 3] / t; rgb[p * 3 + 1] = acc[p * 3 + 1] / t; rgb[p * 3 + 2] = acc[p * 3 + 2] / t; }
  // pixeles de salida por pixel original (en el centro, con el primer fotograma): fija el tamano de la PSF
  const M0 = marcos[0], c = M0.mapa(W / 2, H / 2), cx = M0.mapa(W / 2 + 1, H / 2), cy = M0.mapa(W / 2, H / 2 + 1);
  const porOriginal = 2 / (Math.hypot(cx[0] - c[0], cx[1] - c[1]) + Math.hypot(cy[0] - c[0], cy[1] - c[1]));
  const sigmaPsf = porOriginal * Math.sqrt(1 / 12 + o.sigma * o.sigma);
  if (o.iter > 0) for (let ch = 0; ch < 3; ch++) {
    const canal = new Float32Array(n); for (let p = 0; p < n; p++) canal[p] = rgb[p * 3 + ch];
    const r = RP.rlGaussiano(canal, W, H, sigmaPsf, o.iter); for (let p = 0; p < n; p++) rgb[p * 3 + ch] = r[p];
  }
  return { w: W, h: H, rgb, porOriginal, sigmaPsf };
};
