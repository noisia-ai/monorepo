# Signal desde la primera importación — entrega UAT, 24 septiembre 2026

Este recibo amplía el Compass y la historia previa. No certifica Topics, clasificación, consolidación ni monitoreo incremental completo.

## PostgreSQL privado

- `dev-test` se verificó contra su identidad y esquema reales: 299 tablas inicialmente vacías. SQL0152 y SQL0182 se instalaron sólo en el ensayo privado, según el upgrade explícito del runner. No se reaplicó SQL en UAT.
- Signal import-only: seis escenarios sintéticos en PostgreSQL real pasaron con rollback físico y comprobación posterior de base vacía; cero proveedores.
- SQL0183 de preparación de intereses: ocho preflight y ocho escenarios positivos pasaron en el mismo esquema privado, con savepoints, rollback físico y base vacía posterior. Hash de SQL0183 `6ac6e1bb9f4ba99e049fec380329dc24c3cc384370ee8ea94ad59463c8340a2d`; hash de esquema `ff26cd9ba6c0cbe2c8b6e7178b85463a3fa67ecea0f0f91ef672213b0cc3f94b`; `full_preparation_acceptance=false`, cero proveedores. Esta prueba no certifica recuperación tras commit perdido, admisión pagada ni clasificación persistente.
- Tras el ensayo, las dos aprobaciones privadas de SQL0183 quedaron en `false`, el comando de inicio volvió a `bootstrap-readonly.mjs` y autodeploy sigue deshabilitado. La réplica de restauración `ea1e22fb` terminó; su salida a las 12:50:56 CST registra `status: observed`, `read_only: true`, 299 tablas, `nonempty_tables: 0` y el mismo hash de esquema `ff26cd9b…8340a2d`.

## Recorrido real en UAT

- Studio `5db9a7c` / deployment `6c3bb3e7-2df5-4dd7-ac34-961a2eb0271c` activo. Laika y Alexa+ conservaron sus comprobaciones previas; no se mutaron sus datos.
- Se creó desde Studio la marca QA descartable `national-qa-importado-2026-09-24` (`f98b9547-4afe-4097-bc0a-2642e281386d`). Se registró SentiOne con derecho de visualización, almacenamiento y análisis; derecho de IA desmarcado. Se subió por la UI el CSV real `Alamo.csv` del material del operador al slot competidor, sin consulta de búsqueda adjunta.
- La importación terminó: 57 filas, 51 incluidas, 3 excluidas, 3 duplicadas, 54 menciones únicas recibidas. Signal abrió sin ejecutar Topics: Resumen muestra `CONVERSACIONES IMPORTADAS`, clasificación pendiente y 51 menciones en el periodo; Menciones muestra 51 conversaciones y 51 textos accesibles. [Signal QA](https://studio-uat-uat.up.railway.app/signal/national-qa-importado-2026-09-24) y [Menciones QA](https://studio-uat-uat.up.railway.app/signal/national-qa-importado-2026-09-24/mentions).
- El corpus de ese archivo incluye contenidos ajenos a Alamo. Signal refleja lo recibido y aprobado; no se infiere relevancia semántica ni precisión de clasificación. La generación de queries y la evaluación de pertinencia siguen pendientes.

## Fallo operativo observado y recuperación

El intento quedó inicialmente `queued` con outbox `pending`, disponible y `attempt_count=0`. Redis no tenía trabajos activos. El Worker UAT antiguo seguía marcado ACTIVE por Railway; sus logs históricos muestran un rechazo no capturado del drainer de evaluación de Topics al agotarse la conexión PostgreSQL, seguido de salida y reinicio automático. No está demostrado que esa salida histórica sea la causa única del atasco de hoy. Se reinició sólo ese Worker, sin repetir el upload: startup en modo recovery encontró una fila reclamable y la importación terminó.

Se corrigió el drainer para capturar fallos de conexión de la pasada programada y al arrancar, registrar sólo el tipo seguro y permitir el siguiente intento. La prueba focal inyecta un rechazo de conexión seguido de éxito. El commit `11be6da` se entregó al Worker UAT: deployment `2032500e` figura Active y su salida a las 12:52:59 CST registra `Worker runtime preflight passed`, modo `recovery`, cero filas de importación y clasificación reclamables. No se atribuye al reinicio una solución permanente. La política de restart del Worker está en `Always`, pero no asegura por sí sola que todos los drainers sigan sanos tras un fallo parcial; revisar esa supervisión como trabajo posterior.

## Siguiente corte

1. Conectar la revisión versionada de intereses a admisión/recuperación durable, decisión con citas, membresías persistentes y proyección del mismo interés a Signal. SQL0183 aún no está en UAT.
2. Completar 42 lotes de consolidación/ranking de Alexa+ sólo con autoridad vigente de proveedor y ledger; última comprobación 2/42. Después probar una segunda carga real y luego queries por ámbito, reportes agente, MCP y escala.

No hubo llamadas de Claude/Voyage en esta entrega. El loop programado permanece pausado por petición del operador. Linear sigue pendiente de reconexión; no se afirma una actualización externa.
