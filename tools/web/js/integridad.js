// -----------------------------------------------------------------------------
// integridad.js — Indicios de integridad de una imagen (calculo, sin DOM):
//  - tablas de cuantizacion JPEG (DQT) y calidad estimada contra las tablas
//    estandar de libjpeg/IJG: coincidencia exacta = la guardo software con
//    libjpeg a esa calidad; tablas propias = camara u otro editor;
//  - ELA (error level analysis): diferencia con la imagen recomprimida;
//  - comparacion de la miniatura EXIF con la imagen principal.
// Son INDICIOS: ninguno prueba por si solo una manipulacion ni su ausencia.
// Author: Saul López
// Date:   2026-11-15
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// Tablas de la norma (ITU-T T.81, anexo K), en orden natural; libjpeg las escala con la calidad
RP.IJG_LUM = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
RP.IJG_CROM = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array(32).fill(99)];
// posicion k del zigzag -> indice natural (los DQT van en zigzag)
RP.ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

// Tabla de libjpeg para una calidad 1-100 (jpeg_quality_scaling + baseline: 1..255)
RP.tablaIJG = (q, base) => {
  const s = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))));
};

// Segmentos DQT de un JPEG: [{ id, precision (8|16), natural: [64] }]
RP.tablasCuantizacion = (u8) => {
  const tablas = [];
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return tablas;
  let i = 2;
  while (i + 4 <= u8.length && u8[i] === 0xff) {
    const m = u8[i + 1], L = (u8[i + 2] << 8) | u8[i + 3];
    if (m === 0xda || m === 0xd9) break; // empiezan los datos: no hay mas cabeceras
    if (m === 0xdb) {
      let p = i + 4;
      while (p < i + 2 + L) {
        const pq = u8[p] >> 4, id = u8[p] & 15, n = pq ? 2 : 1, natural = new Array(64);
        for (let k = 0; k < 64; k++) natural[RP.ZIGZAG[k]] = pq ? (u8[p + 1 + 2 * k] << 8) | u8[p + 2 + 2 * k] : u8[p + 1 + k];
        tablas.push({ id, precision: pq ? 16 : 8, natural });
        p += 1 + 64 * n;
      }
    }
    i += 2 + L;
  }
  return tablas;
};

// Calidad IJG mas parecida a una tabla: { tipo: "luminancia"|"crominancia", calidad, exacta, desviacion (media abs) }
RP.estimarCalidad = (natural) => {
  let mejor = null;
  for (const [tipo, base] of [["luminancia", RP.IJG_LUM], ["crominancia", RP.IJG_CROM]]) for (let q = 1; q <= 100; q++) {
    const t = RP.tablaIJG(q, base), d = t.reduce((s, v, i) => s + Math.abs(v - natural[i]), 0) / 64;
    if (!mejor || d < mejor.desviacion) mejor = { tipo, calidad: q, desviacion: d };
  }
  return { ...mejor, exacta: mejor.desviacion === 0 };
};

// ELA: |original - recomprimida| por canal, el maximo de los tres, amplificado. Devuelve el mapa (0-255) y su media.
RP.ela = (orig, recomp, n, amplificacion) => {
  const mapa = new Uint8ClampedArray(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4, d = Math.max(Math.abs(orig[o] - recomp[o]), Math.abs(orig[o + 1] - recomp[o + 1]), Math.abs(orig[o + 2] - recomp[o + 2]));
    s += d; mapa[i] = d * amplificacion;
  }
  return { mapa, media: s / n };
};

// Percentil p (0-1) de un mapa de 0-255 (por histograma)
RP.percentil = (mapa, p) => {
  const h = new Uint32Array(256); for (let i = 0; i < mapa.length; i++) h[mapa[i]]++;
  let acc = 0; const objetivo = p * mapa.length;
  for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= objetivo) return v; }
  return 255;
};

// Media del mapa ELA (sin amplificar) dentro de un rectangulo, para comparar zonas
RP.mediaZona = (orig, recomp, w, x0, y0, x1, y1) => {
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * w + x) * 4; s += Math.max(Math.abs(orig[o] - recomp[o]), Math.abs(orig[o + 1] - recomp[o + 1]), Math.abs(orig[o + 2] - recomp[o + 2])); n++;
  }
  return n ? s / n : 0;
};

// Miniatura frente a la imagen principal ya reducida al mismo tamano (RGBA): NCC de luminancia y diferencia media
RP.compararMiniatura = (a, b, n) => {
  const L = (d, i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const la = new Float32Array(n), lb = new Float32Array(n);
  let dif = 0;
  for (let i = 0; i < n; i++) { la[i] = L(a, i); lb[i] = L(b, i); dif += Math.abs(la[i] - lb[i]); }
  return { ncc: RP.ncc(la, lb), difMedia: dif / n };
};
