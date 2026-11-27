---
id: manual-perspectiva
tipo: manual
proyecto: Perspectiva (tools/web)
actualizado: 2026-11-27
estado: vigente
version: 2.0
clasificacion: C1
responsable: Saul López
revision: 2027-05-19
tags: [manual, herramienta-web, imagen, video]
---

# Manual de uso — Perspectiva

## 1. Objeto y alcance

Herramienta de navegador para **analizar y mejorar imágenes y fotogramas de vídeo**: corregir la perspectiva de una
zona, recortar o editar la imagen entera, mejorar la legibilidad, contrastar hipótesis de lectura de un texto, apilar
fotogramas, calcular hashes, examinar metadatos e indicios de integridad, y dejar registro reproducible de lo hecho.

Funciona **sin conexión y sin instalar nada**: basta abrir la página en Chromium o Firefox. Los archivos que se cargan
**no salen del equipo** ni se modifican: la herramienta trabaja sobre una copia en memoria.

**Límite que rige todo el manual:** los resultados son **mediciones e indicios**. Ninguna función convierte una imagen
ilegible en una lectura cierta, ni prueba por sí sola una manipulación o su ausencia. El informe que genera es un
**documento de trabajo** para revisar o repetir el análisis.

## 2. Arranque

1. Abrir la página (`index.html` en la versión publicada, `tools/web/perspectiva.html` en el repositorio).
2. Cargar archivos con **Abrir archivos**, arrastrándolos a la ventana, con **Pegar** (o `Ctrl+V`) desde el
   portapapeles, o con el botón **＋** junto al carrusel. Para arrastrar, hay que hacerlo desde el explorador de archivos
   del sistema: lo arrastrado desde el explorador de un editor de código o desde otra pestaña llega como enlace, no como
   fichero, y una página web no puede leerlo; la página lo avisa.
3. Para trabajar con vídeo: cargarlo y capturar fotogramas (sección 5.2); al cargarlo, el panel muestra el bloque
   *Vídeo*. Las herramientas de imagen se activan cuando hay al menos una imagen o un fotograma.

Mientras se carga un archivo aparece un aviso con el paso en curso (lectura, hash, metadatos, decodificación). El panel
siempre se muestra al abrir la página; se recuerdan su posición y su tamaño.

Las fuentes tipográficas libres (OFL) vienen incluidas.

**Actualizar.** En la versión publicada, el botón **Actualizar** de la cabecera comprueba si el sitio tiene una versión
más nueva que la abierta (compara la versión de la página con el `version.json` del sitio, sin pasar por la caché). Si
la hay, pregunta antes de recargar: recargar descarta las imágenes, los puntos y los ajustes de la sesión, así que
conviene exportar antes lo que se necesite. Abierta como fichero local o desde el repositorio no hay versión con la que
comparar, y el botón lo dice.

## 3. Pantalla

| Zona | Contenido |
|---|---|
| Cabecera | abrir, pegar, estado (imagen actual y tamaño), **Actualizar** (versión nueva del sitio), **GitHub** (código fuente y licencia, en otra pestaña), **Ayuda** (este manual y las licencias), mostrar u ocultar el panel (`P`) y su posición |
| Carrusel | una hoja por imagen o fotograma; la actual, de frente. Se quitan con la ✕ de la hoja y se añaden con el botón **＋** |
| Lienzo y geometría | la imagen original; aquí se elige qué zona se trabaja. Arrastrar mueve la imagen; un clic marca un punto |
| Salida | el resultado con los ajustes aplicados, en un marco fijo: rueda para ampliar hacia el cursor, arrastrar para moverlo, doble clic para verlo entero |
| Panel lateral | bloques plegables con los controles; cada bloque con controles tiene **↺** para volver a sus valores por defecto |

En el **móvil** o en una tableta en vertical (ventana de 820 px de ancho o menos, o de 520 px de alto o menos) todo va en una
columna que se desplaza entera: carrusel, lienzo y salida arriba y el panel debajo; su posición no se elige. Con el dedo,
tocar marca un punto, arrastrar un punto lo mueve y arrastrar fuera de los puntos mueve la imagen; para ampliar están los
botones **＋**/**－** del lienzo y el deslizador de zoom de la salida.

## 4. Flujo de trabajo recomendado

1. **Cargar** la imagen o el vídeo y anotar sus **hashes** (bloque *Metadatos*).
2. Si es vídeo, **capturar** el fotograma o el rango que interesa.
3. Elegir **qué se trabaja**: la imagen completa, un recorte, o una zona en perspectiva (4 esquinas, 4 aristas o N puntos).
4. **Ajustar** forma, interpolación, color y luminancia, empezando por lo menos invasivo.
5. Si hay varios fotogramas: **seguir puntos y apilar** para reducir ruido.
6. Contrastar lecturas de un texto con la **plantilla de hipótesis** y, si es muy pequeño o pixelado, con la
   **comparación por síntesis**.
7. Revisar **integridad** si importa la autenticidad de la imagen.
8. **Exportar** lo necesario (formato sin pérdida) y generar el **registro JSON** y el **informe de análisis**.

## 5. Funciones

### 5.1 Carga, carrusel y ajustes por imagen

- Cualquier fichero: si el navegador lo decodifica como imagen (por su contenido, no por la extensión) entra al
  carrusel; si es vídeo, al bloque *Vídeo*; si no, solo a *Metadatos* y *Análisis de archivo*.
- **Navegar:** clic en una hoja, rueda sobre el carrusel, `,` / `.` o `RePág` / `AvPág`.
- **Añadir:** botón **＋** junto al carrusel (imágenes, vídeos y documentos).
- **Quitar:** ✕ de la hoja, o `Supr` sobre la imagen actual. Un vídeo o un documento que no es imagen se quita con
  **quitar** en *Metadatos* (los fotogramas ya capturados de un vídeo se quedan). Quitar solo lo saca de la sesión: el
  fichero en disco no se toca. La retirada (nombre, SHA-256, hora) queda en el registro JSON; el informe no menciona
  lo quitado, porque no se analiza.
- **Ajustes por imagen** (bloque *Configuración entre imágenes*): por defecto cada imagen tiene **sus propios ajustes**
  y un cambio solo afecta a la imagen actual. También se puede elegir que la nueva parta de la anterior, o que los
  mismos ajustes se apliquen a todas. *copiar geometría del anterior* reutiliza los puntos marcados.

### 5.2 Vídeo

- Reproductor con avance de **un fotograma** (◀ / ▶), número de fotograma y tiempo exacto presentado.
- **fps**: los del contenedor cuando los declara; también se pueden medir reproduciendo y aplicar con *usar*.
- **Capturar** el fotograma actual, o un **rango** (desde/hasta en segundos, cada N fotogramas, o N fotogramas desde el
  actual). Cada captura guarda su origen: vídeo (SHA-256), tiempo y número de fotograma.
- **Objetos en movimiento:** con *al capturar: seguir los puntos del fotograma anterior* (activado por defecto), al
  capturar un fotograma —suelto o en rango— del mismo vídeo, los puntos marcados en el anterior se buscan en el nuevo:
  si el objeto o la cámara se mueven, los puntos lo siguen. Con *y apilarlos*, los fotogramas de un rango se apilan.
  Un punto que no se encuentra con suficiente parecido se informa y ese fotograma no se apila.

### 5.3 Qué zona se trabaja (bloque *Lienzo y geometría*)

| Modo | Uso |
|---|---|
| **imagen completa** | la imagen entera, sin rectificar: los ajustes se aplican a toda ella, píxel a píxel |
| **recorte** | dos clics en esquinas opuestas de un rectángulo; la salida es esa zona tal cual, sin rectificar |
| **4 esquinas** | clic en las cuatro esquinas de un rectángulo visto en perspectiva, en cualquier orden; la salida es ese rectángulo de frente |
| **4 aristas** | dos puntos sobre cada borde (superior, derecho, inferior, izquierdo); las esquinas son las intersecciones. Sirve si una esquina está tapada o borrosa |
| **N puntos** | cuatro o más puntos cuya posición real se conoce (esquinas, referencias de la lista o coordenadas manuales en cm). Se ajusta por mínimos cuadrados y cada punto muestra su **residuo** en píxeles: uno mal marcado se delata (aviso si supera 3 px) |

- **Mover la imagen:** arrastrar con el botón izquierdo (o con el derecho). Un clic sin mover marca un punto.
- Mover un punto: arrastrarlo, o seleccionarlo y usar las flechas (0,1 px; 1 px con `Mayús`). Coordenadas editables en
  *coordenadas*. Zoom con la rueda o los botones. La lupa muestra los píxeles reales.
- **Forma** (para los modos con perspectiva): tamaños predefinidos, personalizada, o **Automático**, que estima la
  proporción real a partir de la perspectiva de las 4 esquinas. Requiere que la foto no esté recortada (supone el centro
  óptico en el centro de la imagen); el texto informativo indica el método y, si no puede estimar la focal, lo dice.

### 5.4 Salida, interpolación y forma

- **Ventana de la salida:** la imagen se amplía dentro de un marco fijo. Rueda: zoom hacia el cursor. Arrastrar: mover.
  Doble clic o **ajustar**: verla entera. El zoom solo cambia la vista, no los píxeles exportados a 1×.
- **⤢** pliega el lienzo y da todo el espacio a la salida (otra vez: lo vuelve a mostrar). También se pliega con el
  título del bloque *Lienzo y geometría*.
- **Ver los píxeles tal cual:** con *recorte* e interpolación *ninguna*, la salida ampliada muestra los píxeles originales
  sin remuestrear; corregir la perspectiva remuestrea y, en zonas de pocos píxeles, puede suavizar lo que ya se veía.
- **alto px** de la salida en los modos con perspectiva (en imagen completa y recorte, la salida es 1:1).
- **Interpolación:** *ninguna* (vecino más cercano: los píxeles originales, por defecto), bilineal, bicúbica, en
  escalera, Lanczos-3, Mitchell-Netravali, B-spline. Ninguna añade información; cambian cómo se rellena entre píxeles.
- **margen**, **rotación** fina y de 90°, **trapecio** horizontal y vertical, **espejo** horizontal y vertical.

### 5.5 Color, ruido y luminancia

- **Color:** ganancias R/G/B, temperatura, saturación, tono, y **gris desde**: *normal (color)* (por defecto), luminancia
  BT.601, un canal (texto azul sobre fondo blanco: probar *canal R*) o mezclador. Elegir un gris activa la escala de
  grises; *normal (color)* la quita.
- **Ruido y movimiento:** mediana, gaussiano o bilateral; deconvolución de movimiento (Richardson-Lucy).
- **Luminancia y nitidez:** campo plano, CLAHE, auto-niveles (rango común a los tres canales), negro, blanco, gamma,
  brillo, contraste, nitidez, binarizado, negativo y vista de gradiente (Sobel).
- **Histograma** de la región trabajada o de la imagen completa.

### 5.6 Plantilla de hipótesis

Superpone un texto candidato sobre la salida para contrastarlo a ojo.

- Texto tal cual se escribe (espacios incluidos). Si el texto sigue el formato GT (prefijo, 3 dígitos, 3 consonantes),
  lo indica.
- **fuente** (incluidas: Barlow, Barlow Semi Condensed, Barlow Condensed, Oswald, Overpass; o cargar una TTF/OTF/WOFF),
  **alto**, **ancho**, **estirar ↕**, **grosor**, **negrita**, **paso fijo** (cada carácter en una celda igual),
  **espaciado**, desplazamiento, opacidad y rejilla de celdas.
- La plantilla sirve para comparar, no para afirmar: la tipografía real puede no estar entre las disponibles.

### 5.7 Comparación por síntesis

Para textos muy pequeños o pixelados. Cada candidata se renderiza, se lleva a la perspectiva de la foto, se integra en
los píxeles de la cámara y se degrada como la foto; después se compara con los píxeles originales (correlación NCC).

1. Escribir en la plantilla un **texto conocido** que aparezca en la imagen, acercarlo a mano y pulsar **Ajustar al
   texto de la plantilla**: calibra el encaje y la degradación (desenfoque gaussiano o mosaico por bloques). Marcar
   *texto claro sobre fondo oscuro* si corresponde.
2. Marcar **fijar degradación**.
3. Escribir el texto aproximado en la plantilla, acercarlo, y listar **candidatas** (una por línea; `?` = cualquier
   carácter válido en esa posición, `[38]` = uno de esos).
4. **Comparar candidatas**: ranking con NCC, diferencia con la primera y NCC por carácter (color).

Lectura del resultado: importa el margen sobre la segunda. Con margen menor de 0,01 la herramienta informa **empate
práctico**: los píxeles no distinguen entre esas candidatas. El ranking ordena hipótesis; no demuestra que la primera
sea la real. Medido sobre un caso sintético: la candidata real quedó primera de 30 a 24, 8, 4,8 y 3,5 píxeles por
carácter, con márgenes de 0,013 a 0,020; con desenfoque fuerte, empate.

Si el desenfoque calibrado llega a su tope, el aviso indica que no es identificable con ese texto: no fijarlo. En
imágenes nítidas y grandes la comparación trabaja por bloques para no bloquear la página (lo indica el texto informativo).

### 5.8 Apilado de fotogramas

- **Seguir puntos desde la actual**: busca los puntos marcados en los demás fotogramas del mismo tamaño (correlación
  subpíxel); umbral *NCC mínima*; los que no alcanzan el umbral no se apilan.
- **Seguir y apilar**, **Añadir actual**, **Añadir todos**, **Vaciar**, *ver apilado*.
- Mezcla media, mediana o media recortada; alineado fino entero, subpíxel o ninguno; **nítidos %** para usar solo los
  fotogramas más nítidos.
- **Superresolución** (mezcla *superresolución*): en vez de promediar los fotogramas ya rectificados, reconstruye cada
  píxel de la salida con los **píxeles originales** de todos los fotogramas de la pila, proyectados con los puntos
  seguidos de cada uno; después deshace el promedio que hace el sensor (*deconvolución*, Richardson-Lucy). Uso: capturar
  un rango de fotogramas (bloque *Vídeo*) con la geometría marcada en el de partida; se siguen y se apilan solos; elegir
  la mezcla *superresolución* y subir el **alto de salida** (sin más píxeles de salida que de origen no hay detalle que
  ganar; la página lo avisa). *núcleo SR*: 0,3 con muchos fotogramas; con menos de 9, 0,5-0,6 (si no, quedan bloques).
  Medido con una secuencia de verdad conocida (12 fotogramas desplazados tercios de píxel, ×3): error 0,0031 la media,
  0,0009 la media con la misma deconvolución y 0,0008 la superresolución. **La mayor parte de la ganancia viene de la
  deconvolución.** Necesita fotogramas que muestreen la escena de forma independiente: en un vídeo muy comprimido los
  fotogramas consecutivos se predicen unos de otros y apenas aportan detalle nuevo.
- *búsqueda* es cuánto puede haberse movido cada punto entre un fotograma y el siguiente (por defecto 12 px). Si el
  objeto se mueve más y no se encuentra, se reintenta solo con la búsqueda máxima (60 px), y el aviso lo dice. Un
  fotograma donde no se encuentra el objeto **conserva su geometría** (vacía o la marcada a mano): no se apila ni recibe
  esquinas estimadas. La pila de un rango se rectifica con los ajustes del fotograma de partida.

### 5.9 Integridad de la imagen (indicios)

- **Analizar tablas y miniatura:**
  - *Tablas de cuantización JPEG*: si coinciden exactamente con las de libjpeg a una calidad, la última escritura fue
    software (navegador, editor, redes sociales…); si son propias, cámara o editor con tablas propias.
  - *Miniatura EXIF frente a la imagen principal*: si difieren, indicio de edición posterior a la captura (o miniatura
    regenerada). Se muestran miniatura, imagen reducida y diferencia.
- **ELA** (análisis del nivel de error): recomprime y amplifica la diferencia. Debe hacerse a la **calidad del
  original**, que *Analizar* fija sola a partir de las tablas; a 90-95 no distingue lo pegado (medido). Con *autoescala*,
  el percentil 99 del error pasa a blanco. **abrir ELA como imagen** lo añade al carrusel para ampliarlo.
- **Mapas de calor** sobre la imagen (con *opacidad* regulable y *abrir mapa como imagen*):
  - **Mapa de ruido:** compara el nivel de ruido de cada bloque de 16 px con el de la imagen (mediana). Rojo: más
    ruido; azul: menos. Una zona pegada de otra foto, suavizada o retocada suele tener un ruido distinto. Las texturas,
    los bordes y el texto también suben el ruido, y un fondo que ya trae ruido propio distinto se confunde con un
    retoque: buscar zonas lisas que destaquen de su entorno. Medido: una zona con cuatro veces más ruido da 3,75 frente
    a 0,97; la misma imagen sin retoque, 0,99 frente a 1,01.
  - **JPEG ghost:** recomprime a 10 calidades (50 a 95) y muestra, para la elegida, dónde la diferencia es mínima
    (oscuro). Una zona que ya estuvo comprimida a otra calidad se oscurece en esa calidad mientras el resto no. Medido:
    una zona comprimida antes a 60 da 0,15 frente a 0,87 del resto en el mapa de 60.
  - **Clonado** (copy-move): busca zonas copiadas de otra parte de la **misma** imagen, también giradas o reescaladas
    levemente. Azul: origen; rojo: la copia; la flecha une cada origen con su copia, y el texto da desplazamiento, giro,
    escala y el parecido del detalle fino (NCC). Cómo decide: describe cada bloque de forma que no cambie al girarlo,
    exige que los pares vengan en grupos que se desplazan igual y comprueba al final que el detalle fino (ruido, bordes)
    coincide. Las zonas lisas y los bordes rectos no se pueden comprobar y se ignoran. Medido (JPEG 90): una copia
    desplazada, girada 10° o reescalada ×1,1 se detecta con su giro y escala; una textura sin copia, un fondo que se
    repite y los bordes rectos de un rótulo no dan ninguna zona. Los patrones que se repiten de verdad (ladrillos, rejas,
    letras iguales grandes) también pueden coincidir.
- Bordes y texto siempre salen algo claros en el ELA. Todo lo de este bloque son indicios.

### 5.10 Metadatos, hashes y análisis de archivo

- **Hashes** del fichero tal cual se cargó: MD5, SHA-1, SHA-256, SHA-512 y CRC32; **copiar hashes** los lleva al
  portapapeles. MD5 y SHA-1 sirven para cotejar con otros registros; la integridad la da SHA-256.
- EXIF/GPS, IPTC, XMP, chunks PNG (con CRC), comentarios, PDF, ZIP/Office y contenedores de vídeo. La fecha del sistema
  de ficheros es la de la copia, no la del contenido.
- **Imágenes incrustadas** (p. ej. una PNG detrás del fin de un JPEG, o la miniatura EXIF): botón para abrirlas como
  imagen nueva, con sus propios hashes.
- **Análisis de archivo**: formato, códecs y pistas, estructura y entropía.
  - *Vídeo MP4/MOV*: códec con su nombre, perfil y nivel (H.264, H.265), audio (AAC, frecuencia, canales), fotogramas y
    fotogramas clave, bitrate por pista y rotación de presentación.
  - *Matroska/WebM*: pistas, códecs y número de clusters. *WAV/AVI/WebP*: bloques y formato de audio.
  - *JPEG*: segmentos, tipo de codificación (baseline o progresivo), submuestreo de color y escaneos. *PNG*: bloques con
    su CRC verificado (un CRC incorrecto indica fichero alterado o dañado).
  - *Estructura*: cada caja, segmento o bloque con su desplazamiento y tamaño. Si la extensión no corresponde al
    contenido, lo avisa.
  - *Entropía* por bloques (gráfico): casi 8 bits/byte indica datos comprimidos o cifrados; útil para ver añadidos al
    final de un fichero.
  - Además, firma, cabecera y fin de formato en hexadecimal, y los bytes de más tras el fin.

### 5.11 Exportar, registro e informe

- **Guardar imagen**: salida, salida con plantilla, **salida tal como se ve** (con el zoom y el encuadre del marco),
  **lienzo tal como se ve** (con el zoom y los puntos marcados), fuente original o apilado, en PNG, TIFF, BMP o PPM (sin pérdida) o
  JPEG, WebP o AVIF (con pérdida, con aviso). Escala 1× (píxeles reales) a 8×. Cada exportación anota MD5, SHA-1,
  SHA-256 y SHA-512.
- **Registro JSON**: fuente (hashes, origen), zona trabajada, parámetros, plantilla, comparación, integridad, ELA,
  apilado, exportaciones y retiradas. **Reproducir JSON** lo vuelve a aplicar sobre la misma fuente (mismo SHA-256).
- **Informe de análisis**: HTML de un solo fichero, sin dependencias externas, con lo anterior en forma legible e
  imágenes incrustadas; solo lista los parámetros que difieren de los valores por defecto. Incluye **Vista y navegador**:
  capturas del lienzo y de la salida tal como se veían, y la configuración con que se veían (navegador, ventana,
  pantalla, densidad de píxeles —cambia con el zoom del navegador—, zooms y encuadres, panel, tema, idioma y zona
  horaria), para repetir la observación en las mismas condiciones. El registro JSON guarda los mismos datos. Su propio hash queda anotado
  en la lista de exportaciones (un fichero no puede contener su propio hash).

## 6. Atajos

| Tecla | Acción |
|---|---|
| `F1` o `?` | abrir esta ayuda (`Esc` la cierra) |
| `P` | mostrar u ocultar el panel |
| `,` / `.` o `RePág` / `AvPág` | imagen anterior / siguiente |
| `Supr` | quitar la imagen actual de la sesión |
| flechas (`Mayús`: ×10) | mover el punto seleccionado 0,1 px (1 px) |
| `Ctrl+V` | pegar una imagen del portapapeles |
| rueda / arrastrar | zoom / mover la imagen, en el lienzo y en la salida |

## 7. Buenas prácticas

- Anotar los **hashes** al cargar y comprobar que coinciden con los del origen.
- Trabajar siempre sobre copias; exportar en **formato sin pérdida** lo que se vaya a conservar.
- Guardar el **registro JSON** de cada resultado relevante: es lo que permite repetirlo y revisarlo.
- Ir de lo menos a lo más invasivo; anotar por qué se aplicó cada ajuste.
- Presentar las lecturas como **hipótesis con su margen**, y los análisis de integridad como **indicios**.
- La herramienta no guarda nada fuera de lo que se descarga; cerrar la pestaña borra la sesión.

## 8. Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| Un ajuste se aplicó a todas las imágenes | *Configuración entre imágenes* → *solo la imagen actual* |
| La salida sale en gris y no vuelve al color | *gris desde* → *normal (color)* |
| La zona rectificada sale estirada | la forma no coincide con la real: usar *Automático* o *N puntos* |
| En la comparación la candidata real no queda primera | marcar *paso fijo*, ajustar con un texto conocido, revisar fuente y polaridad |
| «sigma en el tope» al ajustar | el desenfoque no es identificable con ese texto: no fijarlo |
| La zona pegada no destaca en el ELA | recomprimir a la calidad del original (la pone *Analizar*) |
| Arrastrar un archivo no lo carga | se arrastró un enlace (desde un editor o una pestaña): arrastrarlo desde el explorador de archivos del sistema o usar *Abrir archivos* |
| Al abrir un archivo no pasa nada | error de carga de un módulo: ver la consola del navegador |

## 9. Verificación de la herramienta

La herramienta tiene pruebas automáticas de su lógica y de cada función en navegador real (Chromium y Firefox), con
casos de resultado conocido y controles que comprueban que cada prueba detecta el fallo que vigila.
