# Overview: ámbitos de archivos recibidos — 9 septiembre 2026

Corte focal `c8f05b904a2129cca5ac791c7e900c5d55a3b64c` enviado sólo a rama UAT. Runtime pendiente de verificación en este recibo inicial. Ocho archivos de Studio, sin migraciones ni cambios Worker.

La tabla de fuentes del Overview muestra los ámbitos de los archivos aceptados: marca, competencia, categoría, referencia y sin ámbito verificable. Antes mostraba el ámbito gobernado del conector, que podía quedar «No disponible» pese a tener todos los archivos recibidos. Cada conteo proviene de imports completados y de su vínculo exacto a slot, plan, workspace y definición; los archivos rechazados, fallidos y en proceso quedan fuera. Dos archivos distintos aceptados con el mismo nombre siguen contando por separado. El conector mantiene su configuración gobernada en Datos.

El cambio enriquece la consulta de fuentes ya existente; no agrega consultas por fila, nuevas secciones ni controles. Los conteos describen intención de captura de archivos, no precisión semántica ni clasificación de menciones.

## Validación local cerrada

Typecheck/lint 11/11. Studio 791 PASS y 7 SKIP. Build 89.187 segundos. Tres pruebas focales regulares y una PG opt-in de sólo lectura con CTE, sin INSERT/DDL. Revisión Root/Import sin P0/P1/P2. QA ES390 y EN1280 con capturas inspeccionadas: la tabla mantiene desplazamiento interno y el documento no desborda.

Composición sobre db97205 verificada por SHA de ocho archivos y comparación semántica de traducciones; conserva los cambios de Topics y Dashboard. Tres drafts ajenos permanecen fuera del corte.

Evidencia privada: worktree focal `.data/overview-source-scopes-2026-09-09/`, `check-receipt.json`, `cut-files.json`, logs; evidencia de origen en `/Users/brandhon_o/Downloads/noisia-overview-import-scope-2026-09-09/.data/overview-source-scopes-2026-09-09/`.

Cero proveedores, permisos, imports o SQL. No modifica la selección de Signal ni los costos.


## UAT comprobado — 9 septiembre 13:18 UTC

Studio y Worker ejecutan `c8f05b904a2129cca5ac791c7e900c5d55a3b64c`. Studio deploy `39228472-d0fa-4252-b14e-ca13a09ad401`; Worker `38a5a045-0fd8-4c20-82ab-59a50f68c699`. El Worker se desplegó por los archivos observados, sin cambios de lógica en este corte.

Navegación real Topics → Overview: National conserva 7,396 menciones únicas, 16 archivos y 9,131 filas. La fuente SentiOne muestra **Marca principal: 2 archivos; Competencia: 13; Categoría: 1**, sin ámbito desconocido. No se infirió esa distribución a partir de nombres de archivo.

Los observadores de sólo lectura confirman cero ejecuciones/llamadas/outbox activos y cero permisos nuevos; SQL0147, selección y costos intactos. Evidencia posterior: `uat-studio-runtime-receipt.json`, `uat-worker-runtime-receipt.json`, `uat-overview-ui.txt` en el directorio privado del corte. La entrega está comprobada; el párrafo inicial conserva la historia previa al runtime.
