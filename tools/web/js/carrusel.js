// -----------------------------------------------------------------------------
// carrusel.js — Carrusel 3D de fotogramas ("hojas" inclinadas ~42 grados):
// el actual de frente, los vecinos girados a cada lado. Clic, rueda o teclado;
// cada hoja con su boton para quitarla (alQuitar). El nombre se pone como texto:
// un nombre de fichero no puede inyectar HTML.
// Author: Saul López
// Date:   2026-11-13
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

RP.Carrusel = class {
  constructor(contenedor, alSeleccionar, { angulo = 42, visibles = 6, alQuitar = null } = {}) {
    this.c = contenedor; this.alSel = alSeleccionar; this.ang = angulo; this.vis = visibles; this.alQuitar = alQuitar;
    this.items = []; this.actual = -1;
    this.c.addEventListener("wheel", (e) => {
      if (!this.items.length) return;
      e.preventDefault();
      this.mover(Math.sign(e.deltaY || e.deltaX));
    }, { passive: false });
  }
  mover(d) {
    const n = Math.max(0, Math.min(this.items.length - 1, this.actual + d));
    if (n !== this.actual) this.alSel(n);
  }
  render(items, actual) {
    this.items = items; this.actual = actual;
    this.c.innerHTML = "";
    if (!items.length) { const v = document.createElement("div"); v.className = "vacio"; v.textContent = "Los fotogramas e imagenes apareceran aqui como hojas"; this.c.appendChild(v); return; }
    const ancho = this.c.clientWidth || 800;
    items.forEach((it, i) => {
      const d = i - actual;
      if (Math.abs(d) > this.vis) return;
      const el = document.createElement("figure");
      el.className = "hoja" + (d === 0 ? " actual" : "");
      const paso = d === 0 ? 0 : Math.sign(d) * (110 + (Math.abs(d) - 1) * 58);
      const giro = d === 0 ? 0 : -Math.sign(d) * this.ang;
      el.style.transform = `translateX(${paso}px) translateZ(${d === 0 ? 40 : -Math.abs(d) * 10}px) rotateY(${giro}deg)`;
      el.style.zIndex = String(100 - Math.abs(d));
      el.style.opacity = String(Math.max(0.35, 1 - Math.abs(d) * 0.11));
      el.style.left = `${ancho / 2}px`;
      const img = document.createElement("img"); img.src = it.src; img.alt = "";
      const pie = document.createElement("figcaption"); pie.textContent = it.titulo;
      el.append(img, pie);
      el.title = it.titulo;
      el.onclick = () => this.alSel(i);
      if (this.alQuitar) {
        const q = document.createElement("button"); q.className = "quitar"; q.textContent = "✕"; q.title = "Quitar de la sesion (el fichero no se toca)";
        q.onclick = (e) => { e.stopPropagation(); this.alQuitar(i); };
        el.appendChild(q);
      }
      this.c.appendChild(el);
    });
  }
};
