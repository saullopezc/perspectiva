// -----------------------------------------------------------------------------
// geometria.js — Seleccion geometrica: esquinas por interseccion de aristas
// (2 puntos por borde), ordenado de esquinas y rectas extendidas para dibujar;
// homografia por minimos cuadrados con N >= 4 puntos de control y estimacion
// del aspecto real de un rectangulo visto en perspectiva.
// Author: Saul López
// Date:   2026-11-13
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

// Interseccion de las rectas p1p2 y p3p4 (null si son paralelas)
RP.interseccion = ([p1, p2], [p3, p4]) => {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (Math.abs(d) < 1e-9) return null;
  const a = p1[0] * p2[1] - p1[1] * p2[0], b = p3[0] * p4[1] - p3[1] * p4[0];
  return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
};

RP.ARISTAS = ["superior", "derecha", "inferior", "izquierda"];

// aristas: lista plana de hasta 8 puntos [sup1, sup2, der1, der2, inf1, inf2, izq1, izq2]
RP.esquinasDeAristas = (ar) => {
  if (ar.length < 8) return null;
  const s = [ar[0], ar[1]], d = [ar[2], ar[3]], i = [ar[4], ar[5]], z = [ar[6], ar[7]];
  const e = [RP.interseccion(s, z), RP.interseccion(s, d), RP.interseccion(i, d), RP.interseccion(i, z)];
  return e.every(Boolean) ? e : null;
};

// Ordena 4 puntos como sup-izq, sup-der, inf-der, inf-izq (por angulo respecto al centroide)
RP.ordenarEsquinas = (p) => {
  const cx = p.reduce((s, q) => s + q[0], 0) / 4, cy = p.reduce((s, q) => s + q[1], 0) / 4;
  const o = [...p].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // tras ordenar por angulo (empezando en -pi): el de menor x+y es sup-izq
  let k = 0;
  o.forEach((q, i) => { if (q[0] + q[1] < o[k][0] + o[k][1]) k = i; });
  return [0, 1, 2, 3].map((i) => o[(k + i) % 4]);
};

// Extremos de la recta pq extendida hasta cubrir un rectangulo de lado L alrededor
RP.rectaExtendida = (p, q, L) => {
  const dx = q[0] - p[0], dy = q[1] - p[1], n = Math.hypot(dx, dy) || 1;
  return [[p[0] - (dx / n) * L, p[1] - (dy / n) * L], [p[0] + (dx / n) * L, p[1] + (dy / n) * L]];
};

// Relacion de aspecto aparente del cuadrilatero (para comparar con la forma real)
RP.aspectoAparente = (p) => {
  const L = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return ((L(p[0], p[1]) + L(p[3], p[2])) / 2) / Math.max(1e-6, (L(p[0], p[3]) + L(p[1], p[2])) / 2);
};

// ---------------------------------------------------------------- puntos de control (N >= 4)
// Normalizacion de Hartley: centroide en 0 y distancia media sqrt(2). Devuelve [T, puntos normalizados]
const normalizarHartley = (P) => {
  const n = P.length, cx = P.reduce((s, p) => s + p[0], 0) / n, cy = P.reduce((s, p) => s + p[1], 0) / n;
  const d = P.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1, k = Math.SQRT2 / d;
  return [[k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], P.map(([x, y]) => [k * (x - cx), k * (y - cy)])];
};
const mulH3 = (A, B) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
const invH3 = (M) => {
  const [a, b, c, d, e, f, g, h, i] = M, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
};

// H (convenio de RP.homografia: H * dst = src) por minimos cuadrados (DLT normalizado, h33 = 1).
// dst: coordenadas reales (p. ej. cm en el objeto); src: pixeles en la imagen. null si hay < 4 o es degenerado.
RP.homografiaMC = (dst, src) => {
  if (dst.length < 4 || dst.length !== src.length) return null;
  const [Td, d] = normalizarHartley(dst), [Ts, s] = normalizarHartley(src);
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const fila = (r, b) => { for (let i = 0; i < 8; i++) { Atb[i] += r[i] * b; for (let j = 0; j < 8; j++) AtA[i][j] += r[i] * r[j]; } };
  d.forEach(([x, y], k) => {
    const [u, v] = s[k];
    fila([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    fila([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  });
  const h = RP.resolver(AtA, Atb);
  if (h.some((v) => !Number.isFinite(v))) return null;
  const H = mulH3(mulH3(invH3(Ts), [...h, 1]), Td); // desnormaliza: H = Ts^-1 * Hn * Td
  return H.map((v) => v / H[8]);
};

RP.componerH = (A, B) => { const C = mulH3(A, B); return C.map((v) => v / C[8]); };
RP.invertirH = (H) => { const I = invH3(H); return I.map((v) => v / I[8]); };

// Residuo de reproyeccion (pixeles de la imagen) de cada punto de control
RP.residuosH = (H, dst, src) => {
  const r = dst.map((p, i) => { const [x, y] = RP.aplicarH(H, p[0], p[1]); return Math.hypot(x - src[i][0], y - src[i][1]); });
  return { r, rms: Math.sqrt(r.reduce((s, v) => s + v * v, 0) / (r.length || 1)), max: Math.max(0, ...r) };
};

// ---------------------------------------------------------------- aspecto real de un rectangulo en perspectiva
// Zhang y He (2007), "Whiteboard scanning and image enhancement": con las 4 esquinas (SI, SD, ID, II) y el
// punto principal (cx, cy; centro de la imagen si no se recorto) estima la focal y la relacion ancho/alto real.
// Sin perspectiva apreciable (caso afin) la focal no se puede estimar y el aspecto sale de los lados.
// Devuelve { aspecto, f (px o null), metodo } o null si los puntos no forman un cuadrilatero valido.
RP.aspectoEstimado = (E, cx, cy) => {
  if (!E || E.length !== 4) return null;
  const [m1, m2, m4, m3] = E.map(([x, y]) => [x - cx, y - cy, 1]); // m1 SI, m2 SD, m3 II, m4 ID (notacion del articulo)
  const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const pto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = pto(cruz(m1, m4), m3) / pto(cruz(m2, m4), m3), k3 = pto(cruz(m1, m4), m2) / pto(cruz(m3, m4), m2);
  if (!Number.isFinite(k2) || !Number.isFinite(k3)) return null;
  const n2 = m2.map((v, i) => k2 * v - m1[i]), n3 = m3.map((v, i) => k3 * v - m1[i]);
  const afin = Math.abs(n2[2]) < 1e-6 * Math.hypot(n2[0], n2[1]) || Math.abs(n3[2]) < 1e-6 * Math.hypot(n3[0], n3[1]);
  const f2 = afin ? NaN : -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!(f2 > 0)) { // afin, o la focal no es coherente con el punto principal (imagen recortada): aspecto de los lados
    const a = Math.sqrt((n2[0] ** 2 + n2[1] ** 2) / (n3[0] ** 2 + n3[1] ** 2));
    return Number.isFinite(a) && a > 0 ? { aspecto: a, f: null, metodo: afin ? "afin" : "sin focal (¿recorte?)" } : null;
  }
  const a = Math.sqrt((n2[0] ** 2 + n2[1] ** 2 + f2 * n2[2] ** 2) / (n3[0] ** 2 + n3[1] ** 2 + f2 * n3[2] ** 2));
  return Number.isFinite(a) && a > 0 ? { aspecto: a, f: Math.sqrt(f2), metodo: "perspectiva" } : null;
};
