// -----------------------------------------------------------------------------
// referencias.js — Puntos de referencia entre fotogramas y apoyo al apilado:
// seguimiento de un punto por correlacion normalizada (NCC) con ajuste subpixel,
// nitidez por varianza del laplaciano (seleccion "lucky imaging"), alineado
// subpixel por SSD y desplazamiento bilineal, y trapecio de la salida.
// Logica pura: sin DOM (se prueba en Node).
// Author: Saul López
// Date:   2026-11-13
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// vertice de la parabola por tres muestras equiespaciadas (f(-1), f(0), f(1)); acotado a +-0.5
const vertice = (a, b, c) => { const d = a - 2 * b + c; return d === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)); };

// Sigue el punto pRef de la imagen ref (luminancia w x h) en la imagen nueva (mismo tamano).
// Parche (2rP+1)^2 centrado en el punto; busqueda +-rB alrededor de pIni (estimacion inicial).
// Devuelve { p:[x,y], ncc } (ncc en [-1,1]; null si el parche se sale de la imagen).
RP.seguirPunto = (ref, nueva, w, h, pRef, pIni, rP = 10, rB = 12) => {
  const rx = Math.round(pRef[0]), ry = Math.round(pRef[1]), fx = pRef[0] - rx, fy = pRef[1] - ry;
  if (rx - rP < 0 || ry - rP < 0 || rx + rP >= w || ry + rP >= h) return null;
  const n = (2 * rP + 1) ** 2, T = new Float32Array(n);
  let m = 0, k = 0;
  for (let y = -rP; y <= rP; y++) for (let x = -rP; x <= rP; x++) { T[k] = ref[(ry + y) * w + rx + x]; m += T[k++]; }
  m /= n; let sT = 0;
  for (let i = 0; i < n; i++) { T[i] -= m; sT += T[i] * T[i]; }
  if (sT < 1e-6) return null; // parche plano: no hay referencia que seguir
  const cx0 = Math.round(pIni[0] - fx), cy0 = Math.round(pIni[1] - fy), L = 2 * rB + 1, mapa = new Float32Array(L * L).fill(-2);
  let mejor = -2, bx = 0, by = 0;
  for (let dy = -rB; dy <= rB; dy++) for (let dx = -rB; dx <= rB; dx++) {
    const cx = cx0 + dx, cy = cy0 + dy;
    if (cx - rP < 0 || cy - rP < 0 || cx + rP >= w || cy + rP >= h) continue;
    let s = 0, s2 = 0, sp = 0; k = 0;
    for (let y = -rP; y <= rP; y++) { const f = (cy + y) * w + cx; for (let x = -rP; x <= rP; x++) { const v = nueva[f + x]; s += v; s2 += v * v; sp += v * T[k++]; } }
    const varA = s2 - (s * s) / n, c = varA > 1e-6 ? sp / Math.sqrt(varA * sT) : -1;
    mapa[(dy + rB) * L + dx + rB] = c;
    if (c > mejor) { mejor = c; bx = dx; by = dy; }
  }
  if (mejor <= -2) return null;
  const at = (dx, dy) => (Math.abs(dx) > rB || Math.abs(dy) > rB ? mejor : mapa[(dy + rB) * L + dx + rB]);
  const sx = Math.abs(bx) < rB ? vertice(at(bx - 1, by), mejor, at(bx + 1, by)) : 0;
  const sy = Math.abs(by) < rB ? vertice(at(bx, by - 1), mejor, at(bx, by + 1)) : 0;
  const fino = refinarLK(T, sT, nueva, w, h, cx0 + bx, cy0 + by, sx, sy, rP);
  return { p: [cx0 + bx + fino[0] + fx, cy0 + by + fino[1] + fy], ncc: mejor, enBorde: Math.abs(bx) === rB || Math.abs(by) === rB };
};

// Refinado subpixel Lucas-Kanade con ganancia y sesgo (parches de media cero): parte de la parabola
// (sx, sy) y minimiza sum (T - g*(I(x+d) - media))^2. Si diverge (> 1 px), se queda con la parabola.
function refinarLK(T, sT, I, w, h, cx, cy, sx, sy, rP) {
  const bil = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), ax = x - x0, ay = y - y0, i = y0 * w + x0;
    return (I[i] * (1 - ax) + I[i + 1] * ax) * (1 - ay) + (I[i + w] * (1 - ax) + I[i + w + 1] * ax) * ay; };
  if (cx - rP - 2 < 0 || cy - rP - 2 < 0 || cx + rP + 2 >= w || cy + rP + 2 >= h) return [sx, sy];
  const n = T.length, v = new Float32Array(n), gx = new Float32Array(n), gy = new Float32Array(n);
  let dx = sx, dy = sy;
  for (let it = 0; it < 12; it++) {
    let k = 0, m = 0;
    for (let y = -rP; y <= rP; y++) for (let x = -rP; x <= rP; x++) {
      const X = cx + x + dx, Y = cy + y + dy;
      v[k] = bil(X, Y); gx[k] = (bil(X + 0.5, Y) - bil(X - 0.5, Y)); gy[k] = (bil(X, Y + 0.5) - bil(X, Y - 0.5)); m += v[k++];
    }
    m /= n; let sI = 0, sTI = 0;
    for (let i = 0; i < n; i++) { v[i] -= m; sI += v[i] * v[i]; sTI += T[i] * v[i]; }
    const g = sI > 1e-9 ? sTI / sI : 1; // ganancia de minimos cuadrados
    let a = 0, b = 0, c = 0, ex = 0, ey = 0;
    for (let i = 0; i < n; i++) { const jx = g * gx[i], jy = g * gy[i], r = T[i] - g * v[i]; a += jx * jx; b += jx * jy; c += jy * jy; ex += jx * r; ey += jy * r; }
    const det = a * c - b * b; if (Math.abs(det) < 1e-9) break;
    const ux = (c * ex - b * ey) / det, uy = (a * ey - b * ex) / det;
    dx += ux; dy += uy;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return [sx, sy];
    if (ux * ux + uy * uy < 1e-8) break;
  }
  return [dx, dy];
}

// Nitidez: varianza del laplaciano (4 vecinos) sobre luminancia
RP.nitidez = (a, w, h) => {
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, l = a[i - 1] + a[i + 1] + a[i - w] + a[i + w] - 4 * a[i];
    s += l; s2 += l * l; n++;
  }
  return n ? s2 / n - (s / n) ** 2 : 0;
};

// Alineado de a respecto a ref: busqueda entera por SSD en +-R y, si subpixel, vertice parabolico.
// Devuelve [dy, dx] tal que a(y+dy, x+dx) ~ ref(y, x).
RP.alinearSub = (ref, a, w, h, R, subpixel = true) => {
  const L = 2 * R + 1, ssd = new Float64Array(L * L);
  let min = Infinity, by = 0, bx = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let s = 0, n = 0;
    for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) { const d = ref[y * w + x] - a[(y + dy) * w + x + dx]; s += d * d; n++; }
    ssd[(dy + R) * L + dx + R] = s / n;
    if (s / n < min) { min = s / n; by = dy; bx = dx; }
  }
  if (!subpixel) return [by, bx];
  const at = (dy, dx) => ssd[(dy + R) * L + dx + R];
  const sy = Math.abs(by) < R ? vertice(at(by - 1, bx), min, at(by + 1, bx)) : 0;
  const sx = Math.abs(bx) < R ? vertice(at(by, bx - 1), min, at(by, bx + 1)) : 0;
  return [by + sy, bx + sx];
};

// Desplazamiento bilineal (dy, dx reales) de RGB intercalado; bordes replicados
RP.desplazarSub = (rgb, w, h, dy, dx) => {
  const o = new Float32Array(rgb.length), cl = (v, a, b) => (v < a ? a : v > b ? b : v);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sy = cl(y + dy, 0, h - 1), sx = cl(x + dx, 0, w - 1), y0 = Math.floor(sy), x0 = Math.floor(sx);
    const y1 = Math.min(h - 1, y0 + 1), x1 = Math.min(w - 1, x0 + 1), fy = sy - y0, fx = sx - x0;
    for (let c = 0; c < 3; c++) {
      const v00 = rgb[(y0 * w + x0) * 3 + c], v01 = rgb[(y0 * w + x1) * 3 + c], v10 = rgb[(y1 * w + x0) * 3 + c], v11 = rgb[(y1 * w + x1) * 3 + c];
      o[(y * w + x) * 3 + c] = (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy;
    }
  }
  return o;
};

// Rectangulo destino (SI, SD, ID, II) con trapecio: trapH > 0 estrecha el borde superior,
// < 0 el inferior; trapV > 0 estrecha el borde izquierdo, < 0 el derecho (en % del lado).
RP.rectTrapecio = (x0, y0, x1, y1, trapH = 0, trapV = 0) => {
  const w = x1 - x0, h = y1 - y0, th = trapH / 100, tv = trapV / 100;
  const arr = Math.max(th, 0) * w / 2, aba = Math.max(-th, 0) * w / 2, izq = Math.max(tv, 0) * h / 2, der = Math.max(-tv, 0) * h / 2;
  return [[x0 + arr, y0 + izq], [x1 - arr, y0 + der], [x1 - aba, y1 - der], [x0 + aba, y1 - izq]];
};

// Mezcla de una pila de RGB del mismo tamano: media, mediana o media recortada (sin min ni max)
RP.mezclarPila = (lista, n, modo) => {
  const out = new Float32Array(n), K = lista.length;
  if (modo === "media" || K < 3) { for (const p of lista) for (let i = 0; i < n; i++) out[i] += p[i] / K; return out; }
  const col = new Float32Array(K);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < K; k++) col[k] = lista[k][i];
    col.sort();
    if (modo === "mediana") out[i] = K % 2 ? col[K >> 1] : (col[K / 2 - 1] + col[K / 2]) / 2;
    else { let s = 0; for (let k = 1; k < K - 1; k++) s += col[k]; out[i] = s / (K - 2); }
  }
  return out;
};
