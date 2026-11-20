// -----------------------------------------------------------------------------
// clonado.js — Deteccion de clonado (copy-move): zonas de la imagen copiadas de otra
// parte de la MISMA imagen, tambien giradas o reescaladas levemente (calculo, sin DOM).
//  1. La luminancia se reduce a <= 640 px de lado (promedio por area).
//  2. Cada 2 px, un bloque circular de radio 8 se describe con el modulo de la transformada
//     de Fourier angular de 4 anillos: no cambia al girar el bloque y poco con un reescalado
//     del 10 %. Los bloques lisos (cielo, pared) se descartan: se parecen a todo.
//  3. Solo cuentan los pares con vecinos que se desplazan igual (una zona, no un azar).
//  3b. Los pares de bloques parecidos y alejados se buscan comparando vecinos en dos
//     ordenaciones (lexicografica de los rasgos cuantizados y una proyeccion fija).
//  4. RANSAC afin sobre los pares: un modelo (desplazamiento, giro, escala) con muchos
//     pares coherentes es una zona clonada; sus pares se retiran y se busca otro.
// Es un INDICIO: los patrones repetidos (ladrillos, rejas, texto) tambien se repiten.
// Author: Saul López
// Date:   2026-11-19
// -----------------------------------------------------------------------------
"use strict";
window.RP = window.RP || {};

RP.CLONADO = { lado: 640, radio: 8, paso: 2, texturaMin: 12, distMin: 24, vecinos: 12, umbral: 0.6, tolerancia: 2.5, nccMin: 0.45, coherenciaMax: 0.6,
  minPares: 40, iteraciones: 1500, maxModelos: 4, radioVec: 10, tolVec: 2.5, minVec: 6 };

// reduccion por promedio de area (factor s <= 1)
RP.reducirLum = (L, w, h, s) => {
  if (s >= 1) return { L, w, h };
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s)), o = new Float32Array(W * H), n = new Float32Array(W * H);
  for (let y = 0; y < h; y++) {
    const Y = Math.min(H - 1, Math.floor((y * H) / h));
    for (let x = 0; x < w; x++) { const k = Y * W + Math.min(W - 1, Math.floor((x * W) / w)); o[k] += L[y * w + x]; n[k]++; }
  }
  for (let i = 0; i < o.length; i++) o[i] /= n[i] || 1;
  return { L: o, w: W, h: H };
};

// rasgos de cada bloque circular: en 4 anillos (radios 2, 4, 6, 8) se toman 16 muestras y se guarda el modulo de
// los armonicos 0..3 de su transformada de Fourier angular. Girar el bloque solo cambia la fase: el modulo no varia.
// La energia de los armonicos >= 1 mide la textura; por debajo de texturaMin el bloque es liso y se descarta.
function rasgosBloques(L, w, h, c) {
  const R = c.radio, NR = 4, NA = 16, NH = 4, radios = [0.25, 0.5, 0.75, 1].map((f) => f * R);
  const co = [], si = []; for (let a = 0; a < NA; a++) { co.push(Math.cos((2 * Math.PI * a) / NA)); si.push(Math.sin((2 * Math.PI * a) / NA)); }
  const bil = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, k = y0 * w + x0;
    return (1 - fy) * ((1 - fx) * L[k] + fx * L[k + 1]) + fy * ((1 - fx) * L[k + w] + fx * L[k + w + 1]); };
  // tensor de estructura por bloque (imagenes integrales de gx2, gy2, gxgy): un borde recto (una sola direccion de
  // gradiente) no fija la posicion a lo largo del borde y encaja con cualquier otro borde; esos bloques no cuentan
  const W1 = w + 1, Ixx = new Float64Array(W1 * (h + 1)), Iyy = new Float64Array(W1 * (h + 1)), Ixy = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let a = 0, b = 0, d = 0; for (let x = 0; x < w; x++) {
    const gx = x > 0 && x < w - 1 ? (L[y * w + x + 1] - L[y * w + x - 1]) / 2 : 0, gy = y > 0 && y < h - 1 ? (L[(y + 1) * w + x] - L[(y - 1) * w + x]) / 2 : 0;
    a += gx * gx; b += gy * gy; d += gx * gy; const k = (y + 1) * W1 + x + 1;
    Ixx[k] = Ixx[k - W1] + a; Iyy[k] = Iyy[k - W1] + b; Ixy[k] = Ixy[k - W1] + d; } }
  const caja = (I, x, y) => I[(y + R + 1) * W1 + x + R + 1] - I[(y - R) * W1 + x + R + 1] - I[(y + R + 1) * W1 + x - R] + I[(y - R) * W1 + x - R];
  const pos = [], rasgos = [], m = new Float32Array(NA);
  for (let y = R + 1; y < h - R - 1; y += c.paso) for (let x = R + 1; x < w - R - 1; x += c.paso) {
    const jxx = caja(Ixx, x, y), jyy = caja(Iyy, x, y), jxy = caja(Ixy, x, y), tr = jxx + jyy;
    if (tr <= 0 || ((jxx - jyy) ** 2 + 4 * jxy * jxy) / (tr * tr) > c.coherenciaMax) continue;
    const f = new Float32Array(NR * NH); let textura = 0;
    for (let r = 0; r < NR; r++) {
      for (let a = 0; a < NA; a++) m[a] = bil(x + radios[r] * co[a], y + radios[r] * si[a]);
      for (let k = 0; k < NH; k++) {
        let re = 0, im = 0;
        for (let a = 0; a < NA; a++) { const t = (k * a) % NA; re += m[a] * co[t]; im -= m[a] * si[t]; }
        const mod = Math.hypot(re, im) / NA; f[r * NH + k] = mod; if (k) textura += mod;
      }
    }
    if (textura < c.texturaMin) continue;
    pos.push([x, y]); rasgos.push(f);
  }
  return { pos, rasgos };
}

// pares candidatos: vecinos en dos ordenaciones, parecidos (RMS < umbral) y alejados (>= distMin)
function paresCandidatos(B, c) {
  const n = B.rasgos.length, dim = n ? B.rasgos[0].length : 0, pares = [], vistos = new Set();
  const proy = Array.from({ length: dim }, (_, i) => Math.sin(1.7 * i + 0.3) + 1.2);
  const q = B.rasgos.map((f) => Array.from(f, (v) => Math.round(v / 3)));
  const ord1 = [...Array(n).keys()].sort((a, b) => { for (let i = 0; i < dim; i++) if (q[a][i] !== q[b][i]) return q[a][i] - q[b][i]; return 0; });
  const p = B.rasgos.map((f) => f.reduce((s, v, i) => s + v * proy[i], 0));
  const ord2 = [...Array(n).keys()].sort((a, b) => p[a] - p[b]);
  const lim = c.umbral * c.umbral * dim, d2min = c.distMin * c.distMin;
  for (const ord of [ord1, ord2]) for (let i = 0; i < n; i++) for (let j = i + 1; j < Math.min(n, i + 1 + c.vecinos); j++) {
    const a = ord[i], b = ord[j], A = B.pos[a], C = B.pos[b];
    if ((A[0] - C[0]) ** 2 + (A[1] - C[1]) ** 2 < d2min) continue;
    const fa = B.rasgos[a], fb = B.rasgos[b]; let d = 0;
    for (let k = 0; k < dim && d <= lim; k++) d += (fa[k] - fb[k]) ** 2;
    if (d > lim) continue;
    const clave = a < b ? a * n + b : b * n + a; if (vistos.has(clave)) continue; vistos.add(clave);
    pares.push(A[0] < C[0] || (A[0] === C[0] && A[1] <= C[1]) ? [A, C] : [C, A]); // orientacion estable: izquierda -> derecha
  }
  return pares;
}

// coherencia local: un par clonado tiene vecinos (origen a <= radioVec px) con casi el mismo desplazamiento (<= tolVec px;
// con giro o escala leves el desplazamiento varia poco entre vecinos). Los pares sueltos (parecidos por azar) se descartan.
function paresCoherentes(pares, c) {
  const celda = 8, mapa = new Map(), clave = (x, y) => x * 100003 + y;
  pares.forEach(([p], i) => { const k = clave(p[0] >> 3, p[1] >> 3); if (!mapa.has(k)) mapa.set(k, []); mapa.get(k).push(i); });
  const r2 = c.radioVec * c.radioVec, t2 = c.tolVec * c.tolVec, alc = Math.ceil(c.radioVec / celda);
  return pares.filter(([p, q]) => {
    const ox = q[0] - p[0], oy = q[1] - p[1], cx = p[0] >> 3, cy = p[1] >> 3; let n = 0;
    for (let gx = cx - alc; gx <= cx + alc; gx++) for (let gy = cy - alc; gy <= cy + alc; gy++) {
      for (const j of mapa.get(clave(gx, gy)) || []) {
        const [pj, qj] = pares[j];
        if ((pj[0] - p[0]) ** 2 + (pj[1] - p[1]) ** 2 > r2 || (pj[0] === p[0] && pj[1] === p[1])) continue;
        if ((qj[0] - pj[0] - ox) ** 2 + (qj[1] - pj[1] - oy) ** 2 <= t2 && ++n >= c.minVec) return true;
      }
    }
    return false;
  });
}

// afin que lleva p a q con 3 pares (null si son casi colineales)
function afin3(P, Q) {
  const [[x1, y1], [x2, y2], [x3, y3]] = P, det = x1 * (y2 - y3) - x2 * (y1 - y3) + x3 * (y1 - y2);
  if (Math.abs(det) < 20) return null;
  const sol = (v1, v2, v3) => [(v1 * (y2 - y3) - v2 * (y1 - y3) + v3 * (y1 - y2)) / det,
    (x1 * (v2 - v3) - x2 * (v1 - v3) + x3 * (v1 - v2)) / det,
    (x1 * (y2 * v3 - y3 * v2) - x2 * (y1 * v3 - y3 * v1) + x3 * (y1 * v2 - y2 * v1)) / det];
  return [sol(Q[0][0], Q[1][0], Q[2][0]), sol(Q[0][1], Q[1][1], Q[2][1])]; // [[a,b,tx],[c,d,ty]]
}
const aplicarAfin = (M, [x, y]) => [M[0][0] * x + M[0][1] * y + M[0][2], M[1][0] * x + M[1][1] * y + M[1][2]];
// afin por minimos cuadrados con todos los inliers (ecuaciones normales 3x3 por coordenada)
function afinMC(pares) {
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const [[x, y], [u, v]] of pares) { const r = [x, y, 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) S[i][j] += r[i] * r[j]; bx[i] += r[i] * u; by[i] += r[i] * v; } }
  const resolver = (A, b) => { // Cramer 3x3
    const d3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = d3(A); if (Math.abs(D) < 1e-9) return null;
    return [0, 1, 2].map((c) => d3(A.map((fila, i) => fila.map((v, j) => (j === c ? b[i] : v)))) / D);
  };
  const a = resolver(S, bx), b = resolver(S, by);
  return a && b ? [a, b] : null;
}

// generador pseudoaleatorio con semilla: el mismo resultado en cada ejecucion
const aleatorio = (semilla) => () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 4294967296; };

// detalle fino: L menos su media 5x5. Al comparar el detalle (ruido, bordes) y no la forma general, un degradado
// o una onda lisa que encaja por casualidad no pasa la verificacion; una copia real si, porque arrastra su ruido.
function altaFrecuencia(L, w, h) {
  const o = new Float32Array(w * h), I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let f = 0; for (let x = 0; x < w; x++) { f += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + f; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - 2), y0 = Math.max(0, y - 2), x1 = Math.min(w, x + 3), y1 = Math.min(h, y + 3);
    const suma = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    o[y * w + x] = L[y * w + x] - suma / ((x1 - x0) * (y1 - y0));
  }
  return o;
}

// verificacion directa: NCC entre el detalle fino del origen y el del destino segun el modelo, en una rejilla alrededor
// de cada par. Un clonado real da NCC alta; un modelo armado con pares parecidos por azar, no.
function nccModelo(L, w, h, M, pares) {
  const bil = (x, y) => { if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return null; const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, k = y0 * w + x0;
    return (1 - fy) * ((1 - fx) * L[k] + fx * L[k + 1]) + fy * ((1 - fx) * L[k + w] + fx * L[k + w + 1]); };
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (const [p] of pares) for (let dy = -3; dy <= 3; dy += 2) for (let dx = -3; dx <= 3; dx += 2) {
    const x = p[0] + dx, y = p[1] + dy, [u, v] = aplicarAfin(M, [x, y]), va = L[y * w + x], vb = bil(u, v);
    if (vb === null || x < 0 || y < 0 || x >= w || y >= h) continue;
    n++; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
  }
  const cov = sab - (sa * sb) / n, d = Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
  return n && d > 0 ? cov / d : 0;
}

// RANSAC afin: modelos con >= minPares inliers, escala plausible y desplazamiento real
function modelosClonado(pares, c, L, w, h) {
  const modelos = [], descartados = [], rnd = aleatorio(12345), tol2 = c.tolerancia * c.tolerancia;
  let resto = pares;
  while (modelos.length < c.maxModelos && resto.length >= c.minPares) {
    let mejor = null, mejorN = 0;
    for (let it = 0; it < c.iteraciones; it++) {
      const s = [0, 0, 0].map(() => resto[Math.floor(rnd() * resto.length)]);
      const M = afin3(s.map((p) => p[0]), s.map((p) => p[1])); if (!M) continue;
      const det = M[0][0] * M[1][1] - M[0][1] * M[1][0]; if (det < 0.6 || det > 1.7) continue;
      let n = 0;
      for (const [p, q] of resto) {
        const r = aplicarAfin(M, p), e = (r[0] - q[0]) ** 2 + (r[1] - q[1]) ** 2;
        if (e < tol2) n++; else { const r2 = aplicarAfin(M, q); if ((r2[0] - p[0]) ** 2 + (r2[1] - p[1]) ** 2 < tol2) n++; }
      }
      if (n > mejorN) { mejorN = n; mejor = M; }
    }
    if (!mejor || mejorN < c.minPares) break;
    // inliers orientados segun el modelo (origen -> destino) y reajuste por minimos cuadrados
    const dentro = [], fuera = [];
    for (const [p, q] of resto) {
      const r = aplicarAfin(mejor, p), r2 = aplicarAfin(mejor, q);
      if ((r[0] - q[0]) ** 2 + (r[1] - q[1]) ** 2 < tol2) dentro.push([p, q]);
      else if ((r2[0] - p[0]) ** 2 + (r2[1] - p[1]) ** 2 < tol2) dentro.push([q, p]);
      else fuera.push([p, q]);
    }
    const M = afinMC(dentro) || mejor, [[a, b], [cc, d]] = M;
    const desp = dentro.reduce((s, [p, q]) => [s[0] + q[0] - p[0], s[1] + q[1] - p[1]], [0, 0]).map((v) => v / dentro.length);
    const ncc = nccModelo(L, w, h, M, dentro);
    if (Math.hypot(desp[0], desp[1]) >= c.distMin && ncc >= c.nccMin)
      modelos.push({ M, pares: dentro, giro: (Math.atan2(cc - b, a + d) * 180) / Math.PI, escala: Math.sqrt(Math.abs(a * d - b * cc)), desp, ncc });
    else descartados.push({ pares: dentro.length, ncc: +ncc.toFixed(3) });
    resto = fuera;
  }
  modelos.descartados = descartados;
  return modelos;
}

// deteccion completa: L luminancia (w x h). Devuelve modelos en pixeles de la imagen original y una
// mascara reducida (0 nada, 1 origen, 2 destino) para el mapa
RP.detectarClonado = (L, w, h, opciones = {}) => {
  const c = Object.assign({}, RP.CLONADO, opciones), s = Math.min(1, c.lado / Math.max(w, h)), r = RP.reducirLum(L, w, h, s);
  const B = rasgosBloques(r.L, r.w, r.h, c), cand = paresCandidatos(B, c), pares = paresCoherentes(cand, c), modelos = modelosClonado(pares, c, altaFrecuencia(r.L, r.w, r.h), r.w, r.h);
  const mascara = new Uint8Array(r.w * r.h), R = c.radio, k = 1 / (r.w / w);
  const marcar = ([x, y], v) => { for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < r.w && Y < r.h && dx * dx + dy * dy <= R * R && mascara[Y * r.w + X] !== 2) mascara[Y * r.w + X] = v; } };
  const caja = (ps) => { const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    return [Math.min(...xs) - R, Math.min(...ys) - R, Math.max(...xs) + R, Math.max(...ys) + R].map((v) => Math.round(v * k)); };
  modelos.forEach((m) => { m.pares.forEach(([p, q]) => { marcar(p, 1); marcar(q, 2); }); });
  return {
    escala: r.w / w, w: r.w, h: r.h, mascara, bloques: B.pos.length, candidatos: cand.length, coherentes: pares.length, descartados: modelos.descartados,
    modelos: modelos.map((m) => ({ pares: m.pares.length, giroGrados: +m.giro.toFixed(1), escala: +m.escala.toFixed(3),
      ncc: +m.ncc.toFixed(3), desplazamiento: m.desp.map((v) => Math.round(v * k)), cajaOrigen: caja(m.pares.map((p) => p[0])), cajaDestino: caja(m.pares.map((p) => p[1])) })),
  };
};

// mapa: la imagen con el origen en azul y el destino en rojo (op = opacidad 0..1)
RP.componerClonado = (rgba, w, h, res, op) => {
  const o = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < h; y++) {
    const Y = Math.min(res.h - 1, Math.floor(y * res.escala));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, g = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      const m = res.mascara[Y * res.w + Math.min(res.w - 1, Math.floor(x * res.escala))];
      const col = m === 2 ? [230, 40, 40] : m === 1 ? [40, 110, 240] : null;
      if (col) for (let c = 0; c < 3; c++) o[i + c] = (1 - op) * g + op * col[c];
      else o[i] = o[i + 1] = o[i + 2] = g;
      o[i + 3] = 255;
    }
  }
  return o;
};
