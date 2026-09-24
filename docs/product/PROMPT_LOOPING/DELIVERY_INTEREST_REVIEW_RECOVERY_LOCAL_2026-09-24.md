# Recuperación de revisión editorial de intereses — composición local

24 septiembre 2026, heartbeat 10:22 UTC. Amplía Compass y DELIVERY_INTEREST_EDITORIAL_INPUT_LOCAL_2026-09-24.md; no sustituye la historia. Corte LOCAL sobre 602ae51, sin entrega UAT, SQL remoto ni proveedores reales.

## Resultado

El manifiesto de intereses versionados puede formar solicitudes Sonnet 4.6 con identidad propia por ejecución, revisión y lote. Usa el transporte, validación de recibos, cálculo de costos y ledger editorial existentes. Conserva cuerpos, hashes, configuración y solicitudes pagadas del screening/global histórico. La matriz se valida una sola vez por coordinador y las respuestas se validan contra los pares y referencias exactos del lote.

El coordinador nuevo registra progreso validado por lotes con comparación atómica del digest esperado. Recibe explícitamente almacenamiento, proveedor y comprobación de vigencia; no tiene conexión por defecto, ruta, dispatcher ni productor. Captura identidad y dependencias antes de cualquier espera y conserva una copia del manifiesto. Revalida fuente/permiso antes de trabajar y guardar. Una respuesta registrada puede recuperarse desde el ledger; un envío incierto se detiene sin lanzar una solicitud de reemplazo. No hay repair automático ni nuevo sistema de costos.

La recuperación se comprobó componiendo el transporte y ledger reales con persistencia y HTTP simulados. **La implementación PostgreSQL de admisión y checkpoints para interest_review todavía no existe.** Este corte prueba el protocolo local y su recuperación; no acredita durabilidad transaccional PG ni ejecución productiva.

Las respuestas siguen siendo evidencia editorial: supports respalda sólo las citas del manifiesto. No adjudica todas las menciones de un grupo mixto ni convierte similitud/top-k en clasificación. membership_effect y approval_policy permanecen none. No habilita publicación, membresías ni UI que prometa clasificación final.

## Validación cerrada

- Query Engine: 508/508 PASS.
- Workers: suite 624 PASS, 42 omitidos, cero fallos. Después del último cambio focal, ocho pruebas compuestas finales PASS; no se atribuyen los omitidos a aceptación PG.
- Typecheck y lint raíz: 11/11 tareas PASS cada uno; lint conserva 13 warnings anteriores, cero errores. Diff-check PASS.
- Ocho escenarios compuestos: ejecución por lotes y replay completo; recibo persistido con confirmación perdida; checkpoint persistido con confirmación perdida; transporte incierto sin reenvío; fuente cambiada o autoridad vencida; entrada distinta sobre la misma ejecución; límite de gasto por lote; mutación del identificador y dependencias durante una espera.
- Las pruebas recrean transporte/ledger al reanudar, conservan un recibo histórico y comprueban número de envíos y costos simulados. No son una evaluación de precisión semántica de Claude.
- Revisión independiente: un P2 sobre lectura de opciones mutables después de await, corregido y cubierto por el octavo escenario. Revisión final sin P0/P1/P2. Sin frontend ni ruta pública nuevos; no se repiten build/QA visual históricos.

Evidencia local: .data/interest-durable-2026-09-24/ en el checkout focal. Sonnet 4.6 fijo; cero llamadas reales, gasto, permisos renovados, imports, embeddings o fit.

## Persistencia pendiente: siguiente tarea delimitada

Extender LOCAL la admisión y el almacenamiento existentes con propósito/identidad de revisión de intereses separados. No basta con añadir interest_review a un CHECK de fases: SQL0176 limita fases e índices; SQL0178 valida configuración, cuerpo, hashes, checkpoint y finalización del plan anterior; SQL0182 restringe el dueño/sucesor cuando ya hubo progreso pagado. No alterar una ejecución histórica ni su dueño para reutilizarla con este contrato. Revisar y probar una extensión aditiva que conserve admisión, presupuesto, permiso, recibos y recuperación anteriores; sin ledger paralelo ni cambio de prompts en curso.

Archivos de referencia: infrastructure/db/migrations/0176_signal_topic_consolidation_editorial.sql; 0178_signal_topic_editorial_catalog_contract.sql; 0182_signal_topic_editorial_plan_successor.sql; infrastructure/db/signal-topic-consolidation-editorial.ts. La implementación actual usa interfaces y fixtures de admisión/almacenamiento; la extensión SQL y sus adaptadores son trabajo pendiente, no un gate aprobado.

Después siguen criterio de evidencia suficiente, materialización/proyección del mismo interés, consolidación/ranking trazables y segunda carga incremental real. Queries por ámbito, reportes agente y MCP conservan su lugar en backlog. No añadir revisión humana por mención.

## Estado externo preservado

Studio UAT a42b9b4 y Worker original0b68b3e0 conservan la última comprobación previa; este corte no desplegó ni volvió a consultar datos. Alexa+43,159/Topic67 y Laika no se modificaron. Signal desde importación (producto a881d21) sigue LOCAL, pendiente de aceptación PG privada.

Dev-test sigue bloqueado por28P01 antes de SQL. Causa credencial/encoding no probada; operador ya avisado. No se reintentó conexión ni se cambió contraseña. Runner readonly/autodeployOFF. Sólo tras corrección: recibo readonly, sellos reales, upgrade vacío explícito si procede y seis escenarios con rollback antes de entregar Signal importado. Este trabajo no elude ese gate. Linear requiere reconexión; no hubo actualización remota.
