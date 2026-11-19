// -----------------------------------------------------------------------------
// control.js — Aplanado sin ajustes: modo "N puntos de control" (cada clic es un
// punto del objeto con su posicion real en cm; homografia por minimos cuadrados
// con su residuo) y aspecto automatico estimado de las 4 esquinas.
// Usa el estado de app.js (F0, modo, esquinas, dibujarFuente, procesar...).
// Author: Saul López
// Date:   2026-11-15
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";

// Referencias del rectangulo en cm. Las esquinas son exactas por definicion; la franja azul del modelo SAT
// se midio en el diagrama oficial de muestra (borde inferior a 0.215 del alto, ±0.01): es aproximada.
RP.REFERENCIAS_RECT = (W, H) => [
  { id: "SI", nombre: "esquina sup. izq.", xy: [0, 0] }, { id: "SD", nombre: "esquina sup. der.", xy: [W, 0] },
  { id: "ID", nombre: "esquina inf. der.", xy: [W, H] }, { id: "II", nombre: "esquina inf. izq.", xy: [0, H] },
  { id: "FI", nombre: "SAT: franja azul, borde izq. (aprox.)", xy: [0, 0.215 * H] },
  { id: "FD", nombre: "SAT: franja azul, borde der. (aprox.)", xy: [W, 0.215 * H] },
];
const dimRect = () => [+document.querySelector('[data-p="anchoCm"]').value, +document.querySelector('[data-p="altoCm"]').value];

function opcionesReferencia() {
  const s = $("refControl"), v = s.value, [W, H] = dimRect();
  s.innerHTML = RP.REFERENCIAS_RECT(W, H).map((r) => `<option value="${r.id}">${r.nombre} (${r.xy[0].toFixed(1)}, ${r.xy[1].toFixed(1)} cm)</option>`).join("")
    + '<option value="manual">manual: X, Y en cm</option>';
  if (v) s.value = v;
  $("refManual").hidden = s.value !== "manual";
}
$("refControl").onchange = () => ($("refManual").hidden = $("refControl").value !== "manual");

// el clic acaba de anadir un punto: se le asigna la referencia elegida y se pasa a la siguiente libre
function anotarReferencia(F) {
  const id = $("refControl").value, [W, H] = dimRect();
  const r = id === "manual" ? { id: "manual", xy: [+$("refX").value, +$("refY").value] } : RP.REFERENCIAS_RECT(W, H).find((x) => x.id === id);
  F.controlRef.push({ id: r.id, xy: [...r.xy] });
  if (id !== "manual") {
    const libre = RP.REFERENCIAS_RECT(W, H).find((x) => !F.controlRef.some((c) => c.id === x.id));
    $("refControl").value = libre ? libre.id : "manual"; $("refManual").hidden = !!libre;
  }
}

// las referencias con id de la lista siguen al tamano del rectangulo (si cambia el preset, se recalculan)
function refsActuales(F) {
  const [W, H] = dimRect(), L = RP.REFERENCIAS_RECT(W, H);
  return F.controlRef.map((c) => (c.id === "manual" ? c.xy : L.find((x) => x.id === c.id).xy));
}

// 4 esquinas del rectangulo en la imagen a partir de los puntos de control (null si aun no hay 4)
function esquinasControl(F) {
  F.controlRes = null;
  if (F.control.length < 4) return null;
  const R = refsActuales(F), H = RP.homografiaMC(R, F.control);
  if (!H) return null;
  F.controlRes = RP.residuosH(H, R, F.control);
  const [W, Hc] = dimRect();
  return [[0, 0], [W, 0], [W, Hc], [0, Hc]].map(([x, y]) => RP.aplicarH(H, x, y));
}

function dibujarControl(F, E) {
  const r = F.controlRes;
  F.control.forEach((p, i) => marca(p, i === sel ? "#ffd24d" : "#5aa9ff", `${F.controlRef[i].id}${r ? ` ${r.r[i].toFixed(1)}px` : ""}`, i === sel));
  E.forEach((p, i) => marca(p, "#ffffff", ["SI", "SD", "ID", "II"][i], false));
}

function tablaControl() {
  const tb = $("tablaPts"), F = F0(), R = refsActuales(F), r = F.controlRes; tb.innerHTML = "";
  F.control.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${F.controlRef[i].id}</td>`
      + `<td><input type="number" step="0.1" value="${p[0].toFixed(2)}" data-i="${i}" data-k="0"></td><td><input type="number" step="0.1" value="${p[1].toFixed(2)}" data-i="${i}" data-k="1"></td>`
      + `<td class="ayuda">${R[i][0].toFixed(1)}, ${R[i][1].toFixed(1)} cm${r ? ` · ${r.r[i].toFixed(2)} px` : ""}</td><td><button class="chico" data-quitar="${i}" title="Quitar este punto">✕</button></td>`;
    tb.appendChild(tr);
  });
  const tr = document.createElement("tr");
  tr.innerHTML = `<td colspan="5" class="ayuda">${F.control.length < 4 ? `faltan ${4 - F.control.length} puntos (minimo 4)` : r ? `residuo rms ${r.rms.toFixed(2)} px · max ${r.max.toFixed(2)} px${r.max > 3 ? " — revisa el punto con mas residuo: referencia equivocada o mal marcado" : ""}` : "puntos degenerados (¿alineados?)"}</td>`;
  tb.appendChild(tr);
  $("infoControl").textContent = tr.textContent + (F.control.length ? " (detalle por punto en «coordenadas»)" : "");
  tb.querySelectorAll("input").forEach((inp) => (inp.onchange = () => { F.control[+inp.dataset.i][+inp.dataset.k] = parseFloat(inp.value); dibujarFuente(); procesar(); }));
  tb.querySelectorAll("[data-quitar]").forEach((b) => (b.onclick = () => { const i = +b.dataset.quitar; F.control.splice(i, 1); F.controlRef.splice(i, 1); sel = -1; dibujarFuente(); procesar(); }));
}

// preset "auto": el ancho real sale de la perspectiva de las 4 esquinas (punto principal = centro de la imagen)
let ultimoAspecto = null;
function actualizarAspectoAuto() {
  ultimoAspecto = null;
  const F = F0();
  if ($("preset").value !== "auto" || !F || modo() === "control") return;
  const E = esquinas(F);
  if (E.length !== 4) return;
  const e = RP.aspectoEstimado(E, F.w / 2, F.h / 2);
  if (!e) return;
  ultimoAspecto = e;
  const alto = +document.querySelector('[data-p="altoCm"]').value;
  document.querySelector('[data-p="anchoCm"]').value = +(alto * e.aspecto).toFixed(2);
  $("infoGeo").textContent = `aspecto aparente ${RP.aspectoAparente(E).toFixed(2)} → forma ${e.aspecto.toFixed(2)}${textoAspecto()}`;
}
const textoAspecto = () => (ultimoAspecto ? ` · estimado ${ultimoAspecto.aspecto.toFixed(3)} (${ultimoAspecto.metodo}${ultimoAspecto.f ? `, f ${ultimoAspecto.f.toFixed(0)} px` : ""})` : "");

opcionesReferencia();
document.querySelectorAll('[data-p="anchoCm"], [data-p="altoCm"], #preset').forEach((el) => el.addEventListener("change", opcionesReferencia));
