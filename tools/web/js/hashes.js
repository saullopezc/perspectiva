// -----------------------------------------------------------------------------
// hashes.js — Hashes de un fichero: MD5 y SHA-1 (los que aun piden
// muchos formularios, informes y bases como NSRL), SHA-256 (el de referencia) y
// SHA-512, mas CRC32 (control de integridad de ZIP/PNG, no criptografico).
// SHA-* con la API criptografica del navegador; MD5 y CRC32 en JS (no estan en ella).
// MD5 y SHA-1 tienen colisiones conocidas: sirven para cotejar con otros
// registros, no como unica prueba de integridad (para eso, SHA-256).
// Author: Saul López
// Date:   2026-11-15
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

const hex32 = (v) => (v >>> 0).toString(16).padStart(8, "0");

// MD5 (RFC 1321) sobre un Uint8Array, por bloques de 64 bytes, sin copiar el fichero entero
RP.md5 = (u8) => {
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const n = u8.length, total = (((n + 8) >> 6) + 1) * 64, M = new Uint32Array(16), cola = new Uint8Array(128);
  const restoIni = n - (n % 64), resto = u8.subarray(restoIni);
  cola.set(resto); cola[resto.length] = 0x80;
  const finCola = total - restoIni, bits = n * 8;
  for (let i = 0; i < 8; i++) cola[finCola - 8 + i] = i < 4 ? (bits >>> (8 * i)) & 0xff : Math.floor(bits / 2 ** 32) >>> (8 * (i - 4)) & 0xff;
  for (let off = 0; off < total; off += 64) {
    const fuente = off < restoIni ? u8 : cola, base = off < restoIni ? off : off - restoIni;
    for (let j = 0; j < 16; j++) { const p = base + 4 * j; M[j] = fuente[p] | (fuente[p + 1] << 8) | (fuente[p + 2] << 16) | (fuente[p + 3] << 24); }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; } else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + K[i] + M[g]) | 0; A = D; D = C; C = B;
      const s = S[(i >> 4) * 4 + (i & 3)]; B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((k) => ((v >>> k) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
};

// CRC32 (IEEE 802.3, el de ZIP y PNG)
const TABLA_CRC32_HASHES = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
RP.crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = TABLA_CRC32_HASHES[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return hex32(c ^ 0xffffffff); };

const hexBuf = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
// Todos los hashes de un ArrayBuffer: { bytes, md5, sha1, sha256, sha512, crc32 }
RP.hashes = async (buf) => {
  const u8 = new Uint8Array(buf), sub = crypto.subtle;
  const [sha1, sha256, sha512] = await Promise.all(["SHA-1", "SHA-256", "SHA-512"].map((a) => sub.digest(a, buf).then(hexBuf)));
  return { bytes: u8.length, md5: RP.md5(u8), sha1, sha256, sha512, crc32: RP.crc32(u8) };
};

RP.informeHashes = (h) => !h ? "Hashes: calculando…" : [
  `Hashes del fichero (${h.bytes} bytes):`,
  `  MD5     ${h.md5}`, `  SHA-1   ${h.sha1}`, `  SHA-256 ${h.sha256}`, `  SHA-512 ${h.sha512}`, `  CRC32   ${h.crc32}`,
  "  (MD5 y SHA-1 tienen colisiones conocidas: para cotejar; la integridad la da SHA-256)",
].join("\n");
