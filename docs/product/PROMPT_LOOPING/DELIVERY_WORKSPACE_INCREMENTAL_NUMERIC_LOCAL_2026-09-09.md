# Continuidad numérica incremental — cierre local

9 septiembre 2026, 09:41 UTC. Commit focal `6640dbba57f5d332324b0f33eb298d0602db7b5f`, 14 archivos. UAT permanece en Studio/Worker `147b0fb` y SQL0144; SQL0145 está sólo local y no se ha aplicado en UAT.

## Resultado para el producto

El motor existente ya tiene un consumidor persistente de actualización incremental: conserva modelos y unidades anteriores, procesa las menciones nuevas/cambiadas y retira de la población actual las eliminadas o ineligibles. La interpretación puede seguir incompleta sin invalidar el trabajo numérico anterior. Este corte todavía no actualiza Signal con una nueva carga: la conexión a clasificación/Signal y el disparo automático son el siguiente trabajo en curso.

No cambia el resultado UAT ya comprobado: 32 Topics editables procedentes de 32/357 unidades interpretadas; proyección completa de 6,826 raíces y 20,821 fragmentos, 1,231 membresías sobre 1,203 raíces. El tópico seleccionado por UI tiene 63 asociaciones y evidencia real en Topics de Signal y Resumen. La precisión semántica sigue sin calibrarse y la interpretación es parcial. Ver `DELIVERY_TOPICS_SIGNAL_PAGES_2026-09-09.md`.

## Continuidad técnica comprobada

El hijo utiliza la cola y ledger existentes con cap Claude cero. No paga, reinterpreta ni reescribe el padre. Cada modelo conserva su origen; el resultado numérico no se presenta como análisis editorial completo. Un padre editorial running/failed con cómputo completo sirve como origen autorizado; un padre incremental debe estar ready. Sólo existe un hijo activo por perfil.

Input completo e índice de salida quedan durables. Una pérdida de ACK después del índice recupera exactamente esos archivos, sin Python ni nueva exportación. Los archivos ausentes/corruptos fallan explícitamente. Los Topics, su edición y selección no se escriben desde esta variante. La consulta de último análisis completo excluye los hijos numéricos y conserva el resultado editorial anterior.

El corte se probó en checkout aislado del mismo HEAD base, excluyendo los tres drafts ajenos y el trabajo siguiente de proyección. Typecheck y lint 11/11; DB 235 PASS/74 SKIP; Worker 402 PASS/5 SKIP; Query 444 PASS; Studio 739 PASS/6 SKIP; build Studio PASS/18 páginas. PG focal 2/2 con rollback, padre/ledger conservados, 3 raíces/133 fragmentos, recuperación, concurrencia y revocación. Revisiones independientes cerradas sin P0/P1/P2 pendientes.

Una primera invocación de tests Studio omitió DATABASE_URL e impidió cargar dos módulos; se corrigió únicamente el entorno local y la suite completa pasó. Los tests numéricos reutilizan las tres oleadas sintéticas ya calculadas (incluida retirada total), sin otro fit ni proveedor. PG verifica autoridad con archivos explícitamente sintéticos; no se afirma una nueva ejecución incremental real en UAT.

## Evidencia y límites

Evidencia privada en `/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06/.data/workspace-incremental-2026-09-09/`: `numeric-consumer-check-receipt.json`, `numeric-check-cut-files.json`, `BACKEND_NUMERIC_RECEIPT.json`, `ROOT_SQL_INDEPENDENT_REVIEW.md`, `DB_TYPESCRIPT_INDEPENDENT_REVIEW.md` y recibos de Worker/archivos/proceso.

El bootstrap legacy insuficiente sin registro de versión se rechaza con `parent_runtime_missing`; no se inventa una versión ni se dispara full fit como fallback. Los archivos y el banco tienen límites explícitos; no se ha demostrado escala de dos millones. Cohortes pendientes y unidades heredadas sin interpretar deben seguir visibles en la siguiente proyección.

Claude nuevo cero: USD 1.918865 confirmado + USD 1.6818 reserva histórica; Voyage USD 0.594449 intacto. El permiso fechado anterior está vencido, la consulta de renovación sigue sin respuesta. No Opus ni Advisor Opus. No producción ni renovación por loop.

## Siguiente trabajo acordado

Frontend implementa contrato y resolución pura unidad→Topic→propuesta histórica; Backend la variante de fuente/guardas SQL0146 y derivación durable; Import el censo streaming; Root el consumidor Worker y entrega integrada. Se reutilizan el ledger de clasificación por páginas y readers de Signal. Los Topics seleccionados conservan identidad; las nuevas conversaciones sin interpretación quedan pendientes, sin Topics ficticios ni controles por grupo.

La ventana autónoma sigue activa hasta 14:47:24 UTC; al cierre, aparcar operaciones y pausar la automatización por herramientas de la app. Mantener el Compass y toda la historia inferior.
