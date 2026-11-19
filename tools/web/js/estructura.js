// -----------------------------------------------------------------------------
// estructura.js — Analisis de la estructura de un fichero (calculo, sin DOM):
//  - MP4/MOV (ISO-BMFF): arbol de cajas con desplazamiento y tamano; por pista, codec
//    con nombre, perfil y nivel (avcC/hvcC), audio (esds: AAC LC/HE, frecuencia,
//    canales), muestras, fotogramas clave, bitrate y rotacion (matriz de tkhd).
//  - Matroska/WebM (EBML): elementos de primer nivel, pistas, codecs y clusters.
//  - RIFF (WAV/AVI/WEBP): bloques; formato de audio de WAV, codecs de AVI.
//  - JPEG: segmentos, tipo de codificacion (SOFn), submuestreo de color, escaneos.
//  - PNG: bloques con su CRC verificado, cabecera IHDR.
//  - Todos: entropia (bits por byte) global y por bloques.
// Devuelve { formato, filas: [[grupo, campo, valor]], arbol: [{n, nombre, off, tam, info}], entropia }.
// Author: Saul López
// Date:   2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

const ascii4 = (u8, i) => String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
const MAX_NODOS = 600;

// ---------------------------------------------------------------- entropia
RP.entropia = (u8, bloques = 64) => {
  const H = (a, b) => {
    const h = new Uint32Array(256); for (let i = a; i < b; i++) h[u8[i]]++;
    let e = 0; const n = b - a; for (const c of h) if (c) { const p = c / n; e -= p * Math.log2(p); }
    return n ? e : 0;
  };
  const tam = Math.max(1, Math.ceil(u8.length / bloques)), porBloque = [];
  for (let a = 0; a < u8.length; a += tam) porBloque.push(+H(a, Math.min(u8.length, a + tam)).toFixed(3));
  return { global: +H(0, u8.length).toFixed(3), tamBloque: tam, porBloque };
};

// ---------------------------------------------------------------- nombres
const H264_PERFILES = { 66: "Baseline", 77: "Main", 88: "Extended", 100: "High", 110: "High 10", 122: "High 4:2:2", 244: "High 4:4:4 Predictive", 44: "CAVLC 4:4:4" };
const HEVC_PERFILES = { 1: "Main", 2: "Main 10", 3: "Main Still Picture", 4: "Format Range Extensions" };
const AAC_TIPOS = { 1: "AAC Main", 2: "AAC LC", 3: "AAC SSR", 4: "AAC LTP", 5: "HE-AAC (SBR)", 29: "HE-AAC v2 (PS)", 23: "AAC LD", 39: "AAC ELD" };
const AAC_FRECUENCIAS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
RP.NOMBRES_CODEC = {
  avc1: "H.264 / AVC", avc3: "H.264 / AVC", hvc1: "H.265 / HEVC", hev1: "H.265 / HEVC", av01: "AV1", vp09: "VP9", vp08: "VP8", mp4v: "MPEG-4 Part 2",
  jpeg: "Motion JPEG", mjpa: "Motion JPEG", apcn: "Apple ProRes 422", apch: "Apple ProRes 422 HQ", mp4a: "AAC / audio MPEG-4", Opus: "Opus", "ac-3": "Dolby AC-3",
  "ec-3": "Dolby E-AC-3", fLaC: "FLAC", alac: "Apple Lossless", ".mp3": "MP3", lpcm: "PCM", sowt: "PCM (little endian)", twos: "PCM (big endian)",
  ulaw: "G.711 mu-law", alaw: "G.711 A-law", samr: "AMR-NB", sawb: "AMR-WB", tx3g: "subtitulos 3GPP", text: "texto", tmcd: "codigo de tiempo",
  V_MPEG4_ISO_AVC: "H.264 / AVC", "V_MPEG4/ISO/AVC": "H.264 / AVC", "V_MPEGH/ISO/HEVC": "H.265 / HEVC", V_VP8: "VP8", V_VP9: "VP9", V_AV1: "AV1",
  "V_MPEG4/ISO/ASP": "MPEG-4 Part 2", V_MJPEG: "Motion JPEG", A_AAC: "AAC", A_OPUS: "Opus", A_VORBIS: "Vorbis", "A_MPEG/L3": "MP3", "A_MPEG/L2": "MPEG audio L2",
  A_AC3: "Dolby AC-3", A_EAC3: "Dolby E-AC-3", A_FLAC: "FLAC", "A_PCM/INT/LIT": "PCM", S_TEXT_UTF8: "subtitulos SRT", "S_TEXT/UTF8": "subtitulos SRT",
};
const nombreCodec = (c) => (RP.NOMBRES_CODEC[c] ? `${RP.NOMBRES_CODEC[c]} (${c})` : c || "?");
const perfilH264 = (p, compat) => (p === 66 && compat & 0x40 ? "Constrained Baseline" : H264_PERFILES[p] || `perfil ${p}`);

// ---------------------------------------------------------------- MP4 / MOV
const CAJAS_CONTENEDOR = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf", "edts", "udta", "mvex", "moof", "traf", "mfra", "ilst", "tref", "sinf", "schi"]);
const ENTRADAS_VIDEO = new Set(["avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "vp08", "mp4v", "jpeg", "mjpa", "encv", "apcn", "apch", "apcs", "apco", "ap4h"]);
const ENTRADAS_AUDIO = new Set(["mp4a", "Opus", "ac-3", "ec-3", "fLaC", "alac", ".mp3", "lpcm", "sowt", "twos", "ulaw", "alaw", "samr", "sawb", "enca"]);

function leerDescriptor(u8, i) { // tag + longitud de 1 a 4 bytes (7 bits cada uno) de los descriptores MPEG-4
  const tag = u8[i]; let len = 0, k = i + 1;
  for (let n = 0; n < 4; n++) { const b = u8[k++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
  return { tag, len, datos: k };
}
function leerEsds(u8, d, fin, p) {
  let i = d + 4; // version + flags
  const es = leerDescriptor(u8, i); if (es.tag !== 3) return;
  i = es.datos + 2; const fl = u8[i++]; if (fl & 0x80) i += 2; if (fl & 0x40) i += 1 + u8[i]; if (fl & 0x20) i += 2;
  const dc = leerDescriptor(u8, i); if (dc.tag !== 4 || dc.datos >= fin) return;
  p.objectType = u8[dc.datos];
  const dv = new DataView(u8.buffer, u8.byteOffset);
  p.bitrateMax = dv.getUint32(dc.datos + 5); p.bitrateMedio = dv.getUint32(dc.datos + 9);
  const ds = leerDescriptor(u8, dc.datos + 13);
  if (ds.tag === 5 && ds.datos + 2 <= fin) {
    let aot = u8[ds.datos] >> 3, f = ((u8[ds.datos] & 7) << 1) | (u8[ds.datos + 1] >> 7), ch = (u8[ds.datos + 1] >> 3) & 15;
    if (aot === 31) aot = 32 + (((u8[ds.datos] & 7) << 3) | (u8[ds.datos + 1] >> 5));
    p.aac = { tipo: AAC_TIPOS[aot] || `tipo de objeto ${aot}`, frecuencia: AAC_FRECUENCIAS[f] || null, canales: ch || null };
  }
}

function analizarMp4(u8, filas, arbol) {
  const dv = new DataView(u8.buffer, u8.byteOffset), pistas = []; let pista = null, nodos = 0, cortado = false;
  const u64 = (i) => dv.getUint32(i) * 4294967296 + dv.getUint32(i + 4);
  const recorrer = (a, b, nivel) => {
    let i = a;
    while (i + 8 <= b) {
      let tam = dv.getUint32(i), cab = 8; const tipo = ascii4(u8, i + 4);
      if (tam === 1) { tam = u64(i + 8); cab = 16; } else if (tam === 0) tam = b - i;
      if (tam < cab || i + tam > b) { filas.push(["Estructura", "AVISO", `caja "${tipo}" en 0x${i.toString(16)} con tamano ${tam} fuera de su contenedor: fichero truncado o danado`]); return; }
      const d = i + cab, fin = i + tam;
      if (nodos++ < MAX_NODOS) arbol.push({ n: nivel, nombre: tipo, off: i, tam }); else cortado = true;
      if (tipo === "trak") { pista = { muestras: 0, bytes: 0 }; pistas.push(pista); }
      if (tipo === "tkhd" && pista) {
        const v = u8[d], m = d + (v ? 52 : 40); pista.id = dv.getUint32(d + (v ? 20 : 12));
        const a0 = dv.getInt32(m) / 65536, b0 = dv.getInt32(m + 4) / 65536;
        pista.rotacion = Math.round(-Math.atan2(b0, a0) * 180 / Math.PI + 360) % 360; // convencion de FFmpeg (av_display_rotation_get)
        pista.anchoPres = dv.getUint32(m + 36) / 65536; pista.altoPres = dv.getUint32(m + 40) / 65536;
      } else if (tipo === "mdhd" && pista) {
        const v = u8[d]; pista.escala = dv.getUint32(d + (v ? 20 : 12)); pista.duracion = v ? u64(d + 24) : dv.getUint32(d + 16);
      } else if (tipo === "hdlr" && pista && !pista.tipo) pista.tipo = ascii4(u8, d + 8);
      else if (tipo === "stsd" && pista) { recorrer(d + 8, fin, nivel + 1); i = fin; continue; }
      else if (pista && ENTRADAS_VIDEO.has(tipo)) {
        pista.codec = tipo; pista.ancho = dv.getUint16(d + 24); pista.alto = dv.getUint16(d + 26);
        recorrer(d + 78, fin, nivel + 1); i = fin; continue;
      } else if (pista && ENTRADAS_AUDIO.has(tipo)) {
        pista.codec = tipo; const ver = dv.getUint16(d + 8);
        pista.canales = dv.getUint16(d + 16); pista.bits = dv.getUint16(d + 18); pista.frecuencia = dv.getUint32(d + 24) / 65536;
        recorrer(d + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0), fin, nivel + 1); i = fin; continue;
      } else if (tipo === "avcC" && pista) {
        pista.perfil = perfilH264(u8[d + 1], u8[d + 2]); pista.nivel = u8[d + 3];
        pista.nivelTxt = (u8[d + 3] / 10).toFixed(1);
      } else if (tipo === "hvcC" && pista) {
        pista.perfil = HEVC_PERFILES[u8[d + 1] & 31] || `perfil ${u8[d + 1] & 31}`; pista.tier = u8[d + 1] & 32 ? "High" : "Main";
        pista.nivel = u8[d + 12]; pista.nivelTxt = (u8[d + 12] / 30).toFixed(1);
      } else if (tipo === "esds" && pista) leerEsds(u8, d, fin, pista);
      else if (tipo === "stsz" && pista) {
        const fijo = dv.getUint32(d + 4), n = dv.getUint32(d + 8); pista.muestras = n;
        if (fijo) pista.bytes = fijo * n; else { let s = 0; for (let k = 0; k < n && d + 12 + 4 * k + 4 <= fin; k++) s += dv.getUint32(d + 12 + 4 * k); pista.bytes = s; }
      } else if (tipo === "stss" && pista) pista.clave = dv.getUint32(d + 4);
      else if (tipo === "ftyp") filas.push(["Formato", "marca (ftyp)", `${ascii4(u8, d)} · compatibles ${Array.from({ length: (fin - d - 8) / 4 }, (_, k) => ascii4(u8, d + 8 + 4 * k)).join(" ")}`]);
      if (tipo === "meta") recorrer(d + (ascii4(u8, d + 4) === "hdlr" ? 0 : 4), fin, nivel + 1); // meta es FullBox en MP4, no en QuickTime
      else if (CAJAS_CONTENEDOR.has(tipo)) recorrer(d, fin, nivel + 1);
      i = fin;
    }
  };
  recorrer(0, u8.length, 0);
  if (cortado) filas.push(["Estructura", "nota", `arbol cortado en ${MAX_NODOS} cajas`]);
  pistas.forEach((p, k) => {
    const g = `Pista ${k + 1}${p.tipo ? ` (${{ vide: "video", soun: "audio", text: "texto", sbtl: "subtitulos", tmcd: "codigo de tiempo", meta: "metadatos" }[p.tipo] || p.tipo})` : ""}`;
    filas.push([g, "codec", nombreCodec(p.codec) + (p.perfil ? ` · perfil ${p.perfil}${p.tier ? ` (${p.tier} tier)` : ""}` : "") + (p.nivelTxt ? ` · nivel ${p.nivelTxt}` : "")]);
    if (p.aac) filas.push([g, "audio", `${p.aac.tipo}${p.aac.frecuencia ? ` · ${p.aac.frecuencia} Hz` : ""}${p.aac.canales ? ` · ${p.aac.canales} canales` : ""}`]);
    else if (p.tipo === "soun") filas.push([g, "audio", `${p.frecuencia} Hz · ${p.canales} canales · ${p.bits} bits por muestra (cabecera)`]);
    if (p.ancho) filas.push([g, "imagen", `${p.ancho} x ${p.alto} px${p.anchoPres && (p.anchoPres !== p.ancho || p.altoPres !== p.alto) ? ` (se presenta a ${p.anchoPres} x ${p.altoPres})` : ""}`]);
    if (p.rotacion) filas.push([g, "rotacion", `${p.rotacion}° (matriz de presentacion de tkhd, convencion de FFmpeg): el video se muestra girado`]);
    const seg = p.escala ? p.duracion / p.escala : 0;
    if (seg) filas.push([g, "duracion", `${seg.toFixed(3)} s`]);
    if (p.muestras) filas.push([g, "muestras", `${p.muestras}${p.clave != null ? ` · ${p.clave} fotogramas clave` : p.tipo === "vide" ? " · todos clave (sin stss)" : ""}${seg && p.tipo === "vide" ? ` · ${(p.muestras / seg).toFixed(3)} fps` : ""}`]);
    if (p.bytes && seg) filas.push([g, "bitrate", `${Math.round((p.bytes * 8) / seg / 1000)} kbit/s (${p.bytes} bytes de datos)`]);
  });
  return pistas;
}

// ---------------------------------------------------------------- Matroska / WebM
const EBML_NOMBRES = { 0x1a45dfa3: "EBML", 0x18538067: "Segment", 0x114d9b74: "SeekHead", 0x1549a966: "Info", 0x1654ae6b: "Tracks", 0x1f43b675: "Cluster",
  0x1c53bb6b: "Cues", 0x1254c367: "Tags", 0x1941a469: "Attachments", 0x1043a770: "Chapters", 0xec: "Void" };
function vint(u8, i, quitarMarca) {
  const b = u8[i]; let n = 1; while (n <= 8 && !(b & (0x80 >> (n - 1)))) n++;
  if (n > 8) return null;
  let v = quitarMarca ? b & (0xff >> n) : b, todosUnos = (b & (0xff >> n)) === (0xff >> n);
  for (let k = 1; k < n; k++) { v = v * 256 + u8[i + k]; if (u8[i + k] !== 0xff) todosUnos = false; }
  return { v, n, desconocido: quitarMarca && todosUnos };
}
function analizarMkv(u8, filas, arbol) {
  const dv = new DataView(u8.buffer, u8.byteOffset), pistas = []; let clusters = 0, nodos = 0;
  const elementos = (a, b, fn) => {
    let i = a;
    while (i < b) {
      const id = vint(u8, i, false); if (!id) return; const tm = vint(u8, i + id.n, true); if (!tm) return;
      const d = i + id.n + tm.n, fin = tm.desconocido ? b : Math.min(b, d + tm.v);
      fn(id.v, d, fin, i); i = fin;
    }
  };
  const uint = (d, fin) => { let v = 0; for (let k = d; k < fin; k++) v = v * 256 + u8[k]; return v; };
  const txt = (d, fin) => String.fromCharCode(...u8.subarray(d, fin)).replace(/\0+$/, "");
  const flt = (d, fin) => (fin - d === 4 ? dv.getFloat32(d) : dv.getFloat64(d));
  elementos(0, u8.length, (id, d, fin, i) => {
    if (nodos++ < MAX_NODOS) arbol.push({ n: 0, nombre: EBML_NOMBRES[id] || `0x${id.toString(16)}`, off: i, tam: fin - i });
    if (id === 0x1a45dfa3) elementos(d, fin, (s, a, b) => { if (s === 0x4282) filas.push(["Formato", "DocType", txt(a, b)]); });
    if (id !== 0x18538067) return;
    elementos(d, fin, (s, a, b, j) => {
      if (s === 0x1f43b675) { clusters++; return; }
      if (nodos++ < MAX_NODOS) arbol.push({ n: 1, nombre: EBML_NOMBRES[s] || `0x${s.toString(16)}`, off: j, tam: b - j });
      if (s === 0x1549a966) elementos(a, b, (t, x, y) => { if (t === 0x4d80) filas.push(["Formato", "MuxingApp", txt(x, y)]); else if (t === 0x5741) filas.push(["Formato", "WritingApp", txt(x, y)]); });
      if (s !== 0x1654ae6b) return;
      elementos(a, b, (t, x, y) => {
        if (t !== 0xae) return; const p = {}; pistas.push(p);
        elementos(x, y, (c, e, f) => {
          if (c === 0x86) p.codec = txt(e, f); else if (c === 0x83) p.tipo = uint(e, f);
          else if (c === 0x63a2) p.priv = [e, f];
          else if (c === 0xe0) elementos(e, f, (v, g, h) => { if (v === 0xb0) p.ancho = uint(g, h); else if (v === 0xba) p.alto = uint(g, h); });
          else if (c === 0xe1) elementos(e, f, (v, g, h) => { if (v === 0xb5) p.frecuencia = flt(g, h); else if (v === 0x9f) p.canales = uint(g, h); else if (v === 0x6264) p.bits = uint(g, h); });
        });
        if (p.priv && /AVC/.test(p.codec || "")) { const [e] = p.priv; p.perfil = perfilH264(u8[e + 1], u8[e + 2]); p.nivelTxt = (u8[e + 3] / 10).toFixed(1); p.nivel = u8[e + 3]; }
      });
    });
  });
  filas.push(["Estructura", "clusters", String(clusters)]);
  pistas.forEach((p, k) => {
    const g = `Pista ${k + 1} (${{ 1: "video", 2: "audio", 17: "subtitulos" }[p.tipo] || p.tipo || "?"})`;
    filas.push([g, "codec", nombreCodec(p.codec) + (p.perfil ? ` · perfil ${p.perfil} · nivel ${p.nivelTxt}` : "")]);
    if (p.ancho) filas.push([g, "imagen", `${p.ancho} x ${p.alto} px`]);
    if (p.frecuencia) filas.push([g, "audio", `${p.frecuencia} Hz · ${p.canales || 1} canales${p.bits ? ` · ${p.bits} bits` : ""}`]);
  });
  return pistas;
}

// ---------------------------------------------------------------- RIFF (WAV, AVI, WEBP)
const WAV_FORMATOS = { 1: "PCM", 3: "PCM en coma flotante", 6: "G.711 A-law", 7: "G.711 mu-law", 0x11: "IMA ADPCM", 0x55: "MP3", 0xfffe: "extensible" };
function analizarRiff(u8, filas, arbol) {
  const dv = new DataView(u8.buffer, u8.byteOffset), forma = ascii4(u8, 8), pistas = [];
  filas.push(["Formato", "RIFF", forma]);
  let byteRate = 0, nodos = 0;
  const bloques = (a, b, nivel) => {
    let i = a;
    while (i + 8 <= b) {
      const id = ascii4(u8, i), tam = dv.getUint32(i + 4, true), d = i + 8, fin = Math.min(b, d + tam);
      if (nodos++ < MAX_NODOS) arbol.push({ n: nivel, nombre: id === "LIST" ? `LIST ${ascii4(u8, d)}` : id, off: i, tam: tam + 8 });
      if (id === "LIST") bloques(d + 4, fin, nivel + 1);
      else if (id === "fmt ") {
        const f = dv.getUint16(d, true), p = { codec: WAV_FORMATOS[f] || `formato 0x${f.toString(16)}`, canales: dv.getUint16(d + 2, true), frecuencia: dv.getUint32(d + 4, true), bits: dv.getUint16(d + 14, true) };
        byteRate = dv.getUint32(d + 8, true); pistas.push(p);
        filas.push(["Pista 1 (audio)", "codec", `${p.codec} · ${p.frecuencia} Hz · ${p.canales} canales · ${p.bits} bits`]);
      } else if (id === "data" && byteRate) filas.push(["Pista 1 (audio)", "duracion", `${(tam / byteRate).toFixed(3)} s (${tam} bytes de audio)`]);
      else if (id === "strh") pistas.push({ tipo: ascii4(u8, d), codec: ascii4(u8, d + 4).replace(/\0/g, "") }) && filas.push([`Pista ${pistas.length}`, ascii4(u8, d) === "vids" ? "video" : "audio", nombreCodec(ascii4(u8, d + 4).replace(/\0/g, ""))]);
      else if (/^VP8[ LX]$/.test(id)) filas.push(["Formato", "WebP", { "VP8 ": "con perdida (VP8)", VP8L: "sin perdida (VP8L)", VP8X: "extendido (VP8X: alfa, animacion o metadatos)" }[id]]);
      i = d + tam + (tam & 1);
    }
  };
  bloques(12, u8.length, 0);
  return pistas;
}

// ---------------------------------------------------------------- JPEG
const SOF_TIPOS = { 0xc0: "baseline (DCT secuencial)", 0xc1: "DCT secuencial extendido", 0xc2: "progresivo", 0xc3: "sin perdida", 0xc5: "diferencial secuencial",
  0xc6: "diferencial progresivo", 0xc7: "diferencial sin perdida", 0xc9: "secuencial aritmetico", 0xca: "progresivo aritmetico", 0xcb: "sin perdida aritmetico" };
function submuestreo(comps) {
  if (comps.length < 3) return comps.length === 1 ? "escala de grises (1 componente)" : `${comps.length} componentes`;
  const [y, cb] = comps, h = y.h / cb.h, v = y.v / cb.v;
  return ({ "1,1": "4:4:4", "2,1": "4:2:2", "2,2": "4:2:0", "4,1": "4:1:1", "1,2": "4:4:0" }[`${h},${v}`] || `${h}x${v}`) + ` (Y ${y.h}x${y.v}, Cb ${cb.h}x${cb.v})`;
}
function analizarJpeg(u8, filas, arbol) {
  const dv = new DataView(u8.buffer, u8.byteOffset); let i = 2, escaneos = 0, nodos = 0;
  arbol.push({ n: 0, nombre: "SOI", off: 0, tam: 2 });
  while (i + 4 <= u8.length) {
    if (u8[i] !== 0xff) { i++; continue; }
    const m = u8[i + 1];
    if (m === 0xff || (m >= 0xd0 && m <= 0xd7) || m === 0x00 || m === 0x01) { i += m === 0xff ? 1 : 2; continue; }
    if (m === 0xd9) { arbol.push({ n: 0, nombre: "EOI", off: i, tam: 2 }); filas.push(["Estructura", "fin (EOI)", `0x${i.toString(16)}${i + 2 < u8.length ? ` · ${u8.length - i - 2} bytes despues` : ""}`]); break; }
    const L = dv.getUint16(i + 2), d = i + 4;
    let nombre = m >= 0xe0 && m <= 0xef ? `APP${m - 0xe0}` : SOF_TIPOS[m] ? `SOF${m - 0xc0}` : { 0xdb: "DQT", 0xc4: "DHT", 0xdd: "DRI", 0xda: "SOS", 0xfe: "COM" }[m] || `FF${m.toString(16).toUpperCase()}`;
    if (m >= 0xe0 && m <= 0xef) {
      let z = d; while (z < d + Math.min(L - 2, 40) && u8[z]) z++;
      const idt = String.fromCharCode(...u8.subarray(d, z)).replace(/[^\x20-\x7e]/g, "");
      if (idt) nombre += ` ${idt.length > 28 ? idt.slice(0, 28) + "…" : idt}`;
    }
    if (nodos++ < MAX_NODOS) arbol.push({ n: 0, nombre, off: i, tam: L + 2 });
    if (SOF_TIPOS[m]) {
      const n = u8[d + 5], comps = [];
      for (let k = 0; k < n; k++) comps.push({ id: u8[d + 6 + 3 * k], h: u8[d + 7 + 3 * k] >> 4, v: u8[d + 7 + 3 * k] & 15 });
      filas.push(["Imagen", "codificacion", `${SOF_TIPOS[m]} (SOF${m - 0xc0}) · ${u8[d]} bits`]);
      filas.push(["Imagen", "tamano", `${dv.getUint16(d + 3)} x ${dv.getUint16(d + 1)} px · ${n} componentes`]);
      filas.push(["Imagen", "submuestreo de color", submuestreo(comps)]);
    } else if (m === 0xdd) filas.push(["Imagen", "intervalo de reinicio (DRI)", `${dv.getUint16(d)} MCU`]);
    if (m === 0xda) { // datos entropicos hasta el siguiente marcador que no sea relleno ni RSTn
      escaneos++; i = d + L - 2;
      while (i + 1 < u8.length && !(u8[i] === 0xff && u8[i + 1] !== 0x00 && !(u8[i + 1] >= 0xd0 && u8[i + 1] <= 0xd7))) i++;
      continue;
    }
    i = d + L - 2;
  }
  filas.push(["Imagen", "escaneos (SOS)", `${escaneos}${escaneos > 1 ? " (progresivo o multiescaneo)" : ""}`]);
  return [];
}

// ---------------------------------------------------------------- PNG
const PNG_COLOR = { 0: "gris", 2: "RGB", 3: "paleta", 4: "gris + alfa", 6: "RGBA" };
function analizarPng(u8, filas, arbol) {
  const dv = new DataView(u8.buffer, u8.byteOffset); let i = 8, idat = 0, bytesIdat = 0, malCrc = 0, nodos = 0;
  while (i + 12 <= u8.length) {
    const L = dv.getUint32(i), tipo = ascii4(u8, i + 4), fin = i + 12 + L;
    if (fin > u8.length) { filas.push(["Estructura", "AVISO", `bloque ${tipo} en 0x${i.toString(16)} truncado`]); break; }
    const ok = RP.crc32 ? RP.crc32(u8.subarray(i + 4, i + 8 + L)) === dv.getUint32(i + 8 + L).toString(16).padStart(8, "0") : null;
    if (ok === false) malCrc++;
    if (tipo === "IDAT") { idat++; bytesIdat += L; } else if (nodos++ < MAX_NODOS) arbol.push({ n: 0, nombre: tipo, off: i, tam: L + 12, info: ok === false ? "CRC INCORRECTO" : "" });
    if (tipo === "IHDR") {
      const d = i + 8;
      filas.push(["Imagen", "tamano", `${dv.getUint32(d)} x ${dv.getUint32(d + 4)} px`]);
      filas.push(["Imagen", "color", `${PNG_COLOR[u8[d + 9]] || u8[d + 9]} · ${u8[d + 8]} bits por canal · ${u8[d + 12] ? "entrelazado Adam7" : "sin entrelazar"}`]);
    }
    i = fin;
    if (tipo === "IEND") break;
  }
  arbol.push({ n: 0, nombre: `IDAT x${idat}`, off: null, tam: bytesIdat });
  filas.push(["Estructura", "bloques IDAT", `${idat} (${bytesIdat} bytes de imagen comprimida)`]);
  filas.push(["Estructura", "CRC", malCrc ? `${malCrc} bloques con CRC INCORRECTO: fichero modificado o danado` : "todos correctos"]);
  return [];
}

// ---------------------------------------------------------------- principal
RP.analizarEstructura = (u8, tipo) => {
  const filas = [], arbol = [];
  let pistas = [];
  try {
    if (tipo === "MP4/ISO-BMFF") pistas = analizarMp4(u8, filas, arbol);
    else if (tipo === "MKV/WebM") pistas = analizarMkv(u8, filas, arbol);
    else if (tipo === "WEBP/RIFF") pistas = analizarRiff(u8, filas, arbol);
    else if (tipo === "JPEG") analizarJpeg(u8, filas, arbol);
    else if (tipo === "PNG") analizarPng(u8, filas, arbol);
  } catch (e) { filas.push(["Estructura", "AVISO", `analisis interrumpido: ${e.message} (fichero danado o variante no prevista)`]); }
  return { formato: tipo, filas, arbol, pistas, entropia: RP.entropia(u8) };
};

RP.informeEstructura = (r, analisis) => {
  const L = [];
  if (analisis && analisis.extensionCoincide === false) L.push(`AVISO: la extension .${analisis.extension} no corresponde al contenido (${analisis.tipo})`, "");
  let grupo = null;
  for (const [g, c, v] of r.filas) { if (g !== grupo) { L.push(`— ${g} —`); grupo = g; } L.push(`  ${c}: ${v}`); }
  const e = r.entropia;
  L.push("", `— Entropia —`, `  global: ${e.global} bits por byte (maximo 8)${e.global > 7.9 ? " · casi maxima: datos comprimidos o cifrados" : e.global < 5 ? " · baja: datos sin comprimir o repetitivos" : ""}`,
    `  por bloques de ${e.tamBloque} bytes: minima ${Math.min(...e.porBloque)} · maxima ${Math.max(...e.porBloque)} (grafico abajo)`);
  if (r.arbol.length) {
    L.push("", `— Estructura (${r.arbol.length} elementos: desplazamiento, tamano) —`);
    for (const x of r.arbol) L.push(`${"  ".repeat(x.n + 1)}${x.nombre}${x.off != null ? `  @0x${x.off.toString(16)}` : ""}  ${x.tam} B${x.info ? "  " + x.info : ""}`);
  }
  return L.join("\n");
};
