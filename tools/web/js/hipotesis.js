// -----------------------------------------------------------------------------
// hipotesis.js — Plantilla de hipotesis: renderiza un texto candidato con su
// tipografia y deformacion (alto, ancho, estiramiento vertical, grosor del trazo,
// espaciado, desplazamiento) sobre la salida rectificada. Devuelve las cajas de
// cada caracter para compararlo despues con la imagen (comparacion por sintesis).
// Author: Saul López
// Date:   2026-11-15
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// Formato GT: prefijo + 3 digitos + 3 letras sin vocales ni Ñ
RP.FORMATO_GT = /^(CC|CD|MI|TC|P|C|A|U|O|M)\d{3}[B-DF-HJ-NP-TV-Z]{3}$/;
RP.normalizarTexto = (t) => (t || "").toUpperCase().replace(/[\s-]/g, "");

// Parametros de la plantilla (todos relativos al lienzo, para que no dependan del zoom):
//   altoPct: alto del texto en % del alto · anchoPct: estira en horizontal · estVPct: estira en vertical
//   grosorPct: engorda (+) o adelgaza (-) el trazo, en % del alto del texto · esp: espaciado en 1/300 del ancho
//   dxPct/dyPct: desplazamiento en % · fuente, negrita
//   pasoFijo: cada caracter centrado en una celda de ancho igual (el avance del "0"), como en textos de paso fijo: la
//   posicion de cada celda no depende de la candidata, asi cambiar una letra no mueve las demas; el espacio
//   ocupa 0.35 celdas
RP.PLANTILLA_DEF = { altoPct: 55, anchoPct: 100, estVPct: 100, grosorPct: 0, esp: 2, dxPct: 0, dyPct: 0,
  fuente: "DejaVu Sans Mono", negrita: true, pasoFijo: false };

// Pinta `txt` en un lienzo propio de W x H (fondo transparente, `color` opaco) y devuelve
// { lienzo, cajas: [{c, x0, x1, y0, y1}] } en pixeles del lienzo.
// `reutilizar`: un lienzo propio que se reaprovecha (la comparacion por sintesis renderiza miles de veces: en Firefox
// un lienzo nuevo por render acumulaba su memoria fuera del monton de JS hasta agotar la del equipo)
RP.renderHipotesis = (W, H, txt, o, color = "#ff3b3b", reutilizar = null) => {
  const p = { ...RP.PLANTILLA_DEF, ...o };
  const c = reutilizar || document.createElement("canvas"), cw = Math.max(1, Math.round(W)), ch = Math.max(1, Math.round(H));
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  c.getContext("2d").setTransform(1, 0, 0, 1, 0, 0); c.getContext("2d").globalCompositeOperation = "source-over"; c.getContext("2d").clearRect(0, 0, cw, ch);
  const ctx = c.getContext("2d"), cajas = [];
  if (!txt) return { lienzo: c, cajas };
  const alto = (H * p.altoPct) / 100, sx = p.anchoPct / 100, sy = p.estVPct / 100, esp = p.esp * (W / 300);
  ctx.font = `${p.negrita ? "bold " : ""}${alto}px "${p.fuente}"`; ctx.textBaseline = "middle"; ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  const celda = ctx.measureText("0").width * sx + esp, glifo = (ch) => ctx.measureText(ch).width * sx;
  const anchos = p.pasoFijo ? [...txt].map((ch) => (ch === " " ? 0.35 * celda : celda)) : [...txt].map(glifo);
  const total = anchos.reduce((s, x) => s + x, 0) + (p.pasoFijo ? 0 : esp * (txt.length - 1));
  const g = (p.grosorPct / 100) * alto, lw = (2 * Math.abs(g)) / Math.sqrt(sx * sy);
  let x = (W - total) / 2 + (W * p.dxPct) / 100;
  const y = H / 2 + (H * p.dyPct) / 100, mitad = (alto * sy) / 2;
  // [caracter, x donde se pinta, x0 y x1 de su caja]
  const posiciones = [...txt].map((ch, i) => {
    const x0 = x, xp = p.pasoFijo ? x + (anchos[i] - glifo(ch)) / 2 : x; x += anchos[i] + (p.pasoFijo ? 0 : esp);
    return [ch, xp, p.pasoFijo ? xp : x0, p.pasoFijo ? xp + glifo(ch) : x0 + anchos[i]];
  });
  const trazar = (fn) => posiciones.forEach(([ch, xp]) => { ctx.save(); ctx.translate(xp, y); ctx.scale(sx, sy); fn(ch); ctx.restore(); });
  trazar((ch) => ctx.fillText(ch, 0, 0));
  if (g > 0) { ctx.lineWidth = lw; trazar((ch) => ctx.strokeText(ch, 0, 0)); }
  if (g < 0) { ctx.globalCompositeOperation = "destination-out"; ctx.lineWidth = lw; trazar((ch) => ctx.strokeText(ch, 0, 0)); }
  posiciones.forEach(([ch, , x0, x1]) => cajas.push({ c: ch, x0, x1, y0: y - mitad, y1: y + mitad }));
  return { lienzo: c, cajas };
};

// Superpone la hipotesis sobre ctx (la salida ya escalada) con la opacidad indicada (0-1)
RP.dibujarHipotesis = (ctx, txt, o, opacidad) => {
  const { lienzo, cajas } = RP.renderHipotesis(ctx.canvas.width, ctx.canvas.height, txt, o);
  ctx.save(); ctx.globalAlpha = opacidad; ctx.drawImage(lienzo, 0, 0); ctx.restore();
  return cajas;
};
