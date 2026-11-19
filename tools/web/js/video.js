// -----------------------------------------------------------------------------
// video.js — Navegacion por fotogramas y captura desde <video> (sin re-codificar:
// se copia el fotograma decodificado por el navegador a un canvas).
// Author: Saul López
// Date:   2026-11-13
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// pts (mediaTime) del fotograma presentado; lo actualiza requestVideoFrameCallback
RP.ptsPresentado = null;
const hayRVFC = typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;
const esperarPresentacion = (video) => new Promise((ok) => {
  if (!hayRVFC) return ok(null);
  let hecho = false;
  const id = video.requestVideoFrameCallback((_, m) => { hecho = true; RP.ptsPresentado = m.mediaTime; ok(m.mediaTime); });
  setTimeout(() => { if (!hecho) { video.cancelVideoFrameCallback(id); ok(RP.ptsPresentado); } }, 400);
});

// Busca t y espera a que el fotograma correspondiente se presente; devuelve su pts (o null)
RP.irA = async (video, t) => {
  t = Math.max(0, Math.min(video.duration || t, t));
  if (Math.abs(video.currentTime - t) < 1e-4) return RP.ptsPresentado;
  const presentado = esperarPresentacion(video);
  await new Promise((ok) => { video.addEventListener("seeked", ok, { once: true }); video.currentTime = t; });
  return presentado;
};

// Indice del fotograma que se ve en el instante t. Vale para los dos significados de mediaTime:
// Chromium da el pts del fotograma (a veces redondeado al ms: 0.133 -> 3.99 fotogramas) y Firefox
// el instante buscado (p. ej. el centro, 4.5). floor con 0.05 de holgura acierta en ambos.
RP.indiceFotograma = (t, fps) => Math.floor(t * fps + 0.05);
// Paso de +-n fotogramas: al CENTRO del fotograma destino (nunca a su frontera)
RP.pasoFotograma = (video, n, fps) => {
  const k = RP.indiceFotograma(RP.ptsPresentado ?? video.currentTime, fps);
  return RP.irA(video, (k + n + 0.5) / fps);
};

RP.capturar = async (video, t) => {
  const pts = t != null ? await RP.irA(video, t) : RP.ptsPresentado;
  const c = document.createElement("canvas");
  c.width = video.videoWidth; c.height = video.videoHeight;
  const cx = c.getContext("2d");
  cx.drawImage(video, 0, 0);
  const datos = cx.getImageData(0, 0, c.width, c.height);
  return { canvas: c, datos, t: pts ?? video.currentTime, tSolicitado: video.currentTime, pts,
    sha256Pixeles: await RP.sha256(datos.data.buffer.slice(0)) };
};

RP.miniatura = (fuente, alto = 40) => {
  const c = document.createElement("canvas"), w = fuente.width || fuente.videoWidth, h = fuente.height || fuente.videoHeight;
  c.height = alto; c.width = Math.max(1, Math.round((w * alto) / h));
  c.getContext("2d").drawImage(fuente, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
};
