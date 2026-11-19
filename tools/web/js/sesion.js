// -----------------------------------------------------------------------------
// sesion.js — Gestion de la sesion: quitar imagenes, fotogramas y documentos (solo
// de la sesion: el fichero en disco no se toca), con registro de cada retirada
// (nombre, SHA-256, hora) para el registro JSON y el informe; anadir archivos;
// y la ayuda integrada (el manual, generado en ayuda_contenido.js).
// Usa el estado de app.js (fuentes, archivos, videos, actual, pila, carrusel...).
// Author: Saul López
// Date:   2026-11-16
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";

const retiradas = []; // { nombre, sha256, clase, fecha }
const anotarRetirada = (nombre, sha256, clase) => retiradas.push({ nombre, sha256, clase, fecha: new Date().toISOString() });

function vaciarVista() {
  carrusel.render([], -1);
  $("estado").textContent = "Sin imagenes: abre, arrastra o pega archivos"; $("hashInfo").textContent = "";
  limpiarIntegridad(); dibujarFuente(); procesar(); actualizarHerramientas();
}

// Quita la imagen o el fotograma i del carrusel (y su archivo, si es una imagen cargada)
function quitarFuente(i) {
  const F = fuentes[i]; if (!F) return;
  fuentes.splice(i, 1);
  for (let k = pila.length - 1; k >= 0; k--) if (pila[k].sha256 === F.sha256 && pila[k].fuente === F.nombre) pila.splice(k, 1);
  if (F.archivo && F.archivo.fuente === F && !F.archivo.retirado) retirarArchivo(F.archivo, false);
  anotarRetirada(F.nombre, F.sha256, F.tipo);
  actual = -1; sel = -1;
  if (fuentes.length) seleccionar(Math.min(i, fuentes.length - 1)); else vaciarVista();
  infoPila(); actualizarHerramientas();
}

// Quita un archivo de Metadatos (y del selector de video o del carrusel, segun su clase)
function retirarArchivo(A, anotar = true) {
  if (!A || A.retirado) return;
  A.retirado = true;
  const idx = archivos.indexOf(A), o = $("selArchivo").querySelector(`option[value="${idx}"]`); if (o) o.remove();
  if (A.clase === "video") {
    const ov = $("selVideo").querySelector(`option[value="${A.video}"]`); if (ov) ov.remove();
    if (!$("selVideo").options.length) { video.removeAttribute("src"); video.load(); $("bloqueVideo").hidden = true; }
    else { $("selVideo").value = $("selVideo").options[0].value; activarVideo(+$("selVideo").value); }
  }
  if (anotar) anotarRetirada(A.nombre, A.sha256, A.clase);
  if (A.clase === "imagen" && A.fuente && fuentes.includes(A.fuente)) quitarFuente(fuentes.indexOf(A.fuente));
  const s = $("selArchivo");
  if (s.options.length) { s.value = s.options[0].value; const B = archivos[+s.value]; mostrarArchivo(B); }
  else { $("metaInfo").textContent = "(sin archivo)"; $("hexInfo").textContent = "(sin archivo)"; $("entropia").hidden = true; $("incrustables").innerHTML = ""; $("tMeta").textContent = "imagen · video · archivo"; }
  actualizarHerramientas();
}

$("btnAnadir").onclick = () => $("archivo").click();
$("btnQuitarArchivo").onclick = () => { const A = archivos[+$("selArchivo").value]; if (A) retirarArchivo(A); };

// ---------------------------------------------------------------- ayuda
function abrirAyuda() {
  const a = window.RP && RP.AYUDA;
  $("ayudaCuerpo").innerHTML = a ? a.html : "<p>Falta js/ayuda_contenido.js: generarlo con <code>python3 -I tools/generar_ayuda_web.py</code>.</p>";
  $("ayudaOrigen").textContent = a ? `Generada desde el manual de uso (sha256 ${a.sha256Manual.slice(0, 16)}…)` : "";
  $("ayuda").hidden = false; $("ayudaCerrar").focus();
}
const cerrarAyuda = () => { $("ayuda").hidden = true; };
$("btnAyuda").onclick = abrirAyuda;
$("ayudaCerrar").onclick = cerrarAyuda;
$("ayuda").addEventListener("click", (e) => { if (e.target === $("ayuda")) cerrarAyuda(); }); // clic fuera de la ventana

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("ayuda").hidden) { cerrarAyuda(); return; }
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) && e.target.type !== "range") return;
  if (e.key === "F1" || e.key === "?") { e.preventDefault(); abrirAyuda(); return; }
  if (e.key === "Delete" && $("ayuda").hidden && F0()) { e.preventDefault(); quitarFuente(actual); }
});
