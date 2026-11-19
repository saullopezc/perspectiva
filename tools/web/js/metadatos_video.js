// -----------------------------------------------------------------------------
// metadatos_video.js — Metadatos de contenedores de video: ISO-BMFF (MP4/MOV/3GP:
// ftyp, mvhd, tkhd, mdhd, hdlr, stsd, stts, udta, keys/ilst con ubicacion ISO 6709)
// y Matroska/WebM (EBML: Info, Tracks, Tags). Devuelven, ademas de las filas, los fps
// declarados por el contenedor para la captura de fotogramas.
// Author: Saul López
// Date:   2026-11-15
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

const segundosAFecha = (s, epocaMs) => { const d = new Date(epocaMs + s * 1000); return isNaN(d) ? String(s) : d.toISOString(); };
const EPOCA_1904 = Date.UTC(1904, 0, 1), EPOCA_2001 = Date.UTC(2001, 0, 1);
const CONTENEDORES = new Set(["moov", "trak", "mdia", "minf", "stbl", "udta", "edts", "dinf", "ilst", "meta", "moof", "traf", "mvex"]);

// ============================================================ ISO-BMFF
RP.metadatosIso = (u8, filas) => {
  const { latin1, utf8, corta } = RP.mdTexto, dv = new DataView(u8.buffer, u8.byteOffset);
  const pistas = []; let pista = null, claves = [], orden = [];
  const u64 = (i) => dv.getUint32(i) * 4294967296 + dv.getUint32(i + 4);
  const caja = (a, b, ruta) => {
    for (let i = a, n = 0; i + 8 <= b && n < 5000; n++) {
      let tam = dv.getUint32(i), cab = 8; const nom = latin1(u8, i + 4, i + 8);
      if (tam === 1) { tam = u64(i + 8); cab = 16; } else if (tam === 0) tam = b - i;
      // en ilst con 'keys' (QuickTime) los hijos se llaman por indice binario (00 00 00 01...)
      if (tam < cab || i + tam > b + 8 || (!/^[\x20-\x7e\xa9]{4}$/.test(nom) && !ruta.endsWith("ilst"))) break;
      const d = i + cab, fin = Math.min(b, i + tam), r = ruta ? ruta + "/" + nom : nom;
      if (!ruta) orden.push(`${nom}${nom === "mdat" ? `(${tam} B)` : ""}`);
      if (nom === "ftyp") filas.push(["MP4", "ftyp", `marca ${latin1(u8, d, d + 4)} v${dv.getUint32(d + 4)} · compatibles ${latin1(u8, d + 8, fin).match(/.{4}/g)?.join(" ") || ""}`]);
      else if (nom === "mvhd") {
        const v = u8[d], o = d + 4, [cre, mod, ts, dur] = v ? [u64(o), u64(o + 8), dv.getUint32(o + 16), u64(o + 20)] : [dv.getUint32(o), dv.getUint32(o + 4), dv.getUint32(o + 8), dv.getUint32(o + 12)];
        filas.push(["MP4", "creacion (mvhd, UTC)", cre ? segundosAFecha(cre, EPOCA_1904) : "0 (sin fecha)"]);
        filas.push(["MP4", "modificacion (mvhd, UTC)", mod ? segundosAFecha(mod, EPOCA_1904) : "0 (sin fecha)"]);
        filas.push(["MP4", "duracion", ts ? `${(dur / ts).toFixed(3)} s (escala ${ts})` : "?"]);
      } else if (nom === "tkhd") { pista = { id: dv.getUint32(d + (u8[d] ? 20 : 12)), w: dv.getUint32(fin - 8) / 65536, h: dv.getUint32(fin - 4) / 65536 }; pistas.push(pista); }
      else if (nom === "mdhd" && pista) {
        const v = u8[d], o = d + 4; pista.ts = dv.getUint32(o + (v ? 16 : 8)); pista.dur = v ? u64(o + 20) : dv.getUint32(o + 12);
        const l = dv.getUint16(o + (v ? 28 : 16)); pista.idioma = String.fromCharCode(((l >> 10) & 31) + 96, ((l >> 5) & 31) + 96, (l & 31) + 96);
      } else if (nom === "hdlr" && pista && ruta.endsWith("mdia")) { pista.tipo = latin1(u8, d + 8, d + 12); pista.nombre = utf8(u8, d + 24, fin).replace(/\0+$/, ""); }
      else if (nom === "stsd" && pista) { pista.codec = latin1(u8, d + 12, d + 16); if (pista.tipo === "vide") { pista.cw = dv.getUint16(d + 8 + 32); pista.ch = dv.getUint16(d + 8 + 34); } }
      else if (nom === "stts" && pista) {
        const n2 = dv.getUint32(d + 4); let mues = 0; const deltas = new Set();
        for (let k = 0; k < Math.min(n2, 100000); k++) { mues += dv.getUint32(d + 8 + k * 8); deltas.add(dv.getUint32(d + 12 + k * 8)); }
        pista.muestras = mues; pista.deltas = [...deltas];
      } else if (nom === "keys") {
        const n2 = dv.getUint32(d + 4); claves = [];
        for (let k = 0, p = d + 8; k < n2 && p + 8 <= fin; k++) { const t = dv.getUint32(p); claves.push(latin1(u8, p + 8, p + t)); p += t; }
      } else if (ruta.endsWith("ilst")) { // elemento de metadatos: hijo 'data' con tipo, locale y valor
        const t = dv.getUint32(d), dn = latin1(u8, d + 4, d + 8);
        if (dn === "data") {
          const tipoD = dv.getUint32(d + 8) & 0xffffff, val = u8.subarray(d + 16, d + t), k = dv.getUint32(i + 4);
          const clave = /^[\x20-\x7e\xa9]{4}$/.test(nom) && !(claves.length && k >= 1 && k <= claves.length) ? nom : claves[k - 1] || nom;
          filas.push(["MP4 metadatos", clave, corta(tipoD === 1 ? utf8(val) : tipoD === 21 || tipoD === 22 ? String(val.reduce((s, x) => s * 256 + x, 0)) : `(${val.length} B tipo ${tipoD})`)]);
        }
      } else if (ruta.endsWith("udta") && nom === "loci") { // 3GPP: FullBox + idioma + nombre\0 + rol + lon/lat/alt 16.16
        const z = u8.indexOf(0, d + 6), p = z + 2, lon = dv.getInt32(p) / 65536, lat = dv.getInt32(p + 4) / 65536, alt = dv.getInt32(p + 8) / 65536;
        filas.push(["MP4 udta", "loci (ubicacion 3GPP)", `${lat.toFixed(6)}, ${lon.toFixed(6)} · alt ${alt.toFixed(1)} m${z > d + 6 ? ` · "${utf8(u8, d + 6, z)}"` : ""}  (geo:${lat.toFixed(6)},${lon.toFixed(6)})`]);
      } else if (ruta.endsWith("udta") && /^(titl|auth|dscp|perf|gnre|cprt|albm|kywd)$/.test(nom)) { // 3GPP: FullBox + idioma + texto
        filas.push(["MP4 udta", nom, corta(utf8(u8, d + 6, fin).replace(/\0+$/, ""))]);
      } else if (ruta.endsWith("udta") && nom.charCodeAt(0) === 0xa9) { // ©xyz, ©day, ©too... (QuickTime: tamano + idioma + texto)
        const ln = dv.getUint16(d); filas.push(["MP4 udta", nom, corta(ln && ln <= fin - d - 4 ? utf8(u8, d + 4, d + 4 + ln) : latin1(u8, d, fin).replace(/[^\x20-\x7e]/g, ""))]);
      }
      if (CONTENEDORES.has(nom)) {
        const esCompleta = nom === "meta" && dv.getUint32(d) === 0; // ISO: FullBox; QuickTime: caja normal
        caja(d + (esCompleta ? 4 : 0), fin, r);
      }
      i += tam;
    }
  };
  caja(0, u8.length, "");
  filas.push(["MP4", "cajas de primer nivel", orden.join(" ") + (orden.indexOf("moov") > orden.findIndex((x) => x.startsWith("mdat")) ? " (moov al final: no es faststart)" : "")]);
  let fps = null;
  pistas.forEach((p, k) => {
    const dur = p.ts ? p.dur / p.ts : 0;
    filas.push([`MP4 pista ${k + 1}`, p.tipo || "?", `${p.codec || "?"} · idioma ${p.idioma || "?"}${p.nombre ? ` · "${p.nombre}"` : ""}${p.w ? ` · ${p.w}x${p.h}` : ""} · ${dur.toFixed(3)} s`]);
    if (p.tipo === "vide" && p.muestras && dur) {
      const constante = p.deltas.length === 1, f = constante ? p.ts / p.deltas[0] : p.muestras / dur;
      filas.push([`MP4 pista ${k + 1}`, "fotogramas", `${p.muestras} · ${f.toFixed(3)} fps ${constante ? "(constante)" : "(VARIABLE: media)"}`]);
      if (!fps) fps = { fps: f, constante, fotogramas: p.muestras, fuente: "stts del contenedor" };
    }
  });
  return fps;
};

// ============================================================ Matroska / WebM (EBML)
const EBML = {
  0x1a45dfa3: ["EBML", "m"], 0x4282: ["DocType", "s"], 0x4287: ["DocTypeVersion", "u"], 0x18538067: ["Segment", "m"],
  0x1549a966: ["Info", "m"], 0x2ad7b1: ["TimestampScale", "u"], 0x4489: ["Duration", "f"], 0x4461: ["DateUTC", "d"],
  0x7ba9: ["Title", "8"], 0x4d80: ["MuxingApp", "8"], 0x5741: ["WritingApp", "8"], 0x1654ae6b: ["Tracks", "m"], 0xae: ["TrackEntry", "m"],
  0xd7: ["TrackNumber", "u"], 0x83: ["TrackType", "u"], 0x86: ["CodecID", "s"], 0x536e: ["Name", "8"], 0x22b59c: ["Language", "s"],
  0x23e383: ["DefaultDuration", "u"], 0xe0: ["Video", "m"], 0xb0: ["PixelWidth", "u"], 0xba: ["PixelHeight", "u"], 0xe1: ["Audio", "m"],
  0xb5: ["SamplingFrequency", "f"], 0x9f: ["Channels", "u"], 0x1254c367: ["Tags", "m"], 0x7373: ["Tag", "m"], 0x67c8: ["SimpleTag", "m"],
  0x45a3: ["TagName", "8"], 0x4487: ["TagString", "8"], 0x1f43b675: ["Cluster", "x"], 0x1c53bb6b: ["Cues", "x"], 0x114d9b74: ["SeekHead", "x"],
  0x1941a469: ["Attachments", "m"], 0x61a7: ["AttachedFile", "m"], 0x466e: ["FileName", "8"], 0x4660: ["FileMediaType", "s"],
};
RP.metadatosEbml = (u8, filas) => {
  const { latin1, utf8, corta } = RP.mdTexto, dv = new DataView(u8.buffer, u8.byteOffset);
  const vint = (i, conMarca) => {
    const b = u8[i]; let n = 1; while (n <= 8 && !(b & (0x80 >> (n - 1)))) n++;
    if (n > 8) return null;
    let v = conMarca ? b : b & (0xff >> n), todosUnos = (b & (0xff >> n)) === (0xff >> n);
    for (let k = 1; k < n; k++) { v = v * 256 + u8[i + k]; if (u8[i + k] !== 0xff) todosUnos = false; }
    return { v, n, desconocido: !conMarca && todosUnos };
  };
  const pistas = []; let escala = 1e6, duracion = null, pista = null, tag = null;
  const leer = (a, b, prof) => {
    for (let i = a, n = 0; i < b && n < 20000; n++) {
      const id = vint(i, true); if (!id) return; const tm = vint(i + id.n, false); if (!tm) return;
      const d = i + id.n + tm.n, fin = tm.desconocido ? b : Math.min(b, d + tm.v), def = EBML[id.v];
      if (def) {
        const [nom, t] = def;
        const uint = () => { let v = 0; for (let k = d; k < fin; k++) v = v * 256 + u8[k]; return v; };
        const val = t === "u" ? uint() : t === "s" ? latin1(u8, d, fin).replace(/\0+$/, "") : t === "8" ? utf8(u8, d, fin).replace(/\0+$/, "")
          : t === "f" ? (fin - d === 4 ? dv.getFloat32(d) : dv.getFloat64(d)) : t === "d" ? new Date(EPOCA_2001 + Number(dv.getBigInt64(d) / 1000000n)).toISOString() : null;
        if (nom === "TrackEntry") { pista = {}; pistas.push(pista); }
        if (nom === "SimpleTag") { tag = {}; }
        if (t === "x") { if (tm.desconocido) return; i = fin; continue; } // clusters/indices: se saltan
        if (t === "m") leer(d, fin, prof + 1);
        else if (nom === "TimestampScale") escala = val;
        else if (nom === "Duration") duracion = val;
        else if (/^(DocType|DocTypeVersion|DateUTC|Title|MuxingApp|WritingApp)$/.test(nom)) filas.push(["MKV/WebM", nom, corta(String(val))]);
        else if (nom === "TagName" && tag) tag.n = val;
        else if (nom === "TagString" && tag) { tag.v = val; filas.push(["MKV/WebM etiquetas", tag.n || "?", corta(val)]); }
        else if (nom === "FileName") filas.push(["MKV/WebM adjuntos", "fichero", corta(val)]);
        else if (pista && /^(TrackNumber|TrackType|CodecID|Name|Language|DefaultDuration|PixelWidth|PixelHeight|SamplingFrequency|Channels)$/.test(nom)) pista[nom] = val;
      }
      if (tm.desconocido && !def) return;
      i = fin;
    }
  };
  leer(0, u8.length, 0);
  if (duracion != null) filas.push(["MKV/WebM", "duracion", `${((duracion * escala) / 1e9).toFixed(3)} s`]);
  let fps = null;
  pistas.forEach((p) => {
    const tipo = { 1: "video", 2: "audio", 17: "subtitulos" }[p.TrackType] || p.TrackType;
    filas.push([`MKV/WebM pista ${p.TrackNumber ?? "?"}`, String(tipo), `${p.CodecID || "?"}${p.Name ? ` · "${p.Name}"` : ""}${p.Language ? " · " + p.Language : ""}${p.PixelWidth ? ` · ${p.PixelWidth}x${p.PixelHeight}` : ""}${p.SamplingFrequency ? ` · ${p.SamplingFrequency} Hz x${p.Channels || 1}` : ""}${p.DefaultDuration ? ` · ${(1e9 / p.DefaultDuration).toFixed(3)} fps (DefaultDuration)` : ""}`]);
    if (p.TrackType === 1 && p.DefaultDuration && !fps) fps = { fps: 1e9 / p.DefaultDuration, constante: true, fotogramas: null, fuente: "DefaultDuration del contenedor" };
  });
  return fps;
};
