// -----------------------------------------------------------------------------
// test_logica.js — Pruebas de la logica de tools/web/js (sin navegador) en Node.
// Uso: node tests/web/test_logica.js
// Author: Saul López
// Date:   2026-11-13
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
global.window = global;
global.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
for (const f of ["nucleo", "interpolacion", "filtros", "hexa", "geometria", "exportar", "referencias", "hipotesis", "sintesis", "hashes", "integridad", "mapas", "clonado"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../../tools/web/js", f + ".js"), "utf8"));
let fallos = 0;
const ok = (c, m) => { console.log((c ? "OK    " : "FALLO ") + m); if (!c) fallos++; };

// los <script> clasicos comparten el ambito global: un const/let/class/function de nivel superior repetido entre
// modulos rompe la carga de la pagina entera ("Identifier ... has already been declared")
const dirJs = path.join(__dirname, "../../tools/web/js"), declarados = {};
for (const f of fs.readdirSync(dirJs).filter((x) => x.endsWith(".js")))
  for (const m of fs.readFileSync(path.join(dirJs, f), "utf8").matchAll(/^(?:const|let|class|(?:async\s+)?function)\s+([A-Za-z_$][\w$]*)/gm))
    (declarados[m[1]] = declarados[m[1]] || []).push(f);
const sintaxis = fs.readdirSync(dirJs).filter((x) => x.endsWith(".js")).flatMap((f) => {
  try { new vm.Script(fs.readFileSync(path.join(dirJs, f), "utf8"), { filename: f }); return []; } catch (e) { return [`${f}: ${e.message}`]; }
});
ok(!sintaxis.length, `todos los modulos de tools/web/js compilan (incluidos los de interfaz, que aqui no se ejecutan)${sintaxis.length ? ": " + sintaxis.join("; ") : ""}`);
const repetidos = Object.entries(declarados).filter(([, fs2]) => fs2.length > 1);
// lo mismo con las funciones colgadas de RP (RP.x = ...): no rompen la carga, la ultima pisa en silencio a la anterior
// (paso con RP.richardsonLucy: superres.js piso la de filtros.js y la deconvolucion de movimiento dejo de hacer nada)
const rpDef = {};
for (const f of fs.readdirSync(dirJs).filter((x) => x.endsWith(".js")))
  for (const m of fs.readFileSync(path.join(dirJs, f), "utf8").matchAll(/^RP\.([A-Za-z_$][\w$]*)\s*=(?!=)/gm))
    (rpDef[m[1]] = rpDef[m[1]] || []).push(f);
const rpRepetidos = Object.entries(rpDef).filter(([, fs2]) => fs2.length > 1);
// la ayuda integrada se genera del manual: si el manual cambia y no se regenera, la ayuda queda desfasada
const manualMd = fs.readFileSync(path.join(__dirname, "../../docs/MANUAL_perspectiva.md"));
const shaManual = require("crypto").createHash("sha256").update(manualMd).digest("hex");
const ayudaJs = fs.readFileSync(path.join(dirJs, "ayuda_contenido.js"), "utf8"), shaAyuda = (ayudaJs.match(/"sha256Manual": "([0-9a-f]{64})"/) || [])[1];
ok(shaAyuda === shaManual, `ayuda integrada al dia con docs/MANUAL_perspectiva.md${shaAyuda === shaManual ? "" : " — regenerar: python3 -I tools/generar_ayuda_web.py"}`);
ok(!rpRepetidos.length, `sin funciones RP.* definidas en dos sitios (una pisaria a la otra)${rpRepetidos.length ? ": " + rpRepetidos.map(([n, fs2]) => `${n} (${fs2.join(", ")})`).join("; ") : ""}`);
ok(!repetidos.length, `sin nombres de nivel superior repetidos entre modulos de tools/web/js${repetidos.length ? ": " + repetidos.map(([n, fs2]) => `${n} (${fs2.join(", ")})`).join("; ") : ""}`);

// homografia: esquinas exactas + control positivo
const src = [[53, 419.5], [77.8, 409.2], [80.8, 432.2], [54.2, 444.5]], dst = [[0, 0], [320, 0], [320, 160], [0, 160]];
const H = RP.homografia(dst, src);
ok(Math.max(...dst.map((p, i) => Math.hypot(...RP.aplicarH(H, ...p).map((v, k) => v - src[i][k])))) < 1e-9, "homografia lleva cada esquina a su sitio");

// geometria: aristas sobre los lados del cuadrilatero -> mismas esquinas
const mid = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const [A, B, C, D] = src;
const ar = [mid(A, B, .2), mid(A, B, .7), mid(B, C, .3), mid(B, C, .8), mid(D, C, .25), mid(D, C, .6), mid(A, D, .1), mid(A, D, .9)];
const E = RP.esquinasDeAristas(ar);
ok(E && Math.max(...E.map((p, i) => Math.hypot(p[0] - src[i][0], p[1] - src[i][1]))) < 1e-6, "aristas -> esquinas por interseccion");
ok(RP.interseccion([[0, 0], [1, 0]], [[0, 1], [1, 1]]) === null, "rectas paralelas -> null");
const des = [C, A, D, B], ord = RP.ordenarEsquinas(des);
ok(ord.every((p, i) => p === src[i]), "ordenarEsquinas recupera SI,SD,ID,II desde orden aleatorio");

// interpolacion: impulso de 255 en (3,4). Interpolantes -> 255 exacto en el centro;
// B-spline suaviza -> 255*(4/6)^2 = 113.33; Mitchell -> 255*((6-2/3)/6)^2 = 201.48
const w = 8, h = 8, img = new Float32Array(w * h * 3); img[(4 * w + 3) * 3] = 255;
const esperado = { vecino: 255, bilineal: 255, bicubica: 255, lanczos3: 255, bspline: 255 * (4 / 6) ** 2, mitchell: 255 * ((6 - 2 / 3) / 6) ** 2 };
for (const k of Object.keys(esperado)) {
  const m = RP.muestreador(img, w, h, 3, k), t = [0, 0, 0]; m(3.5, 4.5, t);
  ok(Math.abs(t[0] - esperado[k]) < 1e-6, `${k}: centro del impulso ${t[0].toFixed(2)} (esperado ${esperado[k].toFixed(2)})`);
}
const esc = RP.escalera(img, w, h, 64, 64);
ok(esc.w === 64 && esc.h === 64 && esc.pasos.join(" ") === "x2 x2 x2", `escalera 8->64: pasos ${esc.pasos.join(" ")}`);
const esc2 = RP.escalera(new Float32Array(64 * 64 * 3).fill(100), 64, 64, 10, 10);
ok(esc2.w === 10 && Math.abs(esc2.rgb[0] - 100) < 1e-6, `escalera 64->10: pasos ${esc2.pasos.join(" ")}, conserva nivel`);

// filtros
const n = 32 * 32, plano = new Float32Array(n).fill(100); plano[500] = 255; plano[600] = 0;
const med = RP.mediana(plano, 32, 32, 1);
ok(med[500] === 100 && med[600] === 100, "mediana elimina ruido impulsivo");
const psf = RP.psfMovimiento(9, 0);
ok(Math.abs(psf.reduce((s, p) => s + p[2], 0) - 1) < 1e-9 && psf.length === 9, `PSF movimiento suma 1 (${psf.length} taps)`);
ok(Math.abs(psf.reduce((s, p) => s + p[0] * p[2], 0)) < 1e-9, "PSF simetrica (centroide en 0)");
const barra = new Float32Array(n).fill(50); for (let y = 8; y < 24; y++) for (let x = 14; x < 17; x++) barra[y * 32 + x] = 220;
const conv = (a, taps) => a.map((_, i) => { const x = i % 32, y = (i / 32) | 0; let s = 0; for (const [dx, dy, p] of taps) s += a[Math.min(31, Math.max(0, y + dy)) * 32 + Math.min(31, Math.max(0, x + dx))] * p; return s; });
const borrosa = conv(barra, psf), rest = RP.richardsonLucy(borrosa, 32, 32, psf, 30);
const mse = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length;
ok(mse(rest, barra) < mse(borrosa, barra), `Richardson-Lucy reduce el error (${mse(borrosa, barra).toFixed(1)} -> ${mse(rest, barra).toFixed(1)})`);
const grad = new Float32Array(n).map((_, i) => 60 + (i % 32) * 4);
const cp = RP.campoPlano(grad, 32, 32, 8, "restar");
ok(Math.max(...cp.slice(32 * 16 + 4, 32 * 16 + 28)) - Math.min(...cp.slice(32 * 16 + 4, 32 * 16 + 28)) < (28 - 4) * 4 * 0.5, "campo plano atenua el gradiente de iluminacion");
const cl = RP.clahe(grad, 32, 32, 2, 2, 2.5);
ok(Math.min(...cl) >= 0 && Math.max(...cl) <= 255.001, "CLAHE dentro de 0..255");
const sob = RP.sobel(barra, 32, 32);
ok(sob[16 * 32 + 13] > 100 && sob[16 * 32 + 5] < 1, "Sobel marca bordes y no zonas planas");
const desplazada = RP.desplazar(new Float32Array(n * 3).map((_, i) => barra[(i / 3) | 0]), 32, 32, 2, -1);
const [ay, ax] = RP.alinear(barra, RP.luminancia(desplazada, n), 32, 32, 4);
ok(ay === -2 && ax === 1, `alinear recupera el desplazamiento (${ay}, ${ax})`);
const cad = RP.cadenaAjustes({ w: 4, h: 2, rgb: new Float32Array(24).fill(200) }, { gris: true, ruido: "no", movimiento: false, campoPlano: "no", clahe: false, autoNiveles: false, negro: 0, blanco: 255, gamma: 1, brillo: 0, contraste: 0, enfoque: 0, vista: "normal", binarizar: false, negativo: true });
ok(cad.data[0] === 55, "cadena: negativo 200 -> 55");

// color
const azul = new Float32Array([30, 60, 200, 250, 250, 250]); // pixel azul (caracter) y blanco (fondo)
const base = { gananciaR: 1, gananciaG: 1, gananciaB: 1, temperatura: 0, saturacion: 1, tono: 0 };
const id = RP.ajustarColor(azul, 2, base);
ok(Math.max(...id.map((v, i) => Math.abs(v - azul[i]))) < 1e-3, `color neutro = identidad (err ${Math.max(...id.map((v, i) => Math.abs(v - azul[i]))).toExponential(1)})`);
const desat = RP.ajustarColor(azul, 2, { ...base, saturacion: 0 });
ok(Math.abs(desat[0] - desat[2]) < 0.05 && Math.abs(desat[1] - desat[2]) < 0.05, "saturacion 0 -> gris");
const gR = RP.aGris(azul, 2, { modoGris: "R" }), gL = RP.aGris(azul, 2, { modoGris: "bt601" });
ok(gR[1] - gR[0] > gL[1] - gL[0], `canal R da mas contraste azul/blanco (${(gR[1] - gR[0]).toFixed(0)} vs ${(gL[1] - gL[0]).toFixed(0)})`);
const mz = RP.aGris(azul, 2, { modoGris: "mezcla", mezclaR: 2, mezclaG: 0, mezclaB: 0 });
ok(Math.abs(mz[0] - 30) < 1e-6, "mezclador normaliza pesos");

// exportadores propios: estructura valida y reconocidos por el analizador hexa (control cruzado)
const im = new ImageData(5, 3); for (let i = 0; i < 15; i++) { im.data[i * 4] = i * 10; im.data[i * 4 + 1] = 200 - i; im.data[i * 4 + 2] = 7; im.data[i * 4 + 3] = 255; }
const bmp = RP.codificarBMP(im), ab = RP.analizarBytes(bmp, "x.bmp");
ok(ab.tipo === "BMP" && ab.fin === bmp.length && bmp.length === 54 + 16 * 3, `BMP valido (${bmp.length} B, filas alineadas a 4)`);
ok(bmp[54] === 7 && bmp[55] === 200 - 10 && bmp[56] === 100, "BMP: orden BGR y filas de abajo arriba");
const tif = RP.codificarTIFF(im), at = RP.analizarBytes(tif, "x.tif"), dv = new DataView(tif.buffer);
const tag = (t) => { for (let i = 0; i < dv.getUint16(8, true); i++) { const o = 10 + i * 12; if (dv.getUint16(o, true) === t) return dv.getUint16(o + 2, true) === 3 ? dv.getUint16(o + 8, true) : dv.getUint32(o + 8, true); } return null; };
ok(at.tipo === "TIFF" && tag(256) === 5 && tag(257) === 3 && tag(277) === 3 && tif.length === tag(273) + 45, "TIFF valido (IFD ancho/alto/muestras/datos)");
ok(tif[tag(273)] === 0 && tif[tag(273) + 1] === 200 && tif[tag(273) + 2] === 7, "TIFF: primer pixel RGB correcto");
const pnm = RP.codificarPNM(im), ap = RP.analizarBytes(pnm.bytes, "x." + pnm.ext);
ok(pnm.ext === "ppm" && ap.tipo === "PPM" && pnm.bytes.length === new TextEncoder().encode("P6\n# perspectiva.html\n5 3\n255\n").length + 45, "PPM (P6) valido");
const g = new ImageData(2, 1); g.data.set([9, 9, 9, 255, 50, 50, 50, 255]);
const pg = RP.codificarPNM(g); ok(pg.ext === "pgm" && RP.analizarBytes(pg.bytes, "g.pgm").tipo === "PGM", "imagen gris -> PGM (P5)");
ok(RP.escalarEntero(im, 3).width === 15 && RP.escalarEntero(im, 3).data[(0 * 15 + 2) * 4] === 0 && RP.escalarEntero(im, 3).data[(0 * 15 + 3) * 4] === 10, "escala entera repite pixeles sin interpolar");

// referencias: escena analitica con textura; el fotograma 2 es el 1 desplazado (3.3, -2.6) px
{
  const W = 120, Hh = 90, f = (x, y) => 128 + 50 * Math.sin(0.31 * x) * Math.cos(0.23 * y) + 40 * Math.sin(0.17 * (x + 2 * y)) + 30 * Math.cos(0.41 * x - 0.19 * y);
  const esc = (dx, dy) => Float32Array.from({ length: W * Hh }, (_, i) => f((i % W) - dx, ((i / W) | 0) - dy));
  const r0 = esc(0, 0), r1 = esc(3.3, -2.6);
  const s0 = RP.seguirPunto(r0, r0, W, Hh, [60.4, 45.7], [60.4, 45.7]);
  ok(s0 && Math.hypot(s0.p[0] - 60.4, s0.p[1] - 45.7) < 0.01 && s0.ncc > 0.9999, "seguirPunto: misma imagen -> mismo punto, NCC 1");
  const s1 = RP.seguirPunto(r0, r1, W, Hh, [60.4, 45.7], [60.4, 45.7]);
  const e1 = s1 ? Math.hypot(s1.p[0] - 63.7, s1.p[1] - 43.1) : 99;
  ok(e1 < 0.05, `seguirPunto: desplazamiento (3.3,-2.6) recuperado con error ${e1.toFixed(3)} px`);
  const s2 = RP.seguirPunto(r0, r1, W, Hh, [60.4, 45.7], [56, 50], 10, 12);
  ok(s2 && Math.hypot(s2.p[0] - 63.7, s2.p[1] - 43.1) < 0.05, "seguirPunto: desde una estimacion inicial lejana (8 px)");
  const s3 = RP.seguirPunto(r0, r1, W, Hh, [60.4, 45.7], [40, 45.7], 10, 4);
  ok(s3 && (s3.enBorde || s3.ncc < 0.6), "seguirPunto: busqueda corta que no alcanza -> en el borde o NCC baja (control negativo)");
  ok(RP.seguirPunto(new Float32Array(W * Hh).fill(7), r1, W, Hh, [60, 45], [60, 45]) === null, "seguirPunto: parche plano -> null");
  const [ay, ax] = RP.alinearSub(r0, esc(-1.4, 0.7), W, Hh, 6, true);
  ok(Math.abs(ay - 0.7) < 0.15 && Math.abs(ax + 1.4) < 0.15, `alinearSub: (0.7,-1.4) estimado (${ay.toFixed(2)},${ax.toFixed(2)})`);
  ok(RP.alinearSub(r0, esc(-1.4, 0.7), W, Hh, 6, false).every(Number.isInteger), "alinearSub entero devuelve enteros");
  const rgb0 = new Float32Array(W * Hh * 3); r0.forEach((v, i) => { rgb0[i * 3] = rgb0[i * 3 + 1] = rgb0[i * 3 + 2] = v; });
  const des2 = RP.desplazarSub(rgb0, W, Hh, 0, 0);
  ok(des2.every((v, i) => Math.abs(v - rgb0[i]) < 1e-4), "desplazarSub(0,0) = identidad");
  const blur = RP.gauss(r0, W, Hh, 2);
  ok(RP.nitidez(r0, W, Hh) > 2 * RP.nitidez(blur, W, Hh), "nitidez: nitida > desenfocada");
}
const T = RP.rectTrapecio(0, 0, 200, 100, 20, 0);
ok(T[0][0] === 20 && T[1][0] === 180 && T[2][0] === 200 && T[3][0] === 0 && T.every((p) => p[1] === 0 || p[1] === 100), "rectTrapecio: +20% estrecha solo el borde superior");
const T0 = RP.rectTrapecio(5, 6, 105, 56, 0, 0);
ok(JSON.stringify(T0) === JSON.stringify([[5, 6], [105, 6], [105, 56], [5, 56]]), "rectTrapecio 0 = rectangulo");
const Tv = RP.rectTrapecio(0, 0, 200, 100, 0, -10);
ok(Tv[1][1] === 5 && Tv[2][1] === 95 && Tv[0][1] === 0, "rectTrapecio: -10% vertical estrecha el borde derecho");
const pilaT = [[1], [2], [9], [4]].map((a) => Float32Array.from(a));
ok(RP.mezclarPila(pilaT, 1, "media")[0] === 4, "mezcla media");
ok(RP.mezclarPila(pilaT, 1, "mediana")[0] === 3, "mezcla mediana con K par = media de los centrales");
ok(RP.mezclarPila(pilaT, 1, "recortada")[0] === 3, "mezcla recortada descarta min y max");

// puntos de control: homografia por minimos cuadrados (N >= 4)
let semilla = 7; const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const rectCm = [[0, 0], [30, 0], [30, 15], [0, 15]], quad = [[112.4, 80.2], [530.7, 121.9], [505.1, 318.6], [90.3, 260.8]];
const H0 = RP.homografia(rectCm, quad);
const cm = []; for (let i = 0; i <= 3; i++) for (let j = 0; j <= 2; j++) cm.push([i * 10, j * 7.5]);
const px = cm.map((p) => RP.aplicarH(H0, ...p));
const err = (H) => Math.max(...rectCm.map((p, i) => Math.hypot(...RP.aplicarH(H, ...rectCm[i]).map((v, k) => v - quad[i][k]))));
const Hx = RP.homografiaMC(cm, px);
ok(Hx && err(Hx) < 1e-6, `homografiaMC sin ruido reproduce las esquinas (error ${Hx && err(Hx).toExponential(1)} px)`);
const pxR = px.map(([x, y]) => [x + (azar() - 0.5) * 0.6, y + (azar() - 0.5) * 0.6]), Hr = RP.homografiaMC(cm, pxR), resR = RP.residuosH(Hr, cm, pxR);
ok(err(Hr) < 0.5 && resR.rms < 0.3, `homografiaMC con ruido ±0.3 px: esquinas a ${err(Hr).toFixed(2)} px, rms ${resR.rms.toFixed(2)} px`);
const cmMal = cm.map((p, i) => (i === 5 ? [p[0] + 2, p[1]] : p)), resMal = RP.residuosH(RP.homografiaMC(cmMal, pxR), cmMal, pxR);
ok(resMal.max > 3 && resMal.r.indexOf(resMal.max) === 5, `control positivo: un punto con la referencia equivocada salta en el residuo (max ${resMal.max.toFixed(1)} px en el punto ${resMal.r.indexOf(resMal.max)})`);
ok(RP.homografiaMC(cm.slice(0, 3), px.slice(0, 3)) === null, "homografiaMC con 3 puntos -> null");

// aspecto real de un rectangulo en perspectiva (Zhang y He): camara sintetica f = 900, punto principal (400, 300)
const proyectar = (W, Hh, rx, ry, f = 900, cx = 400, cy = 300, tz = 120) => {
  const [a, b] = [rx * Math.PI / 180, ry * Math.PI / 180];
  return [[0, 0], [W, 0], [W, Hh], [0, Hh]].map(([X, Y]) => {
    let x = X - W / 2, y = Y - Hh / 2, z = 0;
    [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
    [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    return [cx + (f * x) / (z + tz), cy + (f * y) / (z + tz)];
  });
};
for (const [W, Hh, rx, ry] of [[30, 15, 25, 40], [30, 15, -15, 55], [30, 20, 30, -35], [52, 11, 10, 45]]) {
  const e = RP.aspectoEstimado(proyectar(W, Hh, rx, ry), 400, 300), real = W / Hh;
  ok(e && Math.abs(e.aspecto / real - 1) < 0.01 && Math.abs(e.f / 900 - 1) < 0.02,
    `aspectoEstimado ${W}x${Hh} girado (${rx}°, ${ry}°): ${e && e.aspecto.toFixed(3)} (real ${real.toFixed(3)}), f ${e && e.f && e.f.toFixed(0)}; aparente ${RP.aspectoAparente(proyectar(W, Hh, rx, ry)).toFixed(3)}`);
}
const fr = RP.aspectoEstimado([[100, 100], [400, 100], [400, 250], [100, 250]], 400, 300);
ok(fr && Math.abs(fr.aspecto - 2) < 1e-9 && fr.f === null, `aspectoEstimado frontal (afin) = 2 sin focal (${fr && fr.metodo})`);

// sintesis: candidatos por patron
ok(RP.expandirPatron("P12?BCD").total === 10 && RP.expandirPatron("P123BC?").total === 21, "patron GT: ? en digito = 10, en letra = 21 consonantes");
ok(RP.expandirPatron("?123BCD").lista.join() === "P123BCD,C123BCD,A123BCD,U123BCD,O123BCD,M123BCD", "patron GT: ? en prefijo = prefijos de 1 letra");
ok(RP.expandirPatron("CC12?BCD").total === 10 && RP.expandirPatron("p 1[38]3-bcd").lista.join() === "P133BCD,P183BCD", "patron: prefijo de 2 letras, conjuntos [..], minusculas y separadores");
const tr = RP.expandirPatron("P???BCD", 50); ok(tr.total === 1000 && tr.lista.length === 50 && tr.truncado, "patron truncado al maximo");
// integracion en pixeles de la camara y degradacion
const Hid = [1, 0, 0, 0, 1, 0, 0, 0, 1], t4 = new Float32Array(16); t4[5] = 1;
const i1 = RP.integrarEnImagen(t4, 4, 4, 1, Hid, 0, 0, 4, 4);
ok(i1[5] === 1 && i1.reduce((s, v) => s + v, 0) === 1, "integrar con H identidad y k=1 = la misma tinta");
const t8 = new Float32Array(64); t8[2 * 8 + 3] = 1; const i2 = RP.integrarEnImagen(t8, 8, 8, 2, Hid, 0, 0, 4, 4);
ok(Math.abs(i2[1 * 4 + 1] - 0.25) < 1e-9, "integrar con k=2: un subpixel de tinta = 1/4 del pixel");
const mo = RP.degradar(Float32Array.from([4, 0, 0, 0, 0, 0, 0, 0]), 4, 2, { tipo: "mosaico", bloque: 2 });
const mo1 = RP.degradar(Float32Array.from([4, 0, 0, 0, 0, 0, 0, 0]), 4, 2, { tipo: "mosaico", bloque: 2, ox: 1 });
ok(mo[0] === 1 && mo[5] === 1 && mo[6] === 0 && mo1[0] === 2 && mo1[1] === 0, "mosaico 2x2: promedio por bloque; desfase de rejilla cambia los bloques");
const va = Float32Array.from([1, 2, 3, 4]);
ok(Math.abs(RP.ncc(va, va) - 1) < 1e-12 && Math.abs(RP.ncc(va, va.map((x) => -x)) + 1) < 1e-12 && RP.ncc(va, new Float32Array(4).fill(5)) === 0, "ncc: igual 1, invertida -1, plana 0");
const opt = RP.optimizarLocal((x) => -((x.a - 3.3) ** 2) - (x.b + 1.2) ** 2, { a: 0, b: 0 }, { a: 1, b: 1 }, {}, 6);
ok(Math.abs(opt.x.a - 3.3) < 0.05 && Math.abs(opt.x.b + 1.2) < 0.05, `optimizarLocal: maximo (${opt.x.a.toFixed(3)}, ${opt.x.b.toFixed(3)}) en ${opt.evaluaciones} evaluaciones`);
// extremo a extremo con fuente 3x5: la candidata real gana mientras queda informacion; con pixeles mayores que
// un caracter el margen cae (no se inventa informacion)
const F35 = { 0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001",
  5: "111100111001111", 6: "111100111101111", 7: "111001001001001", 8: "111101111101111", 9: "111101111001111" };
const celda = 4, renderD = (txt) => { const w = txt.length * 4 * celda, h = 5 * celda, a = new Float32Array(w * h);
  [...txt].forEach((c, n) => { for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (F35[c][r * 3 + q] === "1")
    for (let y = 0; y < celda; y++) for (let x = 0; x < celda; x++) a[(r * celda + y) * w + n * 4 * celda + q * celda + x] = 1; });
  return { a, w, h }; };
const verdad = "4817", vars = [...Array(10).keys()].map((d) => "48" + d + "7");
for (const esc of [2, 4, 8]) { // pixeles de la salida por pixel de la camara: el caracter (3 celdas = 12 px) mide 12/esc px de camara
  const Hs = [esc, 0, 0, 0, esc, 0, 0, 0, 1], R0 = renderD(verdad), bw = Math.ceil(R0.w / esc), bh = Math.ceil(R0.h / esc);
  let s2 = 11; const ruido = () => ((s2 = (s2 * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 0.1;
  const obs = RP.integrarEnImagen(R0.a, R0.w, R0.h, 1, Hs, 0, 0, bw, bh).map((v) => v + ruido());
  const rk = RP.ordenarRanking(vars.map((t) => { const R = renderD(t); return { txt: t, ncc: RP.ncc(RP.integrarEnImagen(R.a, R.w, R.h, 1, Hs, 0, 0, bw, bh), obs) }; }));
  const margen = -rk[1].delta;
  ok(rk[0].txt === verdad && margen > 0.02, `sintesis ${(12 / esc).toFixed(1)} px de camara por caracter: gana ${rk[0].txt} (margen ${margen.toFixed(3)} sobre ${rk[1].txt})`);
}
{ // control: si la degradacion lo borra todo (un solo bloque para todo el texto), empate exacto: no se inventa
  const R0 = renderD(verdad), bw = Math.ceil(R0.w / 2), bh = Math.ceil(R0.h / 2), Hs = [2, 0, 0, 0, 2, 0, 0, 0, 1], M = { tipo: "mosaico", bloque: 1000 };
  const obs = RP.degradar(RP.integrarEnImagen(R0.a, R0.w, R0.h, 1, Hs, 0, 0, bw, bh), bw, bh, M);
  const rk = RP.ordenarRanking(vars.map((t) => { const R = renderD(t); return { txt: t, ncc: RP.ncc(RP.degradar(RP.integrarEnImagen(R.a, R.w, R.h, 1, Hs, 0, 0, bw, bh), bw, bh, M), obs) }; }));
  ok(rk.every((x) => x.delta === 0), `control: degradacion total -> empate exacto entre las ${rk.length} candidatas (delta max ${Math.min(...rk.map((x) => x.delta))})`);
}

// hashes: vectores del RFC 1321 (MD5) y CRC32 de "123456789"; contraste con el crypto de Node en los bordes de bloque
const te = (t) => new TextEncoder().encode(t);
const vMD5 = { "": "d41d8cd98f00b204e9800998ecf8427e", a: "0cc175b9c0f1b6a831c399e269772661", abc: "900150983cd24fb0d6963f7d28e17f72",
  "message digest": "f96b697d7cb7938d525a2f31aaf161d0", abcdefghijklmnopqrstuvwxyz: "c3fcd3d76192e4007dfb496cca67e13b",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789": "d174ab98d277d9f5a5611c2c9f419d9f",
  ["1234567890".repeat(8)]: "57edf4a22be3c955ac49da2e2107b67a" };
ok(Object.entries(vMD5).every(([t, h]) => RP.md5(te(t)) === h), "MD5: los 7 vectores del RFC 1321");
ok(RP.crc32(te("123456789")) === "cbf43926", "CRC32 de '123456789' = cbf43926");
const nodeCrypto = require("crypto");
const largos = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 100003];
const difs = largos.filter((n) => { const b = nodeCrypto.randomBytes(n); return RP.md5(new Uint8Array(b)) !== nodeCrypto.createHash("md5").update(b).digest("hex"); });
ok(!difs.length, `MD5 igual al de Node en ${largos.length} longitudes (bordes de bloque de 64 bytes)${difs.length ? ": difiere en " + difs : ""}`);
ok(RP.md5(te("abd")) !== vMD5.abc, "control: MD5 de otro texto es distinto");

// integridad: DQT sintetico de libjpeg (calidad conocida) -> se lee y se estima exacto; tabla propia -> no estandar
const dqt = (tabs) => { const b = [0xff, 0xd8]; for (const [id, nat] of tabs) { const zz = RP.ZIGZAG.map((n) => nat[n]); b.push(0xff, 0xdb, 0, 67, id, ...zz); } b.push(0xff, 0xda, 0, 2); return Uint8Array.from(b); };
for (const q of [10, 50, 75, 90, 100]) {
  const t = RP.tablasCuantizacion(dqt([[0, RP.tablaIJG(q, RP.IJG_LUM)], [1, RP.tablaIJG(q, RP.IJG_CROM)]]));
  const e0 = RP.estimarCalidad(t[0].natural), e1 = RP.estimarCalidad(t[1].natural);
  ok(t.length === 2 && e0.exacta && e0.tipo === "luminancia" && e1.exacta && (e1.tipo === "crominancia" || q === 100) && /* a q100 todas valen 1: tipo indistinguible */ (e0.calidad === q || (q === 100 && e0.calidad >= 98)),
    `DQT libjpeg q${q}: leida y estimada q${e0.calidad} ${e0.tipo} exacta / q${e1.calidad} ${e1.tipo}`);
}
const propia = RP.estimarCalidad(RP.tablasCuantizacion(dqt([[0, RP.IJG_LUM.map((v, i) => 2 + (i % 7))]]))[0].natural);
ok(!propia.exacta && propia.desviacion > 1, `control: tabla propia -> no estandar (mas parecida q${propia.calidad}, desviacion ${propia.desviacion.toFixed(1)})`);
ok(RP.tablasCuantizacion(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])).length === 0, "sin JPEG -> sin tablas");
const o4 = Uint8ClampedArray.from([10, 10, 10, 255, 50, 50, 50, 255]), r4 = Uint8ClampedArray.from([12, 10, 7, 255, 50, 50, 50, 255]);
const el = RP.ela(o4, r4, 2, 10);
ok(el.mapa[0] === 30 && el.mapa[1] === 0 && el.media === 1.5, "ELA: maximo por canal amplificado (3 x 10) y media sin amplificar");

// mapas de calor: ruido x4 en una zona -> razon ~4 dentro y ~1 fuera; control sin zona -> ~1 en las dos
{ let s3 = 3; const az = () => ((s3 = (s3 * 1103515245 + 12345) % 2147483648) / 2147483648);
  const gs = () => { let u = 0; while (!u) u = az(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * az()); };
  const w = 256, h = 192, L1 = new Float32Array(w * h), L0 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const b = 120 + 40 * Math.sin(x / 30) + 20 * Math.cos(y / 25), z = x >= 96 && x < 192 && y >= 64 && y < 160;
    L1[y * w + x] = b + gs() * (z ? 8 : 2); L0[y * w + x] = b + gs() * 2; }
  const r1 = RP.mapaRuido(L1, w, h, 16), r0 = RP.mapaRuido(L0, w, h, 16), m = (r, a) => RP.mediaBloquesRect(r.razon, r.gw, 16, ...a);
  const di = m(r1, [96, 64, 192, 160]), fu = m(r1, [0, 0, 96, 64]), ci = m(r0, [96, 64, 192, 160]), cf = m(r0, [0, 0, 96, 64]);
  ok(di > 3 && Math.abs(fu - 1) < 0.15, `mapa de ruido: zona con ruido x4 -> razon ${di.toFixed(2)} dentro, ${fu.toFixed(2)} fuera`);
  ok(Math.abs(ci - 1) < 0.15 && Math.abs(cf - 1) < 0.15, `mapa de ruido, control sin zona: ${ci.toFixed(2)} dentro, ${cf.toFixed(2)} fuera`);
  const g = RP.ghostNormalizado([{ q: 60, d: Float32Array.from([1, 9]) }, { q: 75, d: Float32Array.from([4, 4]) }, { q: 90, d: Float32Array.from([7, 1]) }]);
  ok(g[0].n[0] === 0 && g[0].n[1] === 1 && g[2].n[0] === 1 && g[2].n[1] === 0, "JPEG ghost: cada bloque normalizado entre su minimo (0) y su maximo (1)"); }

// clonado: textura sin repeticiones (ruido por octavas + ruido de pixel); un trozo de 120x100 copiado 300 px a la derecha y
// 150 abajo se detecta con ese desplazamiento; control: la misma textura sin copiar -> ningun modelo
{ const w = 640, h = 480, sem = { v: 7 }, rnd = () => ((sem.v = (sem.v * 1664525 + 1013904223) >>> 0) / 4294967296);
  const L = new Float32Array(w * h);
  for (const [paso, amp] of [[64, 60], [24, 40], [9, 25], [4, 12]]) {
    const gw = Math.ceil(w / paso) + 2, gh = Math.ceil(h / paso) + 2, g = Float32Array.from({ length: gw * gh }, rnd);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / paso, fy = y / paso, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0, k = y0 * gw + x0;
      L[y * w + x] += amp * ((1 - ay) * ((1 - ax) * g[k] + ax * g[k + 1]) + ay * ((1 - ax) * g[k + gw] + ax * g[k + gw + 1]) - 0.5);
    }
  }
  for (let i = 0; i < L.length; i++) L[i] += 128 + 6 * (rnd() - 0.5);
  const C = Float32Array.from(L);
  for (let y = 60; y < 160; y++) for (let x = 80; x < 200; x++) C[(y + 150) * w + x + 300] = L[y * w + x];
  const rc = RP.detectarClonado(C, w, h), r0 = RP.detectarClonado(L, w, h), m = rc.modelos[0];
  ok(rc.modelos.length === 1 && Math.abs(m.desplazamiento[0] - 300) <= 2 && Math.abs(m.desplazamiento[1] - 150) <= 2 && Math.abs(m.giroGrados) < 1 && m.ncc > 0.8,
    `clonado: trozo copiado -> 1 modelo, desplazamiento ${m ? m.desplazamiento : "-"} (300,150), giro ${m ? m.giroGrados : "-"}, NCC ${m ? m.ncc : "-"}`);
  ok(r0.modelos.length === 0, `clonado, control sin copia: ${r0.modelos.length} modelos (${r0.bloques} bloques con textura)`); }

console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
