# Admisión automática de nuevas revisiones del corpus

Corte 2026-09-09T10:54:30.976247+00:00, commit `4b481e2aee42c80248c2d4fcbc6a59d379d599ab`.17archivos, sinSQL nuevo. UATcódigo1c4f506/SQL0145–0146 verificado; nuevaentrega en curso.

Una marca que ya inició un análisis nativo puede actualizar automáticamente su cálculo cuando dispone de una revisión nueva con preparación y embeddings completos. El productor revalida contexto, intereses, derechos, actor original, modelo compatible y revisión bajo locks existentes; crea una única solicitud con cap0 y outbox existente. No hereda permisos de Claude, no crea embeddings, no usa fit del corpus como fallback. Un fallo aislado no bloquea las demás marcas.

Las conversaciones pendientes se acumulan cuando no alcanzan el mínimo existente; cada nueva revisión completa solicita cierre de cohorte, permitiendo descubrimiento emergente con suficiente población. La propuesta anterior close_requested=false fue corregida porque por sí sola nunca cerraba la cohorte. No se cambiaron umbrales ni política numérica.

La UI diferencia preparación, embeddings, listo para admitir y solicitud ya registrada. Espera sólo ante trabajos reales; el intervalo previo a la admisión se consulta máximo6veces/24s. Conserva borradores, selección y recibos anteriores. El banner global es navegación, no una lista de requisitos obligatorios.

## Validación

Copia exacta aislada17archivos: typecheck/lint11/11, DB236PASS/76SKIP, Worker505PASS/5SKIP, Studio746PASS/6SKIP, buildPASS. Query sin cambios conserva evidencia previa460PASS, no repetida. PG integrado conSQL0146 pasó7/7sin skips (3.69s, rollback): nueva revisión real→preparación→embeddings nuevos con caché/cap0→una ejecución, carreras manual/auto y reservas intactas.15casos reales del componente con transporte local simulado, ES390px/ENdesktop; no overflow. P2deaislamiento corregido; sin P0/P1/P2 residual. Recibos privados `.data/workspace-incremental-2026-09-09/admission-cut-check-receipt.json` y fuentes aisladas.

## Límites y siguiente entrega

Rollout gates siguen false hasta comprobar Studio yWorker nuevos. No hay nueva carga UAT ni hijo incremental inventado para simularla. Nueva importación y preparación siguen pasos existentes; no afirmar monitoreo completo de punta a punta todavía. Siguiente: reintento numérico exacto desdeUI y reutilización100%cache sin proveedor. Las unidades nuevas sin interpretación necesitan operación editorial sobre su checkpoint; no volver a correr fit como sustituto.

Provider nuevo0. ClaudeUSD1.918865 confirmado+USD1.6818 reserva terminal; permiso8sept vencido, renovación preguntada sin respuesta. Sonnet4.6/noOpus. VoyageUSD0.594449 intacto. Fin autonomía14:47:24UTC, luego pausa segura. Compass e historia conservados.

## Verificación y activación posterior — 11:09:54 UTC

Studio `53bb9bc2-4ac1-4d12-9524-498ee3d3de04` y Worker `cac786f2-bbe2-49da-88e9-487012121176` ejecutaron `4b481e2` antes de cambiar variables. Se desplegaron exactamente dos flags: productor numérico y proyección incremental. El Worker resultante `5e548c3f-d57b-4911-90c9-f31816181e19` conserva el mismo commit; ambos flags están activos. La admisión de Claude conserva su vencimiento anterior.

La comprobación DB de sólo lectura posterior registra cero candidatos actuales, cero ejecuciones/outbox activos y cero hijos numéricos. Los 15 recibos Claude, USD 1.918865 confirmado, USD 1.6818 de reserva terminal y la selección Signal permanecen intactos. No se generó una carga artificial para activar el productor. La prueba de segunda carga sigue pendiente de menciones reales del operador por UI. Evidencia privada: `.data/workspace-incremental-2026-09-09/uat-admission-before.json` y `uat-admission-after.json`.
