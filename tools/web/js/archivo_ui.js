// -----------------------------------------------------------------------------
// archivo_ui.js — Bloque "Analisis de archivo": formato, codecs y pistas, estructura
// (cajas, segmentos o bloques con desplazamiento y tamano), entropia con su grafico,
// y el analisis hexadecimal de cabecera y fin. El calculo esta en estructura.js.
// Author: Saul López
// Date:   2026-11-19
// -----------------------------------------------------------------------------
"use strict";

// se calcula al cargar (en un video los bytes no se conservan despues) y sin bloquear la carga
function analizarArchivoDiferido(A, u8) {
  setTimeout(() => {
    A.estructura = RP.analizarEstructura(u8, A.analisis.tipo);
    if (+$("selArchivo").value === archivos.indexOf(A)) mostrarAnalisisArchivo(A);
  }, 0);
}

function mostrarAnalisisArchivo(A, prefijo = "") {
  $("hexInfo").textContent = prefijo + (A.estructura ? RP.informeEstructura(A.estructura, A.analisis) : "(analizando la estructura…)")
    + "\n\n— Cabecera y fin (hexadecimal) —\n" + RP.informeHex(A.analisis);
  dibujarEntropia(A.estructura ? A.estructura.entropia : null);
}

let ultimaEntropia = null;
function dibujarEntropia(e) {
  ultimaEntropia = e;
  const c = $("entropia"); c.hidden = !e; if (!e || !c.clientWidth) return; // plegado: se dibuja al abrir el bloque
  const d = devicePixelRatio || 1, W = c.clientWidth * d || 300, H = 60 * d; c.width = W; c.height = H;
  const x = c.getContext("2d"), n = e.porBloque.length, w = W / n;
  x.clearRect(0, 0, W, H);
  e.porBloque.forEach((v, i) => { x.fillStyle = v > 7.9 ? "#ff6b6b" : v > 7 ? "#ffd24d" : "#5aa9ff"; const h = (v / 8) * (H - 2); x.fillRect(i * w, H - h, Math.max(1, w - 1), h); });
  x.strokeStyle = "rgba(255,255,255,.25)"; x.beginPath(); x.moveTo(0, H * (1 - 7.9 / 8)); x.lineTo(W, H * (1 - 7.9 / 8)); x.stroke();
  c.title = `entropia por bloques de ${e.tamBloque} bytes, de principio a fin del fichero (0-8 bits/byte). Rojo: casi maxima (comprimido o cifrado)`;
}

// resumen para el informe de analisis: formato, pistas y entropia (sin el arbol completo)
function resumenArchivo(A) {
  if (!A || !A.estructura) return "";
  return RP.informeEstructura({ ...A.estructura, arbol: [] }, A.analisis);
}
$("entropia").closest("details").addEventListener("toggle", () => dibujarEntropia(ultimaEntropia));
