// -----------------------------------------------------------------------------
// metadatos.js — Metadatos de fichero sin dependencias: EXIF/TIFF (IFD0, Exif, GPS,
// miniatura), JPEG (segmentos, COM, IPTC), PNG (chunks, texto, CRC), GIF, RIFF
// (WEBP/AVI/WAV), BMP, PDF (Info, actualizaciones, acciones), ZIP (directorio y
// docProps de Office) y paquetes XMP en cualquier fichero. Los contenedores de video
// (MP4/MOV, MKV/WebM) estan en metadatos_video.js.
// Devuelve filas [grupo, clave, valor] y los fragmentos que se pueden abrir como imagen.
// Author: Saul López
// Date:   2026-11-15
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// latin1 exacto (byte -> mismo codigo), por bloques: TextDecoder("latin1") es en realidad windows-1252
const latin1 = (u8, a = 0, b = u8.length) => { let s = ""; for (let i = a; i < b; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(b, i + 32768))); return s; };
// busqueda de una secuencia ASCII sin convertir el fichero entero a texto
const buscarAscii = (u8, txt, desde = 0) => {
  const p = [...txt].map((c) => c.charCodeAt(0));
  for (let i = u8.indexOf(p[0], desde); i >= 0 && i + p.length <= u8.length; i = u8.indexOf(p[0], i + 1)) if (p.every((b, k) => u8[i + k] === b)) return i;
  return -1;
};
const utf8 = (u8, a = 0, b = u8.length) => new TextDecoder("utf-8").decode(u8.subarray(a, b));
const corta = (s, n = 300) => (s.length > n ? s.slice(0, n) + `… (${s.length} caracteres)` : s);
RP.mdTexto = { latin1, utf8, corta, buscarAscii };

// inflado con la API del navegador (zTXt/iTXt de PNG, entradas de ZIP)
RP.inflar = async (u8, formato = "deflate") => {
  const ds = new DecompressionStream(formato), w = ds.writable.getWriter();
  w.write(u8).catch(() => {}); w.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
};

let TABLA_CRC = null;
const crc32 = (u8, a, b) => {
  if (!TABLA_CRC) { TABLA_CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLA_CRC[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = a; i < b; i++) c = TABLA_CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// ============================================================ EXIF / TIFF
const TAGS = {
  0x010e: "ImageDescription", 0x010f: "Make", 0x0110: "Model", 0x0112: "Orientation", 0x011a: "XResolution", 0x011b: "YResolution",
  0x0128: "ResolutionUnit", 0x0131: "Software", 0x0132: "DateTime", 0x013b: "Artist", 0x013c: "HostComputer", 0x8298: "Copyright",
  0x0100: "ImageWidth", 0x0101: "ImageLength", 0x0102: "BitsPerSample", 0x0103: "Compression", 0x0106: "PhotometricInterpretation",
  0x0111: "StripOffsets", 0x0115: "SamplesPerPixel", 0x0116: "RowsPerStrip", 0x0117: "StripByteCounts", 0x011c: "PlanarConfiguration",
  0x0213: "YCbCrPositioning", 0x02bc: "XMLPacket (XMP)", 0x83bb: "IPTC-NAA", 0x8773: "ICCProfile", 0xa300: "FileSource", 0xa301: "SceneType", 0x0201: "ThumbnailOffset", 0x0202: "ThumbnailLength",
  0x829a: "ExposureTime", 0x829d: "FNumber", 0x8822: "ExposureProgram", 0x8827: "ISO", 0x9000: "ExifVersion",
  0x9003: "DateTimeOriginal", 0x9004: "DateTimeDigitized", 0x9010: "OffsetTime", 0x9011: "OffsetTimeOriginal", 0x9012: "OffsetTimeDigitized",
  0x9201: "ShutterSpeedValue", 0x9202: "ApertureValue", 0x9204: "ExposureBiasValue", 0x9207: "MeteringMode", 0x9209: "Flash",
  0x920a: "FocalLength", 0x927c: "MakerNote", 0x9286: "UserComment", 0x9290: "SubSecTime", 0x9291: "SubSecTimeOriginal", 0x9292: "SubSecTimeDigitized",
  0x9c9b: "XPTitle", 0x9c9c: "XPComment", 0x9c9d: "XPAuthor", 0x9c9e: "XPKeywords", 0x9c9f: "XPSubject", 0x4746: "Rating",
  0xa001: "ColorSpace", 0xa002: "PixelXDimension", 0xa003: "PixelYDimension", 0xa402: "ExposureMode", 0xa403: "WhiteBalance",
  0xa405: "FocalLengthIn35mmFilm", 0xa420: "ImageUniqueID", 0xa430: "CameraOwnerName", 0xa431: "BodySerialNumber",
  0xa432: "LensSpecification", 0xa433: "LensMake", 0xa434: "LensModel", 0xa435: "LensSerialNumber", 0x8769: "ExifIFD", 0x8825: "GPSIFD", 0xa005: "InteropIFD",
};
const TAGS_GPS = {
  0: "GPSVersionID", 1: "GPSLatitudeRef", 2: "GPSLatitude", 3: "GPSLongitudeRef", 4: "GPSLongitude", 5: "GPSAltitudeRef", 6: "GPSAltitude",
  7: "GPSTimeStamp", 8: "GPSSatellites", 0x0c: "GPSSpeedRef", 0x0d: "GPSSpeed", 0x10: "GPSImgDirectionRef", 0x11: "GPSImgDirection",
  0x12: "GPSMapDatum", 0x1b: "GPSProcessingMethod", 0x1d: "GPSDateStamp",
};
const TAM_TIPO = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

RP.esTiff = (u8, i) => (u8[i] === 0x49 && u8[i + 1] === 0x49 && u8[i + 2] === 0x2a && u8[i + 3] === 0) || (u8[i] === 0x4d && u8[i + 1] === 0x4d && u8[i + 2] === 0 && u8[i + 3] === 0x2a);
// t0: offset absoluto del inicio del TIFF dentro del fichero (los offsets EXIF son relativos a el)
RP.leerTiff = (u8, t0, filas, grupo = "EXIF", incrustables = []) => {
  if (t0 + 8 > u8.length) return false;
  const le = u8[t0] === 0x49 && u8[t0 + 1] === 0x49;
  if (!le && !(u8[t0] === 0x4d && u8[t0 + 1] === 0x4d)) return false;
  const dv = new DataView(u8.buffer, u8.byteOffset);
  const u16 = (i) => dv.getUint16(t0 + i, le), u32 = (i) => dv.getUint32(t0 + i, le), s32 = (i) => dv.getInt32(t0 + i, le);
  if (u16(2) !== 42) return false;
  const lim = u8.length - t0, vistos = new Set();
  const valor = (tipo, n, off) => {
    const tam = TAM_TIPO[tipo] || 1, abs = t0 + off;
    if (off + tam * n > lim) return "(fuera del fichero)";
    if (tipo === 2) return latin1(u8, abs, abs + n).replace(/\0+$/, "");
    if (tipo === 7 || tipo === 1) return n <= 16 ? [...u8.subarray(abs, abs + n)] : u8.subarray(abs, abs + n);
    const out = [];
    for (let k = 0; k < Math.min(n, 64); k++) {
      const p = off + k * tam;
      out.push(tipo === 3 ? u16(p) : tipo === 4 ? u32(p) : tipo === 9 ? s32(p) : tipo === 8 ? dv.getInt16(t0 + p, le)
        : tipo === 5 ? [u32(p), u32(p + 4)] : tipo === 10 ? [s32(p), s32(p + 4)] : tipo === 11 ? dv.getFloat32(t0 + p, le) : dv.getFloat64(t0 + p, le));
    }
    return n === 1 ? out[0] : out;
  };
  const racional = (r) => (Array.isArray(r) && r.length === 2 && typeof r[0] === "number" ? (r[1] ? r[0] / r[1] : 0) : r);
  const fmt = (nombre, v) => {
    if (v instanceof Uint8Array) {
      if (/^XP/.test(nombre)) return new TextDecoder("utf-16le").decode(v).replace(/\0+$/, "");
      if (nombre === "UserComment") return latin1(v, 0, 8).replace(/\0/g, "").trim() === "UNICODE" ? new TextDecoder(le ? "utf-16le" : "utf-16be").decode(v.subarray(8)).replace(/\0+$/, "") : latin1(v, 8).replace(/\0+$/, "");
      if (nombre === "MakerNote") return `(${v.length} B de datos del fabricante)`;
      const txt = latin1(v); return /^[\x20-\x7e\0]+$/.test(txt) ? txt.replace(/\0+$/, "") : `(${v.length} B) ${[...v.subarray(0, 24)].map((b) => b.toString(16).padStart(2, "0")).join(" ")}`;
    }
    if (Array.isArray(v) && /^XP/.test(nombre)) return new TextDecoder("utf-16le").decode(Uint8Array.from(v)).replace(/\0+$/, "");
    if (nombre === "ExifVersion" && Array.isArray(v)) return String.fromCharCode(...v);
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" && /Time|Number|Value|Length|Resolution|Altitude|Speed|Direction/.test(nombre) && !/Offset/.test(nombre))
      return `${+racional(v).toFixed(6)} (${v[0]}/${v[1]})`;
    if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? +racional(x).toFixed(6) : x)).join(", ");
    return String(v);
  };
  const gps = {};
  const ifd = (off, nombreGrupo, dic) => {
    if (!off || off + 2 > lim || vistos.has(off)) return 0;
    vistos.add(off);
    const n = u16(off); if (n > 1000 || off + 2 + n * 12 > lim) return 0;
    const sub = [];
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12, tag = u16(e), tipo = u16(e + 2), cnt = u32(e + 4), tam = (TAM_TIPO[tipo] || 1) * cnt;
      const v = valor(tipo, cnt, tam <= 4 ? e + 8 : u32(e + 8));
      const nombre = dic[tag] || `tag 0x${tag.toString(16).padStart(4, "0")}`;
      if (dic === TAGS && (tag === 0x8769 || tag === 0x8825 || tag === 0xa005)) { sub.push([tag, v]); continue; }
      if (dic === TAGS_GPS) gps[tag] = v;
      filas.push([nombreGrupo, nombre, corta(fmt(nombre, v))]);
    }
    for (const [tag, v] of sub) ifd(v, tag === 0x8825 ? "GPS" : tag === 0x8769 ? grupo + " (Exif)" : grupo + " (Interop)", tag === 0x8825 ? TAGS_GPS : TAGS);
    return off + 2 + n * 12 + 4 <= lim ? u32(off + 2 + n * 12) : 0;
  };
  const sig = ifd(u32(4), grupo + " IFD0", TAGS);
  if (sig) { // IFD1: miniatura
    const antes = filas.length; ifd(sig, grupo + " IFD1 (miniatura)", TAGS);
    const ofs = filas.slice(antes).find((f) => f[1] === "ThumbnailOffset"), lon = filas.slice(antes).find((f) => f[1] === "ThumbnailLength");
    if (ofs && lon && +ofs[2] + +lon[2] <= lim) incrustables.push({ desc: "miniatura EXIF (JPEG)", off: t0 + +ofs[2], len: +lon[2] });
  }
  if (gps[2] && gps[4]) {
    const dec = (a, ref) => { const [g, m, s] = a.map(racional); const d = g + m / 60 + s / 3600; return /[SW]/.test(ref || "") ? -d : d; };
    const lat = dec(gps[2], gps[1]), lon = dec(gps[4], gps[3]);
    filas.push(["GPS", "posicion decimal", `${lat.toFixed(6)}, ${lon.toFixed(6)}  (geo:${lat.toFixed(6)},${lon.toFixed(6)})`]);
  }
  return true;
};

// ============================================================ JPEG
const IPTC = { 5: "ObjectName", 25: "Keywords", 55: "DateCreated", 60: "TimeCreated", 80: "By-line", 85: "By-lineTitle", 90: "City",
  92: "Sub-location", 95: "Province-State", 101: "Country", 105: "Headline", 110: "Credit", 115: "Source", 116: "CopyrightNotice", 120: "Caption-Abstract" };
const jpeg = (u8, filas, inc) => {
  let i = 2, segs = [];
  while (i + 4 <= u8.length && u8[i] === 0xff) {
    const m = u8[i + 1]; if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    if (m === 0xff) { i++; continue; }
    const len = (u8[i + 2] << 8) | u8[i + 3], a = i + 4, b = Math.min(u8.length, i + 2 + len);
    segs.push(m === 0xda ? "SOS" : m >= 0xe0 && m <= 0xef ? `APP${m - 0xe0}` : { 0xfe: "COM", 0xdb: "DQT", 0xc4: "DHT", 0xdd: "DRI" }[m]
      || (m >= 0xc0 && m <= 0xcf ? `SOF${m - 0xc0}` : `FF${m.toString(16).toUpperCase()}`));
    if (m === 0xe0 && latin1(u8, a, a + 5) === "JFIF\0") filas.push(["JPEG", "JFIF", `v${u8[a + 5]}.${String(u8[a + 6]).padStart(2, "0")} · densidad ${(u8[a + 8] << 8) | u8[a + 9]}x${(u8[a + 10] << 8) | u8[a + 11]} (unidad ${u8[a + 7]})`]);
    else if (m === 0xe1 && latin1(u8, a, a + 6) === "Exif\0\0") { filas.push(["JPEG", "APP1 Exif", `${len - 8} B @0x${a.toString(16)}`]); RP.leerTiff(u8, a + 6, filas, "EXIF", inc); }
    else if (m === 0xe1 && latin1(u8, a, a + 28) === "http://ns.adobe.com/xap/1.0/") filas.push(["JPEG", "APP1 XMP", `${len} B (contenido en el grupo XMP)`]);
    else if (m === 0xe2 && latin1(u8, a, a + 11) === "ICC_PROFILE") filas.push(["JPEG", "APP2 ICC", `${len} B · perfil ${latin1(u8, a + 14 + 4, a + 14 + 8)}`]);
    else if (m === 0xed && latin1(u8, a, a + 13) === "Photoshop 3.0") iptc(u8, a + 14, b, filas);
    else if (m === 0xee && latin1(u8, a, a + 5) === "Adobe") filas.push(["JPEG", "APP14 Adobe", `transform ${u8[a + 11]}`]);
    else if (m === 0xfe) filas.push(["JPEG", "COM (comentario)", corta(utf8(u8, a, b), 2000)]);
    else if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb))
      filas.push(["JPEG", "SOF", `${(u8[a + 3] << 8) | u8[a + 4]}x${(u8[a + 1] << 8) | u8[a + 2]} · ${u8[a + 5]} componentes · ${u8[a]} bits · ${m === 0xc2 ? "progresivo" : m === 0xc0 ? "baseline" : "SOF" + (m - 0xc0)}`]);
    if (m === 0xda) break;
    i += 2 + len;
  }
  filas.push(["JPEG", "segmentos", segs.join(" ")]);
};
const iptc = (u8, a, b, filas) => {
  for (let i = a; i + 12 < b;) { // bloques 8BIM
    if (latin1(u8, i, i + 4) !== "8BIM") break;
    const id = (u8[i + 4] << 8) | u8[i + 5], nl = u8[i + 6], p = i + 7 + nl + ((nl + 1) % 2), tam = ((u8[p] << 24) >>> 0) + (u8[p + 1] << 16) + (u8[p + 2] << 8) + u8[p + 3], d = p + 4;
    if (id === 0x0404) for (let k = d; k + 5 <= d + tam && u8[k] === 0x1c;) {
      const reg = u8[k + 1], ds = u8[k + 2], n = (u8[k + 3] << 8) | u8[k + 4];
      if (reg === 2 && ds !== 0) filas.push(["IPTC", IPTC[ds] || `2:${ds}`, corta(utf8(u8, k + 5, k + 5 + n))]);
      k += 5 + n;
    }
    i = d + tam + (tam % 2);
  }
};

// ============================================================ PNG
const COLOR_PNG = { 0: "gris", 2: "RGB", 3: "paleta", 4: "gris+alfa", 6: "RGBA" };
const png = async (u8, filas, inc) => {
  const dv = new DataView(u8.buffer, u8.byteOffset);
  const tipos = [], malos = [];
  for (let i = 8; i + 12 <= u8.length;) {
    const len = dv.getUint32(i), tipo = latin1(u8, i + 4, i + 8), a = i + 8, b = a + len;
    if (b + 4 > u8.length || !/^[A-Za-z]{4}$/.test(tipo)) { filas.push(["PNG", "estructura", `chunk truncado o invalido @0x${i.toString(16)}`]); break; }
    tipos.push(tipo);
    if (crc32(u8, i + 4, b) !== dv.getUint32(b)) malos.push(`${tipo}@0x${i.toString(16)}`);
    if (tipo === "IHDR") filas.push(["PNG", "IHDR", `${dv.getUint32(a)}x${dv.getUint32(a + 4)} · ${u8[a + 8]} bits · ${COLOR_PNG[u8[a + 9]] || u8[a + 9]} · entrelazado ${u8[a + 12] ? "Adam7" : "no"}`]);
    else if (tipo === "tEXt") { const z = u8.indexOf(0, a); filas.push(["PNG texto", latin1(u8, a, z), corta(latin1(u8, z + 1, b), 2000)]); }
    else if (tipo === "zTXt") { const z = u8.indexOf(0, a); let t; try { t = latin1(await RP.inflar(u8.slice(z + 2, b))); } catch (e) { t = "(no se pudo descomprimir: " + e.message + ")"; } filas.push(["PNG texto", latin1(u8, a, z) + " (zTXt)", corta(t, 2000)]); }
    else if (tipo === "iTXt") {
      const z1 = u8.indexOf(0, a), comp = u8[z1 + 1], z2 = u8.indexOf(0, z1 + 3), z3 = u8.indexOf(0, z2 + 1);
      let t; try { t = utf8(comp ? await RP.inflar(u8.slice(z3 + 1, b)) : u8.subarray(z3 + 1, b)); } catch (e) { t = "(no se pudo descomprimir: " + e.message + ")"; }
      filas.push(["PNG texto", latin1(u8, a, z1) + " (iTXt)", corta(t, 2000)]);
    }
    else if (tipo === "tIME") filas.push(["PNG", "tIME (modificacion)", `${dv.getUint16(a)}-${String(u8[a + 2]).padStart(2, "0")}-${String(u8[a + 3]).padStart(2, "0")} ${[4, 5, 6].map((k) => String(u8[a + k]).padStart(2, "0")).join(":")} UTC`]);
    else if (tipo === "pHYs") filas.push(["PNG", "pHYs", `${dv.getUint32(a)}x${dv.getUint32(a + 4)} px/${u8[a + 8] ? "m" : "unidad"}${u8[a + 8] ? ` (${(dv.getUint32(a) * 0.0254).toFixed(1)} ppp)` : ""}`]);
    else if (tipo === "gAMA") filas.push(["PNG", "gAMA", (dv.getUint32(a) / 100000).toFixed(5)]);
    else if (tipo === "iCCP") filas.push(["PNG", "iCCP", `perfil "${latin1(u8, a, u8.indexOf(0, a))}" (${len} B)`]);
    else if (tipo === "acTL") filas.push(["PNG", "APNG (acTL)", `${dv.getUint32(a)} fotogramas · ${dv.getUint32(a + 4) || "infinitas"} repeticiones`]);
    else if (tipo === "eXIf") { filas.push(["PNG", "eXIf", `${len} B`]); RP.leerTiff(u8, a, filas, "EXIF", inc); }
    i = b + 4;
    if (tipo === "IEND") break;
  }
  const cuenta = {}; tipos.forEach((t) => (cuenta[t] = (cuenta[t] || 0) + 1));
  filas.push(["PNG", "chunks", Object.entries(cuenta).map(([t, n]) => (n > 1 ? `${t}x${n}` : t)).join(" ")]);
  const raros = Object.keys(cuenta).filter((t) => !/^(IHDR|PLTE|IDAT|IEND|tRNS|cHRM|gAMA|iCCP|sBIT|sRGB|cICP|mDCV|cLLI|tEXt|zTXt|iTXt|bKGD|hIST|pHYs|sPLT|eXIf|tIME|acTL|fcTL|fdAT)$/.test(t));
  if (raros.length) filas.push(["PNG", "ATENCION chunks no estandar", raros.join(" ")]);
  filas.push(["PNG", "CRC", malos.length ? `ATENCION ${malos.length} CRC no coinciden: ${malos.slice(0, 10).join(" ")}${malos.some((m) => m.startsWith("IHDR")) ? " (IHDR: dimensiones posiblemente alteradas)" : ""}` : "todos coinciden"]);
};

// ============================================================ GIF / BMP
const gif = (u8, filas) => {
  const dv = new DataView(u8.buffer, u8.byteOffset);
  filas.push(["GIF", "cabecera", `${latin1(u8, 0, 6)} · ${dv.getUint16(6, true)}x${dv.getUint16(8, true)} · paleta global ${u8[10] & 0x80 ? 2 << (u8[10] & 7) : "no"}`]);
  let i = 13 + (u8[10] & 0x80 ? 3 * (2 << (u8[10] & 7)) : 0), imagenes = 0, demora = 0;
  const saltarSub = (k) => { while (k < u8.length && u8[k]) k += u8[k] + 1; return k + 1; };
  while (i < u8.length) {
    const b = u8[i];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const et = u8[i + 1];
      if (et === 0xf9) demora += dv.getUint16(i + 4, true);
      if (et === 0xfe) { let t = "", k = i + 2; while (u8[k]) { t += latin1(u8, k + 1, k + 1 + u8[k]); k += u8[k] + 1; } filas.push(["GIF", "comentario", corta(t, 2000)]); }
      if (et === 0xff) filas.push(["GIF", "extension de aplicacion", latin1(u8, i + 3, i + 14)]);
      i = saltarSub(i + 2);
    } else if (b === 0x2c) {
      imagenes++; const f = u8[i + 9]; i += 10 + (f & 0x80 ? 3 * (2 << (f & 7)) : 0) + 1; i = saltarSub(i);
    } else { filas.push(["GIF", "estructura", `byte inesperado 0x${b.toString(16)} @0x${i.toString(16)}`]); break; }
  }
  filas.push(["GIF", "fotogramas", `${imagenes}${demora ? ` · ${(demora / 100).toFixed(2)} s de animacion` : ""}`]);
};
const bmp = (u8, filas) => {
  const dv = new DataView(u8.buffer, u8.byteOffset);
  if (u8.length < 54) return;
  filas.push(["BMP", "cabecera", `${dv.getInt32(18, true)}x${dv.getInt32(22, true)} · ${dv.getUint16(28, true)} bpp · compresion ${dv.getUint32(30, true)} · datos @${dv.getUint32(10, true)} · ${Math.round(dv.getInt32(38, true) * 0.0254)} ppp`]);
};

// ============================================================ RIFF (WEBP, AVI, WAV)
const riff = (u8, filas, inc) => {
  const dv = new DataView(u8.buffer, u8.byteOffset), forma = latin1(u8, 8, 12);
  filas.push(["RIFF", "forma", forma]);
  const INFO = { INAM: "titulo", IART: "artista", ICMT: "comentario", ICRD: "fecha", ISFT: "software", ICOP: "copyright", IGNR: "genero", IKEY: "palabras clave", ISBJ: "asunto", IENG: "ingeniero" };
  const recorrer = (a, b, prof) => {
    for (let i = a; i + 8 <= b && prof < 4;) {
      const id = latin1(u8, i, i + 4), len = dv.getUint32(i + 4, true), d = i + 8, fin = Math.min(b, d + len);
      if (id === "LIST") recorrer(d + 4, fin, prof + 1);
      else if (INFO[id]) filas.push(["RIFF INFO", INFO[id], corta(latin1(u8, d, fin).replace(/\0+$/, ""))]);
      else if (id === "VP8X") filas.push(["WEBP", "VP8X", `lienzo ${1 + (u8[d + 4] | (u8[d + 5] << 8) | (u8[d + 6] << 16))}x${1 + (u8[d + 7] | (u8[d + 8] << 8) | (u8[d + 9] << 16))} · indicadores ${["ICC", "alfa", "EXIF", "XMP", "animacion"].filter((_, k) => u8[d] & [0x20, 0x10, 0x08, 0x04, 0x02][k]).join(",") || "ninguno"}`]);
      else if (id === "VP8 ") filas.push(["WEBP", "VP8 (con perdida)", `${dv.getUint16(d + 6, true) & 0x3fff}x${dv.getUint16(d + 8, true) & 0x3fff}`]);
      else if (id === "VP8L") { const v = dv.getUint32(d + 1, true); filas.push(["WEBP", "VP8L (sin perdida)", `${(v & 0x3fff) + 1}x${((v >> 14) & 0x3fff) + 1}`]); }
      else if (id === "EXIF") RP.leerTiff(u8, latin1(u8, d, d + 6) === "Exif\0\0" ? d + 6 : d, filas, "EXIF", inc);
      else if (id === "avih") filas.push(["AVI", "avih", `${dv.getUint32(d + 32, true)}x${dv.getUint32(d + 36, true)} · ${dv.getUint32(d + 16, true)} fotogramas · ${dv.getUint32(d, true) ? (1e6 / dv.getUint32(d, true)).toFixed(3) : "?"} fps`]);
      else if (id === "strh") filas.push(["AVI", "flujo", `${latin1(u8, d, d + 4)} ${latin1(u8, d + 4, d + 8)} · ${dv.getUint32(d + 20, true) ? (dv.getUint32(d + 24, true) / dv.getUint32(d + 20, true)).toFixed(3) : "?"} por s`]);
      else if (id === "fmt ") filas.push(["WAV", "formato", `codigo ${dv.getUint16(d, true)} · ${dv.getUint16(d + 2, true)} canales · ${dv.getUint32(d + 4, true)} Hz · ${dv.getUint16(d + 14, true)} bits`]);
      else if (id === "data" && forma === "WAVE") filas.push(["WAV", "datos", `${len} B`]);
      else if (!/^(ANIM|ANMF|ALPH|ICCP|XMP |movi|idx1|JUNK|strf|indx|vprp|odml|dmlh)$/.test(id) && prof === 0) filas.push(["RIFF", `chunk ${id}`, `${len} B @0x${i.toString(16)}`]);
      i = d + len + (len & 1);
    }
  };
  recorrer(12, Math.min(u8.length, dv.getUint32(4, true) + 8), 0);
};

// ============================================================ PDF
const cadenaPdf = (s) => {
  if (s.startsWith("<")) { const h = s.slice(1, -1).replace(/\s/g, ""), b = Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16)); return b[0] === 0xfe && b[1] === 0xff ? new TextDecoder("utf-16be").decode(b.subarray(2)) : latin1(b); }
  const t = s.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[c] ?? (/\d/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c));
  return t.charCodeAt(0) === 0xfe && t.charCodeAt(1) === 0xff ? new TextDecoder("utf-16be").decode(Uint8Array.from(t.slice(2), (c) => c.charCodeAt(0))) : t;
};
const pdf = (u8, filas) => {
  const s = latin1(u8);
  filas.push(["PDF", "version", s.slice(5, 8)]);
  let hay = false;
  for (const k of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"]) {
    const re = new RegExp(`/${k}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)`, "g");
    const vals = new Set([...s.matchAll(re)].map((m) => cadenaPdf(m[1])));
    for (const v of vals) { filas.push(["PDF Info", k, corta(v)]); hay = true; }
  }
  if (!hay) filas.push(["PDF Info", "(sin diccionario Info en texto plano)", "puede estar en un flujo de objetos comprimido; revisar XMP"]);
  filas.push(["PDF", "paginas (/Type /Page)", String((s.match(/\/Type\s*\/Page(?!s)/g) || []).length)]);
  const eof = (s.match(/%%EOF/g) || []).length;
  filas.push(["PDF", "%%EOF", eof > 1 ? `${eof} (ATENCION: ${eof - 1} actualizacion(es) incremental(es): hay versiones anteriores)` : String(eof)]);
  const sosp = ["/Encrypt", "/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/EmbeddedFile", "/URI", "/SubmitForm", "/ObjStm"]
    .map((k) => [k, (s.match(new RegExp(k.replace("/", "\\/") + "(?![A-Za-z])", "g")) || []).length]).filter(([, n]) => n);
  filas.push(["PDF", "claves de interes", sosp.length ? sosp.map(([k, n]) => `${k} x${n}`).join(" · ") : "ninguna"]);
};

// ============================================================ ZIP (y Office/ODF)
const zip = async (u8, filas) => {
  const dv = new DataView(u8.buffer, u8.byteOffset);
  let e = -1; for (let k = u8.length - 22; k >= Math.max(0, u8.length - 65557); k--) if (dv.getUint32(k, true) === 0x06054b50) { e = k; break; }
  if (e < 0) { filas.push(["ZIP", "directorio central", "no encontrado (truncado o no es ZIP)"]); return; }
  const n = dv.getUint16(e + 10, true), cd = dv.getUint32(e + 16, true), lc = dv.getUint16(e + 20, true);
  filas.push(["ZIP", "entradas", String(n)]);
  if (lc) filas.push(["ZIP", "comentario del archivo", corta(utf8(u8, e + 22, e + 22 + lc), 2000)]);
  const docs = {};
  for (let k = 0, p = cd; k < n && p + 46 <= u8.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const fl = dv.getUint16(p + 8, true), met = dv.getUint16(p + 10, true), hr = dv.getUint16(p + 12, true), fe = dv.getUint16(p + 14, true);
    const csz = dv.getUint32(p + 20, true), usz = dv.getUint32(p + 24, true), ln = dv.getUint16(p + 28, true), lx = dv.getUint16(p + 30, true), lcm = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
    const nombre = utf8(u8, p + 46, p + 46 + ln), fecha = `${1980 + (fe >> 9)}-${String((fe >> 5) & 15).padStart(2, "0")}-${String(fe & 31).padStart(2, "0")} ${String(hr >> 11).padStart(2, "0")}:${String((hr >> 5) & 63).padStart(2, "0")}`;
    if (k < 200) filas.push(["ZIP contenido", nombre, `${usz} B (${csz} comp., metodo ${met}${fl & 1 ? ", CIFRADO" : ""}) · ${fecha}${lcm ? " · comentario: " + utf8(u8, p + 46 + ln + lx, p + 46 + ln + lx + lcm) : ""}`]);
    if (/^(docProps\/(core|app|custom)\.xml|meta\.xml)$/.test(nombre) && !(fl & 1)) docs[nombre] = { loc, csz, met };
    p += 46 + ln + lx + lcm;
  }
  if (n > 200) filas.push(["ZIP contenido", "…", `${n - 200} entradas mas`]);
  for (const [nombre, d] of Object.entries(docs)) {
    try {
      const ini = d.loc + 30 + dv.getUint16(d.loc + 26, true) + dv.getUint16(d.loc + 28, true), crudo = u8.slice(ini, ini + d.csz);
      const xml = utf8(d.met === 8 ? await RP.inflar(crudo, "deflate-raw") : crudo);
      for (const m of xml.matchAll(/<([\w]+:[\w]+|Application|Company|AppVersion|Template|TotalTime|Pages|Words)\b[^>]*>([^<]+)<\/\1>/g)) filas.push(["Office " + nombre, m[1], corta(m[2])]);
    } catch (err) { filas.push(["Office " + nombre, "error", err.message]); }
  }
};

// ============================================================ XMP (cualquier fichero)
const xmp = (u8, filas) => {
  const out = [];
  let i = buscarAscii(u8, "<x:xmpmeta");
  while (i >= 0 && out.length < 4) { const f = buscarAscii(u8, "</x:xmpmeta>", i); if (f < 0) break; out.push([i, utf8(u8, i, f + 12)]); i = buscarAscii(u8, "<x:xmpmeta", f); }
  for (const [off, x] of out) {
    filas.push(["XMP", "paquete", `${x.length} caracteres @0x${off.toString(16)}`]);
    const vistos = new Set();
    for (const m of x.matchAll(/\s([\w-]+:[\w-]+)="([^"]*)"/g)) if (!/^(xmlns|rdf|x):/.test(m[1]) && !vistos.has(m[1] + m[2])) { vistos.add(m[1] + m[2]); filas.push(["XMP", m[1], corta(m[2])]); }
    for (const m of x.matchAll(/<([\w-]+:[\w-]+)(?:\s[^>]*)?>([^<]+)<\/\1>/g)) if (!/^rdf:/.test(m[1]) || /^rdf:li$/.test(m[1])) { const v = m[2].trim(); if (v && !vistos.has(m[1] + v)) { vistos.add(m[1] + v); filas.push(["XMP", m[1], corta(v)]); } }
  }
};

// ============================================================ despacho
// devuelve { filas: [[grupo, clave, valor]], incrustables: [{desc, off, len}], video: {...} | null }
RP.metadatos = async (u8, archivo = {}, analisis = null) => {
  const filas = [], inc = [];
  const tipo = analisis ? analisis.tipo : "desconocido";
  filas.push(["Fichero", "nombre", archivo.name || "(pegado)"]);
  filas.push(["Fichero", "tamano", `${u8.length} B`]);
  if (archivo.type) filas.push(["Fichero", "tipo MIME declarado", archivo.type]);
  if (archivo.lastModified) filas.push(["Fichero", "ultima modificacion (sistema de ficheros local, no del contenido)", new Date(archivo.lastModified).toISOString()]);
  filas.push(["Fichero", "firma", tipo]);
  let video = null;
  try {
    if (tipo === "JPEG") jpeg(u8, filas, inc);
    else if (tipo === "PNG") await png(u8, filas, inc);
    else if (tipo === "GIF") gif(u8, filas);
    else if (tipo === "BMP") bmp(u8, filas);
    else if (tipo === "TIFF") RP.leerTiff(u8, 0, filas, "TIFF", inc);
    else if (tipo === "WEBP/RIFF") riff(u8, filas, inc);
    else if (tipo === "PDF") pdf(u8, filas);
    else if (tipo === "ZIP") await zip(u8, filas);
    else if (tipo === "MP4/ISO-BMFF" && RP.metadatosIso) video = RP.metadatosIso(u8, filas);
    else if (tipo === "MKV/WebM" && RP.metadatosEbml) video = RP.metadatosEbml(u8, filas);
  } catch (err) { filas.push(["Error", "analisis de " + tipo, err.message]); }
  // EXIF suelto (HEIC, RAW, contenedores no tratados): "Exif\0\0" seguido de una cabecera TIFF
  if (!filas.some((f) => /^(EXIF|TIFF)/.test(f[0]))) {
    let k = buscarAscii(u8, "Exif\0\0");
    while (k >= 0 && !RP.esTiff(u8, k + 6)) k = buscarAscii(u8, "Exif\0\0", k + 1);
    if (k >= 0) { filas.push(["EXIF", "bloque Exif suelto", `@0x${k.toString(16)}`]); RP.leerTiff(u8, k + 6, filas, "EXIF", inc); }
  }
  xmp(u8, filas);
  // imagenes incrustadas que se pueden abrir con las herramientas de imagen
  // (hexa.js no busca la firma JPEG de 3 bytes; aqui se exige un 4.o byte de marcador valido)
  for (let k = u8.indexOf(0xff, 1), n = 0; k > 0 && k + 3 < u8.length && n < 10; k = u8.indexOf(0xff, k + 1))
    if (u8[k + 1] === 0xd8 && u8[k + 2] === 0xff && /^(e[0-9a-f]|db|c0|c2|c4|fe)$/.test(u8[k + 3].toString(16)) && !inc.some((x) => x.off === k)) { inc.push({ desc: "JPEG incrustado", off: k, len: null }); n++; }
  for (const s of (analisis && analisis.incrustadas) || []) if (/PNG|GIF|BMP|WEBP/.test(s.tipo) && !inc.some((x) => x.off === s.off)) inc.push({ desc: `${s.tipo} incrustado`, off: s.off, len: null });
  inc.sort((a, b) => a.off - b.off);
  return { filas, incrustables: inc, video };
};

RP.informeMetadatos = (m) => {
  if (!m) return "(sin archivo)";
  const grupos = new Map(); // en el orden en que aparece cada grupo por primera vez
  for (const [grupo, k, v] of m.filas) { if (!grupos.has(grupo)) grupos.set(grupo, []); grupos.get(grupo).push(`${k}: ${v}`); }
  return [...grupos].map(([g, L]) => `— ${g} —\n${L.join("\n")}`).join("\n\n");
};
