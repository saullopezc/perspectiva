// -----------------------------------------------------------------------------
// integridad_ui.js — Bloque "Integridad de la imagen": tablas de cuantizacion y
// calidad estimada, miniatura EXIF frente a la imagen principal, ELA, mapas de ruido,
// JPEG ghost y clonado (con la opcion de abrir el mapa como imagen). Usa el estado de app.js.
// Author: Saul López
// Date:   2026-11-15
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";

let ultimoELA = null; // { orig, recomp, w, h, calidad, amplificacion, media } (lo leen las pruebas)
let ultimoMapa = null; // { tipo, vals, gw, B, q } del ultimo mapa de calor (lo leen las pruebas)
const decodificar = async (blob) => { const im = new Image(), u = URL.createObjectURL(blob); im.src = u; await im.decode(); URL.revokeObjectURL(u); return im; };
const pixeles = (fuente, w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(fuente, 0, 0, w, h); return x.getImageData(0, 0, w, h); };

// al cambiar de imagen no puede quedar a la vista el resultado de otra (lo llama seleccionar en app.js)
function limpiarIntegridad() {
  $("integInfo").textContent = "(sin analizar)"; $("miniCanvas").hidden = true; $("elaCanvas").hidden = true; $("elaInfo").textContent = ""; ultimoELA = null;
  $("mapaCanvas").hidden = true; $("mapaInfo").textContent = ""; ultimoMapa = null;
}
async function analizarIntegridad() {
  $("miniCanvas").hidden = true;
  const F = F0(), A = F && F.archivo;
  if (!A || !A.u8) { $("integInfo").textContent = "Solo para archivos de imagen cargados (un fotograma o una imagen derivada no tiene bytes de fichero propios)."; return; }
  const L = [`${A.nombre}`], res = { archivo: A.nombre, sha256: A.sha256, tablas: [], miniatura: null };
  // 1) tablas de cuantizacion
  const tablas = RP.tablasCuantizacion(A.u8);
  if (!tablas.length) L.push("Cuantizacion: no es JPEG (o no tiene tablas DQT). En formatos sin perdida el ELA apenas aporta.");
  else {
    L.push("Cuantizacion (DQT):");
    tablas.forEach((t) => {
      const e = RP.estimarCalidad(t.natural); res.tablas.push({ id: t.id, precision: t.precision, ...e });
      L.push(`  tabla ${t.id} (${t.precision} bits): ` + (e.exacta ? `estandar libjpeg/IJG, ${e.tipo}, calidad ${e.calidad} EXACTA`
        : `NO estandar — la mas parecida: ${e.tipo} q${e.calidad} (desviacion media ${e.desviacion.toFixed(1)})`));
    });
    const qs = new Set(res.tablas.filter((t) => t.exacta).map((t) => t.calidad));
    L.push(res.tablas.every((t) => t.exacta)
      ? `  → tablas de libjpeg a calidad ${[...qs].join("/")}: la ultima escritura la hizo software (navegador, GIMP, Python, redes sociales...), no la camara.`
      : "  → tablas propias: tipico de una camara o de un editor con tablas propias (p. ej. Photoshop). Comparar con las del modelo de camara que dice el EXIF.");
    const ql = res.tablas.find((t) => t.tipo === "luminancia");
    if (ql) { // medido: el ELA distingue lo pegado al recomprimir a la MISMA calidad que el original, no a 90-95
      $("elaCalidad").value = ql.calidad; $("vElaCalidad").textContent = ql.calidad;
      L.push(`  → calidad del ELA puesta en ${ql.calidad} (la estimada del original): ahi lo ya recomprimido apenas cambia y lo pegado o retocado destaca.`);
    }
  }
  // 2) miniatura EXIF frente a la imagen principal
  const inc = A.meta.incrustables.find((x) => /miniatura EXIF/.test(x.desc));
  if (!inc) L.push("Miniatura EXIF: no tiene.");
  else {
    try {
      const mini = await decodificar(new Blob([A.u8.slice(inc.off, inc.off + inc.len)], { type: "image/jpeg" }));
      const w = mini.naturalWidth, h = mini.naturalHeight, a = pixeles(mini, w, h), b = pixeles(F.img, w, h), c = RP.compararMiniatura(a.data, b.data, w * h);
      const asp = Math.abs(w / h / (F.w / F.h) - 1), coincide = c.ncc >= 0.95 && c.difMedia < 12;
      res.miniatura = { ancho: w, alto: h, ncc: +c.ncc.toFixed(4), difMedia: +c.difMedia.toFixed(2), proporcionDistinta: asp > 0.03, coincide };
      L.push(`Miniatura EXIF ${w}x${h}: NCC ${c.ncc.toFixed(3)} · diferencia media ${c.difMedia.toFixed(1)} niveles`
        + (asp > 0.03 ? ` · proporcion distinta de la principal (${(w / h).toFixed(2)} frente a ${(F.w / F.h).toFixed(2)}): ¿recorte o bandas?` : "")
        + (coincide ? "\n  → coincide con la imagen principal." : "\n  → DIFIERE: indicio de que la imagen se edito despues de la captura (o de que la miniatura se regenero). Mirar la diferencia abajo."));
      const cv = $("miniCanvas"); cv.width = w * 3 + 8; cv.height = h; const x = cv.getContext("2d"), d = x.createImageData(w, h);
      for (let i = 0; i < w * h; i++) { const v = Math.min(255, 4 * Math.max(...[0, 1, 2].map((k) => Math.abs(a.data[i * 4 + k] - b.data[i * 4 + k])))); d.data.set([v, v, v, 255], i * 4); }
      x.putImageData(a, 0, 0); x.putImageData(b, w + 4, 0); x.putImageData(d, 2 * w + 8, 0); cv.hidden = false;
    } catch (err) { L.push(`Miniatura EXIF: no se pudo decodificar (${err.message}).`); }
  }
  L.push("Son indicios: ninguno prueba por si solo una manipulacion ni su ausencia.");
  A.integridad = res;
  $("integInfo").textContent = L.join("\n");
}

async function calcularELA() {
  const F = F0(); if (!F) return;
  const q = +$("elaCalidad").value, amp = +$("elaAmp").value;
  const c = document.createElement("canvas"); c.width = F.w; c.height = F.h; c.getContext("2d").drawImage(F.img, 0, 0);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", q / 100));
  const recomp = pixeles(await decodificar(blob), F.w, F.h).data, orig = F.datos.data;
  let r = RP.ela(orig, recomp, F.w * F.h, 1), ampUsada = amp;
  if ($("elaAuto").checked) { // autoescala: el percentil 99 del error pasa a blanco (los errores suelen ser decimas de nivel)
    const p99 = RP.percentil(r.mapa, 0.99); ampUsada = p99 > 0 ? Math.min(255, 255 / p99) : 1;
  }
  r = RP.ela(orig, recomp, F.w * F.h, ampUsada);
  ultimoELA = { orig, recomp, w: F.w, h: F.h, calidad: q, amplificacion: +ampUsada.toFixed(2), media: r.media };
  const cv = $("elaCanvas"); cv.width = F.w; cv.height = F.h; const x = cv.getContext("2d"), d = x.createImageData(F.w, F.h);
  for (let i = 0; i < r.mapa.length; i++) d.data.set([r.mapa[i], r.mapa[i], r.mapa[i], 255], i * 4);
  x.putImageData(d, 0, 0); cv.hidden = false;
  F.ela = { calidad: q, amplificacion: ultimoELA.amplificacion, autoescala: $("elaAuto").checked, errorMedio: +r.media.toFixed(3), recompresion: "codificador JPEG de este navegador" };
  $("elaInfo").textContent = `error medio ${r.media.toFixed(3)} niveles (recomprimida a q${q} por el navegador, x${ultimoELA.amplificacion}). Recomprime a la calidad del original (la pone «Analizar»): zonas claras sobre un fondo casi negro = distinta historia de compresion. Bordes y texto siempre salen algo claros.`;
}

$("btnIntegridad").onclick = analizarIntegridad;
$("btnELA").onclick = calcularELA;
$("btnElaAbrir").onclick = async () => {
  const F = F0(); if (!ultimoELA || !F) { alert("Calcula primero el ELA"); return; }
  const src = $("elaCanvas"), c = document.createElement("canvas"); c.width = src.width; c.height = src.height; c.getContext("2d").drawImage(src, 0, 0);
  const datos = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  agregarFuente({ tipo: "derivada", nombre: `ELA q${ultimoELA.calidad} x${ultimoELA.amplificacion} · ${F.nombre}`, sha256: await RP.sha256(datos.data.buffer.slice(0)), origen: null,
    derivado: { analisis: "ELA", calidad: ultimoELA.calidad, amplificacion: ultimoELA.amplificacion, sha256Fuente: F.sha256 }, w: c.width, h: c.height, img: c, datos, archivo: F.archivo });
};
["elaCalidad", "elaAmp"].forEach((id) => $(id).addEventListener("input", () => { $("v" + id[0].toUpperCase() + id.slice(1)).textContent = $(id).value; }));
$("vElaCalidad").textContent = $("elaCalidad").value; $("vElaAmp").textContent = $("elaAmp").value;

// ---------------------------------------------------------------- mapas de calor (mapas.js)
const B_MAPA = 16;
function pintarMapa() {
  const F = F0(); if (!F || !ultimoMapa) return;
  const op = +$("mapaOpacidad").value / 100, m = ultimoMapa;
  const rgba = m.tipo === "clonado" ? RP.componerClonado(F.datos.data, F.w, F.h, m.res, op)
    : RP.componerMapa(F.datos.data, F.w, F.h, m.vals, m.gw, m.B, m.tipo === "ruido" ? RP.colorRuido : RP.colorGhost, op);
  const cv = $("mapaCanvas"), x = cv.getContext("2d"); cv.width = F.w; cv.height = F.h; x.putImageData(new ImageData(rgba, F.w, F.h), 0, 0); cv.hidden = false;
  if (m.tipo === "clonado") { // flecha de cada origen a su copia
    x.lineWidth = Math.max(2, F.w / 400); x.strokeStyle = "#ffd400"; x.fillStyle = "#ffd400";
    m.res.modelos.forEach((mo, i) => {
      const [a, b] = [mo.cajaOrigen, mo.cajaDestino].map((c) => [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2]);
      x.beginPath(); x.moveTo(...a); x.lineTo(...b); x.stroke();
      x.font = `${Math.max(14, F.w / 50)}px sans-serif`; x.fillText(String(i + 1), b[0] + 6, b[1] - 6);
    });
  }
}
$("btnClonado").onclick = () => {
  const F = F0(); if (!F) return;
  $("mapaInfo").textContent = "Clonado: buscando zonas repetidas…";
  setTimeout(() => { // deja pintar el aviso antes del calculo (~1 s)
    const t0 = performance.now(), res = RP.detectarClonado(RP.lumRGBA(F.datos.data, F.w * F.h), F.w, F.h);
    ultimoMapa = { tipo: "clonado", res };
    F.mapa = { tipo: "clonado", modelos: res.modelos, bloquesConTextura: res.bloques, paresCoherentes: res.coherentes };
    const lista = res.modelos.map((m, i) => `${i + 1}) ${m.pares} bloques, desplazamiento ${m.desplazamiento.join(", ")} px, giro ${m.giroGrados} grados, escala ${m.escala}, ` +
      `detalle coincidente NCC ${m.ncc}; origen ${m.cajaOrigen.join(",")} -> copia ${m.cajaDestino.join(",")}`).join(" · ");
    $("mapaInfo").textContent = (res.modelos.length ? `Clonado: ${res.modelos.length} zona(s) copiada(s) dentro de la imagen. ${lista}.`
      : "Clonado: no se encontraron zonas copiadas dentro de la imagen (las zonas lisas y los bordes rectos no se pueden comprobar).") +
      ` Indicio, no prueba: los patrones que se repiten de verdad (ladrillos, rejas, letras iguales) tambien coinciden. (${Math.round(performance.now() - t0)} ms)`;
    pintarMapa();
  }, 30);
};
$("btnMapaRuido").onclick = () => {
  const F = F0(); if (!F) return;
  const r = RP.mapaRuido(RP.lumRGBA(F.datos.data, F.w * F.h), F.w, F.h, B_MAPA);
  ultimoMapa = { tipo: "ruido", vals: r.razon, gw: r.gw, B: B_MAPA };
  const altos = r.razon.filter((v) => v > 2).length, bajos = r.razon.filter((v) => v < 0.5).length;
  F.mapa = { tipo: "ruido", sigmaReferencia: +r.referencia.toFixed(3), bloques: r.razon.length, masDelDoble: altos, menosDeLaMitad: bajos };
  $("mapaInfo").textContent = `ruido de referencia (mediana) sigma ${r.referencia.toFixed(2)} niveles · bloques de ${B_MAPA} px con mas del doble: ${altos}, con menos de la mitad: ${bajos} (de ${r.razon.length}). Texturas, bordes y texto tambien suben el ruido: buscar zonas lisas que destaquen.`;
  pintarMapa();
};
$("btnGhost").onclick = async () => {
  const F = F0(); if (!F) return;
  if (!F.ghost) { // una recompresion por calidad (50, 55 ... 95), una sola vez por imagen
    $("mapaInfo").textContent = "JPEG ghost: recomprimiendo a 10 calidades…";
    const c = document.createElement("canvas"); c.width = F.w; c.height = F.h; c.getContext("2d").drawImage(F.img, 0, 0);
    const lista = [];
    for (let q = 50; q <= 95; q += 5) {
      const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", q / 100));
      const rec = pixeles(await decodificar(blob), F.w, F.h).data, d = RP.difBloques(F.datos.data, rec, F.w, F.h, B_MAPA);
      lista.push({ q, d: d.d }); F.ghostGw = d.gw;
    }
    F.ghost = RP.ghostNormalizado(lista);
  }
  const q = +$("ghostQ").value, g = F.ghost.find((x) => x.q === q);
  ultimoMapa = { tipo: "ghost", q, vals: g.n, gw: F.ghostGw, B: B_MAPA };
  F.mapa = { tipo: "JPEG ghost", calidad: q };
  $("mapaInfo").textContent = `JPEG ghost a calidad ${q}: oscuro = zona cuya diferencia es minima a esta calidad (ya estuvo comprimida a ${q}). Recorre las calidades: una zona que se oscurece en una calidad distinta que el resto es indicio de otra historia de compresion.`;
  pintarMapa();
};
$("ghostQ").addEventListener("input", () => { $("vGhostQ").textContent = $("ghostQ").value; if (ultimoMapa && ultimoMapa.tipo === "ghost") $("btnGhost").onclick(); });
$("mapaOpacidad").addEventListener("input", () => { $("vMapaOpacidad").textContent = $("mapaOpacidad").value; pintarMapa(); });
$("vGhostQ").textContent = $("ghostQ").value; $("vMapaOpacidad").textContent = $("mapaOpacidad").value;
$("btnMapaAbrir").onclick = async () => {
  const F = F0(); if (!ultimoMapa || !F) { alert("Calcula primero un mapa"); return; }
  const src = $("mapaCanvas"), c = document.createElement("canvas"); c.width = src.width; c.height = src.height; c.getContext("2d").drawImage(src, 0, 0);
  const datos = c.getContext("2d").getImageData(0, 0, c.width, c.height), nom = { ruido: "mapa de ruido", clonado: "mapa de clonado" }[ultimoMapa.tipo] || `JPEG ghost q${ultimoMapa.q}`;
  agregarFuente({ tipo: "derivada", nombre: `${nom} · ${F.nombre}`, sha256: await RP.sha256(datos.data.buffer.slice(0)), origen: null,
    derivado: { analisis: nom, sha256Fuente: F.sha256 }, w: c.width, h: c.height, img: c, datos, archivo: F.archivo });
};
