// -----------------------------------------------------------------------------
// version.js — Boton «Actualizar»: comprueba si el sitio tiene publicada una version
// mas nueva que la abierta y, si la hay, recarga la pagina.
// La version la incrusta tools/publicar_web.py en <meta name="perspectiva-version"> y
// la publica en version.json (huella del contenido). Se pide version.json sin cache y
// se recarga con ?v=<version>: una URL nueva obliga a traer el index.html fresco aunque
// el alojamiento lo tenga cacheado (los modulos ya llevan su propia huella).
// Solo pide un fichero del mismo origen; nada sale del sitio.
// Author: Saul López
// Date:   2026-11-19
// -----------------------------------------------------------------------------
"use strict";
(() => {
  const meta = document.querySelector('meta[name="perspectiva-version"]');
  const propia = meta ? meta.content : "desarrollo";
  const btn = document.getElementById("btnVersion");
  const aviso = (t) => { document.getElementById("estado").textContent = t; };
  // trabajo que se perderia al recargar: imagenes o archivos cargados en la sesion
  const hayTrabajo = () => (typeof fuentes !== "undefined" && fuentes.length > 0) ||
    (typeof archivos !== "undefined" && archivos.some((a) => !a.retirado));

  async function comprobar() {
    if (location.protocol === "file:") { aviso("Abierta como fichero local: no hay sitio con el que comparar la version"); return; }
    if (propia === "desarrollo") { aviso("Copia de desarrollo (sin publicar): no tiene version que comparar"); return; }
    btn.disabled = true; aviso("Comprobando si hay una version nueva…");
    try {
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`version.json respondio ${r.status}`);
      const { version } = await r.json();
      if (!version) throw new Error("version.json sin version");
      if (version === propia) { aviso(`Al dia: la version abierta (${propia}) es la publicada`); return; }
      const pregunta = `Hay una version nueva publicada (${version}; la abierta es ${propia}).` +
        (hayTrabajo() ? "\n\nRecargar descarta las imagenes, los puntos y los ajustes de esta sesion: exporta antes lo que necesites." : "") +
        "\n\n¿Recargar ahora?";
      if (confirm(pregunta)) location.replace(`${location.pathname}?v=${encodeURIComponent(version)}${location.hash}`);
      else aviso(`Hay una version nueva (${version}) sin cargar: pulsa Actualizar cuando quieras recargar`);
    } catch (e) {
      aviso(`No se pudo comprobar la version: ${e.message}`);
    } finally { btn.disabled = false; }
  }
  btn.onclick = comprobar;
  btn.title = `Comprueba si hay una version publicada mas nueva y recarga la pagina (version abierta: ${propia})`;
})();
