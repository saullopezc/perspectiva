// -----------------------------------------------------------------------------
// test_estructura.js — Pruebas de tools/web/js/estructura.js contra ffprobe (oraculo
// independiente: sus JSON se generan con generar_insumos.py) y contra los
// parametros con que se codificaron los insumos; con controles (CRC alterado, fichero
// truncado, extension que no corresponde).
// Uso: node tests/web/test_estructura.js DIR_BASE/estructura   (tests/web/generar_insumos.py)
// Author: Saul López
// Date:   2026-11-19
// -----------------------------------------------------------------------------
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
global.window = global;
for (const f of ["nucleo", "hexa", "hashes", "estructura"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../../tools/web/js", f + ".js"), "utf8"));
const D = process.argv[2];
let fallos = 0;
const ok = (c, m) => { console.log((c ? "OK    " : "FALLO ") + m); if (!c) fallos++; };
if (!D || !fs.existsSync(D)) { console.log("falta el directorio de insumos"); process.exit(2); }
const leer = (n) => new Uint8Array(fs.readFileSync(path.join(D, n)));
const ffp = (n) => JSON.parse(fs.readFileSync(path.join(D, n + ".ffprobe.json"), "utf8"));
const est = (n, u8 = leer(n)) => RP.analizarEstructura(u8, RP.analizarBytes(u8, n).tipo);
const campo = (r, g, c) => (r.filas.find(([gg, cc]) => gg.startsWith(g) && cc === c) || [])[2] || "";
const H264 = { High: "High", Main: "Main", "Constrained Baseline": "Constrained Baseline", Baseline: "Baseline" };

// ---- MP4: codec, perfil, nivel, audio, duracion, fotogramas, bitrate y rotacion frente a ffprobe
for (const n of ["h264_aac.mp4", "h264_rot90.mp4", "hevc_aac.mp4"]) {
  const r = est(n), f = ffp(n), v = f.streams.find((s) => s.codec_type === "video"), a = f.streams.find((s) => s.codec_type === "audio");
  const p = r.pistas.find((x) => x.tipo === "vide"), q = r.pistas.find((x) => x.tipo === "soun");
  const nivelFf = v.level, perfilOk = v.codec_name === "h264" ? p.perfil === H264[v.profile] : p.perfil === v.profile;
  ok(perfilOk && p.nivel === nivelFf, `${n}: video ${p.codec} perfil «${p.perfil}» nivel ${p.nivel} = ffprobe ${v.codec_name} «${v.profile}» ${nivelFf}`);
  ok(p.ancho === v.width && p.alto === v.height && p.muestras === +v.nb_frames, `${n}: ${p.ancho}x${p.alto}, ${p.muestras} fotogramas = ffprobe ${v.width}x${v.height}, ${v.nb_frames}`);
  const bFf = +v.bit_rate, bN = Math.round((p.bytes * 8) / (p.duracion / p.escala));
  ok(Math.abs(bN / bFf - 1) < 0.02, `${n}: bitrate de video ${bN} = ffprobe ${bFf} (±2%)`);
  const rotFf = ((v.side_data_list || []).find((x) => x.rotation != null) || {}).rotation || 0;
  ok(((p.rotacion || 0) - rotFf) % 360 === 0, `${n}: rotacion ${p.rotacion || 0}° = ffprobe ${rotFf}°`);
  if (a) ok(q.aac && q.aac.frecuencia === +a.sample_rate && q.aac.canales === a.channels && q.aac.tipo === "AAC " + a.profile,
    `${n}: audio ${q.aac && q.aac.tipo} ${q.aac && q.aac.frecuencia} Hz ${q.aac && q.aac.canales} canales = ffprobe AAC ${a.profile} ${a.sample_rate} ${a.channels}`);
}
// ---- Matroska / WebM
for (const n of ["vp9_opus.webm", "h264_mp3.mkv"]) {
  const r = est(n), f = ffp(n), v = f.streams.find((s) => s.codec_type === "video"), a = f.streams.find((s) => s.codec_type === "audio");
  const p = r.pistas.find((x) => x.tipo === 1), q = r.pistas.find((x) => x.tipo === 2);
  const mapa = { vp9: "V_VP9", h264: "V_MPEG4/ISO/AVC", opus: "A_OPUS", mp3: "A_MPEG/L3" };
  ok(p.codec === mapa[v.codec_name] && q.codec === mapa[a.codec_name], `${n}: codecs ${p.codec} / ${q.codec} = ffprobe ${v.codec_name} / ${a.codec_name}`);
  ok(p.ancho === v.width && p.alto === v.height && q.frecuencia === +a.sample_rate && (q.canales || 1) === a.channels,
    `${n}: ${p.ancho}x${p.alto} · ${q.frecuencia} Hz ${q.canales || 1} canales = ffprobe ${v.width}x${v.height} · ${a.sample_rate} ${a.channels}`);
  if (v.codec_name === "h264") ok(p.perfil === H264[v.profile] && p.nivel === v.level, `${n}: perfil «${p.perfil}» nivel ${p.nivel} (CodecPrivate) = ffprobe «${v.profile}» ${v.level}`);
}
// ---- WAV
{ const r = est("tono.wav"), a = ffp("tono.wav").streams[0], p = r.pistas[0];
  ok(p.codec === "PCM" && p.frecuencia === +a.sample_rate && p.canales === a.channels && p.bits === a.bits_per_sample, `tono.wav: ${p.codec} ${p.frecuencia} Hz ${p.canales} canal ${p.bits} bits = ffprobe ${a.codec_name} ${a.sample_rate} ${a.channels} ${a.bits_per_sample}`);
  ok(/duracion/.test(r.filas.map((x) => x[1]).join()) && campo(r, "Pista 1", "duracion").startsWith((+a.duration).toFixed(3)), `tono.wav: duracion ${campo(r, "Pista 1", "duracion")} = ffprobe ${a.duration}`); }
// ---- JPEG: tipo y submuestreo con que se guardaron (Pillow)
for (const [n, tipo, sub, multi] of [["base_420.jpg", "SOF0", "4:2:0", false], ["prog_444.jpg", "SOF2", "4:4:4", true], ["base_422.jpg", "SOF0", "4:2:2", false]]) {
  const r = est(n), cod = campo(r, "Imagen", "codificacion"), s = campo(r, "Imagen", "submuestreo de color"), esc = parseInt(campo(r, "Imagen", "escaneos (SOS)"), 10);
  ok(cod.includes(tipo) && s.startsWith(sub) && (multi ? esc > 1 : esc === 1), `${n}: ${cod} · ${s} · ${esc} escaneos`);
}
// ---- PNG: CRC correcto y control con un byte alterado
{ const u8 = leer("rgb.png"), r = est("rgb.png", u8);
  ok(campo(r, "Estructura", "CRC") === "todos correctos" && campo(r, "Imagen", "color").startsWith("RGB · 8 bits"), `rgb.png: ${campo(r, "Imagen", "color")} · CRC ${campo(r, "Estructura", "CRC")}`);
  const mal = u8.slice(); mal[40] ^= 0x01; const r2 = est("rgb.png", mal);
  ok(/INCORRECTO/.test(campo(r2, "Estructura", "CRC")), `control: un byte alterado en rgb.png -> «${campo(r2, "Estructura", "CRC")}»`); }
// ---- controles de robustez y de extension
{ const u8 = leer("h264_aac.mp4"), r = est("x.mp4", u8.slice(0, Math.floor(u8.length * 0.6)));
  ok(r.filas.some(([, c, v]) => c === "AVISO" && /truncado|fuera/.test(v)), "control: MP4 truncado -> aviso de fichero truncado, sin excepcion");
  const u = leer("imagen_con_extension.jpg"), a = RP.analizarBytes(u, "imagen_con_extension.jpg");
  ok(/no corresponde al contenido \(PNG\)/.test(RP.informeEstructura(est("imagen_con_extension.jpg", u), a)), "control: PNG con extension .jpg -> aviso de extension");
  const e = RP.entropia(new Uint8Array(4096)), e2 = RP.entropia(Uint8Array.from({ length: 65536 }, (_, i) => i % 256));
  ok(e.global === 0 && e2.global === 8, `entropia: ceros = ${e.global}, todos los bytes por igual = ${e2.global}`); }
// ---- analisis hexadecimal: un PNG anadido tras el fin de un JPEG real se detecta en su desplazamiento
{ const j = leer("base_420.jpg"), p = leer("rgb.png"), u = new Uint8Array(j.length + p.length); u.set(j); u.set(p, j.length);
  const a = RP.analizarBytes(u, "con_anadido.jpg");
  ok(a.tipo === "JPEG" && a.fin === j.length && a.bytesTrasFin === p.length && a.incrustadas.some((s) => s.tipo === "PNG" && s.off === j.length),
    `hexa: JPEG de ${j.length} B con PNG anadido -> fin ${a.fin}, ${a.bytesTrasFin} bytes tras el fin, PNG en 0x${j.length.toString(16)}`);
  const b = RP.analizarBytes(j, "base_420.jpg"); ok(b.bytesTrasFin === 0 && !b.incrustadas.some((s) => s.tipo === "PNG"), "control: el JPEG sin anadido no tiene nada tras el fin"); }
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
