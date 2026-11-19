// -----------------------------------------------------------------------------
// nucleo.js — Utilidades base: hash, homografia de 4 puntos, conversiones.
// Author: Saul López
// Date:   2026-11-13
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

RP.sha256 = async (buf) => {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// Eliminacion gaussiana con pivoteo parcial
RP.resolver = (A, b) => {
  const n = b.length, M = A.map((f, i) => [...f, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
};

// H tal que H * dst = src (dst: rectangulo de salida, src: cuadrilatero marcado)
RP.homografia = (dst, src) => {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...RP.resolver(A, b), 1];
};

RP.aplicarH = (H, x, y) => {
  const z = H[6] * x + H[7] * y + 1;
  return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
};

// RGB float (3 canales) -> luminancia BT.601
RP.luminancia = (rgb, n) => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  return a;
};

// Plano (canales separados) <-> ImageData
RP.aImageData = (canales, w, h) => {
  const out = new ImageData(w, h), n = w * h;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = canales[canales.length === 1 ? 0 : c][i];
      out.data[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    out.data[i * 4 + 3] = 255;
  }
  return out;
};

RP.sello = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
