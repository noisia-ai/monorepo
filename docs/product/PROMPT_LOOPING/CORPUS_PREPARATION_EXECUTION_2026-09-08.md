# Preparación de texto completo — ejecución self-service

**Cierre: UATbed52d9 entregado y National preparado.** El resultado vigente está en [el recibo](./DELIVERY_WORKSPACE_CORPUS_TEXT_PREPARATION_2026-09-08.md). Las entradas de progreso inferiores conservan la secuencia y no reabren trabajo.

8 septiembre 2026. Corte activo posterior a UAT `65926c0`. Amplía el [Compass](./COMPASS_SELF_SERVICE_2026-09-07.md) y [plan](./PLAN_SELF_SERVICE_MONITORING_2026-09-07.md); no sustituye su alcance de clasificación, descubrimiento ni Signal.

## Resultado de este corte

El operador puede preparar los textos de importaciones aceptadas, ver avance persistente y recuperar una interrupción. Nuevas entradas o correcciones invalidan la preparación afectada. Se reutilizan textos compatibles ya preparados. El resultado se llama **texto preparado**; todavía no es un embedding, un cluster, una atribución semántica ni una clasificación.

No se modifica National para adivinar fechas. La pregunta de zona SentiOne permanece pendiente. La implementación y las pruebas independientes no necesitan su respuesta. Cero proveedores pagados en este corte.

## Decisiones de implementación

- El workspace y sus importaciones/membresías aceptadas son la autoridad de población. No crear un `study_corpus` ficticio para entrar al camino legacy.
- POST persiste una solicitud idempotente y responde rápido. El Worker existente captura el manifiesto, sin enviar todos los textos por HTTP.
- El manifiesto fija población, disposiciones, procedencia y texto exacto. Las páginas posteriores leen ese snapshot, no menciones mutables. No mantener una transacción abierta entre páginas.
- Activos de texto por workspace y hash permiten reutilizar contenido entre generaciones. Política de fragmentación versionada, límites contiguos verificables, sin recortar a 900 caracteres, 80 fragmentos ni 50 mil menciones.
- Progreso y checkpoint avanzan juntos bajo lease. Reintentar o redespachar el trabajo no duplica resultados. Redis transporta; PostgreSQL conserva el trabajo pendiente.
- La actualización incremental detecta cierre de importación y cambios de contenido/derechos, no sólo la fecha de publicación. Una generación completa anterior permanece identificable mientras se prepara la siguiente; no se presenta como vigente si cambió su entrada.
- Permiso de lectura: `can_view`. Preparación local sin proveedores: permiso scoped de importación; no ampliar `can_execute_topics` ni permisos de publicación. El Worker vuelve a comprobar autoridad.
- Los derechos se resuelven por una ruta de procedencia completa. Ámbito de captura y atribución semántica permanecen distintos: se pueden preparar textos cuya atribución todavía necesita cálculo.
- UI en Datos recibidos, sin nuevo formulario. Un estado y siguiente acción; errores recuperables y nuevas cargas visibles. Topics conserva su entrada y no habilita búsqueda por tener sólo texto preparado.

## Responsabilidades focales

Backend: SQL manual aditiva, almacén de manifiesto/activos/ejecución/revisión, contratos y pruebas PostgreSQL. Worker/import: fragmentación íntegra, dispatch recuperable en Data OS, leases/checkpoints y pruebas reales locales. Frontend: panel mínimo bilingüe sobre el contrato. Root: API/autorización, integración, revisión, comprobaciones y continuidad/Linear.

## Evidencia requerida para aceptar el corte

Texto que excede límites legacy, cobertura exacta y Unicode; páginas completas; duplicados y replay; interrupción y recuperación; segunda carga y correcciones; derechos retirados/expirados; aislamiento de workspace y actor revocado. Fixtures sólo locales. Un resultado sin proveedor no debe declararse análisis terminado. Medición de escala 2M, embeddings, BERTopic, interpretación y Signal siguen siendo trabajo posterior del programa.

Estado inicial: implementación en curso. No hay migración remota, despliegue ni ejecución National de este corte todavía. Tickets NOI-31/78; recepción y rendimiento659 quedan cerrados.

## Avance comprobado durante la integración

- UI local: root observó 10 casos PASS con transporte simulado, incluyendo respuesta perdida, clave idempotente, doble clic, avance, nueva carga y retiro por 403. ES/EN y permisos cuentan con pruebas del componente y servicio. No es todavía una prueba remota.
- PostgreSQL local: primer recorrido de 600 raíces en 1.876 s, 591 elegibles, 9 excluidas y 751 fragmentos. Conserva un texto Unicode de más de 80 fragmentos.
- PostgreSQL + BullMQ locales: 50,001 raíces procesadas íntegramente; fallo después del primer checkpoint y reintento del mismo snapshot; job terminal retenido en Redis recuperado; segunda carga de una fila deja 50,002 raíces, 50,001 reutilizadas y un solo activo nuevo; cambio de fuente durante la ejecución produce supersession y siguiente generación automática. Cero proveedores y cero corpora de estudio creados. Recibo privado focal `.data/workspace-corpus-preparation-2026-09-08/worker-postgres-receipt.json`.
- La primera preparación de 50,001 demoró 163.7 s locales. Lecturas individuales de activos consumieron 123.4 s acumulados; la versión bulk final completó las mismas 50,001 raíces y 50,161 fragmentos en 21.6 s, con 501 peticiones en lugar de 50,001. Pasaron también dos documentos de 4 MiB y uno de 7.5 MB íntegros. El presupuesto de 6 MiB acota texto por lote, con excepción para un documento mayor; no es un límite RSS. No extrapolar esta medición a una promesa 2M ni a velocidad UAT.
- Revisión independiente detectó una carrera en un fallo de dispatch tardío que podía degradar una ejecución completada. Corrección: la adquisición del Worker confirma entrega y cerca el token; ACK/fail tardíos no pueden modificar terminales. Otras correcciones: cursor existente antes del primer opt-in, expiración temporal, autorización revocada visible y todas las disposiciones contadas.
- Checks hasta este punto: typecheck/lint raíz 11/11, sin errores de lint; Studio 606 PASS/5 SKIP y build verde; Worker 230 PASS/3 SKIP. El primer intento de suite Studio carecía del placeholder local DATABASE_URL requerido por dos imports legacy; se corrigió el entorno de pruebas sin tocar esos módulos ni apuntar a una DB remota. Pruebas nuevas DB y comparación de rendimiento siguen integrándose.

Nuevo pendiente de lanzamiento: [NOI-80](https://linear.app/noisia/issue/NOI-80/ss-aplicar-retencion-y-retirada-de-contenido-a-textos-y-manifiestos), retención/retirada de activos derivados. Invalidar derechos no es borrar copias. No se ejecutó limpieza.

## Aplicación focal y retirada

SQL0132 es aditiva, manual y privada para el servidor: cuatro tablas, cursor por workspace, triggers de revisión, RLS y sin grants de Data API. Aplicación UAT sólo después de comprobar el artefacto final contra PostgreSQL local, en transacción y sobre el destino UAT identificado. Se conservan checksum y recibo. Ningún DDL de13 anterior se vuelve a aplicar a ciegas.

El código se integra exclusivamente desde el worktree focal; los tres archivos ajenos de contract-drafts quedan fuera. Retirar este código conserva datos y vuelve a ocultar la acción; no elimina tablas ni ejecuta proveedores. Una retirada debe detener primero el despacho de preparación para no dejar operaciones aparentando avance. No se cambia producción ni `main`.

Revisión final bulk independiente: sin P0/P1/P2 concretos en paginación, autorización/lease, lectura agrupada, hashes/cobertura y commit atómico. Worker final tras bulk: 230 PASS/3 SKIP, typecheck verde. Preflight remoto sólo lectura confirmó UAT, National y Data OS habilitado con heartbeat vivo; SQL0132 aún pendiente de aplicación.

## Integración final y entrega en curso

Commit focal `bed52d9bdea7d72f986e994bc13d0a8f1ee260a7`, 26 archivos propios; tres contract-drafts ajenos excluidos y hashes conservados. Push exclusivamente a rama UAT. SQL0132 aplicado en transacción a Studio UAT el 8 septiembre a las 11:53:15 UTC, checksum `eb35e91fb46049edc383cf54efc5900a1188d18d6848a8f283d5917b9b06740d`, cuatro tablas con RLS. Preflight comprobó Data OS habilitado y heartbeat vivo. Código todavía en build; aceptación National pendiente.

Checks finales: root typecheck/lint 11/11, DB 230 PASS/34 SKIP, Worker 230 PASS/3 SKIP; Studio 606 PASS/5 SKIP y build previamente verdes del mismo corte. PostgreSQL real separado comprobó fronteras temporales sin mutación, ocho fallos de despacho/backoff, replay/reanudación y cursor. ANALYZE de columnas de llaves/disposición se ejecuta una vez por snapshot; medición local adicional 79.4+106.3 ms, no incluida en los 21.6 s bulk previos. No ANALYZE de mentions ni revisión del benchmark cerrado659.
