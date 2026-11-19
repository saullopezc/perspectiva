// -----------------------------------------------------------------------------
// hexa.js — Identificacion de fichero por cabecera (magic) y trailer, datos tras
// el fin del formato, firmas incrustadas y volcado hexadecimal.
// Author: Saul López
// Date:   2026-11-13
// Modified By: Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

const hx = (s) => s.split(" ").map((b) => parseInt(b, 16));
RP.FIRMAS = [
  { tipo: "PNG", off: 0, sig: hx("89 50 4E 47 0D 0A 1A 0A"), ext: ["png"] },
  { tipo: "JPEG", off: 0, sig: hx("FF D8 FF"), ext: ["jpg", "jpeg", "jfif"] },
  { tipo: "GIF", off: 0, sig: hx("47 49 46 38"), ext: ["gif"] },
  { tipo: "BMP", off: 0, sig: hx("42 4D"), ext: ["bmp"] },
  { tipo: "WEBP/RIFF", off: 0, sig: hx("52 49 46 46"), ext: ["webp", "wav", "avi"] },
  { tipo: "MP4/ISO-BMFF", off: 4, sig: hx("66 74 79 70"), ext: ["mp4", "m4v", "mov", "3gp", "heic"] },
  { tipo: "MKV/WebM", off: 0, sig: hx("1A 45 DF A3"), ext: ["mkv", "webm"] },
  { tipo: "TIFF", off: 0, sig: hx("49 49 2A 00"), ext: ["tif", "tiff"] },
  { tipo: "TIFF", off: 0, sig: hx("4D 4D 00 2A"), ext: ["tif", "tiff"] },
  { tipo: "ZIP", off: 0, sig: hx("50 4B 03 04"), ext: ["zip", "docx", "xlsx"] },
  { tipo: "PDF", off: 0, sig: hx("25 50 44 46"), ext: ["pdf"] },
  { tipo: "7Z", off: 0, sig: hx("37 7A BC AF 27 1C"), ext: ["7z"] },
  { tipo: "RAR", off: 0, sig: hx("52 61 72 21 1A 07"), ext: ["rar"] },
  { tipo: "GZIP", off: 0, sig: hx("1F 8B"), ext: ["gz"] },
  { tipo: "PPM", off: 0, sig: hx("50 36 0A"), ext: ["ppm", "pnm"] },
  { tipo: "PGM", off: 0, sig: hx("50 35 0A"), ext: ["pgm", "pnm"] },
];

const coincide = (u8, off, sig) => sig.every((b, i) => u8[off + i] === b);
// salta con indexOf (nativo) al siguiente primer byte de la firma: ~30x mas rapido que recorrer byte a byte
const buscar = (u8, sig, desde = 0, hasta = u8.length) => {
  const lim = hasta - sig.length;
  for (let i = u8.indexOf(sig[0], desde); i >= 0 && i <= lim; i = u8.indexOf(sig[0], i + 1)) if (coincide(u8, i, sig)) return i;
  return -1;
};
const u32be = (u8, i) => ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];
const u32le = (u8, i) => u8[i] + (u8[i + 1] << 8) + (u8[i + 2] << 16) + ((u8[i + 3] << 24) >>> 0);

// Fin del formato segun su estructura (trailer o tamanos declarados)
const finFormato = (u8, tipo) => {
  switch (tipo) {
    case "PNG": { const i = buscar(u8, hx("49 45 4E 44")); return i < 0 ? null : { fin: i + 8, trailer: "IEND + CRC" }; }
    case "JPEG": {
      const sos = buscar(u8, hx("FF DA"), 2), i = sos < 0 ? -1 : buscar(u8, hx("FF D9"), sos);
      return i < 0 ? null : { fin: i + 2, trailer: "FF D9 (EOI, primero tras SOS)" };
    }
    case "GIF": { for (let i = u8.length - 1; i > 6; i--) if (u8[i] === 0x3b) return { fin: i + 1, trailer: "3B (ultimo)" }; return null; }
    case "BMP": return { fin: u32le(u8, 2), trailer: "tamano declarado en cabecera" };
    case "WEBP/RIFF": return { fin: u32le(u8, 4) + 8, trailer: "tamano RIFF" };
    case "PDF": { let i = -1; for (let k = u8.length - 5; k >= 0; k--) if (coincide(u8, k, hx("25 25 45 4F 46"))) { i = k; break; } return i < 0 ? null : { fin: i + 5, trailer: "%%EOF (ultimo)" }; }
    case "ZIP": { for (let k = u8.length - 22; k >= 0; k--) if (coincide(u8, k, hx("50 4B 05 06"))) return { fin: k + 22 + (u8[k + 20] | (u8[k + 21] << 8)), trailer: "EOCD" }; return null; }
    case "MP4/ISO-BMFF": {
      let i = 0, cajas = [];
      while (i + 8 <= u8.length) {
        let tam = u32be(u8, i);
        const nom = String.fromCharCode(...u8.subarray(i + 4, i + 8));
        if (tam === 1) tam = Number((BigInt(u32be(u8, i + 8)) << 32n) + BigInt(u32be(u8, i + 12)));
        if (tam === 0) tam = u8.length - i;
        if (tam < 8 || !/^[\x20-\x7e]{4}$/.test(nom)) break;
        cajas.push(nom); i += tam;
      }
      return { fin: Math.min(i, u8.length), trailer: "cajas: " + cajas.join(" ") };
    }
    default: return null;
  }
};

RP.hexdump = (u8, off, len) => {
  const L = [];
  for (let i = off; i < Math.min(u8.length, off + len); i += 16) {
    const fila = u8.subarray(i, Math.min(u8.length, i + 16));
    L.push(i.toString(16).padStart(8, "0") + "  " + [...fila].map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(48) +
      "  " + [...fila].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join(""));
  }
  return L.join("\n");
};

RP.analizarBytes = (u8, nombre) => {
  const ext = (nombre.split(".").pop() || "").toLowerCase();
  const f = RP.FIRMAS.find((s) => coincide(u8, s.off, s.sig));
  const tipo = f ? f.tipo : "desconocido";
  const fin = f ? finFormato(u8, tipo) : null;
  const incrustadas = [];
  for (const s of RP.FIRMAS) {
    if (s.sig.length < 4 || s.off !== 0) continue;
    let i = buscar(u8, s.sig, 1);
    while (i >= 0 && incrustadas.length < 20) { incrustadas.push({ off: i, tipo: s.tipo }); i = buscar(u8, s.sig, i + 1); }
  }
  incrustadas.sort((a, b) => a.off - b.off);
  return {
    nombre, bytes: u8.length, tipo, extension: ext, extensionCoincide: f ? f.ext.includes(ext) : null,
    fin: fin ? fin.fin : null, trailer: fin ? fin.trailer : null,
    bytesTrasFin: fin && fin.fin < u8.length ? u8.length - fin.fin : 0, incrustadas,
    cabecera: RP.hexdump(u8, 0, 64),
    final: RP.hexdump(u8, Math.max(0, u8.length - 64), 64),
    zonaFin: fin && fin.fin > 0 ? RP.hexdump(u8, Math.max(0, fin.fin - 32), 64) : "",
  };
};

RP.informeHex = (a) => [
  `fichero: ${a.nombre} (${a.bytes} B)`,
  `firma: ${a.tipo} · extension .${a.extension} · coincide: ${a.extensionCoincide}`,
  `fin de formato: ${a.fin ?? "no determinado"} ${a.trailer ? "(" + a.trailer + ")" : ""}`,
  a.bytesTrasFin ? `ATENCION: ${a.bytesTrasFin} bytes tras el fin del formato (offset ${a.fin})` : "sin datos tras el fin del formato",
  a.incrustadas.length ? "firmas incrustadas: " + a.incrustadas.map((s) => `${s.tipo}@0x${s.off.toString(16)}`).join(", ") : "sin firmas incrustadas",
  "", "— cabecera —", a.cabecera, "", "— zona de fin de formato —", a.zonaFin || "(n/d)", "", "— ultimos 64 bytes —", a.final,
].join("\n");
