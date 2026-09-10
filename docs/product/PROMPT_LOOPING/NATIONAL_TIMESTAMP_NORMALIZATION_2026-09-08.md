# National: fechas reproducibles y validación previa a la ingesta

> Entrega final vigente: Studio y Worker Active en `2c2e3f409a1ab0fe38f4724b9a4295ddedc1486f`, que incorpora70604a4 y la corrección de hidratación. Studio `9dc3024b-57c3-44ef-9658-32025c427e2e`; Worker `d63874cf-450e-45d4-a52b-ae0e6f8c51d9`. Estado y enlaces de commit exacto cotejados por separado. National 16 archivos/9,131 registros conservados; cero nuevas cargas o SQL remoto.

## Estado del corte

Commit focal `70604a4ff442ee34603bc87ed095e4a990d88879` (22 archivos), basado en `33d48d35af4c73486d4f4873aa02968037764a54`, enviado exclusivamente a la rama UAT. Ambos despliegues Active y sus enlaces al commit exacto verificados en Railway: Studio `4655989e-9e66-471a-80d5-6d0838be4cb0`, Worker `d03e3b79-0407-4669-8417-27c06ccb990a`. Logs de arranque del Worker sin los patrones de error comprobados; no se encoló una carga nueva. No se han modificado los 16 archivos aceptados ni sus proyecciones remotas. La zona usada por SentiOne sigue pendiente de respuesta del operador; no repetir la pregunta ni inferirla.

La [aceptación anterior](./NATIONAL_IMPORT_ACCEPTANCE_2026-09-08.md) conserva sus pruebas: 16 CSV originales, 9,131 registros leídos, ocho competidores sin archivos sin bloquear la recepción. Recibir archivos no demuestra preparación, BERTopic, interpretación de Claude, clasificación ni Signal. El [Compass](./COMPASS_SELF_SERVICE_2026-09-07.md) y el plan original siguen vigentes.

## Decisión de producto y contrato

La declaración existente de zona del archivo se vuelve editable y explica que interpreta fechas sin offset. Comienza con la zona de la marca, visible y modificable por el operador; el backend utiliza la zona guardada en el import, nunca la zona del servidor ni un campo del job. El servidor conserva su validación de IANA y el formulario añade un error traducido antes de subir bytes si la entrada no es válida.

- Created es obligatorio. Added to system vacío permanece null.
- Un valor con Z u offset explícito conserva su instante. Si además se proporciona una zona inválida, se rechaza la declaración.
- Un timestamp sin offset requiere una zona IANA declarada. También aplica a una fecha civil sin hora.
- Se rechazan fechas imposibles, horas inexistentes y horas repetidas por cambios de horario; no se inventa epoch1970 ni se escoge una interpretación ambigua.
- El recibo conserva un código y el nombre de la columna, sin valor crudo ni texto de la mención. Reintentar los mismos bytes/contexto no corrige estos errores: UI e API ofrecen corrección, sin retry de storage.
- La UI retira el 99% obsoleto del resultado terminal «Archivo ya importado», conservando su estado y conteo.

`@noisia/db` expone `sourceTimezone` en ingesta/mapper, `SentioneTimestampError` y el parser común. Luxon3.7.2 ya estaba fijado transitivamente por BullMQ; se declara la misma versión directamente en DB y se añaden sus tipos. Sin framework, DDL ni proveedor nuevo.

## Fallo descubierto durante revisión y corrección

PostgreSQL local reprodujo un archivo de 601 registros con una fecha ambigua en la última fila: el primer intento dejaba 500 menciones canónicas. Una recarga con zona corregida era aceptada con una diferencia de cinco horas entre la fecha canónica anterior y su nueva observación. Esto puede ocurrir en una marca nueva, no sólo en datos históricos.

La corrección añade inspección temporal completa a la primera lectura de verificación ya existente. Reutiliza el lector CSV y las mismas reglas de fechas, sin SQL, deduplicación global ni persistencia. Retiene el primer error y termina de calcular el hash. Primero se reconoce una aceptación previa exacta; si no existe y la inspección falla, no se inicia la segunda lectura ni se guardan menciones. Así un error temporal tardío no contamina la recarga corregida.

La ingesta válida mantiene dos lecturas de Storage; el duplicado conserva una. La inspección añade CPU de parseo, no una lectura extra ni una llamada de IA. Su memoria depende del chunk y la fila actual; no es un benchmark de dos millones de registros. El hash posterior sigue protegiendo la aceptación si cambian los bytes entre pasadas; esto no convierte toda la persistencia en una transacción por archivo.

Un duplicado exacto conserva la aceptación anterior y su interpretación: cambiar la zona en un nuevo formulario no reinterpreta datos ya aceptados. Los solapamientos canónicos también conservan raíces existentes. La reparación de National debe ser explícita y trazable después de conocer su zona, no una recarga ni una fusión de raíces.

## Evidencia y límites

Validación local del parser: offsets, calendario, Created obligatorio, Added opcional, DST Nueva York, transición de media hora de Lord Howe y día inexistente de Apia. Ingesta streaming sintética bajo UTC y Pacific/Honolulu produjo instantes y hashes de observación iguales. Prueba integrada con Worker y PostgreSQL verifica lectura del sello, códigos/recibos y rechazo de reintentos improductivos. La regresión integrada de 601 filas ya pasó: cero menciones tras el fallo temporal; recarga UTC con 601 observaciones y cero diferencias frente a las fechas canónicas; un duplicado con la zona originalmente ambigua reconoce la aceptación previa sin reinterpretación.

Los datos sintéticos se usan exclusivamente en pruebas locales aisladas. No se cargan fixtures a UAT ni se reimportan archivos del operador. Checks locales finales: root typecheck y lint 11/11, Studio 577 pass/4 skip, Worker 221 pass/3 skip, DB 217 pass/29 skip, build Studio exit0. Los skips son integraciones opt-in; las pruebas PostgreSQL nuevas temporal y legacy sí se ejecutaron (1/1 cada una). La temporal incluye nueve casos y dos recargas, con Worker real y transporte Storage reemplazado por bytes locales. La prueba legacy expone el bloqueo previo, no una carga exitosa. Seis variantes de error/aborto de stream rechazan sin devolver un hash parcial, liberan el reader y ejecutan cero SQL. Revisión independiente final sin nuevos P0/P1/P2; el P2 descubierto se cerró con la regresión posterior. Sin nuevas migraciones.

## QA de UAT posterior al despliegue

National mantiene 16 archivos aceptados y 9,131 registros después de recargar. Campo de zona editable y ayuda revisados en desktop; DOM de 390px sin overflow horizontal. La captura móvil de esta sesión no es evidencia visual fiable por el escalado del navegador automatizado; no afirmar QA visual EN/móvil nuevo.

Se reprodujo React418 en dos recargas. La respuesta HTML del Document muestra tres aprobaciones como «8 sep 2026» y el DOM hidratado las muestra como «7 sep 2026». `PolicyRows` usa `formatAdminDate` sin zona explícita; servidor y navegador difieren. Causa comprobada de presentación, sin atribuirla al nuevo parser ni afirmar que comenzó en este commit. El mismo formatter sin zona existe en el código33d48d3 anterior. Corrección focal implementada: las tres aprobaciones y las fechas del selector de recibos usan `initial.workspace.timezone`, sin alterar el formatter global ni datos. Regresión SSR del componente completo ES/EN bajo UTC/Los_Angeles y marcas en México/Tokyo: salida estable por workspace y distinta cuando cambia su zona. Root typecheck/lint11/11, Studio579pass/4skip y build exit0. Commit adicional `2c2e3f409a1ab0fe38f4724b9a4295ddedc1486f`, tres archivos focales, enviado sólo a UAT y verificado Active en ambos servicios. A las 09:24 UTC la recarga de National devolvió HTTP200: las tres aprobaciones son «7 sep 2026» tanto en HTML como en DOM, y no aparecen errores de consola posteriores al inicio de esta comprobación. Se conservaron los errores anteriores como evidencia. Worker nuevo: arranque observado sin patrones ERROR/EMAXCONNSESSION/module-not-found. No se probaron jobs nuevos en este follow-up de presentación. Pestañas Railway propias cerradas; National queda abierta.

## Deuda separada registrada

[NOI-79](https://linear.app/noisia/issue/NOI-79/acq-resolver-incompatibilidad-de-importadores-legacy-con-procedencia) registra una incompatibilidad anterior: los importadores legacy crean `ingestion_phase='legacy'`, rechazado por el procedimiento de procedencia durable con SQL23514 después de posibles escrituras parciales. Las pruebas locales reproducen el bloqueo, no afirman aceptación legacy. Este corte sólo cablea su declaración explícita y sus errores; no cambia SQL ni recupera producción antigua. El CLI legacy tampoco se declara soporte self-service.

NOI-12 mantiene preflight/import y la reparación pendiente de derivados; NOI-17 conserva orientación/cobertura y otras deudas de UI; NOI-27 mantiene preparación real del corpus; NOI-55 registra entrega. Ninguno se cierra por esta corrección aislada. El incidente previo de credenciales de Railway sigue en NOI-58: rotación pendiente, sin valores en documentos, Linear o git.

Cero gasto nuevo. Producto USD11.362961 y Advisor USD1.343826, conservados. Tres archivos ajenos de contract drafts fuera del corte. Sin producción, SQL remoto, clasificación o publicación automática.

Evidencia privada en el focal: `.data/national-import-qa-2026-09-08/`, especialmente `timestamp-review.md`, `timestamp-all-files.json`, `timestamps-implementation.md`, `reupload-timezone-before.log`, `worker-timestamp-tests.log`, `timestamp-*-tests.log` y `backend.md`. El canon original y las conversaciones exportadas permanecen como historia y fundamento del rumbo, no se sustituyen.

Continuidad posterior: [corpus recibido visible y refresco UAT65926c0](./NATIONAL_CORPUS_VISIBILITY_2026-09-08.md), GET937ms, mismos16archivos/9,131registros. No repitió importaciones ni alteró fechas; recepción y normalización de código conservan sus pruebas anteriores.
