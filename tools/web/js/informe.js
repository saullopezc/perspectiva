// -----------------------------------------------------------------------------
// informe.js — Informe de analisis (HTML autocontenido) del estado actual: archivos
// y hashes, fuente y origen, geometria y residuos, parametros que difieren de los
// valores por defecto, imagenes (original con la geometria, salida, plantilla),
// comparacion por sintesis, integridad y exportaciones, y el registro JSON completo.
// Es un documento de TRABAJO para el analisis: mediciones e indicios.
// Usa el estado de app.js y de los demas modulos de la interfaz.
// Author: Saul López
// Date:   2026-11-16
// Modified By:   Saul López
// Modified Date: 2026-11-19
// -----------------------------------------------------------------------------
"use strict";

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const filaHtml = (celdas, th = false) => `<tr>${celdas.map((c) => `<${th ? "th" : "td"}>${c}</${th ? "th" : "td"}>`).join("")}</tr>`;
const tablaHtml = (cab, filas) => `<table>${filaHtml(cab.map(escHtml), true)}${filas.map((f) => filaHtml(f)).join("")}</table>`;

// lienzo -> PNG en data URL, reducido (sin suavizar al ampliar) para que el informe no pese de mas
function imgHtml(fuente, pie, maxAncho = 900, minAncho = 0) {
  if (!fuente || !fuente.width) return "";
  const k = fuente.width > maxAncho ? maxAncho / fuente.width : fuente.width < minAncho ? Math.ceil(minAncho / fuente.width) : 1;
  const c = document.createElement("canvas"); c.width = Math.round(fuente.width * k); c.height = Math.round(fuente.height * k);
  const x = c.getContext("2d"); x.imageSmoothingEnabled = k < 1; x.drawImage(fuente, 0, 0, c.width, c.height);
  return `<figure><img src="${c.toDataURL("image/png")}" alt="${escHtml(pie)}"><figcaption>${escHtml(pie)}</figcaption></figure>`;
}
const lienzoDe = (imageData) => { const c = document.createElement("canvas"); c.width = imageData.width; c.height = imageData.height; c.getContext("2d").putImageData(imageData, 0, 0); return c; };

// original con la geometria dibujada (esquinas efectivas y, en N puntos, los puntos de control con su residuo)
function originalConGeometria(F) {
  const k = Math.min(1, 900 / F.w), c = document.createElement("canvas"); c.width = Math.round(F.w * k); c.height = Math.round(F.h * k);
  const x = c.getContext("2d"); x.drawImage(F.img, 0, 0, c.width, c.height);
  const E = esquinas(F);
  if (E.length === 4) { x.strokeStyle = "#00e08a"; x.lineWidth = 2; x.beginPath(); E.forEach(([a, b], i) => (i ? x.lineTo(a * k, b * k) : x.moveTo(a * k, b * k))); x.closePath(); x.stroke(); }
  x.font = "12px sans-serif";
  (modo() === "control" ? F.control : editables(F)).forEach(([a, b], i) => {
    x.strokeStyle = x.fillStyle = "#ffd24d"; x.beginPath(); x.arc(a * k, b * k, 5, 0, 7); x.stroke();
    const et = modo() === "control" ? `${F.controlRef[i].id}${F.controlRes ? " " + F.controlRes.r[i].toFixed(1) + "px" : ""}` : String(i + 1);
    x.fillText(et, a * k + 7, b * k - 7);
  });
  return c;
}

function parametrosCambiados() {
  const c = leerConfig();
  return Object.keys(c).filter((k) => k !== "__rot90" && String(c[k]) !== String(DEFECTO[k])).map((k) => [escHtml(k), escHtml(DEFECTO[k]), `<b>${escHtml(c[k])}</b>`])
    .concat(rot90 ? [["rotacion 90", "0", `<b>${rot90}</b>`]] : []);
}

async function generarInforme() {
  const F = F0(), r = registro(), ahora = new Date(), S = [];
  S.push(`<p class="aviso">Informe de ANALISIS (documento de trabajo): resume lo hecho con la herramienta para revisarlo o repetirlo. Los resultados son mediciones e indicios, con sus limites indicados.</p>`);
  S.push(tablaHtml(["campo", "valor"], [
    ["generado", `${escHtml(ahora.toISOString())} (UTC) · ${escHtml(ahora.toString())}`], ["herramienta", "Perspectiva (perspectiva.html)"],
    ["navegador", escHtml(navigator.userAgent)], ["zona horaria", escHtml(Intl.DateTimeFormat().resolvedOptions().timeZone)]]));
  // archivos
  const vigentes = archivos.filter((A) => !A.retirado);
  S.push("<h2>Archivos cargados</h2>" + (vigentes.length ? tablaHtml(["archivo", "clase", "bytes", "MD5", "SHA-1", "SHA-256"], vigentes.map((A) => [
    escHtml(A.nombre), escHtml(A.clase), A.hashes ? A.hashes.bytes : "", ...(A.hashes ? [A.hashes.md5, A.hashes.sha1] : ["(calculando)", ""]).map(escHtml), `<code>${escHtml(A.sha256)}</code>`]))
    + `<details><summary>SHA-512 y CRC32</summary>${tablaHtml(["archivo", "SHA-512", "CRC32"], vigentes.map((A) => [escHtml(A.nombre), `<code>${escHtml(A.hashes?.sha512 || "")}</code>`, escHtml(A.hashes?.crc32 || "")]))}</details>`
    : "<p>Ninguno.</p>"));
  const resumenes = vigentes.filter((A) => A.estructura).map((A) => `<details><summary>${escHtml(A.nombre)}</summary><pre>${escHtml(resumenArchivo(A))}</pre></details>`);
  if (resumenes.length) S.push("<h2>Analisis de los archivos</h2><p>Formato, codecs, pistas y entropia de cada archivo.</p>" + resumenes.join(""));
  if (!F) { S.push("<p>No hay imagen ni fotograma seleccionado: el resto del informe no aplica.</p>"); }
  else {
    // fuente
    S.push("<h2>Imagen analizada</h2>" + tablaHtml(["campo", "valor"], [
      ["nombre", escHtml(F.nombre)], ["tipo", escHtml(F.tipo)], ["tamano", `${F.w} x ${F.h} px`], ["SHA-256 (fichero o pixeles)", `<code>${escHtml(F.sha256)}</code>`],
      ...(F.origen ? [["origen", escHtml(`fotograma ${F.origen.fotograma} de ${F.origen.video} en t=${F.origen.t.toFixed(3)} s (SHA-256 del video ${F.origen.sha256Video})`)]] : []),
      ...(F.derivado ? [["derivada de", escHtml(`${F.derivado.analisis} de la imagen con SHA-256 ${F.derivado.sha256Fuente} (${JSON.stringify(F.derivado)})`)]] : [])]));
    // geometria
    const g = r.geometria, E = r.esquinas_TL_TR_BR_BL;
    S.push("<h2>Geometria y rectificacion</h2>" + tablaHtml(["campo", "valor"], [
      ["modo", escHtml(g.modo)], ["forma", escHtml(`${r.parametros.anchoCm} x ${r.parametros.altoCm} cm (preset ${g.preset})`)],
      ["esquinas SI, SD, ID, II (px)", escHtml(E.map((p) => `(${p[0]}, ${p[1]})`).join(" · ") || "sin geometria")],
      ...(g.aspecto_estimado ? [["aspecto estimado", escHtml(`${g.aspecto_estimado.aspecto.toFixed(3)} (${g.aspecto_estimado.metodo}${g.aspecto_estimado.f ? `, f ${g.aspecto_estimado.f.toFixed(0)} px` : ""})`)]] : []),
      ...(g.modo === "control" && F.controlRes ? [["puntos de control", escHtml(`${F.control.length} puntos · residuo rms ${F.controlRes.rms.toFixed(2)} px · max ${F.controlRes.max.toFixed(2)} px`)]] : []),
      ["interpolacion", escHtml(r.nucleo)], ...(r.apilado ? [["apilado", `<pre>${escHtml(JSON.stringify(r.apilado, null, 1))}</pre>`]] : [])]));
    const cambios = parametrosCambiados();
    S.push("<h3>Parametros distintos de los valores por defecto</h3>" + (cambios.length ? tablaHtml(["parametro", "por defecto", "usado"], cambios) : "<p>Ninguno: todo en sus valores por defecto.</p>"));
    S.push('<div class="imgs">' + imgHtml(originalConGeometria(F), "original con la geometria marcada")
      + (limpia ? imgHtml(lienzoDe(limpia), `salida rectificada ${limpia.width}x${limpia.height} px${r.apilado ? " (apilado)" : ""}, ampliada sin suavizar`, 900, 600) : "")
      + ($("plantilla").value && cvS.width ? imgHtml(cvS, `salida con la plantilla «${$("plantilla").value}»`) : "") + "</div>");
    // sintesis
    if (r.plantilla) S.push("<h2>Plantilla de hipotesis</h2>" + tablaHtml(["campo", "valor"], [["texto", escHtml(r.plantilla)], ["parametros", `<code>${escHtml(JSON.stringify(r.plantillaParametros))}</code>`]]));
    if (r.comparacion) {
      const c = r.comparacion;
      S.push(`<h2>Comparacion por sintesis</h2><p>${c.candidatas} candidatas${c.truncado ? " (truncadas)" : ""} · degradacion <code>${escHtml(JSON.stringify(c.modelo))}</code> · texto ${c.polaridadClara ? "claro" : "oscuro"}. Resultado: ${escHtml($("infoComparar").textContent)}</p>`
        + tablaHtml(["#", "candidata", "NCC", "diferencia con la 1.a", "NCC por caracter"], c.top.map((x, i) => [i + 1, `<b>${escHtml(x.txt)}</b>`, x.ncc.toFixed(4), i ? x.delta.toFixed(4) : "",
          escHtml((x.chars || []).map((ch) => `${ch.c}:${ch.ncc === null ? "-" : ch.ncc.toFixed(2)}`).join(" "))])));
    }
    // integridad
    const integ = $("integInfo").textContent;
    if (!integ.startsWith("(sin") || F.ela || F.mapa) {
      S.push("<h2>Integridad de la imagen (indicios)</h2>" + (integ.startsWith("(sin") ? "" : `<pre>${escHtml(integ)}</pre>`)
        + (!$("miniCanvas").hidden ? imgHtml($("miniCanvas"), "miniatura EXIF · imagen principal reducida · diferencia x4", 900, 480) : "")
        + (F.ela && !$("elaCanvas").hidden ? `<p>${escHtml($("elaInfo").textContent)}</p>` + imgHtml($("elaCanvas"), `ELA a q${F.ela.calidad} x${F.ela.amplificacion}`) : "")
        + (F.mapa && !$("mapaCanvas").hidden ? `<p>${escHtml($("mapaInfo").textContent)}</p>` + imgHtml($("mapaCanvas"), F.mapa.tipo === "ruido" ? "mapa de ruido" : `JPEG ghost a calidad ${F.mapa.calidad}`) : ""));
    }
  }
  if (r.retiradas.length) S.push("<h2>Quitados de la sesion</h2><p>Se sacaron de la sesion (el fichero en disco no se toca).</p>"
    + tablaHtml(["nombre", "clase", "SHA-256", "fecha"], r.retiradas.map((x) => [escHtml(x.nombre), escHtml(x.clase), `<code>${escHtml(x.sha256)}</code>`, escHtml(x.fecha)])));
  // exportaciones
  S.push("<h2>Exportaciones de esta sesion</h2>" + (exportaciones.length ? tablaHtml(["fichero", "contenido", "formato", "bytes", "MD5", "SHA-256", "fecha"],
    exportaciones.map((e) => [escHtml(e.fichero), escHtml(e.contenido), escHtml(e.formato), e.bytes, escHtml(e.md5 || ""), `<code>${escHtml(e.sha256)}</code>`, escHtml(e.fecha)])) : "<p>Ninguna.</p>"));
  S.push(`<h2>Registro JSON (para reproducir)</h2><p>Se reproduce cargando la misma fuente y este registro con «Reproducir JSON».</p><details><summary>ver registro</summary><pre id="registro">${escHtml(JSON.stringify(r, null, 2))}</pre></details>`);
  S.push("<p class=\"pie\">El informe no puede contener su propio hash: la herramienta lo calcula al guardarlo y lo anota en «Exportaciones».</p>");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de analisis — ${escHtml(F ? F.nombre : "sin imagen")}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#1d2433;background:#fff}
h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #d6dbe4;padding-bottom:4px}h3{font-size:14px}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d6dbe4;padding:4px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#f1f4f8}code,pre{font:12px/1.4 ui-monospace,monospace}pre{background:#f6f8fa;padding:8px;overflow:auto;white-space:pre-wrap}
.aviso{background:#fff4d6;border:1px solid #e6c46a;padding:8px 10px;border-radius:6px}.imgs img,figure img{max-width:100%;border:1px solid #d6dbe4;image-rendering:pixelated}
figure{margin:12px 0}figcaption{font-size:12px;color:#5a6577}.pie{color:#5a6577;font-size:12px;margin-top:24px}</style></head>
<body><h1>Informe de analisis — ${escHtml(F ? F.nombre : "sin imagen")}</h1>${S.join("\n")}</body></html>`;
}

$("btnInforme").onclick = async () => {
  try {
    const html = await generarInforme(), blob = new Blob([html], { type: "text/html" }), hs = await RP.hashes(await blob.arrayBuffer());
    const nombre = `${RP.sello()}_informe_analisis.html`;
    descargar(nombre, blob);
    exportaciones.push({ fichero: nombre, formato: "html", contenido: "informe de analisis", escala: null, ancho: null, alto: null, bytes: blob.size,
      sha256: hs.sha256, md5: hs.md5, sha1: hs.sha1, sha512: hs.sha512, calidad: null, fecha: new Date().toISOString() });
    const li = document.createElement("li"); li.textContent = `${nombre} · ${blob.size} B · sha256 ${hs.sha256.slice(0, 16)}… · md5 ${hs.md5}`; li.title = RP.informeHashes(hs); $("listaExport").prepend(li);
    $("infoExport").textContent = `${exportaciones.length} guardadas`;
  } catch (err) { alert("No se pudo generar el informe: " + err.message); }
};
