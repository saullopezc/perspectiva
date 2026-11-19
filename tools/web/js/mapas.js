// -----------------------------------------------------------------------------
// mapas.js — Mapas de calor de posibles retoques (calculo, sin DOM):
//  - Mapa de ruido: el residuo de alta frecuencia (luminancia menos su mediana 3x3)
//    da el ruido del sensor; su nivel por bloque (MAD robusto) se compara con la
//    mediana de la imagen. Una zona pegada de otra foto, suavizada o con ruido anadido
//    suele tener un nivel distinto del resto (mas: rojo; menos: azul).
//  - JPEG ghost (Farid, 2009): se recomprime a varias calidades y, por bloque, la
//    diferencia se normaliza entre su minimo y su maximo. Una zona que ya estuvo
//    comprimida a la calidad q tiene su minimo en q: sale oscura en el mapa de q
//    mientras el resto sale claro.
// Son INDICIOS: las texturas, los bordes y el texto tambien cambian el ruido.
// Author: Saul López
// Date:   2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

RP.lumRGBA = (d, n) => { const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return L; };

// mediana de 3x3 (bordes replicados): una red de ordenacion de 9 valores
RP.mediana3 = (L, w, h) => {
  const o = new Float32Array(w * h), v = new Float32Array(9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v[k++] = L[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
    v.sort(); o[y * w + x] = v[4];
  }
  return o;
};
const medianaDe = (a) => { const s = Float32Array.from(a).sort(); return s.length ? s[s.length >> 1] : 0; };

// Nivel de ruido por bloque de B x B: sigma = MAD(residuo) / 0.6745. Devuelve { gw, gh, B, sigma, referencia, razon }
RP.mapaRuido = (L, w, h, B = 16) => {
  const m = RP.mediana3(L, w, h), gw = Math.ceil(w / B), gh = Math.ceil(h / B), sigma = new Float32Array(gw * gh), buf = [];
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    buf.length = 0;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) buf.push(Math.abs(L[y * w + x] - m[y * w + x]));
    sigma[by * gw + bx] = medianaDe(buf) / 0.6745;
  }
  const referencia = medianaDe(sigma) || 1e-6;
  const razon = sigma.map((s) => s / referencia);
  return { gw, gh, B, sigma, referencia, razon };
};

// Diferencia cuadratica media por bloque entre original y recomprimida (RGBA)
RP.difBloques = (a, b, w, h, B = 16) => {
  const gw = Math.ceil(w / B), gh = Math.ceil(h / B), s = new Float32Array(gw * gh), n = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, k = ((y / B) | 0) * gw + ((x / B) | 0);
    for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; s[k] += d * d; }
    n[k] += 3;
  }
  return { gw, gh, B, d: s.map((v, k) => v / n[k]) };
};

// JPEG ghost: lista de { q, d } (difBloques a cada calidad) -> por calidad, la diferencia normalizada por bloque (0-1)
RP.ghostNormalizado = (lista) => {
  const nb = lista[0].d.length, min = new Float32Array(nb).fill(Infinity), max = new Float32Array(nb).fill(-Infinity);
  for (const { d } of lista) for (let k = 0; k < nb; k++) { if (d[k] < min[k]) min[k] = d[k]; if (d[k] > max[k]) max[k] = d[k]; }
  return lista.map(({ q, d }) => ({ q, n: d.map((v, k) => (max[k] - min[k] > 1e-9 ? (v - min[k]) / (max[k] - min[k]) : 0)) }));
};

// Media de un mapa por bloques dentro de un rectangulo en pixeles (para comparar zonas)
RP.mediaBloquesRect = (vals, gw, B, x0, y0, x1, y1) => {
  let s = 0, n = 0;
  for (let by = Math.floor(y0 / B); by < Math.ceil(y1 / B); by++) for (let bx = Math.floor(x0 / B); bx < Math.ceil(x1 / B); bx++) {
    // solo bloques enteramente dentro: los del borde mezclan las dos zonas
    if (bx * B >= x0 && (bx + 1) * B <= x1 && by * B >= y0 && (by + 1) * B <= y1) { s += vals[by * gw + bx]; n++; }
  }
  return n ? s / n : NaN;
};

// Colores: divergente para el ruido (log2 de la razon: azul menos, rojo mas) y secuencial para el ghost (oscuro = minimo)
RP.colorRuido = (razon) => { const t = Math.max(-1, Math.min(1, Math.log2(razon || 1e-6) / 1.5)); return t >= 0 ? [255, 255 * (1 - t), 255 * (1 - t), t] : [255 * (1 + t), 255 * (1 + t), 255, -t]; };
RP.colorGhost = (v) => { const t = Math.max(0, Math.min(1, v)); return [255 * Math.min(1, t * 1.6), 255 * Math.max(0, t * 1.6 - 0.6), 255 * Math.max(0, t * 2 - 1.2), 1]; };

// Mapa por bloques sobre la imagen en gris: devuelve RGBA. color(v) -> [r, g, b, alfa 0-1]; opacidad global 0-1
RP.componerMapa = (base, w, h, vals, gw, B, color, opacidad) => {
  const L = RP.lumRGBA(base, w * h), o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, [r, g, b, a] = color(vals[((y / B) | 0) * gw + ((x / B) | 0)]), al = a * opacidad, gris = L[i] * 0.6;
    o[i * 4] = gris * (1 - al) + r * al; o[i * 4 + 1] = gris * (1 - al) + g * al; o[i * 4 + 2] = gris * (1 - al) + b * al; o[i * 4 + 3] = 255;
  }
  return o;
};
