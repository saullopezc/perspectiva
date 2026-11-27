// -----------------------------------------------------------------------------
// app.js — Interfaz: fuentes (imagenes y fotogramas de video) en carrusel,
// geometria por esquinas o por aristas, zoom, rectificacion, cadena de ajustes,
// plantilla de hipotesis, apilado y registro reproducible.
// Author: Saul López
// Date:   2026-11-13
// Modified By: Saul López
// Modified Date: 2026-11-27
// -----------------------------------------------------------------------------
"use strict";
const $ = (id) => document.getElementById(id);
const fuentes = [];   // {tipo, nombre, sha256, origen, w, h, img, datos, analisis, mini, esquinas[], aristas[]}
const videos = [];    // {nombre, sha256, url, analisis}
let actual = -1, sel = -1, arrastrando = -1, paneando = null, rot90 = 0;
const vista = { s: 1, ox: 0, oy: 0 };
const pila = [];
let ultimaPlana = null, limpia = null, ultimosPasos = null;
const COLORES = ["#ff6b6b", "#ffd24d", "#5dff96", "#5aa9ff"];
const cvF = $("fuente"), ctxF = cvF.getContext("2d"), cvS = $("salida"), ctxS = cvS.getContext("2d"), lupa = $("lupa").getContext("2d");
const video = $("video");
const modo = () => document.querySelector('input[name="modoGeo"]:checked').value;
const F0 = () => (actual >= 0 ? fuentes[actual] : null);
const SIN_PUNTOS = Object.freeze([]); // modo "imagen completa": no hay puntos que marcar
const editables = (F = F0()) => (!F ? [] : { esquinas: F.esquinas, aristas: F.aristas, control: F.control, recorte: F.recorte }[modo()] || SIN_PUNTOS);
const maxPuntos = () => ({ esquinas: 4, aristas: 8, recorte: 2, completa: 0 }[modo()] ?? 40);
const modoNativo = () => modo() === "completa" || modo() === "recorte"; // sin rectificar: la salida son los pixeles tal cual (1:1)
function esquinas(F = F0()) {   // las 4 esquinas efectivas (sup-izq, sup-der, inf-der, inf-izq)
  if (!F) return [];
  if (modo() === "completa") return [[0, 0], [F.w, 0], [F.w, F.h], [0, F.h]];
  if (modo() === "recorte") {
    if (F.recorte.length < 2) return [];
    const [[a, b], [c, d]] = F.recorte, x0 = Math.min(a, c), x1 = Math.max(a, c), y0 = Math.min(b, d), y1 = Math.max(b, d);
    return x1 - x0 < 1 || y1 - y0 < 1 ? [] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  if (modo() === "aristas") return RP.esquinasDeAristas(F.aristas) || [];
  if (modo() === "control") return esquinasControl(F) || [];
  return F.esquinas.length === 4 && $("autoOrden").checked ? RP.ordenarEsquinas(F.esquinas) : F.esquinas;
}
const carrusel = new RP.Carrusel($("carrusel"), (i) => seleccionar(i), { alQuitar: (i) => quitarFuente(i) }); // quitarFuente: sesion.js

// ============================================================ carga
// Cualquier fichero: video -> captura de fotogramas; imagen decodificable (por su contenido, no por
// su extension) -> herramientas de imagen; otro -> metadatos, analisis hex e imagenes incrustadas.
const archivos = [];  // {nombre, sha256, clase: imagen|video|archivo, analisis, meta, u8 (salvo video), fuente, video}
const MIME_FIRMA = { PNG: "image/png", JPEG: "image/jpeg", GIF: "image/gif", BMP: "image/bmp", "WEBP/RIFF": "image/webp" };
// con aviso de carga (logo y paso en curso: interfaz.js) mientras se lee, se calcula el hash y se decodifica
async function cargarArchivo(f) {
  if (window.RP && RP.cargando) RP.cargando(true, f.name || "pegado");
  try { return await cargarArchivoSinAviso(f); } finally { if (window.RP && RP.cargando) RP.cargando(false); }
}
async function cargarArchivoSinAviso(f) {
  if (window.RP && RP.pasoCarga) RP.pasoCarga("leyendo el fichero");
  const buf = await f.arrayBuffer(), u8 = new Uint8Array(buf);
  if (window.RP && RP.pasoCarga) RP.pasoCarga("calculando SHA-256");
  const sha = await RP.sha256(buf), analisis = RP.analizarBytes(u8, f.name || "pegado");
  if (window.RP && RP.pasoCarga) RP.pasoCarga("leyendo metadatos");
  $("ocupado").textContent = `leyendo metadatos de ${f.name}…`;
  const A = { nombre: f.name || "pegado", sha256: sha, analisis, meta: await RP.metadatos(u8, f, analisis), u8: null, hashes: null };
  // los demas hashes (MD5 en JS tarda ~1 s por cada 100-200 MB) se calculan sin retrasar la carga
  analizarArchivoDiferido(A, u8); // formato, codecs, estructura y entropia (archivo_ui.js)
  RP.hashes(buf).then((h) => { A.hashes = h; if (+$("selArchivo").value === archivos.indexOf(A)) $("metaInfo").textContent = textoMeta(A); });
  $("ocupado").textContent = "";
  const o = document.createElement("option"); o.value = archivos.length; archivos.push(A); $("selArchivo").appendChild(o);
  const esVideo = (f.type || "").startsWith("video/") || (["MP4/ISO-BMFF", "MKV/WebM"].includes(analisis.tipo) && !/heic|avif/i.test(f.name));
  if (esVideo) {
    const url = URL.createObjectURL(new Blob([f], { type: f.type || "application/octet-stream" })); // referencia al File: sin copiar el buffer;
    A.clase = "video"; A.video = videos.length; o.textContent = `[video] ${A.nombre}`;
    videos.push({ nombre: f.name, sha256: sha, url, analisis, archivo: A });
    const ov = document.createElement("option"); ov.value = videos.length - 1; ov.textContent = f.name; $("selVideo").appendChild(ov);
    $("selVideo").value = videos.length - 1; activarVideo(videos.length - 1); return;
  }
  A.u8 = u8; // se conserva para abrir las imagenes incrustadas
  if (window.RP && RP.pasoCarga) RP.pasoCarga("decodificando la imagen");
  const url = URL.createObjectURL(new Blob([f], { type: MIME_FIRMA[analisis.tipo] || f.type || "application/octet-stream" }));
  const img = new Image();
  const decodifica = await new Promise((ok) => { img.onload = () => ok(true); img.onerror = () => ok(false); img.src = url; });
  if (!decodifica || !img.naturalWidth) {
    URL.revokeObjectURL(url); A.clase = "archivo"; o.textContent = `[archivo] ${A.nombre}`;
    mostrarArchivo(A); actualizarHerramientas(); return;
  }
  A.clase = "imagen"; o.textContent = `[imagen] ${A.nombre}`;
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const cx = c.getContext("2d"); cx.drawImage(img, 0, 0);
  A.fuente = { tipo: "imagen", nombre: f.name || "pegada.png", sha256: sha, origen: null, w: c.width, h: c.height, img: c,
    datos: cx.getImageData(0, 0, c.width, c.height), analisis, archivo: A };
  agregarFuente(A.fuente);
}
// ---- metadatos e imagenes incrustadas del archivo mostrado
function mostrarArchivo(A, prefijo = "") {
  $("selArchivo").value = archivos.indexOf(A);
  A.prefijo = prefijo; $("metaInfo").textContent = textoMeta(A);
  mostrarAnalisisArchivo(A, prefijo); // archivo_ui.js
  $("tMeta").textContent = `${A.clase} · ${A.meta.filas.length} campos`;
  const caja = $("incrustables"); caja.innerHTML = "";
  if (!A.u8) return;
  A.meta.incrustables.forEach((x) => {
    const b = document.createElement("button"); b.className = "chico"; b.textContent = `abrir ${x.desc} @0x${x.off.toString(16)}`;
    b.title = "Lo abre como imagen nueva (con sus propios metadatos y SHA-256)"; b.onclick = () => abrirIncrustado(A, x); caja.appendChild(b);
  });
}
const textoMeta = (A) => (A.prefijo || "") + RP.informeHashes(A.hashes) + "\n\n" + RP.informeMetadatos(A.meta);
$("btnCopiarHashes").onclick = async () => {
  const A = archivos[+$("selArchivo").value];
  if (!A || !A.hashes) { alert(A ? "Los hashes aun se estan calculando" : "No hay archivo"); return; }
  const t = `${A.nombre}\n` + RP.informeHashes(A.hashes) + `\ncalculado: ${new Date().toISOString()} (Perspectiva)\n`;
  try { await navigator.clipboard.writeText(t); $("ocupado").textContent = "hashes copiados"; } catch (err) { alert("No se pudo copiar: " + err.message); }
};
async function abrirIncrustado(A, x) {
  const trozo = A.u8.slice(x.off, x.len ? x.off + x.len : A.u8.length); // sin longitud: hasta el final (el decodificador ignora la cola)
  const ext = /JPEG/.test(x.desc) ? "jpg" : (x.desc.split(" ")[0] || "bin").toLowerCase();
  await cargarArchivo(new File([trozo], `${A.nombre}@0x${x.off.toString(16)}.${ext}`, { type: "" }));
  const B = archivos[archivos.length - 1];
  if (B.clase === "archivo") $("ocupado").textContent = `${x.desc} @0x${x.off.toString(16)}: el navegador no lo decodifica como imagen`;
}
$("selArchivo").onchange = () => {
  const A = archivos[+$("selArchivo").value];
  if (A.clase === "imagen") seleccionar(fuentes.indexOf(A.fuente));
  else if (A.clase === "video") { $("selVideo").value = A.video; activarVideo(A.video); }
  else mostrarArchivo(A);
  actualizarHerramientas();
};
// Las herramientas de imagen se activan cuando hay una imagen o un fotograma con que trabajar
function actualizarHerramientas() {
  const sin = !fuentes.length, A = archivos[+$("selArchivo").value];
  document.body.classList.toggle("sin-imagen", sin);
  $("avisoHerramientas").textContent = !sin || !A ? ""
    : A.clase === "video" ? "Video cargado: captura un fotograma (panel Video) para activar las herramientas de imagen."
    : "El archivo no es una imagen decodificable: solo metadatos y analisis hex" + (A.meta.incrustables.length ? "; puedes abrir una imagen incrustada desde Metadatos." : ".");
}
actualizarHerramientas();
function agregarFuente(F) {
  F.mini = RP.miniatura(F.img, 100); F.esquinas = F.esquinas || []; F.aristas = F.aristas || []; F.control = F.control || []; F.controlRef = F.controlRef || []; F.recorte = F.recorte || [];
  fuentes.push(F); actualizarHerramientas(); seleccionar(fuentes.length - 1);
}
function seleccionar(i) {
  const prev = F0(), modoCfg = $("modoConfig").value;
  if (prev && modoCfg !== "mantener") prev.config = leerConfig(); // cada imagen guarda la suya
  actual = i;
  const F = fuentes[i];
  if (prev && prev !== F && $("copiarGeo").checked) { // geometria del anterior, para solo ajustarla
    if (!F.esquinas.length && prev.esquinas.length) F.esquinas = prev.esquinas.map((p) => [...p]);
    if (!F.aristas.length && prev.aristas.length) F.aristas = prev.aristas.map((p) => [...p]);
    if (!F.recorte.length && prev.recorte.length) F.recorte = prev.recorte.map((p) => [...p]);
    if (!F.control.length && prev.control.length) { F.control = prev.control.map((p) => [...p]); F.controlRef = prev.controlRef.map((c) => ({ id: c.id, xy: [...c.xy] })); }
  }
  if (modoCfg !== "mantener") {
    if (!F.config) F.config = modoCfg === "cero" ? { ...DEFECTO } : leerConfig();
    aplicarConfig(F.config);
  }
  $("infoConfig").textContent = modoCfg === "mantener" ? "los ajustes se aplican a todas las imagenes"
    : `esta imagen tiene su propia configuracion (${F.config === undefined ? "nueva" : "guardada"})`;
  carrusel.render(fuentes.map((x) => ({ src: x.mini, titulo: x.nombre })), i);
  $("estado").textContent = `${i + 1}/${fuentes.length} · ${F.nombre} · ${F.w}x${F.h}`;
  $("hashInfo").textContent = F.origen
    ? `fotograma de ${F.origen.video} (SHA-256 video ${F.origen.sha256Video.slice(0, 16)}…) t=${F.origen.t.toFixed(3)} s`
    : `SHA-256 fuente: ${F.sha256}`;
  mostrarArchivo(F.archivo, F.origen ? `[fotograma capturado de ${F.origen.video} en t=${F.origen.t.toFixed(3)} s: metadatos del video]\n\n` : "");
  if (!prev || prev.w !== F.w || prev.h !== F.h) ajustarVista();
  if (prev !== F && typeof limpiarIntegridad === "function") limpiarIntegridad(); // integridad_ui.js
  dibujarFuente(); procesar();
}
$("archivo").onchange = async (e) => { for (const f of e.target.files) await cargarArchivo(f); e.target.value = ""; };
document.addEventListener("paste", async (e) => {
  for (const it of e.clipboardData.items) {
    if (!it.type.startsWith("image/")) continue;
    const f = it.getAsFile();
    await cargarArchivo(f && f.name && f.name !== "image.png" ? f : new File([f], `portapapeles_${RP.sello()}.${it.type.split("/")[1]}`, { type: it.type }));
  }
});
// arrastrar y soltar: aviso mientras se arrastra y explicacion si lo soltado no es un fichero (un enlace o una ruta, p. ej.
// arrastrado desde el explorador de un editor o desde otra pestana: una pagina no puede leer un fichero por su ruta)
let profArrastre = 0, avisoSoltar = null;
const esFichero = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
const mostrarSoltar = (texto, ms = 0) => {
  clearTimeout(avisoSoltar); $("soltarTexto").textContent = texto; $("soltar").hidden = false;
  if (ms) avisoSoltar = setTimeout(() => ($("soltar").hidden = true), ms);
};
document.addEventListener("dragenter", (e) => {
  profArrastre++;
  mostrarSoltar(esFichero(e) ? "Suelta para cargar" : "Esto es un enlace o un texto, no un fichero: arrastralo desde el explorador de archivos del sistema o usa «Abrir archivos»");
});
document.addEventListener("dragleave", () => { if (--profArrastre <= 0) { profArrastre = 0; $("soltar").hidden = true; } });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault(); profArrastre = 0;
  const dt = e.dataTransfer;
  let ficheros = [...(dt?.files || [])];
  // algunos navegadores dejan files vacio y entregan el fichero solo por items
  if (!ficheros.length) ficheros = [...(dt?.items || [])].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
  if (!ficheros.length) {
    // se dice que llego (tipos y, si es una ruta file://, que lo es): el dato para saber por que no hubo fichero
    const tipos = [...(dt?.types || [])].join(", ") || "nada";
    const uris = (dt?.getData("text/uri-list") || "").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    const ruta = uris.some((u) => u.startsWith("file:"));
    mostrarSoltar((ruta
      ? "El navegador entrego la ruta del archivo (file://…), no el archivo, y una pagina web no puede leer un archivo por su ruta."
      : "Lo soltado no es un fichero (es un enlace o un texto).") +
      ` Usa «Abrir archivos» o Ctrl+V. (Recibido: ${tipos})`, 9000);
    return;
  }
  $("soltar").hidden = true;
  for (const f of ficheros) await cargarArchivo(f);
});
$("btnAnterior").onclick = () => carrusel.mover(-1);
$("btnSiguiente").onclick = () => carrusel.mover(1);

// ============================================================ video
function activarVideo(k) {
  const v = videos[k]; $("bloqueVideo").hidden = false; $("bloqueVideo").open = true; video.src = v.url;
  if (window.RP && RP.mostrarPanel) RP.mostrarPanel("bloqueVideo"); // el panel a la vista, en el bloque Video (interfaz.js)
  mostrarArchivo(v.archivo); actualizarHerramientas();
  // fps declarados por el contenedor: se aplican solo si son constantes (con VFR, solo se informan)
  const c = v.archivo.meta.video;
  $("fpsContenedor").textContent = c ? `contenedor: ${c.fps.toFixed(3)} fps ${c.constante ? "(constante, aplicado)" : "(VARIABLE: no se aplica)"}${c.fotogramas ? ` · ${c.fotogramas} fotogramas` : ""}` : "contenedor: sin fps declarados";
  if (c && c.constante) $("fps").value = +c.fps.toFixed(3);
  video.onloadedmetadata = () => { $("rHasta").value = Math.min(video.duration, 1).toFixed(2); };
}
const vActual = () => videos[+$("selVideo").value];
$("selVideo").onchange = () => activarVideo(+$("selVideo").value);
// indicador de fotograma: preciso por fotograma si el navegador da requestVideoFrameCallback
const fpsV = () => Math.max(1, +$("fps").value);
const nFot = (t) => RP.indiceFotograma(t, fpsV()); // ver video.js: vale con pts (Chromium) o instante (Firefox)
function mostrarT(t = RP.ptsPresentado ?? video.currentTime) {
  const tot = Math.round((video.duration || 0) * fpsV());
  $("tVideo").textContent = `fot. ${nFot(t)} · t ${t.toFixed(3)} s`;
  $("fotVideo").textContent = `fotograma ${nFot(t)} / ${tot}`;
}
const deltas = [];
function seguirFotogramas() {
  if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) return;
  let prev = null;
  const cb = (_, m) => {
    if (prev && m.presentedFrames === prev.presentedFrames + 1 && !video.paused) {
      deltas.push(m.mediaTime - prev.mediaTime); if (deltas.length > 60) deltas.shift();
      const ord = [...deltas].sort((a, b) => a - b), med = ord[ord.length >> 1];
      if (med > 0) $("fpsMedido").textContent = `≈ ${(1 / med).toFixed(2)} fps medidos`;
    }
    prev = m; RP.ptsPresentado = m.mediaTime; mostrarT(m.mediaTime);
    video.requestVideoFrameCallback(cb);
  };
  video.requestVideoFrameCallback(cb);
}
video.addEventListener("timeupdate", () => { if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) mostrarT(video.currentTime); });
video.addEventListener("loadedmetadata", () => { RP.ptsPresentado = null; deltas.length = 0; mostrarT(0); seguirFotogramas(); });
$("btnUsarFps").onclick = () => { const m = /([\d.]+)/.exec($("fpsMedido").textContent); if (m) { $("fps").value = (+m[1]).toFixed(2); mostrarT(); } };
$("btnDesdeAqui").onclick = () => { video.pause(); $("rDesde").value = video.currentTime.toFixed(3); };
$("btnHastaAqui").onclick = () => { video.pause(); $("rHasta").value = video.currentTime.toFixed(3); };
$("btnRangoAqui").onclick = async () => {
  video.pause();
  const ref = F0(), n0 = fuentes.length;
  const paso = Math.max(1, +$("rPaso").value), n = Math.max(1, +$("nRango").value);
  for (let k = 0; k < n; k++) {
    if (k) { await RP.pasoFotograma(video, paso, fpsV()); if (video.currentTime >= video.duration - 1e-3) break; }
    $("ocupado").textContent = `capturando ${k + 1}/${n} (fot. ${nFot(RP.ptsPresentado ?? video.currentTime)})…`; await capturarEn(null);
  }
  $("ocupado").textContent = ""; mostrarT(); trasRango(ref, fuentes.slice(n0));
};
$("btnFotAnt").onclick = async () => { video.pause(); await RP.pasoFotograma(video, -1, fpsV()); mostrarT(); };
$("btnFotSig").onclick = async () => { video.pause(); await RP.pasoFotograma(video, 1, fpsV()); mostrarT(); };
async function capturarEn(t) {
  const v = vActual(), cap = await RP.capturar(video, t);
  agregarFuente({ tipo: "fotograma", nombre: `${v.nombre}@fot${nFot(cap.t)}_${cap.t.toFixed(3)}s`, sha256: cap.sha256Pixeles,
    origen: { video: v.nombre, sha256Video: v.sha256, t: cap.t, pts: cap.pts, tSolicitado: cap.tSolicitado, fotograma: nFot(cap.t), fps: fpsV() },
    w: cap.canvas.width, h: cap.canvas.height,
    img: cap.canvas, datos: cap.datos, analisis: v.analisis, archivo: v.archivo });
}
$("btnCapturar").onclick = async () => { video.pause(); const ref = F0(); await capturarEn(null); trasCaptura(ref, F0()); }; // trasCaptura: apilado.js
$("btnRango").onclick = async () => {
  video.pause();
  const ref = F0(), n0 = fuentes.length;
  const fps = +$("fps").value, paso = Math.max(1, +$("rPaso").value) / fps, t1 = +$("rHasta").value;
  for (let t = +$("rDesde").value; t <= t1 + 1e-6; t += paso) { $("ocupado").textContent = `capturando t=${t.toFixed(3)}…`; await capturarEn(t); }
  $("ocupado").textContent = ""; trasRango(ref, fuentes.slice(n0));
};

// ============================================================ lienzo y zoom
function tamCanvas() {
  const r = cvF.getBoundingClientRect(), d = devicePixelRatio || 1;
  if (cvF.width !== Math.round(r.width * d) || cvF.height !== Math.round(r.height * d)) { cvF.width = Math.round(r.width * d); cvF.height = Math.round(r.height * d); }
}
function ajustarVista() {
  const F = F0(); if (!F) return;
  tamCanvas();
  vista.s = Math.min(cvF.width / F.w, cvF.height / F.h) * 0.95;
  vista.ox = (cvF.width - F.w * vista.s) / 2; vista.oy = (cvF.height - F.h * vista.s) / 2;
}
function zoomEn(factor, cx = cvF.width / 2, cy = cvF.height / 2, absoluto = false) {
  const [x, y] = aImg(cx, cy);
  vista.s = absoluto ? factor : vista.s * factor;
  vista.ox = cx - x * vista.s; vista.oy = cy - y * vista.s; dibujarFuente();
}
$("zMas").onclick = () => zoomEn(1.5); $("zMenos").onclick = () => zoomEn(1 / 1.5);
$("zAjustar").onclick = () => { ajustarVista(); dibujarFuente(); };
$("z11").onclick = () => zoomEn(devicePixelRatio || 1, undefined, undefined, true);
const aImg = (cx, cy) => [(cx - vista.ox) / vista.s, (cy - vista.oy) / vista.s];
const aCanvas = (x, y) => [x * vista.s + vista.ox, y * vista.s + vista.oy];
function posRaton(e) { const r = cvF.getBoundingClientRect(), d = devicePixelRatio || 1; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; }

function linea(p, q, color, ancho = 1.5, discontinua = false) {
  const [a, b] = aCanvas(...p), [c, d] = aCanvas(...q);
  ctxF.save(); ctxF.strokeStyle = color; ctxF.lineWidth = ancho; if (discontinua) ctxF.setLineDash([6, 5]);
  ctxF.beginPath(); ctxF.moveTo(a, b); ctxF.lineTo(c, d); ctxF.stroke(); ctxF.restore();
}
function marca([x, y], color, texto, activo) {
  const [a, b] = aCanvas(x, y), d = devicePixelRatio || 1;
  ctxF.strokeStyle = color; ctxF.lineWidth = activo ? 2.5 : 1.5;
  ctxF.beginPath(); ctxF.arc(a, b, 6 * d, 0, 7); ctxF.stroke();
  ctxF.beginPath(); ctxF.moveTo(a - 10 * d, b); ctxF.lineTo(a + 10 * d, b); ctxF.moveTo(a, b - 10 * d); ctxF.lineTo(a, b + 10 * d); ctxF.stroke();
  ctxF.fillStyle = color; ctxF.font = `${11 * d}px sans-serif`; ctxF.fillText(texto, a + 8 * d, b - 8 * d);
}
function dibujarFuente() {
  tamCanvas();
  ctxF.setTransform(1, 0, 0, 1, 0, 0); ctxF.fillStyle = "#000"; ctxF.fillRect(0, 0, cvF.width, cvF.height);
  const F = F0();
  if (!F) { // sin imagen: decir que hacer (antes el lienzo quedaba en negro sin indicacion)
    const d = devicePixelRatio || 1; ctxF.fillStyle = "#8b95a7"; ctxF.textAlign = "center"; ctxF.font = `${14 * d}px sans-serif`;
    ctxF.fillText("Arrastra aqui una imagen o un video,", cvF.width / 2, cvF.height / 2 - 12 * d);
    ctxF.fillText("o usa «Abrir archivos», «Pegar» (Ctrl+V) o ＋", cvF.width / 2, cvF.height / 2 + 12 * d); ctxF.textAlign = "start";
    return;
  }
  ctxF.imageSmoothingEnabled = vista.s < 2;
  ctxF.setTransform(vista.s, 0, 0, vista.s, vista.ox, vista.oy); ctxF.drawImage(F.img, 0, 0);
  ctxF.setTransform(1, 0, 0, 1, 0, 0);
  $("zNivel").textContent = `${Math.round((vista.s / (devicePixelRatio || 1)) * 100)}%`;
  const E = esquinas(F), P = editables(F);
  if (modo() === "aristas") {
    for (let k = 0; k + 1 < P.length; k += 2) {
      const [p, q] = RP.rectaExtendida(P[k], P[k + 1], Math.max(F.w, F.h) * 2);
      linea(p, q, COLORES[k >> 1], 1, true);
    }
    P.forEach((p, i) => marca(p, COLORES[i >> 1], `${RP.ARISTAS[i >> 1][0].toUpperCase()}${(i & 1) + 1}`, i === sel));
  }
  if (E.length > 1) {
    for (let i = 0; i < E.length - (E.length === 4 ? 0 : 1); i++) linea(E[i], E[(i + 1) % E.length], "rgba(126,224,178,.95)", 1.8);
  }
  if (modo() === "esquinas") P.forEach((p, i) => marca(p, COLORES[E.length === 4 ? E.indexOf(p) : i] || "#fff", String(i + 1), i === sel));
  else if (modo() === "control") dibujarControl(F, E);
  else E.forEach((p, i) => marca(p, "#ffffff", ["SI", "SD", "ID", "II"][i], false));
  $("infoGeo").textContent = E.length === 4 && modoNativo() ? `${Math.round(E[1][0] - E[0][0])} x ${Math.round(E[3][1] - E[0][1])} px (1:1, sin rectificar)` : E.length === 4 ? `aspecto aparente ${RP.aspectoAparente(E).toFixed(2)} → forma ${(+document.querySelector('[data-p="anchoCm"]').value / +document.querySelector('[data-p="altoCm"]').value).toFixed(2)}${typeof textoAspecto === "function" ? textoAspecto() : ""}` : "";
  $("barraControl").hidden = modo() !== "control";
  $("ayudaGeo").innerHTML = modo() === "completa" ? "Se trabaja con la imagen entera, sin rectificar: los ajustes se aplican a toda ella. Arrastra para mover la vista."
    : modo() === "recorte" ? "Clic en dos esquinas opuestas del rectangulo a recortar (luego se pueden arrastrar). La salida es esa zona tal cual, sin rectificar."
    : modo() === "esquinas"
    ? "Clic: 4 esquinas en cualquier orden (se ordenan solas). Arrastra un punto para corregirlo (o flechas: 0.1 px, Mayus 1 px). Arrastra la imagen para moverla; rueda: zoom."
    : modo() === "control"
    ? "Clic: 4 o mas puntos del objeto. Antes de cada clic elige que punto es (su posicion real en cm). La homografia se ajusta por minimos cuadrados y el residuo de cada punto dice si encaja: con mas de 4, un punto mal marcado se delata."
    : "Clic: 2 puntos sobre cada borde en orden <b class='p1'>superior</b>, <b class='p2'>derecha</b>, <b class='p3'>inferior</b>, <b class='p4'>izquierda</b>. Las esquinas son las intersecciones: sirve aunque una esquina este tapada o borrosa.";
  tablaPuntos();
}
function dibujarLupa(cx, cy) {
  const F = F0(); if (!F) return;
  const [x, y] = aImg(cx, cy), R = 9, Z = 150 / (2 * R + 1);
  lupa.imageSmoothingEnabled = false; lupa.fillStyle = "#000"; lupa.fillRect(0, 0, 150, 150);
  lupa.drawImage(F.img, x - R - 0.5, y - R - 0.5, 2 * R + 1, 2 * R + 1, 0, 0, 150, 150);
  lupa.strokeStyle = "rgba(90,169,255,.9)"; lupa.beginPath(); lupa.moveTo(75, 0); lupa.lineTo(75, 150); lupa.moveTo(0, 75); lupa.lineTo(150, 75); lupa.stroke();
  editables(F).forEach(([px, py], i) => { lupa.strokeStyle = COLORES[modo() === "aristas" ? i >> 1 : i]; lupa.beginPath(); lupa.arc(75 + (px - x) * Z, 75 + (py - y) * Z, 4, 0, 7); lupa.stroke(); });
}
function tablaPuntos() {
  if (modo() === "control") { tablaControl(); return; }
  const tb = $("tablaPts"), P = editables(), E = esquinas(); tb.innerHTML = "";
  const nombres = { esquinas: ["1", "2", "3", "4"], recorte: ["esquina A", "esquina B"], completa: [] }[modo()] || RP.ARISTAS.flatMap((a) => [`${a} 1`, `${a} 2`]);
  nombres.forEach((n, i) => {
    const p = P[i], tr = document.createElement("tr"), cls = `p${(modo() === "aristas" ? i >> 1 : i) + 1}`;
    tr.innerHTML = `<td class="${cls}">${n}</td>` + (p
      ? `<td><input type="number" step="0.1" value="${p[0].toFixed(2)}" data-i="${i}" data-k="0"></td><td><input type="number" step="0.1" value="${p[1].toFixed(2)}" data-i="${i}" data-k="1"></td><td>${i === sel ? "◀" : ""}</td>`
      : `<td colspan="3" class="ayuda">pendiente</td>`);
    tb.appendChild(tr);
  });
  if (E.length === 4) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="ayuda">esquinas: ${E.map((p, i) => `${["SI", "SD", "ID", "II"][i]} (${p[0].toFixed(1)}, ${p[1].toFixed(1)})`).join(" · ")}</td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll("input").forEach((inp) => (inp.onchange = () => { P[+inp.dataset.i][+inp.dataset.k] = parseFloat(inp.value); dibujarFuente(); procesar(); }));
}
cvF.addEventListener("contextmenu", (e) => e.preventDefault());
// eventos pointer: el mismo codigo sirve al raton, al dedo y al lapiz (el dedo, con un radio de agarre mayor)
cvF.addEventListener("pointerdown", (e) => {
  const F = F0(); if (!F || !e.isPrimary) return;
  const [cx, cy] = posRaton(e), P = editables(F), radio = e.pointerType === "touch" ? 24 : 12;
  const cerca = P.findIndex(([x, y]) => { const [a, b] = aCanvas(x, y); return Math.hypot(a - cx, b - cy) < radio * (devicePixelRatio || 1); });
  if (e.button === 0 && cerca >= 0) arrastrando = sel = cerca;
  else if (e.button === 0) clicPendiente = { cx, cy, ox: vista.ox, oy: vista.oy, movido: false }; // clic = punto; arrastrar = mover la vista
  else paneando = [cx, cy, vista.ox, vista.oy];
  dibujarFuente();
});
window.addEventListener("pointermove", (e) => {
  if (!F0() || !e.isPrimary) return;
  const [cx, cy] = posRaton(e);
  if (arrastrando >= 0) { editables()[arrastrando] = aImg(cx, cy); dibujarFuente(); procesar(); }
  else if (clicPendiente) {
    const c = clicPendiente;
    if (!c.movido && Math.hypot(cx - c.cx, cy - c.cy) > 4 * (devicePixelRatio || 1)) { c.movido = true; cvF.style.cursor = "grabbing"; }
    if (c.movido) { vista.ox = c.ox + cx - c.cx; vista.oy = c.oy + cy - c.cy; dibujarFuente(); }
  } else if (paneando) { vista.ox = paneando[2] + cx - paneando[0]; vista.oy = paneando[3] + cy - paneando[1]; dibujarFuente(); }
  if (e.target === cvF) dibujarLupa(cx, cy);
});
let clicPendiente = null;
function soltarLienzo(e) {
  if (!e.isPrimary) return;
  const c = e.type === "pointercancel" ? null : clicPendiente, F = F0(); clicPendiente = null; cvF.style.cursor = "";
  if (c && !c.movido && F) { // clic sin mover: anade un punto si caben mas
    const P = editables(F);
    if (P.length < maxPuntos()) { P.push(aImg(c.cx, c.cy)); if (modo() === "control") anotarReferencia(F); sel = P.length - 1; dibujarFuente(); procesar(); }
  }
  arrastrando = -1; paneando = null;
}
window.addEventListener("pointerup", soltarLienzo);
window.addEventListener("pointercancel", soltarLienzo);
cvF.addEventListener("wheel", (e) => { e.preventDefault(); const [cx, cy] = posRaton(e); zoomEn(e.deltaY < 0 ? 1.2 : 1 / 1.2, cx, cy); }, { passive: false });
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) && e.target.type !== "range") return;
  if (e.key === "," || e.key === "PageUp") { carrusel.mover(-1); return; }
  if (e.key === "." || e.key === "PageDown") { carrusel.mover(1); return; }
  const P = editables();
  if (sel < 0 || !P[sel]) return;
  const d = e.shiftKey ? 1 : 0.1, m = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
  if (!m) return; e.preventDefault(); P[sel][0] += m[0]; P[sel][1] += m[1]; dibujarFuente(); procesar();
});
window.addEventListener("resize", () => { dibujarFuente(); if (F0()) carrusel.render(fuentes.map((x) => ({ src: x.mini, titulo: x.nombre })), actual); });
document.querySelectorAll('input[name="modoGeo"]').forEach((r) => (r.onchange = () => { sel = -1; dibujarFuente(); procesar(); }));
$("autoOrden").onchange = () => { dibujarFuente(); procesar(); };
$("btnReiniciar").onclick = () => { const F = F0(); if (F) { if (modo() === "esquinas") F.esquinas = []; else if (modo() === "aristas") F.aristas = []; else if (modo() === "recorte") F.recorte = []; else if (modo() === "control") { F.control = []; F.controlRef = []; } } sel = -1; dibujarFuente(); procesar(); };

// ============================================================ rectificacion
function parametros() {
  const P = {};
  document.querySelectorAll("[data-p]").forEach((el) => {
    P[el.dataset.p] = el.type === "checkbox" ? el.checked : el.type === "range" || el.type === "number" ? +el.value : el.value;
  });
  P.rot90 = rot90; P.modoGeometria = modo(); P.ordenFiltros = RP.ORDEN;
  return P;
}
// correspondencia salida -> imagen: (x, y) en pixeles de la salida (centro del pixel u en u + 0.5) a la posicion en la
// fuente, con margen, trapecio, giro y espejos. La usan warp y la superresolucion (superres.js)
function mapaSalida(E, P, w, h) {
  const m = P.margenPct / 100;
  const H = RP.homografia(RP.rectTrapecio(w * m, h * m, w * (1 - m), h * (1 - m), P.trapH, P.trapV), E);
  const ang = ((P.giroFino + P.rot90) * Math.PI) / 180, co = Math.cos(ang), si = Math.sin(ang);
  const vertical = ((P.rot90 % 180) + 180) % 180 === 90, W2 = vertical ? h : w, H2 = vertical ? w : h;
  const f = (x, y) => {
    let du = x - W2 / 2, dv = y - H2 / 2;
    if (P.espejo) du = -du;
    if (P.espejoV) dv = -dv;
    return RP.aplicarH(H, co * du + si * dv + w / 2, -si * du + co * dv + h / 2);
  };
  return { f, W2, H2 };
}
function warp(F, E, P, w, h, nucleo) {
  const { f, W2, H2 } = mapaSalida(E, P, w, h);
  const muestra = RP.muestreador(F.datos.data, F.w, F.h, 4, nucleo), rgb = new Float32Array(W2 * H2 * 3), t = [0, 0, 0];
  for (let v = 0; v < H2; v++) for (let u = 0; u < W2; u++) {
    const [sx, sy] = f(u + 0.5, v + 0.5);
    muestra(sx, sy, t);
    const k = (v * W2 + u) * 3; rgb[k] = t[0]; rgb[k + 1] = t[1]; rgb[k + 2] = t[2];
  }
  return { w: W2, h: H2, rgb };
}
// tamano de la salida: rectificando, el alto elegido y la proporcion de la forma; sin rectificar (imagen completa o
// recorte), los pixeles de la zona tal cual (1:1)
function dimsSalida(F, P, E = esquinas(F)) {
  if (modoNativo() && E.length === 4) return [Math.max(1, Math.round(E[1][0] - E[0][0])), Math.max(1, Math.round(E[3][1] - E[0][1]))];
  return [Math.round((P.altoPx * P.anchoCm) / P.altoCm), P.altoPx];
}
function rectificarPlano(F, P) {
  const E = esquinas(F), [w, h] = dimsSalida(F, P, E);
  ultimosPasos = null;
  if (P.interp !== "escalera") return warp(F, E, P, w, h, P.interp);
  const [a, b, c, d] = E, L = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const hn = Math.max(4, Math.round((L(a, d) + L(b, c)) / 2)), wn = Math.max(4, Math.round((hn * P.anchoCm) / P.altoCm));
  const base = warp(F, E, P, wn, hn, "bicubica"), vertical = base.w !== wn;
  const e = RP.escalera(base.rgb, base.w, base.h, vertical ? h : w, vertical ? w : h);
  ultimosPasos = { nativo: [base.w, base.h], pasos: e.pasos };
  return e;
}
let pendiente = false;
function procesar() { if (!pendiente) { pendiente = true; requestAnimationFrame(() => { pendiente = false; procesarYa(); }); } }
function procesarYa() {
  document.querySelectorAll("[data-v]").forEach((s) => { const el = document.querySelector(`[data-p="${s.dataset.v}"]`); if (el) s.textContent = el.value; });
  $("vZoom").textContent = +(+$("zoomSalida").value).toFixed(2) + "x";
  ["altoTxt", "anchoTxt", "estVTxt", "grosorTxt", "espTxt"].forEach((k) => ($("v" + k[0].toUpperCase() + k.slice(1)).textContent = +(+$(k).value).toFixed(2)));
  if (typeof actualizarAspectoAuto === "function") actualizarAspectoAuto(); // preset "auto" (control.js): fija el ancho real antes de leer los parametros
  const P = parametros();
  $("descNucleo").textContent = P.interp === "escalera" ? "reduce/amplia por pasos de x2 (bicubica) y ajusta al final" : (RP.NUCLEOS[P.interp] || {}).desc || "";
  if (!F0() || esquinas().length < 4) { // sin geometria no hay salida: tampoco una anterior que se pueda exportar por error
    ctxS.clearRect(0, 0, cvS.width, cvS.height); $("infoSalida").textContent = ""; limpia = null; ultimaPlana = null; histograma(null);
    const faltan = { esquinas: "Marca las 4 esquinas de la zona en el lienzo (clic en cada una)", aristas: "Marca 2 puntos sobre cada borde de la zona en el lienzo",
      control: "Marca 4 o mas puntos de referencia en el lienzo", recorte: "Marca dos esquinas opuestas del recorte en el lienzo" }[modo()];
    $("salidaVacia").textContent = !F0() ? "Aqui aparecera el resultado" : `${faltan || ""}. Para trabajar con la imagen entera elige «imagen completa».`;
    return;
  }
  $("salidaVacia").textContent = "";
  const t0 = performance.now();
  let plana = rectificarPlano(F0(), P);
  ultimaPlana = plana;
  if ($("verPila").checked && pila.length) plana = apilado(plana);
  limpia = RP.cadenaAjustes(plana, P);
  const z = +$("zoomSalida").value, tmp = document.createElement("canvas");
  tmp.width = limpia.width; tmp.height = limpia.height; tmp.getContext("2d").putImageData(limpia, 0, 0);
  cvS.width = Math.max(1, Math.round(limpia.width * z)); cvS.height = Math.max(1, Math.round(limpia.height * z));
  ctxS.imageSmoothingEnabled = false; ctxS.drawImage(tmp, 0, 0, cvS.width, cvS.height);
  dibujarPlantilla();
  if (typeof colocarSalida === "function") colocarSalida(); // vistas.js: ventana con zoom y arrastre
  histograma(plana);
  $("infoSalida").textContent = `${limpia.width}x${limpia.height} · ${(performance.now() - t0).toFixed(0)} ms` + (ultimosPasos ? ` · escalera ${ultimosPasos.nativo.join("x")} ${ultimosPasos.pasos.join(" ")}` : "");
}

// ============================================================ histograma: region rectificada (lo que se ve) o imagen completa (original)
let ultimoHisto = null;
function histograma(entrada) {
  const completa = $("histoAmbito").value === "completa", F = F0();
  $("histoRef").disabled = completa; // la entrada al ajuste solo existe para la region
  let H = null, ref = null;
  if (completa && F) H = F.histo || (F.histo = RP.histograma(F.datos)); // sin ajustes: se calcula una vez por imagen
  else if (!completa && entrada && limpia) { H = RP.histograma(limpia); if ($("histoRef").checked) ref = RP.histograma(entrada); }
  if (!H) { ultimoHisto = null; RP.dibujarHistograma($("histo"), null); $("histoInfo").textContent = ""; return; }
  const e = RP.estadisticasHisto(H);
  ultimoHisto = { H, e, ambito: completa ? "completa" : "region" };
  RP.dibujarHistograma($("histo"), H, ref, $("histoLog").checked);
  const fila = (c) => `${c} ${String(e[c].min).padStart(3)}–${String(e[c].max).padEnd(3)} μ${e[c].media.toFixed(0).padStart(3)}${e[c].bajo >= 0.05 || e[c].alto >= 0.05 ? `  recorte ${e[c].bajo.toFixed(1)}% / ${e[c].alto.toFixed(1)}%` : ""}`;
  $("histoInfo").textContent = ["R", "G", "B"].map(fila).join("\n");
}
const redibujarHisto = () => histograma(F0() && esquinas().length === 4 ? ultimaPlana : null);
$("histoRef").onchange = $("histoLog").onchange = $("histoAmbito").onchange = redibujarHisto;
new ResizeObserver(() => { if (ultimoHisto) redibujarHisto(); }).observe($("histo"));

// ============================================================ plantilla
function dibujarPlantilla() {
  const W = cvS.width, H = cvS.height;
  if ($("celdas").checked) {
    const n = +$("nCeldas").value; ctxS.strokeStyle = "rgba(255,210,77,.6)";
    for (let i = 1; i < n; i++) { ctxS.beginPath(); ctxS.moveTo((W * i) / n, 0); ctxS.lineTo((W * i) / n, H); ctxS.stroke(); }
  }
  // se pinta tal cual se escribe (espacios incluidos: "P 123ABC", "CENTRO AMERICA"); el formato se valida sin ellos
  const txt = $("plantilla").value.toUpperCase().trim(), ok = RP.FORMATO_GT.test(RP.normalizarTexto(txt));
  $("formato").textContent = txt ? (ok ? "formato GT valido" : "formato GT NO valido") : "";
  $("formato").style.color = ok ? "#7ee0b2" : "#ff6b6b";
  if (!txt) return;
  RP.dibujarHipotesis(ctxS, txt, plantillaParams(), $("opPlantilla").value / 100);
}
// parametros de la plantilla de hipotesis (van al registro JSON para reproducirla)
function plantillaParams() {
  return { altoPct: +$("altoTxt").value, anchoPct: +$("anchoTxt").value, estVPct: +$("estVTxt").value, grosorPct: +$("grosorTxt").value,
    esp: +$("espTxt").value, dxPct: +$("dxTxt").value, dyPct: +$("dyTxt").value, fuente: $("fuenteTxt").value, negrita: $("negritaTxt").checked,
    pasoFijo: $("pasoFijoTxt").checked };
}

// ============================================================ exportar / reproducir
function descargar(nombre, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre; a.click(); }
// formatos disponibles en este navegador (los propios siempre)
const exportaciones = [];
RP.FORMATOS.forEach((f) => {
  if (f.navegador && !RP.soportaMime(f.mime)) return;
  const o = document.createElement("option"); o.value = f.id; o.textContent = f.nombre; $("formatoExp").appendChild(o);
});
function infoFormato() {
  const f = RP.FORMATOS.find((x) => x.id === $("formatoExp").value);
  $("vCalidad").textContent = (+$("calidadExp").value).toFixed(2);
  $("calidadExp").disabled = !f.perdida;
  $("avisoExp").textContent = f.perdida ? "Formato con perdida: anade artefactos sobre los caracteres. Para conservar los pixeles usa PNG, TIFF, BMP o PPM." : "";
}
$("formatoExp").onchange = infoFormato; $("calidadExp").oninput = infoFormato; infoFormato();
function imagenAExportar() {
  const c = $("contenidoExp").value, F = F0();
  if (c === "fuente") return F ? F.datos : null;
  if (c === "salidaPlantilla") return cvS.width ? ctxS.getImageData(0, 0, cvS.width, cvS.height) : null;
  if (c === "vistaSalida" || c === "vistaLienzo") { const v = c === "vistaSalida" ? RP.capturaSalidaVisible() : RP.capturaLienzo(); return v ? v.getContext("2d").getImageData(0, 0, v.width, v.height) : null; }
  if (c === "pila") {
    if (!pila.length || !ultimaPlana) return null;
    const a = apilado(ultimaPlana), n = a.w * a.h;
    return RP.aImageData([0, 1, 2].map((k) => Float32Array.from({ length: n }, (_, i) => a.rgb[i * 3 + k])), a.w, a.h);
  }
  return limpia;
}
async function exportar() {
  const img0 = imagenAExportar();
  if (!img0) { alert("No hay nada que exportar con ese contenido"); return; }
  const esc = ["salidaPlantilla", "vistaSalida", "vistaLienzo"].includes($("contenidoExp").value) ? 1 : +$("escalaExp").value;
  const img = RP.escalarEntero(img0, esc), fmt = $("formatoExp").value;
  try {
    const { blob, ext } = await RP.codificar(img, fmt, +$("calidadExp").value);
    const hs = await RP.hashes(await blob.arrayBuffer()), sha = hs.sha256, nombre = `${RP.sello()}_${$("contenidoExp").value}.${ext}`;
    descargar(nombre, blob);
    const reg = { fichero: nombre, formato: fmt, contenido: $("contenidoExp").value, escala: esc, ancho: img.width, alto: img.height,
      bytes: blob.size, sha256: sha, md5: hs.md5, sha1: hs.sha1, sha512: hs.sha512, calidad: RP.FORMATOS.find((x) => x.id === fmt).perdida ? +$("calidadExp").value : null, fecha: new Date().toISOString() };
    exportaciones.push(reg);
    const li = document.createElement("li"); li.textContent = `${nombre} · ${blob.size} B · sha256 ${sha.slice(0, 16)}… · md5 ${hs.md5}`; li.title = RP.informeHashes(hs); $("listaExport").prepend(li);
    $("infoExport").textContent = `${exportaciones.length} guardadas`;
  } catch (err) { alert("No se pudo exportar: " + err.message); }
}
$("btnExportar").onclick = exportar; $("btnExportarRapido").onclick = exportar;
async function copiar() {
  const img0 = imagenAExportar();
  if (!img0) { alert("No hay nada que copiar con ese contenido"); return; }
  const esc = ["salidaPlantilla", "vistaSalida", "vistaLienzo"].includes($("contenidoExp").value) ? 1 : +$("escalaExp").value, img = RP.escalarEntero(img0, esc);
  try {
    const { blob } = await RP.codificar(img, "png");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    const sha = await RP.sha256(await blob.arrayBuffer());
    exportaciones.push({ fichero: "(portapapeles)", formato: "png", contenido: $("contenidoExp").value, escala: esc, ancho: img.width, alto: img.height,
      bytes: blob.size, sha256: sha, calidad: null, fecha: new Date().toISOString() });
    const li = document.createElement("li"); li.textContent = `portapapeles (PNG) · ${blob.size} B · sha256 ${sha.slice(0, 16)}…`; $("listaExport").prepend(li);
    $("ocupado").textContent = "copiado al portapapeles";
  } catch (err) { alert("No se pudo copiar al portapapeles: " + err.message + " (el navegador puede pedir permiso)"); }
}
$("btnCopiar").onclick = copiar; $("btnCopiarRapido").onclick = copiar;
$("btnPegar").onclick = async () => {
  try {
    let n = 0;
    for (const it of await navigator.clipboard.read()) {
      const tipo = it.types.find((t) => t.startsWith("image/"));
      if (!tipo) continue;
      const blob = await it.getType(tipo);
      await cargarArchivo(new File([blob], `portapapeles_${RP.sello()}.${tipo.split("/")[1]}`, { type: tipo })); n++;
    }
    if (!n) alert("El portapapeles no contiene una imagen");
  } catch (err) { alert("No se pudo leer el portapapeles: " + err.message + ". Prueba con Ctrl+V."); }
};
// registro reproducible del estado actual (lo usan el boton JSON y el informe de analisis)
function registro() {
  const F = F0(), P = parametros();
  return {
    herramienta: "perspectiva.html", fecha: new Date().toISOString(),
    fuente: F ? { tipo: F.tipo, nombre: F.nombre, sha256: F.sha256, origen: F.origen, ancho: F.w, alto: F.h,
      derivado: F.derivado || null, integridad: (F.archivo && F.archivo.integridad) || null, ela: F.ela || null, mapa: F.mapa || null,
      hashesArchivo: (F.archivo && F.archivo.hashes) || (F.origen && (videos.find((v) => v.sha256 === F.origen.sha256Video) || {}).archivo?.hashes) || null } : null,
    geometria: F ? { modo: modo(), esquinas_marcadas: F.esquinas, aristas_marcadas: F.aristas, recorte_marcado: F.recorte, control_marcados: F.control, control_referencias: F.controlRef,
      control_residuo: F.controlRes, aspecto_estimado: ultimoAspecto, preset: $("preset").value, ordenar: $("autoOrden").checked } : null,
    esquinas_TL_TR_BR_BL: F ? esquinas(F).map((p) => p.map((v) => +v.toFixed(3))) : [], parametros: P,
    escalera: ultimosPasos, nucleo: (RP.NUCLEOS[P.interp] || {}).desc || P.interp,
    apilado: $("verPila").checked ? infoApilado() : null,
    retiradas: typeof retiradas !== "undefined" ? retiradas : [],
    vista: RP.datosVista ? RP.datosVista() : null, // navegador, ventana, densidad de pixeles, zooms y encuadres (vistas.js)
    plantilla: $("plantilla").value || null, plantillaParametros: $("plantilla").value ? plantillaParams() : null,
    comparacion: typeof ultimoRanking !== "undefined" && ultimoRanking ? { ...ultimoRanking, polaridadClara: $("textoClaro").checked } : null, exportaciones,
    nota: "Reproducible cargando la misma fuente (mismo SHA-256; si es fotograma, el mismo video y t) y este JSON.",
  };
}
$("btnJson").onclick = () => {
  descargar(`${RP.sello()}_rectificacion.json`, new Blob([JSON.stringify(registro(), null, 2)], { type: "application/json" }));
};
$("cargarJson").onchange = async (e) => {
  const r = JSON.parse(await e.target.files[0].text()); e.target.value = "";
  let i = fuentes.findIndex((F) => F.sha256 === r.fuente?.sha256);
  if (i < 0 && r.fuente?.origen) {
    const k = videos.findIndex((v) => v.sha256 === r.fuente.origen.sha256Video);
    if (k >= 0) { $("selVideo").value = k; activarVideo(k); await new Promise((ok) => (video.readyState >= 1 ? ok() : video.addEventListener("loadedmetadata", ok, { once: true }))); await capturarEn(r.fuente.origen.t); i = fuentes.length - 1; }
  }
  if (i < 0) { alert("Carga primero la fuente del registro: SHA-256 " + (r.fuente?.origen?.sha256Video || r.fuente?.sha256)); return; }
  const g = r.geometria || { modo: "esquinas", esquinas_marcadas: r.esquinas_TL_TR_BR_BL, aristas_marcadas: [] };
  fuentes[i].esquinas = g.esquinas_marcadas.map((p) => [...p]); fuentes[i].aristas = (g.aristas_marcadas || []).map((p) => [...p]); fuentes[i].recorte = (g.recorte_marcado || []).map((p) => [...p]);
  fuentes[i].control = (g.control_marcados || []).map((p) => [...p]); fuentes[i].controlRef = (g.control_referencias || []).map((c) => ({ id: c.id, xy: [...c.xy] }));
  if (g.preset) $("preset").value = g.preset;
  document.querySelector(`input[name="modoGeo"][value="${g.modo}"]`).checked = true; $("autoOrden").checked = g.ordenar !== false;
  rot90 = r.parametros.rot90 || 0;
  document.querySelectorAll("[data-p]").forEach((el) => { const v = r.parametros[el.dataset.p]; if (v === undefined) return; if (el.type === "checkbox") el.checked = !!v; else el.value = v; });
  if (r.plantilla) $("plantilla").value = r.plantilla;
  if (r.plantillaParametros) {
    const q = r.plantillaParametros, ids = { altoPct: "altoTxt", anchoPct: "anchoTxt", estVPct: "estVTxt", grosorPct: "grosorTxt", esp: "espTxt", dxPct: "dxTxt", dyPct: "dyTxt", fuente: "fuenteTxt" };
    for (const [k, id] of Object.entries(ids)) if (q[k] !== undefined) $(id).value = q[k];
    if (q.negrita !== undefined) $("negritaTxt").checked = !!q.negrita;
    if (q.pasoFijo !== undefined) $("pasoFijoTxt").checked = !!q.pasoFijo;
  }
  seleccionar(i);
};

// ============================================================ configuracion: leer / aplicar / restablecer
function leerConfig() {
  const c = {};
  document.querySelectorAll("[data-p]").forEach((el) => (c[el.dataset.p] = el.type === "checkbox" ? el.checked : el.value));
  c.__rot90 = rot90;
  return c;
}
function aplicarConfig(c, soloClaves = null) {
  document.querySelectorAll("[data-p]").forEach((el) => {
    const k = el.dataset.p;
    if ((soloClaves && !soloClaves.includes(k)) || c[k] === undefined) return;
    if (el.type === "checkbox") el.checked = !!c[k]; else el.value = c[k];
  });
  if (!soloClaves && c.__rot90 !== undefined) rot90 = c.__rot90;
  dibujarFuente(); procesar();
}
// Firefox restaura al recargar el estado de los controles de la sesion anterior (p. ej. "escala de
// grises" marcada): se vuelve a los valores escritos en el HTML ANTES de tomarlos como defecto.
function valoresDelHtml() {
  document.querySelectorAll("input, select").forEach((el) => {
    if (el.type === "file") return;
    if (el.type === "checkbox" || el.type === "radio") el.checked = el.defaultChecked;
    else if (el.tagName === "SELECT") { const o = [...el.options].find((x) => x.defaultSelected) || el.options[0]; if (o) el.value = o.value; }
    else el.value = el.defaultValue;
  });
}
valoresDelHtml();
const DEFECTO = leerConfig(); // valores del HTML (no los restaurados por el navegador)
$("btnResetTodo").onclick = () => { aplicarConfig(DEFECTO); if (F0() && $("modoConfig").value !== "mantener") F0().config = leerConfig(); };
$("modoConfig").onchange = () => { if (F0()) { F0().config = leerConfig(); seleccionar(actual); } };
// boton ↺ en cada bloque del panel con controles: restablece solo ese bloque
document.querySelectorAll("#panel details.bloque").forEach((b) => {
  const claves = [...b.querySelectorAll("[data-p]")].map((el) => el.dataset.p);
  if (!claves.length) return;
  const bt = document.createElement("button");
  bt.className = "chico reset"; bt.textContent = "↺"; bt.title = "Restablecer este bloque";
  bt.onclick = (e) => { e.preventDefault(); e.stopPropagation(); aplicarConfig(DEFECTO, claves); if (b.querySelector("#btnMas90")) { rot90 = 0; procesar(); } };
  b.querySelector("summary").appendChild(bt);
});

// ============================================================ controles
$("preset").onchange = () => { const v = $("preset").value; if (v !== "libre" && v !== "auto") { const [a, b] = v.split("x"); document.querySelector('[data-p="anchoCm"]').value = a; document.querySelector('[data-p="altoCm"]').value = b; } dibujarFuente(); procesar(); };
$("btnColorNeutro").onclick = () => {
  const def = { gananciaR: 1, gananciaG: 1, gananciaB: 1, temperatura: 0, saturacion: 1, tono: 0, modoGris: "color", mezclaR: 1, mezclaG: 0, mezclaB: 0 };
  for (const [k, v] of Object.entries(def)) document.querySelector(`[data-p="${k}"]`).value = v;
  if (grisPorColor) document.querySelector('[data-p="gris"]').checked = false; // solo si lo marco el bloque Color
  grisPorColor = false;
  procesar();
};
// elegir de que se saca el gris (bloque Color) activa la escala de grises (bloque Luminancia): si no, no hacia nada
let grisPorColor = false;
document.querySelector('[data-p="gris"]').addEventListener("change", () => (grisPorColor = false)); // la decide el usuario
const marcarGris = () => { const g = document.querySelector('[data-p="gris"]'); if (!g.checked) { g.checked = true; grisPorColor = true; procesar(); } };
// "normal (color)" deshace la escala de grises (desde cualquier gris se puede volver); cualquier otro gris la activa
document.querySelector('[data-p="modoGris"]').addEventListener("change", (e) => {
  if (e.target.value !== "color") { marcarGris(); return; }
  document.querySelector('[data-p="gris"]').checked = false; grisPorColor = false; procesar();
});
["mezclaR", "mezclaG", "mezclaB"].forEach((k) => document.querySelector(`[data-p="${k}"]`).addEventListener("input", () => {
  const m = document.querySelector('[data-p="modoGris"]'); if (m.value !== "mezcla") m.value = "mezcla"; marcarGris();
}));
$("btnMas90").onclick = () => { rot90 = (rot90 + 90) % 360; procesar(); };
$("btnMenos90").onclick = () => { rot90 = (rot90 + 270) % 360; procesar(); };
$("ttf").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const nombre = f.name.replace(/\.[^.]+$/, ""), ff = new FontFace(nombre, await f.arrayBuffer());
  await ff.load(); document.fonts.add(ff);
  const o = document.createElement("option"); o.textContent = nombre; $("fuenteTxt").appendChild(o); $("fuenteTxt").value = nombre; procesar();
};
const SIN_PROCESO = ["ghostQ", "mapaOpacidad", "elaCalidad", "elaAmp", "elaAuto", "degTipo", "degSigma", "degBloque", "degOx", "degOy", "degFijar", "textoClaro", "candidatos", "refControl", "refX", "refY", "archivo", "selArchivo", "histoRef", "histoLog", "histoAmbito", "ttf", "cargarJson", "selVideo", "fps", "rDesde", "rHasta", "rPaso", "nRango", "formatoExp", "calidadExp", "contenidoExp", "escalaExp", "modoConfig", "copiarGeo",
  "autoSeguir", "autoApilar", "alinPila", "rParche", "rBusqueda", "nccMin"];
document.querySelectorAll("input, select").forEach((el) => { if (!SIN_PROCESO.includes(el.id) && el.name !== "modoGeo") el.addEventListener("input", procesar); });
// fuentes: libres (OFL, versionadas en fuentes/fuentes_libres.js) y locales opcionales
// (_local/fonts/fuentes_embebidas.js, generado; no versionado). Cada una en su grupo del selector.
async function registrarFuentes(lista, grupo, elegir) {
  if (!lista.length) return;
  const og = document.createElement("optgroup"); og.label = grupo;
  for (const f of lista) {
    try {
      const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      const ff = new FontFace(f.familia, bin.buffer); await ff.load(); document.fonts.add(ff);
      const o = document.createElement("option"); o.textContent = f.familia; o.title = `${f.archivo} · sha256 ${f.sha256}`; og.appendChild(o);
    } catch (err) { console.warn("fuente no cargada:", f.familia, err.message); }
  }
  if (og.children.length) { $("fuenteTxt").appendChild(og); if (elegir) $("fuenteTxt").value = og.children[0].value; procesar(); }
}
registrarFuentes((window.RP && RP.FUENTES_LIBRES) || [], "libres (OFL)", false);
(() => { // solo abriendo el fichero en local: publicada en un servidor no pide nada fuera de su carpeta
  // solo si se pide (?fuentes=locales) y en local: por defecto no se pide nada que pueda no existir (la consola queda limpia)
  if (location.protocol !== "file:" || !/[?&]fuentes=locales\b/.test(location.search)) return;
  const s = document.createElement("script");
  s.src = "../../_local/fonts/fuentes_embebidas.js";
  s.onload = () => registrarFuentes(RP.FUENTES_LOCALES || [], "locales (_local)", true);
  s.onerror = () => { /* sin fuentes locales: no es un error */ };
  document.head.appendChild(s);
})();
document.addEventListener("DOMContentLoaded", procesar); // tras cargar todos los modulos (apilado.js va despues)
