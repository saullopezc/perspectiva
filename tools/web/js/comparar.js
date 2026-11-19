// -----------------------------------------------------------------------------
// comparar.js — Interfaz de la comparacion por sintesis: calibrar la degradacion
// (y el encaje de la plantilla) con un texto conocido de la imagen, y ordenar
// candidatas de texto comparandolas
// en los pixeles de la imagen original. Usa el estado de app.js.
// Author: Saul López
// Date:   2026-11-15
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";

const NUM_PLANTILLA = ["altoPct", "anchoPct", "estVPct", "grosorPct", "esp", "dxPct", "dyPct"];
const ID_PLANTILLA = { altoPct: "altoTxt", anchoPct: "anchoTxt", estVPct: "estVTxt", grosorPct: "grosorTxt", esp: "espTxt", dxPct: "dxTxt", dyPct: "dyTxt" };

function modeloDegradacion() {
  const t = $("degTipo").value;
  return t === "gauss" ? { tipo: "gauss", sigma: +$("degSigma").value }
    : t === "mosaico" ? { tipo: "mosaico", bloque: +$("degBloque").value, ox: +$("degOx").value, oy: +$("degOy").value } : { tipo: "ninguna" };
}
function ponerModelo(m) {
  if (m.tipo === "gauss") $("degSigma").value = m.sigma.toFixed(2);
  if (m.tipo === "mosaico") { $("degOx").value = m.ox; $("degOy").value = m.oy; }
  etiquetasDeg();
}
function etiquetasDeg() {
  $("vDegSigma").textContent = (+$("degSigma").value).toFixed(2);
  const t = $("degTipo").value;
  $("filaGauss").hidden = t !== "gauss"; $("filaMosaico").hidden = t !== "mosaico";
}

// Todo lo necesario para comparar en la imagen original, con la geometria y la region fijadas por `params0`
function contextoSintesis(txtRegion, params0) {
  const F = F0(), E = esquinas(F), P = parametros();
  if (!F || E.length !== 4) throw new Error("marca primero la geometria");
  if (P.rot90 || P.giroFino || P.espejo || P.espejoV) throw new Error("pon rotacion y espejos a 0 para comparar (la comparacion usa la homografia directa)");
  const [w, h] = dimsSalida(F, P, E), m = P.margenPct / 100;
  const H = RP.homografia(RP.rectTrapecio(w * m, h * m, w * (1 - m), h * (1 - m), P.trapH, P.trapV), E), Hinv = RP.invertirH(H);
  const L = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), pxPorSalida = (L(E[0], E[1]) + L(E[3], E[2])) / 2 / w;
  // region: caja del texto con margen, llevada a la imagen; mascara = pixeles cuyo centro cae dentro
  const { cajas } = RP.renderHipotesis(w, h, txtRegion, params0);
  const vis = cajas.filter((c) => c.c.trim());
  if (!vis.length) throw new Error("la plantilla esta vacia");
  const alto = Math.max(...vis.map((c) => c.y1 - c.y0));
  const R = { x0: Math.min(...vis.map((c) => c.x0)) - 0.3 * alto, x1: Math.max(...vis.map((c) => c.x1)) + 0.3 * alto,
    y0: Math.min(...vis.map((c) => c.y0)) - 0.12 * alto, y1: Math.max(...vis.map((c) => c.y1)) + 0.12 * alto };
  const esqR = [[R.x0, R.y0], [R.x1, R.y0], [R.x1, R.y1], [R.x0, R.y1]].map(([x, y]) => RP.aplicarH(H, x, y));
  const x0 = Math.max(0, Math.floor(Math.min(...esqR.map((p) => p[0])))), y0 = Math.max(0, Math.floor(Math.min(...esqR.map((p) => p[1]))));
  const x1 = Math.min(F.w, Math.ceil(Math.max(...esqR.map((p) => p[0])))), y1 = Math.min(F.h, Math.ceil(Math.max(...esqR.map((p) => p[1]))));
  // imagen nitida y grande: se trabaja en bloques f x f promediados (texto de ~32 px de alto); la comparacion por
  // sintesis es para textos pequenos y a resolucion completa bloquearia la pagina. Con mosaico, f = 1 (la rejilla manda)
  const f = $("degTipo").value === "mosaico" ? 1 : Math.max(1, Math.floor((alto * pxPorSalida) / 32));
  // resolucion del render: la necesaria para los pixeles (o bloques) de la imagen que se comparan, no mas (memoria)
  const k = Math.max(1, Math.min(4, Math.ceil((2 * pxPorSalida) / f)));
  const bw = Math.floor((x1 - x0) / f), bh = Math.floor((y1 - y0) / f);
  if (bw < 2 || bh < 2) throw new Error("la region del texto cae fuera de la imagen");
  const Hc = RP.componerH(Hinv, [f, 0, x0, 0, f, y0, 0, 0, 1]); // bloque (i, j) -> salida
  const dentro = (u, v, r) => u >= r.x0 && u <= r.x1 && v >= r.y0 && v <= r.y1, salida = [];
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) salida.push(RP.aplicarH(Hc, i + 0.5, j + 0.5));
  const mascara = Uint32Array.from(salida.map((p, q) => (dentro(p[0], p[1], R) ? q : -1)).filter((q) => q >= 0));
  // observado: gris elegido en el bloque Color (BT.601, un canal o mezcla); texto oscuro -> tinta = -gris
  const Wg = { bt601: [0.299, 0.587, 0.114], color: [0.299, 0.587, 0.114], R: [1, 0, 0], G: [0, 1, 0], B: [0, 0, 1] }[P.modoGris]
    || (() => { const s = Math.abs(P.mezclaR) + Math.abs(P.mezclaG) + Math.abs(P.mezclaB) || 1; return [P.mezclaR / s, P.mezclaG / s, P.mezclaB / s]; })();
  const signo = $("textoClaro").checked ? 1 : -1, obs = new Float32Array(bw * bh), d = F.datos.data;
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    let s = 0;
    for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) { const o = ((y0 + j * f + b) * F.w + x0 + i * f + a) * 4; s += Wg[0] * d[o] + Wg[1] * d[o + 1] + Wg[2] * d[o + 2]; }
    obs[j * bw + i] = (signo * s) / (f * f);
  }
  // submuestras por bloque: las necesarias para ver cada pixel del render (1 a 4 por eje)
  const mSub = Math.max(1, Math.min(4, Math.ceil((k * f) / pxPorSalida)));
  // tope fisico del desenfoque: por encima de ~0.35 del alto del texto (px de la imagen) el texto seria una mancha y la
  // sigma deja de ser identificable (se confunde con bordes vecinos, p. ej. el de la franja azul)
  const sigmaMax = Math.max(0.5, 0.35 * alto * pxPorSalida);
  return { w, h, k, H, Hinv, Hc, f, m: mSub, x0, y0, bw, bh, mascara, obs, salida, pxPorSalida, region: R, sigmaMax };
}

// UN lienzo para todas las evaluaciones de la pagina (miles por comparacion), para lecturas frecuentes (en CPU)
const LIENZO_SINTESIS = document.createElement("canvas");
LIENZO_SINTESIS.getContext("2d", { willReadFrequently: true });

// tinta del candidato en la imagen original (integrada y degradada) y su NCC, total y por caracter
function puntuar(ctx, txt, params, modelo, porCaracter = false) {
  const { lienzo, cajas } = RP.renderHipotesis(ctx.w * ctx.k, ctx.h * ctx.k, txt, params, "#000", LIENZO_SINTESIS);
  const a = lienzo.getContext("2d").getImageData(0, 0, lienzo.width, lienzo.height).data, n = lienzo.width * lienzo.height;
  if (!ctx.tinta || ctx.tinta.length !== n) ctx.tinta = new Float32Array(n); // reutilizado entre evaluaciones
  const tinta = ctx.tinta;
  for (let i = 0; i < tinta.length; i++) tinta[i] = a[i * 4 + 3] / 255;
  const modeloBloques = modelo.tipo === "gauss" ? { ...modelo, sigma: modelo.sigma / ctx.f } : modelo; // sigma en px de la imagen
  const mod = RP.degradar(RP.integrarEnImagen(tinta, lienzo.width, lienzo.height, ctx.k, ctx.Hc, 0, 0, ctx.bw, ctx.bh, ctx.m), ctx.bw, ctx.bh, modeloBloques, ctx.x0, ctx.y0);
  const r = { txt, ncc: RP.ncc(mod, ctx.obs, ctx.mascara) };
  if (porCaracter) {
    r.chars = cajas.filter((c) => c.c.trim()).map((c) => {
      const cx = { x0: c.x0 / ctx.k, x1: c.x1 / ctx.k, y0: c.y0 / ctx.k, y1: c.y1 / ctx.k };
      const sub = Uint32Array.from([...ctx.mascara].filter((q) => { const [u, v] = ctx.salida[q]; return u >= cx.x0 && u <= cx.x1 && v >= cx.y0 && v <= cx.y1; }));
      return { c: c.c, ncc: sub.length > 3 ? RP.ncc(mod, ctx.obs, sub) : null };
    });
  }
  return r;
}

// Ajusta encaje (y la degradacion, salvo que este fijada) para que el texto de la plantilla coincida
function ajustarPlantilla(txt, params, modelo, ctx, fijarDeg, soloEncaje = false) {
  const x = { ...params, sigma: modelo.sigma || 0 }, pasos = soloEncaje ? { dxPct: 0.5, dyPct: 0.5, anchoPct: 2 }
    : { dxPct: 1, dyPct: 1, altoPct: 3, anchoPct: 4, esp: 2, grosorPct: 1 };
  const lim = { altoPct: [5, 95], anchoPct: [5, 200], esp: [-30, 30], grosorPct: [-10, 10], dxPct: [-50, 50], dyPct: [-50, 50], sigma: [0, ctx.sigmaMax] };
  if (!fijarDeg && modelo.tipo === "gauss") pasos.sigma = 0.5;
  const mod = (y) => (modelo.tipo === "gauss" ? { ...modelo, sigma: y.sigma } : modelo);
  const f = (y) => puntuar(ctx, txt, y, mod(y)).ncc;
  let r = RP.optimizarLocal(f, x, pasos, lim, soloEncaje ? 2 : 4), modeloFinal = mod(r.x);
  if (!fijarDeg && modelo.tipo === "gauss") { // sigma es un solo numero: se recorre entero (la busqueda local se quedaba en minimos locales)
    let mejor = { v: r.valor, s: r.x.sigma };
    for (let sg = 0; sg <= lim.sigma[1] + 1e-9; sg += 0.25) { const v = f({ ...r.x, sigma: sg }); if (v > mejor.v) mejor = { v, s: sg }; }
    if (mejor.s !== r.x.sigma) r = RP.optimizarLocal(f, { ...r.x, sigma: mejor.s }, { ...pasos, sigma: 0.125 }, lim, 2);
    modeloFinal = mod(r.x);
  }
  if (!fijarDeg && modelo.tipo === "mosaico") { // el desfase de la rejilla es discreto: se prueban todos
    let mejor = { v: -2, ox: 0, oy: 0 };
    for (let oy = 0; oy < modelo.bloque; oy++) for (let ox = 0; ox < modelo.bloque; ox++) {
      const v = puntuar(ctx, txt, r.x, { ...modelo, ox, oy }).ncc; if (v > mejor.v) mejor = { v, ox, oy };
    }
    modeloFinal = { ...modelo, ox: mejor.ox, oy: mejor.oy };
    r = RP.optimizarLocal((y) => puntuar(ctx, txt, y, modeloFinal).ncc, r.x, pasos, lim, 2);
  }
  return { params: r.x, modelo: modeloFinal, ncc: r.valor, evaluaciones: r.evaluaciones };
}

const conEspacioTras = () => /^(CC|CD|MI|TC|[A-Z]) \S/.test($("plantilla").value.toUpperCase().trim());
const formaRender = (c) => (conEspacioTras() ? c.replace(/^(CC|CD|MI|TC|[A-Z])/, "$1 ") : c);

$("btnAjustar").onclick = () => {
  const txt = $("plantilla").value.toUpperCase().trim();
  try {
    const t0 = performance.now(), params = plantillaParams(), modelo = modeloDegradacion(), ctx = contextoSintesis(txt, params);
    const r = ajustarPlantilla(txt, params, modelo, ctx, $("degFijar").checked);
    for (const k of NUM_PLANTILLA) $(ID_PLANTILLA[k]).value = +r.params[k].toFixed(2);
    if (!$("degFijar").checked) ponerModelo(r.modelo);
    $("infoComparar").textContent = `ajuste a «${txt}»: NCC ${r.ncc.toFixed(3)} · ${r.evaluaciones} evaluaciones · ${(performance.now() - t0).toFixed(0)} ms · `
      + `${ctx.bw}x${ctx.bh} ${ctx.f > 1 ? `bloques de ${ctx.f}x${ctx.f} px` : "px"} de la imagen (${(1 / ctx.pxPorSalida).toFixed(2)} px de salida por px de imagen)`
      + (!$("degFijar").checked && r.modelo.tipo === "gauss" && r.modelo.sigma >= ctx.sigmaMax - 0.01 ? ` — sigma en el tope (${ctx.sigmaMax.toFixed(2)}): no identificable con este texto, no la fijes` : "")
      + (r.ncc < 0.5 ? " — encaje pobre: acerca la plantilla a mano, revisa fuente, polaridad o canal" : "");
    procesar();
  } catch (err) { $("infoComparar").textContent = "no se puede ajustar: " + err.message; }
};

let ultimoRanking = null;
$("btnComparar").onclick = () => {
  const lineas = $("candidatos").value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  const set = new Set();
  let truncado = false;
  for (const l of lineas) { const e = RP.expandirPatron(l, 5000 - set.size); e.lista.forEach((c) => set.add(c)); truncado = truncado || e.truncado; }
  const cands = [...set];
  if (!cands.length) { $("infoComparar").textContent = "escribe candidatas (una por linea; ? y [..] como comodines)"; return; }
  try {
    const t0 = performance.now(), params = plantillaParams(), modelo = modeloDegradacion(), ctx = contextoSintesis(formaRender(cands[0]), params);
    // 1) todas con el mismo encaje; 2) las mejores se reajustan (encaje fino) para no penalizar anchos distintos
    let r = RP.ordenarRanking(cands.map((c) => ({ txt: c, ncc: puntuar(ctx, formaRender(c), params, modelo).ncc })));
    const top = r.slice(0, Math.min(12, r.length)).map((x) => {
      const a = ajustarPlantilla(formaRender(x.txt), params, modelo, ctx, true, true);
      return { ...puntuar(ctx, formaRender(x.txt), a.params, modelo, true), txt: x.txt, params: a.params };
    });
    r = RP.ordenarRanking([...top, ...r.slice(top.length)]);
    ultimoRanking = { candidatas: cands.length, truncado, modelo, top: r.slice(0, 20).map((x) => ({ txt: x.txt, ncc: +x.ncc.toFixed(4), delta: +x.delta.toFixed(4), chars: x.chars })) };
    mostrarRanking(r.slice(0, 20));
    const margen = r.length > 1 ? -r[1].delta : null;
    $("infoComparar").textContent = `${cands.length} candidatas${truncado ? " (truncadas a 5000)" : ""} · ${(performance.now() - t0).toFixed(0)} ms · `
      + (margen === null ? "" : margen < 0.01 ? `EMPATE PRACTICO (margen ${margen.toFixed(4)}): los pixeles no distinguen entre las primeras` : `margen sobre la 2.a: ${margen.toFixed(4)}`)
      + " · ordena hipotesis segun los pixeles; no prueba por si sola que la primera sea la real";
  } catch (err) { $("infoComparar").textContent = "no se puede comparar: " + err.message; }
};

function mostrarRanking(r) {
  const color = (v) => (v === null ? "transparent" : `hsl(${Math.max(0, Math.min(120, v * 120))} 60% 35%)`);
  $("tablaRanking").innerHTML = r.map((x, i) => `<tr data-txt="${x.txt}" title="clic: usar como plantilla"><td>${i + 1}</td><td><b>${x.txt}</b></td>`
    + `<td>${x.ncc.toFixed(4)}</td><td>${i ? x.delta.toFixed(4) : ""}</td><td>${(x.chars || []).map((c) => `<span class="celdaChar" style="background:${color(c.ncc)}" title="${c.c}: ${c.ncc === null ? "-" : c.ncc.toFixed(3)}">${c.c}</span>`).join("")}</td></tr>`).join("");
  $("tablaRanking").querySelectorAll("tr").forEach((tr) => (tr.onclick = () => { $("plantilla").value = formaRender(tr.dataset.txt); procesar(); }));
}

$("degTipo").onchange = etiquetasDeg; $("degSigma").oninput = etiquetasDeg;
etiquetasDeg();
