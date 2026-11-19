// -----------------------------------------------------------------------------
// sintesis.js — Comparacion por sintesis (analisis por sintesis): cada hipotesis
// de texto se renderiza, se lleva a la perspectiva de la foto, se integra en los
// pixeles de la camara (lo que hace el sensor) y se degrada con el modelo
// calibrado (desenfoque gaussiano o mosaico por bloques); despues se compara con
// los pixeles observados por correlacion normalizada (NCC).
// No crea informacion: ordena hipotesis. Si dos candidatas degradadas dan los
// mismos pixeles, la diferencia de NCC es ~0 y asi se informa.
// Funciones puras (sin DOM): se prueban en Node.
// Author: Saul López
// Date:   2026-11-15
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// ---------------------------------------------------------------- candidatos
// Formato GT: prefijo + 3 digitos + 3 consonantes. '?' = cualquiera valida en esa posicion; [abc] = conjunto.
RP.GT_PREFIJOS1 = ["P", "C", "A", "U", "O", "M"];
RP.GT_CONSONANTES = "BCDFGHJKLMNPQRSTVWXYZ";
const DIGITOS = "0123456789", ALFANUM = DIGITOS + "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const tokens = (p) => { const t = []; for (let i = 0; i < p.length; i++) { if (p[i] === "[") { const j = p.indexOf("]", i); t.push(p.slice(i + 1, j < 0 ? p.length : j).split("")); i = j < 0 ? p.length : j; } else t.push(p[i]); } return t; };

// Expande un patron en candidatos. Devuelve { lista, total, truncado }.
RP.expandirPatron = (patron, max = 5000) => {
  const t = tokens(RP.normalizarTexto(patron).replace(/[^A-Z0-9?[\]]/g, ""));
  const pre2 = t.length === 8 && typeof t[0] === "string" && typeof t[1] === "string" && /^(CC|CD|MI|TC)$/.test(t[0] + t[1]);
  const gt = t.length === 7 || pre2, np = pre2 ? 2 : 1;
  const opciones = t.map((x, i) => {
    if (Array.isArray(x)) return x;
    if (x !== "?") return [x];
    if (!gt) return ALFANUM.split("");
    return i < np ? RP.GT_PREFIJOS1 : i < np + 3 ? DIGITOS.split("") : RP.GT_CONSONANTES.split("");
  });
  const total = opciones.reduce((s, o) => s * o.length, 1), lista = [];
  const rec = (i, acc) => { if (lista.length >= max) return; if (i === opciones.length) { lista.push(acc); return; } for (const c of opciones[i]) rec(i + 1, acc + c); };
  rec(0, "");
  return { lista, total, truncado: total > lista.length };
};

// ---------------------------------------------------------------- modelo de imagen
// Integra la tinta renderizada (alfa 0-1, tw x th, a k pixeles por pixel de la salida rectificada) en los
// pixeles de la imagen original del rectangulo [x0, x0+bw) x [y0, y0+bh): cada pixel promedia m x m
// submuestras llevadas a la salida con Hinv (imagen -> salida). Fuera de la salida la tinta es 0.
RP.integrarEnImagen = (tinta, tw, th, k, Hinv, x0, y0, bw, bh, m = 4) => {
  const out = new Float32Array(bw * bh), inv = 1 / (m * m);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    let s = 0;
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const [u, v] = RP.aplicarH(Hinv, x0 + i + (a + 0.5) / m, y0 + j + (b + 0.5) / m);
      const tx = Math.floor(u * k), ty = Math.floor(v * k);
      if (tx >= 0 && ty >= 0 && tx < tw && ty < th) s += tinta[ty * tw + tx];
    }
    out[j * bw + i] = s * inv;
  }
  return out;
};

// Degradacion: { tipo: "gauss", sigma } (optica y movimiento leve) o { tipo: "mosaico", bloque, ox, oy }
// (pixelado por bloques, p. ej. censura o ampliacion de una imagen pequena; la rejilla va en coordenadas
// absolutas de la imagen: x0/y0 son el origen del recorte)
RP.degradar = (a, w, h, modelo, x0 = 0, y0 = 0) => {
  if (!modelo || modelo.tipo === "ninguna") return a;
  if (modelo.tipo === "gauss") return RP.gauss(a, w, h, modelo.sigma);
  const b = Math.max(1, Math.round(modelo.bloque)), ox = modelo.ox || 0, oy = modelo.oy || 0, suma = new Map(), o = new Float32Array(a.length);
  const clave = (i, j) => Math.floor((x0 + i - ox) / b) * 100003 + Math.floor((y0 + j - oy) / b);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = clave(i, j), s = suma.get(c) || [0, 0]; s[0] += a[j * w + i]; s[1]++; suma.set(c, s); }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const s = suma.get(clave(i, j)); o[j * w + i] = s[0] / s[1]; }
  return o;
};

// Correlacion normalizada de a y b en los indices de la mascara (null = todos). 0 si alguna es plana.
RP.ncc = (a, b, mascara = null) => {
  let n = 0, sa = 0, sb = 0;
  const L = mascara ? mascara.length : a.length, idx = (q) => (mascara ? mascara[q] : q);
  for (let q = 0; q < L; q++) { const i = idx(q); sa += a[i]; sb += b[i]; n++; }
  if (!n) return 0;
  const ma = sa / n, mb = sb / n;
  let ab = 0, aa = 0, bb = 0;
  for (let q = 0; q < L; q++) { const i = idx(q), u = a[i] - ma, v = b[i] - mb; ab += u * v; aa += u * u; bb += v * v; }
  return aa > 1e-12 && bb > 1e-12 ? ab / Math.sqrt(aa * bb) : 0;
};

// ---------------------------------------------------------------- busqueda local
// Maximiza f(x) por coordenadas: prueba x[k] +- paso[k], acepta mejoras y reduce los pasos a la mitad
// cuando ninguna mejora. limites[k] = [min, max]. Devuelve { x, valor, evaluaciones }.
RP.optimizarLocal = (f, x0, pasos, limites = {}, rondas = 4) => {
  let x = { ...x0 }, mejor = f(x), ev = 1;
  const p = { ...pasos };
  for (let r = 0; r < rondas; r++) {
    let mejoro = true;
    while (mejoro) {
      mejoro = false;
      for (const k of Object.keys(p)) for (const s of [1, -1]) {
        const lim = limites[k] || [-Infinity, Infinity], v = Math.min(lim[1], Math.max(lim[0], x[k] + s * p[k]));
        if (v === x[k]) continue;
        const y = { ...x, [k]: v }, fy = f(y); ev++;
        if (fy > mejor + 1e-9) { x = y; mejor = fy; mejoro = true; }
      }
      if (ev > 4000) break;
    }
    for (const k of Object.keys(p)) p[k] /= 2;
  }
  return { x, valor: mejor, evaluaciones: ev };
};

// Ordena resultados [{txt, ncc, ...}] y anade la diferencia con el mejor
RP.ordenarRanking = (r) => {
  const o = [...r].sort((a, b) => b.ncc - a.ncc);
  return o.map((x) => ({ ...x, delta: x.ncc - o[0].ncc }));
};
