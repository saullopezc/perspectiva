// -----------------------------------------------------------------------------
// filtros.js — Ruido, movimiento, luminancia, enfoque y alineado. Operan sobre
// canales Float32Array (0..255) de w x h. Ninguno inventa detalle: se documentan
// sus parametros en el registro JSON para reproducir la salida.
// Author: Saul López
// Date:   2026-11-13
// Modified By: Saul López
// Modified Date: 2026-11-15
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};
const cl = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- reduccion de ruido ----------
RP.gauss = (a, w, h, s) => {
  if (s <= 0) return a.slice();
  const r = Math.ceil(3 * s), k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * s * s)); k.push(v); sum += v; }
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += a[y * w + cl(x + i, 0, w - 1)] * k[i + r];
    t[y * w + x] = acc / sum;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += t[cl(y + i, 0, h - 1) * w + x] * k[i + r];
    o[y * w + x] = acc / sum;
  }
  return o;
};

RP.mediana = (a, w, h, r) => {
  const o = new Float32Array(a.length), v = new Float32Array((2 * r + 1) ** 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) v[n++] = a[cl(y + j, 0, h - 1) * w + cl(x + i, 0, w - 1)];
    o[y * w + x] = v.subarray(0, n).sort()[n >> 1];
  }
  return o;
};

// Bilateral: suaviza zonas planas y conserva bordes (sigma espacial / sigma de rango)
RP.bilateral = (a, w, h, ss, sr) => {
  const r = Math.ceil(2 * ss), o = new Float32Array(a.length);
  const ks = [];
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) ks.push([i, j, Math.exp(-(i * i + j * j) / (2 * ss * ss))]);
  const den = 2 * sr * sr;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = a[y * w + x];
    let s = 0, n = 0;
    for (const [i, j, g] of ks) {
      const v = a[cl(y + j, 0, h - 1) * w + cl(x + i, 0, w - 1)], wt = g * Math.exp(-((v - c) ** 2) / den);
      s += v * wt; n += wt;
    }
    o[y * w + x] = s / n;
  }
  return o;
};

// ---------- movimiento: PSF lineal + Richardson-Lucy ----------
RP.psfMovimiento = (len, angDeg) => {
  // simetrica respecto al origen: t en [-(L-1)/2, (L-1)/2] (evita el sesgo de Math.round en .5)
  const m = new Map(), ang = (angDeg * Math.PI) / 180, L = Math.max(1, Math.round(len)), R = (L - 1) / 2;
  for (let t = -R; t <= R + 1e-9; t += 0.25) {
    const rs = (v) => Math.sign(v) * Math.round(Math.abs(v)); // redondeo simetrico respecto a 0
    const dx = rs(t * Math.cos(ang)) + 0, dy = rs(-t * Math.sin(ang)) + 0, key = dx + "," + dy;
    m.set(key, (m.get(key) || 0) + 1);
  }
  let s = 0;
  m.forEach((v) => (s += v));
  return [...m].map(([k, v]) => { const [dx, dy] = k.split(",").map(Number); return [dx, dy, v / s]; });
};
const convolucionar = (a, w, h, taps) => {
  const o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (const [dx, dy, p] of taps) s += a[cl(y + dy, 0, h - 1) * w + cl(x + dx, 0, w - 1)] * p;
    o[y * w + x] = s;
  }
  return o;
};
RP.richardsonLucy = (a, w, h, taps, iters) => {
  const flip = taps.map(([dx, dy, p]) => [-dx, -dy, p]);
  let est = a.map((v) => Math.max(1, v));
  const obs = a.map((v) => Math.max(1, v));
  for (let k = 0; k < iters; k++) {
    const c = convolucionar(est, w, h, taps);
    const r = obs.map((v, i) => v / Math.max(1e-3, c[i]));
    const corr = convolucionar(r, w, h, flip);
    est = est.map((v, i) => v * corr[i]);
  }
  return est;
};

// ---------- luminancia ----------
// Campo plano: elimina el gradiente de iluminacion dividiendo/restando el fondo muy suavizado
RP.campoPlano = (a, w, h, sigma, modo) => {
  const bg = RP.gauss(a, w, h, sigma);
  let m = 0;
  for (const v of bg) m += v;
  m /= bg.length;
  return modo === "dividir" ? a.map((v, i) => (v / Math.max(1, bg[i])) * m) : a.map((v, i) => v - bg[i] + m);
};

// CLAHE: ecualizacion de histograma adaptativa por teselas con limite de contraste
RP.clahe = (a, w, h, tx, ty, clip) => {
  const maps = [], tw = w / tx, th = h / ty;
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    const hist = new Float32Array(256);
    let n = 0;
    for (let y = Math.floor(j * th); y < Math.floor((j + 1) * th); y++)
      for (let x = Math.floor(i * tw); x < Math.floor((i + 1) * tw); x++) { hist[cl(Math.round(a[y * w + x]), 0, 255)]++; n++; }
    const lim = Math.max(1, (clip * n) / 256);
    let exceso = 0;
    for (let b = 0; b < 256; b++) if (hist[b] > lim) { exceso += hist[b] - lim; hist[b] = lim; }
    const map = new Float32Array(256);
    let acc = 0;
    for (let b = 0; b < 256; b++) { acc += hist[b] + exceso / 256; map[b] = (acc * 255) / Math.max(1, n); }
    maps.push(map);
  }
  const o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = cl(x / tw - 0.5, 0, tx - 1), gy = cl(y / th - 0.5, 0, ty - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(tx - 1, x0 + 1), y1 = Math.min(ty - 1, y0 + 1), fx = gx - x0, fy = gy - y0;
    const b = cl(Math.round(a[y * w + x]), 0, 255), M = (i, j) => maps[j * tx + i][b];
    o[y * w + x] = (M(x0, y0) * (1 - fx) + M(x1, y0) * fx) * (1 - fy) + (M(x0, y1) * (1 - fx) + M(x1, y1) * fx) * fy;
  }
  return o;
};

// Rango 1-99 % de TODOS los canales juntos: un estiramiento comun conserva el balance de color (por canal
// deshacia cualquier ganancia o temperatura: medido en tests/web/qa_color.py)
RP.rangoAutoNiveles = (canales, pBajo = 0.01, pAlto = 0.99) => {
  const n = canales[0].length, ord = new Float32Array(n * canales.length);
  canales.forEach((a, k) => ord.set(a, k * n)); ord.sort();
  return [ord[Math.floor(ord.length * pBajo)], ord[Math.floor(ord.length * pAlto)]];
};
RP.autoNiveles = (a, rango = RP.rangoAutoNiveles([a])) => {
  const [lo, hi] = rango;
  return a.map((v) => ((v - lo) * 255) / Math.max(1, hi - lo));
};
// Niveles: punto negro, punto blanco y gamma de medios tonos
RP.niveles = (a, negro, blanco, gamma) =>
  a.map((v) => 255 * Math.pow(cl((v - negro) / Math.max(1, blanco - negro), 0, 1), 1 / gamma));
RP.brilloContraste = (a, brillo, contraste) => {
  const f = (259 * (contraste + 255)) / (255 * (259 - contraste));
  return a.map((v) => f * (v - 128) + 128 + brillo);
};
RP.enfoque = (a, w, h, cantidad, sigma) => {
  const b = RP.gauss(a, w, h, sigma);
  return a.map((v, i) => v + cantidad * (v - b[i]));
};
// Gradiente de luminancia (Sobel): resalta trazos y bordes
RP.sobel = (a, w, h) => {
  const o = new Float32Array(a.length), g = (x, y) => a[cl(y, 0, h - 1) * w + cl(x, 0, w - 1)];
  let mx = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1) - g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1);
    const gy = g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1) - g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1);
    o[y * w + x] = Math.hypot(gx, gy);
    if (o[y * w + x] > mx) mx = o[y * w + x];
  }
  return o.map((v) => (v * 255) / mx);
};

// ---------- alineado para apilado (busqueda entera por SSD) ----------
RP.alinear = (ref, a, w, h, R) => {
  let mejor = [0, 0], min = Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let s = 0, n = 0;
    for (let y = R; y < h - R; y += 2) for (let x = R; x < w - R; x += 2) { const d = ref[y * w + x] - a[(y + dy) * w + x + dx]; s += d * d; n++; }
    if (s / n < min) { min = s / n; mejor = [dy, dx]; }
  }
  return mejor;
};
RP.desplazar = (rgb, w, h, dy, dx) => {
  const o = new Float32Array(rgb.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++)
    o[(y * w + x) * 3 + c] = rgb[(cl(y + dy, 0, h - 1) * w + cl(x + dx, 0, w - 1)) * 3 + c];
  return o;
};

// ---------- color (sobre RGB float intercalado, antes de pasar a canales) ----------
// Ganancias por canal + temperatura (calido: +R -B), saturacion y rotacion de tono en YIQ.
const YIQ = [[0.299, 0.587, 0.114], [0.596, -0.274, -0.322], [0.211, -0.523, 0.312]];
const inv3 = (m) => { // inversa exacta 3x3 (evita el error de ida y vuelta de coeficientes redondeados)
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
          [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
          [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
};
const YIQi = inv3(YIQ);
RP.ajustarColor = (rgb, n, P) => {
  const o = new Float32Array(rgb.length), t = (P.temperatura || 0) / 100;
  const gR = P.gananciaR * (1 + 0.3 * t), gG = P.gananciaG, gB = P.gananciaB * (1 - 0.3 * t);
  const a = ((P.tono || 0) * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a), sat = P.saturacion;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] * gR, g = rgb[i * 3 + 1] * gG, b = rgb[i * 3 + 2] * gB;
    const y = YIQ[0][0] * r + YIQ[0][1] * g + YIQ[0][2] * b;
    let ii = YIQ[1][0] * r + YIQ[1][1] * g + YIQ[1][2] * b, q = YIQ[2][0] * r + YIQ[2][1] * g + YIQ[2][2] * b;
    [ii, q] = [(ii * cs - q * sn) * sat, (ii * sn + q * cs) * sat];
    for (let c = 0; c < 3; c++) o[i * 3 + c] = YIQi[c][0] * y + YIQi[c][1] * ii + YIQi[c][2] * q;
  }
  return o;
};
// Conversion a gris elegible: BT.601, un solo canal o mezclador con pesos (normalizados)
RP.aGris = (rgb, n, P) => {
  const W = { bt601: [0.299, 0.587, 0.114], color: [0.299, 0.587, 0.114], R: [1, 0, 0], G: [0, 1, 0], B: [0, 0, 1] }[P.modoGris] ||
    (() => { const s = Math.abs(P.mezclaR) + Math.abs(P.mezclaG) + Math.abs(P.mezclaB) || 1; return [P.mezclaR / s, P.mezclaG / s, P.mezclaB / s]; })();
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = W[0] * rgb[i * 3] + W[1] * rgb[i * 3 + 1] + W[2] * rgb[i * 3 + 2];
  return a;
};

// ---------- cadena completa (orden fijo, registrado) ----------
RP.ORDEN = ["color", "aGris", "ruido", "movimiento", "campoPlano", "clahe", "autoNiveles", "niveles", "brilloContraste", "enfoque", "vista", "binarizar", "negativo"];
RP.cadenaAjustes = (plana, P) => {
  const { w, h } = plana, n = w * h;
  const neutro = P.gananciaR === 1 && P.gananciaG === 1 && P.gananciaB === 1 && !P.temperatura && P.saturacion === 1 && !P.tono;
  const rgb = P.gananciaR === undefined || neutro ? plana.rgb : RP.ajustarColor(plana.rgb, n, P);
  const canales = P.gris ? [P.modoGris ? RP.aGris(rgb, n, P) : RP.luminancia(rgb, n)]
    : [0, 1, 2].map((c) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rgb[i * 3 + c]; return a; });
  const taps = P.movimiento ? RP.psfMovimiento(P.movLong, P.movAng) : null;
  const previos = canales.map((a0) => {
    let a = a0;
    if (P.ruido === "mediana") a = RP.mediana(a, w, h, P.ruidoRadio);
    else if (P.ruido === "gaussiano") a = RP.gauss(a, w, h, P.ruidoRadio / 2);
    else if (P.ruido === "bilateral") a = RP.bilateral(a, w, h, P.ruidoRadio, P.ruidoRango);
    if (taps) a = RP.richardsonLucy(a, w, h, taps, P.movIters);
    if (P.campoPlano !== "no") a = RP.campoPlano(a, w, h, P.campoSigma, P.campoPlano);
    if (P.clahe) a = RP.clahe(a, w, h, P.claheTx, P.claheTy, P.claheClip);
    return a;
  });
  const rango = P.autoNiveles ? RP.rangoAutoNiveles(previos) : null;
  const out = previos.map((a0) => {
    let a = a0;
    if (P.autoNiveles) a = RP.autoNiveles(a, rango);
    a = RP.niveles(a, P.negro, P.blanco, P.gamma);
    a = RP.brilloContraste(a, P.brillo, P.contraste);
    if (P.enfoque > 0) a = RP.enfoque(a, w, h, P.enfoque / 100, P.radioEnf / 2);
    if (P.vista === "sobel") a = RP.sobel(a, w, h);
    if (P.binarizar) a = a.map((v) => (v >= P.umbral ? 255 : 0));
    if (P.negativo) a = a.map((v) => 255 - v);
    return a;
  });
  return RP.aImageData(out, w, h);
};
