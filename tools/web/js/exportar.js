// -----------------------------------------------------------------------------
// exportar.js — Codificacion de la salida a PNG/JPEG/WebP/AVIF (navegador) y a
// TIFF/BMP/PPM/PGM (codificadores propios, sin perdida, sin dependencias).
// Author: Saul López
// Date:   2026-11-13
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

RP.FORMATOS = [
  { id: "png", nombre: "PNG (sin perdida)", mime: "image/png", ext: "png", perdida: false, navegador: true },
  { id: "tiff", nombre: "TIFF RGB sin comprimir (sin perdida)", mime: "image/tiff", ext: "tif", perdida: false },
  { id: "bmp", nombre: "BMP 24 bits (sin perdida)", mime: "image/bmp", ext: "bmp", perdida: false },
  { id: "ppm", nombre: "PPM/PGM Netpbm (sin perdida)", mime: "image/x-portable-anymap", ext: "ppm", perdida: false },
  { id: "jpeg", nombre: "JPEG (con perdida)", mime: "image/jpeg", ext: "jpg", perdida: true, navegador: true },
  { id: "webp", nombre: "WebP (con perdida)", mime: "image/webp", ext: "webp", perdida: true, navegador: true },
  { id: "avif", nombre: "AVIF (con perdida)", mime: "image/avif", ext: "avif", perdida: true, navegador: true },
];

// ¿El navegador sabe codificar este mime? (si no, toDataURL devuelve PNG)
RP.soportaMime = (mime) => {
  if (typeof document === "undefined") return false;
  const c = document.createElement("canvas"); c.width = c.height = 1;
  return c.toDataURL(mime).startsWith("data:" + mime);
};

const esGris = (d) => { for (let i = 0; i < d.length; i += 4) if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false; return true; };

RP.codificarBMP = (img) => {
  const { width: w, height: h, data } = img, fila = (w * 3 + 3) & ~3, tam = 54 + fila * h;
  const b = new Uint8Array(tam), v = new DataView(b.buffer);
  b[0] = 0x42; b[1] = 0x4d; v.setUint32(2, tam, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, fila * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true); // 72 ppp
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((h - 1 - y) * w + x) * 4, o = 54 + y * fila + x * 3;
    b[o] = data[s + 2]; b[o + 1] = data[s + 1]; b[o + 2] = data[s];
  }
  return b;
};

RP.codificarTIFF = (img) => {
  const { width: w, height: h, data } = img, n = w * h * 3, nTags = 12;
  const ifd = 8, ifdTam = 2 + nTags * 12 + 4, bps = ifd + ifdTam, res = bps + 6, px = res + 16;
  const b = new Uint8Array(px + n), v = new DataView(b.buffer);
  b[0] = 0x49; b[1] = 0x49; v.setUint16(2, 42, true); v.setUint32(4, ifd, true);
  v.setUint16(ifd, nTags, true);
  const tags = [[256, 4, 1, w], [257, 4, 1, h], [258, 3, 3, bps], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, px],
    [277, 3, 1, 3], [278, 4, 1, h], [279, 4, 1, n], [282, 5, 1, res], [283, 5, 1, res + 8], [296, 3, 1, 2]];
  tags.forEach(([tag, tipo, cuenta, valor], i) => {
    const o = ifd + 2 + i * 12;
    v.setUint16(o, tag, true); v.setUint16(o + 2, tipo, true); v.setUint32(o + 4, cuenta, true);
    if (tipo === 3 && cuenta === 1) v.setUint16(o + 8, valor, true); else v.setUint32(o + 8, valor, true);
  });
  v.setUint32(ifd + 2 + nTags * 12, 0, true);
  for (let i = 0; i < 3; i++) v.setUint16(bps + i * 2, 8, true);
  v.setUint32(res, 72, true); v.setUint32(res + 4, 1, true); v.setUint32(res + 8, 72, true); v.setUint32(res + 12, 1, true);
  for (let i = 0, o = px; i < w * h; i++) { b[o++] = data[i * 4]; b[o++] = data[i * 4 + 1]; b[o++] = data[i * 4 + 2]; }
  return b;
};

RP.codificarPNM = (img) => {
  const { width: w, height: h, data } = img, gris = esGris(data);
  const cab = new TextEncoder().encode(`${gris ? "P5" : "P6"}\n# perspectiva.html\n${w} ${h}\n255\n`);
  const cuerpo = new Uint8Array(w * h * (gris ? 1 : 3));
  for (let i = 0, o = 0; i < w * h; i++) {
    if (gris) cuerpo[o++] = data[i * 4];
    else { cuerpo[o++] = data[i * 4]; cuerpo[o++] = data[i * 4 + 1]; cuerpo[o++] = data[i * 4 + 2]; }
  }
  const b = new Uint8Array(cab.length + cuerpo.length); b.set(cab); b.set(cuerpo, cab.length);
  return { bytes: b, ext: gris ? "pgm" : "ppm" };
};

// Escalado entero por vecino (mantiene los pixeles tal cual, solo los repite)
RP.escalarEntero = (img, f) => {
  if (f === 1) return img;
  const W = img.width * f, H = img.height * f, out = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (((y / f) | 0) * img.width + ((x / f) | 0)) * 4, o = (y * W + x) * 4;
    out.data[o] = img.data[s]; out.data[o + 1] = img.data[s + 1]; out.data[o + 2] = img.data[s + 2]; out.data[o + 3] = 255;
  }
  return out;
};

// -> Promise<{blob, ext}>
RP.codificar = async (img, id, calidad = 0.95) => {
  const F = RP.FORMATOS.find((f) => f.id === id);
  if (id === "bmp") return { blob: new Blob([RP.codificarBMP(img)], { type: F.mime }), ext: "bmp" };
  if (id === "tiff") return { blob: new Blob([RP.codificarTIFF(img)], { type: F.mime }), ext: "tif" };
  // octet-stream: con image/x-portable-anymap Firefox renombra la descarga a .pnm
  if (id === "ppm") { const r = RP.codificarPNM(img); return { blob: new Blob([r.bytes], { type: "application/octet-stream" }), ext: r.ext }; }
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").putImageData(img, 0, 0);
  const blob = await new Promise((ok) => c.toBlob(ok, F.mime, F.perdida ? calidad : undefined));
  if (!blob || blob.type !== F.mime) throw new Error(`el navegador no codifica ${F.mime}`);
  return { blob, ext: F.ext };
};
