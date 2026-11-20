# Perspectiva

Herramienta de navegador para **analizar y mejorar imágenes y fotogramas de vídeo**: corregir la perspectiva de una
zona, recortar o editar la imagen entera, mejorar la legibilidad, contrastar hipótesis de lectura de un texto, apilar
fotogramas, calcular hashes, examinar metadatos, estructura de fichero e indicios de integridad, y dejar un registro
reproducible de lo hecho.

**Funciona sin conexión y sin instalar nada.** Los archivos se procesan en el navegador de quien usa la página: la
herramienta no los envía a ningún sitio.

## Uso

- **En línea:** https://saullopezc.github.io/perspectiva/ (se publica sola cuando las pruebas pasan en verde).
- **En local:** abrir `tools/web/perspectiva.html` en Chromium o Firefox.
- **Publicada:** `python3 -I tools/publicar_web.py DESTINO` genera una carpeta estática (`index.html`, módulos, fuentes
  con su licencia, `LICENSE.txt`, `NOTICE.txt`, `version.json`, `LEEME.txt` y `SHA256SUMS`) para cualquier alojamiento de
  páginas estáticas. Sitio: <https://saullopezc.github.io/perspectiva/> (botón *Actualizar* para traer la última versión).
- **Comprobar un despliegue:** `python3 -I tools/comprobar_despliegue.py [COMMIT]` (por defecto `origin/main`) espera a que
  termine la CI de ese push, exige que el despliegue haya pasado y compara la versión del sitio con la que sale de
  publicar ese commit en limpio. Mirar `version.json` sin más no basta: el despliegue puede seguir en cola.
- **Ayuda:** botón *Ayuda* (o `F1`) dentro de la página; el mismo texto está en [docs/MANUAL_perspectiva.md](docs/MANUAL_perspectiva.md).

## Qué hace

- Zona de trabajo: imagen completa, recorte, o rectificación por 4 esquinas, 4 aristas o N puntos de control
  (mínimos cuadrados con residuo); proporción real estimada a partir de la perspectiva.
- Vídeo: captura de fotogramas con número y tiempo exactos; los puntos marcados siguen al objeto en movimiento;
  apilado de fotogramas.
- Ajustes: interpolaciones, color, ruido, deconvolución de movimiento, CLAHE, niveles, nitidez; cada imagen con los suyos.
- Plantilla de hipótesis deformable y comparación por síntesis de candidatas de texto, calibrada con un texto conocido.
- Integridad (indicios): tablas de cuantización JPEG, miniatura EXIF frente a la imagen, ELA, mapa de ruido y JPEG ghost.
- Hashes MD5, SHA-1, SHA-256, SHA-512 y CRC32; metadatos EXIF/XMP/IPTC; análisis de archivo (códecs, perfil y nivel,
  estructura con desplazamientos, entropía).
- Exportación sin pérdida con hashes, registro JSON reproducible e informe de análisis HTML autocontenido.

Los resultados son **mediciones e indicios**: ninguna función convierte una imagen ilegible en una lectura cierta ni
prueba por sí sola una manipulación.

## Pruebas

Cada función se prueba en navegador real (Chromium y Firefox) con casos de resultado conocido y controles que
comprueban que la prueba detecta el fallo que vigila. Los insumos se fabrican con `tests/web/generar_insumos.py`
(sin fotos externas). En GitHub Actions: `pruebas` (funcionalidad), publicación del sitio en GitHub Pages solo si las pruebas pasan y `seguridad` (CodeQL, credenciales en la historia,
carpeta publicable sin términos ni rutas que no deben salir y sin peticiones fuera de su origen).

En local (Python con Pillow, numpy y Playwright; Node 22; FFmpeg y exiftool):

```sh
python3 -I tests/web/generar_insumos.py /tmp/insumos
node tests/web/test_logica.js
node tests/web/test_estructura.js /tmp/insumos/estructura
python3 tests/web/qa_edicion.py /tmp/insumos/muestras        # QA_NAV=firefox para Firefox
```

## Licencias

Perspectiva se distribuye bajo la **Apache License 2.0** ([LICENSE](LICENSE), avisos en [NOTICE](NOTICE)).
Las fuentes incluidas (Barlow, Barlow Semi Condensed, Barlow Condensed, Oswald, Overpass) son SIL Open Font License 1.1;
su texto está en `tools/web/fuentes/<familia>/OFL.txt`.
