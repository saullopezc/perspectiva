// -----------------------------------------------------------------------------
// interfaz.js — Panel de configuracion acoplable (izq/der/arriba/abajo), plegable
// (boton o tecla P) y redimensionable por el asa. Preferencias en localStorage
// (solo comodidad del usuario; si no hay almacenamiento, funciona igual).
// Author: Saul López
// Date:   2026-11-13
// Modified By: Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
(() => {
  const CLAVE = "perspectiva.interfaz";
  const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; } };
  const guardar = (p) => { try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch { /* sin almacenamiento */ } };
  const pref = Object.assign({ dock: "right", oculto: false, ancho: 380, alto: 300 }, leer());
  const body = document.body, raiz = document.documentElement;

  function aplicar() {
    body.classList.remove("dock-left", "dock-right", "dock-top", "dock-bottom");
    body.classList.add("dock-" + pref.dock);
    body.classList.toggle("panel-oculto", pref.oculto);
    raiz.style.setProperty("--panel-ancho", pref.ancho + "px");
    raiz.style.setProperty("--panel-alto", pref.alto + "px");
    document.querySelectorAll("[data-dock]").forEach((b) => b.classList.toggle("activo", b.dataset.dock === pref.dock));
    document.getElementById("btnPanel").textContent = pref.oculto ? "Mostrar panel" : "Ocultar panel";
    guardar(pref);
    requestAnimationFrame(() => { if (typeof dibujarFuente === "function") dibujarFuente(); });
  }
  document.querySelectorAll("[data-dock]").forEach((b) => (b.onclick = () => { pref.dock = b.dataset.dock; pref.oculto = false; aplicar(); }));
  document.getElementById("btnPanel").onclick = () => { pref.oculto = !pref.oculto; aplicar(); };
  window.addEventListener("keydown", (e) => {
    if ((e.key === "p" || e.key === "P") && !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) { pref.oculto = !pref.oculto; aplicar(); }
  });

  // redimensionar arrastrando el asa
  const asa = document.getElementById("asa");
  asa.addEventListener("mousedown", (e) => {
    e.preventDefault(); asa.classList.add("activo");
    const mover = (ev) => {
      const vertical = pref.dock === "left" || pref.dock === "right";
      if (vertical) pref.ancho = Math.max(260, Math.min(window.innerWidth - 300, pref.dock === "right" ? window.innerWidth - ev.clientX : ev.clientX));
      else {
        const cab = document.querySelector("header").offsetHeight;
        pref.alto = Math.max(160, Math.min(window.innerHeight - 260, pref.dock === "bottom" ? window.innerHeight - ev.clientY : ev.clientY - cab));
      }
      aplicar();
    };
    const soltar = () => { asa.classList.remove("activo"); window.removeEventListener("mousemove", mover); window.removeEventListener("mouseup", soltar); };
    window.addEventListener("mousemove", mover); window.addEventListener("mouseup", soltar);
  });

  // el lienzo se redibuja al cambiar de tamano (panel, ventana, bloques plegados)
  new ResizeObserver(() => { if (typeof dibujarFuente === "function") dibujarFuente(); }).observe(document.getElementById("fuenteWrap"));
  aplicar();
})();
