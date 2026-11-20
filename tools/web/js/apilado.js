// -----------------------------------------------------------------------------
// apilado.js — Pila de fotogramas rectificados y seguimiento de puntos de referencia:
// los puntos marcados en un fotograma (esquinas, aristas o N puntos) se buscan en los demas por
// correlacion (NCC subpixel), cada uno se rectifica con sus propios puntos y la pila
// se mezcla (media, mediana o recortada), opcionalmente solo con los mas nitidos.
// La mezcla «superresolucion» vuelve a los pixeles originales de cada fotograma (superres.js).
// Usa el estado global de app.js (fuentes, pila, F0, editables, esquinas, mapaSalida...).
// Author: Saul López
// Date:   2026-11-13
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";

const lumDe = (F) => {   // luminancia de la fuente (cacheada)
  if (F.lum) return F.lum;
  const d = F.datos.data, n = F.w * F.h, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return (F.lum = a);
};
const opcSeguir = () => ({ rP: +$("rParche").value, rB: +$("rBusqueda").value, nccMin: +$("nccMin").value });

// Sigue los puntos editables de ref en cada objetivo del mismo tamano. Recorre hacia delante y hacia
// atras desde ref; la plantilla sale SIEMPRE de ref (sin deriva) y la estimacion inicial, del vecino.
function seguirReferencias(ref, objetivos) {
  const o = opcSeguir(), P0 = editables(ref).map((p) => [...p]), modoG = modo();
  if (!P0.length) return { ok: 0, fallo: 0, motivo: "la imagen de referencia no tiene puntos" };
  const iRef = fuentes.indexOf(ref), lr = lumDe(ref);
  const validos = objetivos.filter((F) => F !== ref && F.w === ref.w && F.h === ref.h);
  const adelante = validos.filter((F) => fuentes.indexOf(F) > iRef).sort((a, b) => fuentes.indexOf(a) - fuentes.indexOf(b));
  const atras = validos.filter((F) => fuentes.indexOf(F) < iRef).sort((a, b) => fuentes.indexOf(b) - fuentes.indexOf(a));
  let ok = 0, fallo = 0;
  for (const cadena of [adelante, atras]) {
    let prev = P0;
    for (const F of cadena) {
      const lf = lumDe(F), r = P0.map((p, i) => RP.seguirPunto(lr, lf, F.w, F.h, p, prev[i], o.rP, o.rB));
      const ncc = r.map((x) => (x ? +x.ncc.toFixed(4) : null)), bien = r.every((x) => x && x.ncc >= o.nccMin && !x.enBorde);
      const pts = r.map((x, i) => (x ? x.p : [...prev[i]]));
      if (modoG === "esquinas") F.esquinas = pts;
      else if (modoG === "aristas") F.aristas = pts;
      else if (modoG === "recorte") F.recorte = pts;
      else { F.control = pts; F.controlRef = ref.controlRef.map((c) => ({ id: c.id, xy: [...c.xy] })); } // N puntos: mismas referencias en cm
      F.seguimiento = { referencia: ref.nombre, sha256Referencia: ref.sha256, modo: modoG, ncc, ok: bien, parche: o.rP, busqueda: o.rB, nccMin: o.nccMin };
      if (bien) { ok++; prev = pts; } else fallo++;
    }
  }
  ref.seguimiento = { referencia: ref.nombre, sha256Referencia: ref.sha256, modo: modoG, ncc: P0.map(() => 1), ok: true };
  return { ok, fallo, total: validos.length };
}
function informarSeguimiento(r) {
  $("infoSeguir").textContent = r.motivo || `seguidos ${r.ok}/${r.total} (NCC >= ${$("nccMin").value})` + (r.fallo ? ` · ${r.fallo} por debajo: no se apilan` : "");
}

// ------------------------------------------------------------ pila
let idPila = 0, cacheSR = null, ultimoSR = null; // ultimoSR: datos de la ultima superresolucion (registro y pruebas)
function anadirPila(F, plana) {
  let { w, h, rgb } = plana, dy = 0, dx = 0;
  if (pila.length && (pila[0].w !== w || pila[0].h !== h)) { alert("Tamano distinto al de la pila (usa los mismos parametros de salida)"); return; }
  const modoAl = $("alinPila").value, lum = RP.luminancia(rgb, w * h);
  if (pila.length && modoAl !== "no") {
    [dy, dx] = RP.alinearSub(RP.luminancia(pila[0].rgb, w * h), lum, w, h, 6, modoAl === "subpixel");
    rgb = modoAl === "subpixel" ? RP.desplazarSub(rgb, w, h, dy, dx) : RP.desplazar(rgb, w, h, dy, dx);
  }
  pila.push({ id: ++idPila, w, h, rgb, dy, dx, nitidez: RP.nitidez(lum, w, h), fuente: F.nombre, sha256: F.sha256, origen: F.origen,
    esquinas: esquinas(F).map((p) => [...p]), seguimiento: F.seguimiento || null });
  infoPila();
}
// los que entran en la mezcla: mismo tamano y, si se pide, solo el mejor % por nitidez
function usados(base) {
  const ok = pila.filter((p) => p.w === base.w && p.h === base.h), pct = +$("mejoresPila").value;
  if (pct >= 100 || ok.length < 2) return ok;
  const k = Math.max(1, Math.ceil((ok.length * pct) / 100));
  return [...ok].sort((a, b) => b.nitidez - a.nitidez).slice(0, k);
}
function apilado(base) {
  const u = usados(base);
  if (!u.length) return base;
  if ($("modoPila").value === "superres") { const sr = apiladoSR(base, u); if (sr) return sr; }
  return { w: base.w, h: base.h, rgb: RP.mezclarPila(u.map((p) => p.rgb), base.w * base.h * 3, $("modoPila").value === "superres" ? "media" : $("modoPila").value) };
}
// superresolucion (superres.js): vuelve a los pixeles originales de cada fotograma de la pila con sus propios puntos.
// Se guarda en cache: solo se recalcula si cambian la pila, la geometria de salida o sus ajustes
function apiladoSR(base, u) {
  const P = parametros(), o = { sigma: +$("srSigma").value, iter: +$("srIter").value };
  const geo = ["margenPct", "trapH", "trapV", "giroFino", "rot90", "espejo", "espejoV", "altoPx", "anchoCm", "altoCm"].map((k) => P[k]);
  const clave = JSON.stringify([u.map((p) => p.id), geo, o, base.w, base.h]);
  if (cacheSR && cacheSR.clave === clave) return cacheSR.res;
  const marcos = [];
  for (const p of u) {
    const F = fuentes.find((f) => f.sha256 === p.sha256 && f.nombre === p.fuente); if (!F || p.esquinas.length !== 4) continue;
    const [w, h] = dimsSalida(F, P, p.esquinas), m = mapaSalida(p.esquinas, P, w, h);
    if (m.W2 !== base.w || m.H2 !== base.h) continue;
    marcos.push({ datos: F.datos.data, w: F.w, h: F.h, mapa: m.f, dx: p.dx, dy: p.dy });
  }
  if (!marcos.length) { $("infoSR").textContent = "superresolucion: los fotogramas de la pila ya no estan cargados; se usa la media"; return null; }
  const t0 = performance.now(), r = RP.superresolver(marcos, base.w, base.h, o), ms = Math.round(performance.now() - t0);
  ultimoSR = { fotogramas: marcos.length, sigma: o.sigma, iteracionesRL: o.iter, salidaPorPixelOriginal: +r.porOriginal.toFixed(2), sigmaPsf: +r.sigmaPsf.toFixed(2), ms };
  $("infoSR").textContent = `superresolucion: ${marcos.length} fotogramas · ${r.porOriginal.toFixed(2)} px de salida por pixel original · PSF ${r.sigmaPsf.toFixed(2)} px · ${ms} ms` +
    (r.porOriginal < 1.5 ? " · sube el alto de salida: con menos de 1.5 px por pixel original no hay detalle que ganar" : "") +
    (marcos.length < 9 && o.sigma < 0.5 ? ` · con ${marcos.length} fotogramas quedan huecos (bloques): sube el nucleo a 0.5-0.6` : "");
  cacheSR = { clave, res: { w: r.w, h: r.h, rgb: r.rgb } };
  return cacheSR.res;
}
function infoPila() {
  const pct = +$("mejoresPila").value, k = pila.length && ultimaPlana ? usados(ultimaPlana).length : pila.length;
  $("nPila").textContent = `${pila.length} en pila` + (pct < 100 && pila.length ? ` · usa ${k} (mejor ${pct}%)` : "");
  $("vMejores").textContent = pct;
}
function infoApilado() {
  const u = ultimaPlana ? usados(ultimaPlana) : pila;
  return { modo: $("modoPila").value, alineado: $("alinPila").value, mejoresPct: +$("mejoresPila").value,
    superresolucion: $("modoPila").value === "superres" ? ultimoSR : null,
    fotogramas: pila.map(({ fuente, sha256, origen, esquinas: e, dy, dx, nitidez, seguimiento }, i) =>
      ({ fuente, sha256, origen, esquinas: e, desplazamiento: [dy, dx], nitidez: +nitidez.toFixed(2), seguimiento, usado: u.includes(pila[i]) })) };
}
function apilarLista(lista, soloSeguidos = true) { // soloSeguidos: descarta los que el seguimiento no encontro
  const P = parametros(), conPuntos = lista.filter((F) => esquinas(F).length === 4 && (!soloSeguidos || !F.seguimiento || F.seguimiento.ok));
  conPuntos.forEach((F) => anadirPila(F, rectificarPlano(F, P)));
  return conPuntos.length;
}

$("btnApilar").onclick = () => { if (ultimaPlana) { anadirPila(F0(), ultimaPlana); procesar(); } };
$("btnApilarTodos").onclick = () => { apilarLista(fuentes, false); procesar(); };
$("btnVaciar").onclick = () => { pila.length = 0; infoPila(); procesar(); };
$("mejoresPila").addEventListener("input", infoPila);
const verOpcSR = () => { $("opcSR").hidden = $("modoPila").value !== "superres"; $("vSrSigma").textContent = $("srSigma").value; $("vSrIter").textContent = $("srIter").value; };
["modoPila", "srSigma", "srIter"].forEach((id) => $(id).addEventListener("input", verOpcSR)); verOpcSR();
$("btnSeguir").onclick = () => {
  const ref = F0(); if (!ref) return;
  informarSeguimiento(seguirReferencias(ref, fuentes)); dibujarFuente(); procesar();
};
$("btnSeguirApilar").onclick = () => {
  const ref = F0(); if (!ref) return;
  const r = seguirReferencias(ref, fuentes); informarSeguimiento(r);
  if (r.motivo) return;
  pila.length = 0;
  apilarLista([ref, ...fuentes.filter((F) => F !== ref && F.w === ref.w && F.h === ref.h)]);
  $("verPila").checked = true; dibujarFuente(); procesar(); infoPila();
};

// tras capturar UN fotograma (llamado desde app.js): si viene del mismo video que el activo antes de capturar y este
// tiene la geometria marcada, sus puntos se buscan en el nuevo (el objeto o la camara pueden haberse movido)
function trasCaptura(ref, nuevo) {
  if (!$("autoSeguir").checked || !ref || !nuevo || ref === nuevo || !ref.origen || !nuevo.origen) return;
  if (ref.origen.sha256Video !== nuevo.origen.sha256Video || esquinas(ref).length !== 4) return;
  informarSeguimiento(seguirReferencias(ref, [nuevo])); dibujarFuente(); procesar();
}
// tras capturar un rango de video (llamado desde app.js): ref = imagen activa antes de capturar
function trasRango(ref, nuevos) {
  if (!$("autoSeguir").checked || !nuevos.length) return;
  if (!ref || esquinas(ref).length !== 4) { $("infoSeguir").textContent = "seguir puntos: marca antes la geometria en el fotograma de partida (4 esquinas, 4 aristas o 4+ puntos)"; return; }
  const r = seguirReferencias(ref, nuevos); informarSeguimiento(r);
  if ($("autoApilar").checked) {
    // se vuelve a la referencia ANTES de apilar: la pila se rectifica con sus ajustes (interpolacion, salida), no con los
    // del ultimo fotograma capturado, que empieza con los de por defecto
    if (fuentes.includes(ref)) seleccionar(fuentes.indexOf(ref));
    pila.length = 0; apilarLista([ref, ...nuevos]); $("verPila").checked = true;
    const b = $("bloqueApilado"); if (b) b.open = true;
  }
  dibujarFuente(); procesar(); infoPila();
}
function etiquetasSeguir() { $("vParche").textContent = $("rParche").value; $("vBusqueda").textContent = $("rBusqueda").value; $("vNcc").textContent = $("nccMin").value; }
["rParche", "rBusqueda", "nccMin"].forEach((id) => $(id).addEventListener("input", etiquetasSeguir));
etiquetasSeguir(); infoPila();
