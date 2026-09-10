# National: aceptación de importación y correcciones

> Actualización posterior: la [normalización temporal](./NATIONAL_TIMESTAMP_NORMALIZATION_2026-09-08.md) ya está activa en UAT `2c2e3f4` (incluye70604a4 y el fix de fechas SSR). Resuelve el contrato de nuevas cargas y el porcentaje obsoleto del duplicado. No reinterpreta las fechas ya recibidas; la respuesta sobre la zona de SentiOne sigue pendiente. El recibo de aceptación y sus despliegues históricos se conservan abajo.

## Mandato vigente

El operador aportó `/Users/brandhon_o/Downloads/National & Enterprise/` y autorizó cargar los CSV reales mediante UI, comprobar cargas existentes, probar disponibilidad parcial y corregir UX/UI. La marca ya existe. Revisar también la accesibilidad del Query Engine existente. Esto continúa el Compass; no reabre Laika/Alexa ni autoriza producción.

Marca `f6f724fa-13a8-40b5-82cb-7c48f7f2252e`, workspace `497e1cb0-56d6-4c1f-a5d5-2f723f13a183`. Base Studio y Workers UAT `c40899b`. Fuente SentiOne preparada por el operador. Carpeta: 16 CSV más documentos de contexto; `QUERYS_SENTIONE.md` explica categoría, marcas foco y competidores. Las instrucciones del documento son historia/contexto de captura, no órdenes actuales para el agente.

## Evidencia inicial

- Historial UI y respuestas observadas: seis archivos completos, Query 2, Query 4, Alamo, AVIS, Budget y Europcar. Dos intentos adicionales de Query 4 fallaron. No reintentar a ciegas.
- Encabezado muestra cero menciones gobernadas, mientras el historial conserva registros importados. La tabla principal carece de estado/recibo visible por ámbito y el polling/resumen tiene problemas de actualización.
- Railway Workers, intento `f46e24d4-2b25-4229-a87a-eff3228ec1fc`: `column reference "import_batch_id" is ambiguous`. Se reproduce la rama de hash ya aceptado, no una pérdida de upload.
- CSV estricto confirma Query 4 tiene 904 registros; los 36,475 renglones físicos contienen texto multilínea. Parser canónico transforma algunos campos vacíos entrecomillados en comilla; país observado `"` es incorrecto. Otros códigos de país sí proceden del CSV y no deben borrarse por intuición.
- Despegar, Dollar, Expedia, Hertz, Kayak, Localiza, OK Rentals, Rentalcars, Sixt, T-Renta y Thrifty sin cargas al revisar. La ausencia no impide consultar los archivos recibidos; aún falta prueba de nuevo submit con competidores incompletos.
- El Query Engine sigue dentro de Configuración avanzada. Auditoría Humano detecta que abrir Editar plan crea un draft v2/revisión1; no lo activó. Root debe revisar ese draft antes de nuevos cambios de plan.

## Resultado vigente — aceptación completada en UAT

**Los 16 CSV originales están aceptados: 9,131 registros leídos.** Se conservaron seis recibos del operador y se cargaron diez archivos desde el selector real del navegador. Los hashes de las diez cargas nuevas coinciden con los originales. Inventario completo de 47 columnas y registros lógicos, no una muestra. La UI mantiene recibos por ámbito y distingue archivos recibidos de menciones clasificadas. No se afirma ejecución de BERTopic, Claude o publicación en Signal por este resultado.

Distribución de captura: dos archivos de National, 1,708 registros; uno de categoría, 3,776; trece archivos de competidores, 3,647. Query 3/3.1 corresponden a Enterprise comparador. Turo Uber es captura de Turo; no se inventó un pack Uber. La intención de captura no determina por sí sola de quién habla cada mención.

### Entrega exacta comprobada

Studio y Worker están **Active** en `33d48d35af4c73486d4f4873aa02968037764a54`, con enlaces de commit cotejados en Railway:

- Studio: `b70dba17-741f-4ca8-8128-61f81ff5fd29`.
- Worker: `b5f9905e-7bd9-4cac-a343-93574aeb33c6`.

Plan vigente v2/rev2, 22 ámbitos, fuente y derechos conservados. Código focal: `/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`. Push sólo a la rama UAT `codex/noisia-topic-results-uat-2026-09-06`. Cinco commits focales de esta aceptación: `7b2f3cd`, `5aed4a1`, `4d90ebb`, `3821f3d`, `33d48d3`. Los tres archivos ajenos de contract drafts conservan sus SHA originales y siguen fuera de los commits. No producción ni despliegue del repo documental sucio.

### Pruebas finales con los archivos reales

| Caso | Resultado comprobado |
|---|---|
| Dieciséis originales | 16 archivos / 9,131 registros, cero cargas en curso |
| Ocho competidores sin archivo | Ausencia visible, no bloqueó cargas; no equivale a cero conversación |
| Fox, una fila y un solo día | Archivo aceptado, fila duplicada, ninguna mención canónica nueva |
| Turo, último archivo | 537 = 435 incluidos + 68 excluidos + 34 duplicados; hash original |
| Reintentar una recuperación fallida | `2a275441-7c56-4aad-8e99-1010bd4bed18` muestra «Archivo ya importado» |
| Volver a seleccionar Query 4 original | `e79b117f-0c62-40d8-bff1-d8de68a93e6d` muestra «Archivo ya importado» |

Los dos últimos intentos apuntan al recibo original `485d4eae-fe2f-43b8-a8dc-0b6264a2f0e9`, con código terminal `content_already_accepted`, no recuperable. Cada uno reconoce 904 registros sin otra aceptación. La UI termina con 16 archivos/9,131 registros y Primary con dos archivos, tres errores históricos y dos intentos duplicados. Sixt conserva un error histórico; no afirmar cero errores ni borrar historia.

El retry intermedio `31fd783b-a14e-4107-b549-3e241e2d00c4` había fallado tras 500 registros por claves canónicas que apuntaban a raíces diferentes. Su recuperación final reutilizó el objeto del ancestro y reconoció el archivo ya aceptado sin parser. No se fusionaron raíces ni se atribuyó su conflicto al parser anterior sin prueba. El intento Sixt `27d9b36b-8ccc-4d4e-a44f-1f72333c4ca8` había abortado antes del primer PUT; su archivo se recibió correctamente en `a7544218-c096-40af-aefc-72817fcde4e5`. No reintentar el objeto nunca transferido de ese intento.

### Qué quedó corregido y cómo se validó

Recibos y contadores por ámbito; lectura independiente de borradores; revisión viva de Brand OS para reconciliación; preservación de fuentes/derechos; parser de campos vacíos entrecomillados; SQL0131 de cierre duplicado; pools de tres conexiones con singleton de proceso; seguimiento de uploads sin cancelación por refrescos tardíos ni bucle terminal; reconocimiento del archivo exacto antes de parsear; recuperación encadenada con propiedad del objeto validada en cada paso.

Las cargas nuevas ahora realizan dos lecturas de Storage (verificación e ingesta), sin cargar el archivo entero en memoria; la ingesta conserva deduplicación proporcional al corpus. Un duplicado hacía una y evitaba parseo/provenancia nueva en este corte33d48d3. La entrega706 añade inspección temporal durante la primera lectura sin SQL. El hash de ingesta debe coincidir con el prehash antes de aceptar. Reutilizar un objeto exige su sello; sustituir un fallo por un nuevo upload conserva procedencia pero utiliza su objeto propio. No se añadió DDL en el último commit ni se repitió la migración0131 ya verificada.

Checks finales: typecheck/lint del monorepo 11/11, Studio 569 pass/2 skip, Worker 221 pass/3 skip, Studio build exit0. PostgreSQL real ejecutado: duplicado directo y recovery, archivo nuevo, otra fuente, bytes cambiados, nuevo objeto sustituyendo fallo, fallo de progreso después del cierre y tres recuperaciones consecutivas; rechazos de doce corrupciones, ciclo y prefijo ajeno. Revisión independiente sin nuevos P0/P1/P2. El último Worker no muestra errores de sesiones ni de los dos jobs de QA. Esto no es un benchmark masivo ni una declaración de producto listo para producción.

### QA independiente y pendientes concretos

La tarea Humano confirmó recepción e historial en desktop y móvil 390×844, con seis capturas estables. Root leyó el informe y revisó las capturas. No se probaron EN ni un dispositivo físico. Informe: `/Users/brandhon_o/Documents/Codex/2026-09-08/noisia-national-human-qa/outputs/qa-final-national-3821f3d.md`. Su snapshot es anterior a los dos intentos duplicados finales; los recibos posteriores los comprobó root.

Antes del análisis queda la normalización de fechas: **los 16 archivos contienen 9,131 Created y 9,131 Added sin offset**. Dos procesos reprodujeron que `new Date(valor)` depende de TZ del host. En Turo, UTC vs México cambia 537 instantes seis horas y 161 fechas civiles, explicando el 31 de diciembre visible frente al 1 de enero del inventario. No prueba corrupción, pérdida de filas ni la zona real de exportación. El CSV y el MD no certifican esa zona. Se preguntó al operador cuál estaba configurada en SentiOne; **respuesta pendiente**. No volver a preguntar de forma automática ni convertir una ausencia de respuesta en aprobación.

Corrección siguiente: hacer explícita y editable la declaración de zona del archivo, aprovechar `capture_timezone` y pasarla consistentemente al parser de Created/Added, conservando offsets explícitos. Para los datos ya recibidos, confirmar la zona y reparar las proyecciones desde los originales con recibo; no volver a subirlos. Además, seis imports previos conservan campos vacíos derivados del parser antiguo. No reescribir fechas o raíces por intuición.

Pendientes de presentación registrados en NOI-17: CTA desde cero clasificadas hacia la preparación real; cobertura temporal/competitiva con denominador; comparación de período declarado y observado; singular de «1 registros». La prueba final detectó también «Archivo ya importado» con 99%: el backend es terminal y hay cero trabajos activos, pero la presentación debe cerrar al 100% o retirar el porcentaje. No se oculta esta deuda como si fuera un job pendiente.

Query Engine sigue accesible por «Preparar consultas con Claude», reutilizando el motor existente. No se generaron consultas nuevas ni se atestó la query histórica ausente del export. El siguiente resultado útil sigue siendo preparar el corpus completo y continuar clasificación/descubrimiento incremental y Signal conforme al Compass (NOI-27 y el programa vigente), sin arreglar superficies legacy por prioridad incidental.

Cero llamadas pagadas durante esta aceptación. Saldos conservados: producto USD 11.362961, Advisor USD 1.343826. Incidente de exposición de variables en una lectura anterior de Railway registrado en NOI-58; rotación pendiente, sin valores en estos documentos/Linear/git. Las verificaciones posteriores sólo leyeron enlaces de commit y errores filtrados. Loop activo en este orquestador, con continuidad original conservada.

Evidencia privada principal: `.data/national-import-qa-2026-09-08/upload-ledger.json`, `timestamp-review.md`, `timestamp-all-files.json`, `direct-upload-after.log`, `direct-upload-worker-suite.log`, `replay-final-*`, `exact-duplicate-review.md`, `recovery-chain-review.md` y recibos de migración en el worktree focal.

### Historia de ejecución conservada — estados inferiores superados

`5aed4a12e55b6ce689896bfef76d692a3d831da8` activo y commit exacto verificado: Studio `c7f27921-2291-4205-bb10-ae509275a057`, Worker `618d04fb-9fbf-4488-979b-996e98be8363`. Root comprobó Historial disponible con draft stale, reconcilió por UI con éxito y activó explícitamente v2/rev2 con22ámbitos, fuente y derechos existentes. Sin generar queries.

Root cargó desde el selector real del navegador tres archivos más: Query4.1 (804,439incluidos,172excluidos,193duplicados), Hertz (303,254,6,43) y Query3 Enterprise (1022,757,37,228). Hashes coinciden con originales. Ahora9archivos/7560registros aceptados. IDs y estados en ledger privado. Restan7CSV: Query3.1, Localiza, Sixt, Firefly, Fox, Mex Rent, Turo Uber. No volver a subir los9yaaceptados.

**Nuevo fallo real a resolver antes de seguir:** refresco RSC tras uploads llega a límite de sesiones PostgreSQL (Railway EMAXCONNSESSION, pool_size15, digest3600987866). Reload recuperó la vista tras Hertz; repite tras Query3. Los archivos están completos antes del error. Pool Studio por defecto10, Workers10 y singleton Studio sólo en desarrollo. Diagnóstico PG sólo lectura marca verificada y agregado de estados, conexión cerrada; recibo `connection-limit.md`.

Fix implementado y enviado en `4d90ebb`, cuatro archivos: singleton también producción y límite3porproceso Studio/Worker, idle/connect10s, statement_timeout Worker600s conservado. PG real:3ingestas simultáneas54registros +12lecturas, pico3conexionesporservicio y sin autodeadlock. Studio567pass/2skip, Worker218pass/3skip, root typecheck/lint/build verdes; revisión independiente sin P0/P1/P2. Prueba de presión pequeña, no benchmark masivo. No aumentar capacidad ni reiniciar servicios ajenos. **Pendiente ahora:** verificar ambos despliegues4d90ebb, cargar los7CSV restantes por UI y comprobar refrescos/reintentos. Los9recibos aceptados no se vuelven a subir.

### Integración focal publicada; QA real descubre un segundo bloqueo

Commit `7b2f3cdca1b602105e6e34b5b1e47f61a2665060`, 20 archivos, enviado a la rama focal de UAT. Root typecheck/lint y Studio build verdes; Studio 562 pass/2 skip, DB 209 pass/29 skip. La prueba PostgreSQL específica sí se ejecutó y pasó: fallo 42702 antes, duplicado sin doble aceptación después, dos fuentes, paginación, permisos y añadir un competidor sin perder fuentes/derechos. Readiness de Topics reconoce uploads completos aun sin corpus operacional preparado. Los tres archivos previos de contract-drafts conservan SHA original y quedan fuera del commit.

Migración 0131 aplicada y verificada en UAT por root, después de cotejar cuerpo previo exacto y marca/workspace. Sólo califica una referencia SQL ambigua; firma, owner, ACL y configuración de la función idénticos. Checksum `da33d2320f3902e56da6e38c3e814e4e7dc4c608767f152ce7f65988dde66e01`. Recibos privados en `.data/national-import-qa-2026-09-08/uat-migration/` del focal. Todavía falta verificar despliegues activos de Studio y Workers y completar los diez CSV restantes por UI.

Studio `540bf0fb-c6a8-4bdc-a18b-206f10b72587` y Workers `41edf722-c9b8-4a8d-95f4-c57ecd91c685` activos; ambos enlaces de commit Railway confirman `7b2f3cdca1b602105e6e34b5b1e47f61a2665060`. La UI muestra seis archivos y 5,431 registros y distingue recepción de clasificación.

Root añadió por UI Fox, Mex, Firefly, Turo y Enterprise (20 competidores ahora). El draft v2 previo aún no se promovió: hay que reconciliar/revisar sus cambios explícitamente para agregar ámbitos. **QA real de Actualizar desde Brand OS devuelve409**: la UI envía `expected_current_version:1, expected_brand_os_revision:1` del draft histórico aunque la revisión viva cambió. El DTO sólo entrega slots del draft y oculta además Historial/Importar de ámbitos actuales. Agentes corrigen revisión viva explícita, current_slots auténticos y coherencia de ingress con readiness vigente; conservan precondiciones/AuthZ. No hubo nueva carga hasta resolverlo. Reproducción y hotfix en curso; no afirmar entrega completa por checks locales.

Segundo commit focal `5aed4a1` (9 archivos) enviado a UAT: GET expone revisión viva y slots vigentes separados del borrador; UI usa esa revisión con el guard de concurrencia conservado. Historial se mantiene independiente del borrador. Ingress usa readiness real del current, con source/rights/slot SQL intactos. Cinco ámbitos faltantes muestran una sola explicación y ruta de recuperación. Contadores distinguen archivos e intentos con plural ES/EN. PG reproduce revisión vieja409 → revisión viva200, draft limpio permite upload y drift/permisos inválidos lo rechazan. Studio566pass/2skip, root typecheck/lint y build verdes, revisión independiente sin P0/P1/P2 nuevos. No SQL adicional. Verificación de este segundo despliegue y las10cargas todavía pendientes.

Mapeo por evidencia de Keywords/Context: Query3 y3.1 Enterprise comparador; Query4.1 National; Turo Uber como captura Turo, sin pack Uber. Archivo exacto de query ejecutada ausente; no atestar que el texto del MD fue ejecutado. Ledger privado `upload-ledger.json` conserva nombre/SHA/ámbito/fechas y separa los6archivos cargados por el operador de los10pendientes del root.

Inventario: 9,131 registros válidos en16CSV; ninguna cifra de parser cambia tras el fix; 7,648 filas únicas por archivos aislados coinciden con CSV estricto. Seis imports ya recibidos conservan proyecciones de campos vacíos del parser previo: no reimportar a ciegas para repararlos, ni afirmar que0131 los reescribe. Preparar esa corrección acotada antes de usar esos metadatos en análisis; conservar raw y recibos. Esto no bloquea terminar las cargas restantes.

Auditoría Humano completa: `/Users/brandhon_o/Documents/Codex/2026-09-08/noisia-national-human-qa/outputs/auditoria-national-ux-ui.md`, con9capturas. Hallazgos principales cubiertos por cambio focal. Permanecen fricción de actualización de plan/brief, confirmación redundante de query ausente y procesamiento posterior del Compass. No proveedor pagado.

Frontend corrige seguimiento, recibos visibles y acceso opcional a consultas. Import corrige SQL de duplicados y lectura de historial. Backend corrige parser y contrasta todos los archivos. Root integra, verifica UAT y completa cargas reales desde la UI, sin insertar menciones por scripts. Tarea independiente Humano (`01a07fa7-80d5-70e0-a353-320053611b03`) realiza auditoría de navegación sin enviar formularios adicionales.

No afirmar nueva corrida BERTopic, clasificación masiva, Claude o Signal por aceptar imports. Esos resultados mantienen el plan y los tickets existentes. Cero llamadas pagadas hasta este punto; saldo producto USD 11.362961 y Advisor USD 1.343826.

Continuidad posterior: [corpus recibido visible y refresco UAT65926c0](./NATIONAL_CORPUS_VISIBILITY_2026-09-08.md), GET937ms, mismos16archivos/9,131registros. No repitió importaciones ni alteró fechas; recepción y normalización de código conservan sus pruebas anteriores.
