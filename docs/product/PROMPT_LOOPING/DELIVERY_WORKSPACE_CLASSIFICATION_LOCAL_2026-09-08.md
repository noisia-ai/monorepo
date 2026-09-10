# Clasificación persistente del workspace — integración local

8 septiembre 2026. Base `ae3e36c`; commit local `92d5d0ade818061bd51c4fd009caae0e6bbbcd21`, sin push. Implementación y prueba local cerradas; el commit focal contiene este recibo y ADR024. **No es una entrega UAT ni una ejecución semántica de National.**

## Resultado

Las decisiones por mención ya pueden persistirse en las generaciones y asignaciones existentes de SQL0087 desde una entrada nativa del workspace. Se reutiliza la ejecución de catálogo; no se fabrica un corpus de estudio ni otro sistema de asignaciones. SQL0136 mantiene separados los contratos antiguos y nuevos.

Una mención puede conservar una pertenencia confirmada, una exclusión y una duda o fallo localizado. Sólo se guardan decisiones explícitas: no se materializa una fila pendiente por cada combinación de mención y Topic. La ausencia de fila nunca significa rechazo. La recuperación mantiene cursor y linaje; una generación abierta o con errores no oculta la última completa. La vigencia de esa generación se informa aparte.

La equivalencia incluye motor, artefacto, política, perfil de embeddings, catálogo, compilador, contexto y la huella/correcciones de cada raíz. Los IDs de preparación y revisión de ingesta sellan la fotografía, pero no invalidan por sí solos las raíces intactas. Una corrección local afecta su raíz; un contexto o catálogo distinto exige recalcular. No se convierte el top32 de búsqueda en aprobación.

## Evidencia y alcance

| Prueba | Resultado observado |
| --- | --- |
| Contrato compartido | 7 pruebas focales; 423 pruebas del paquete PASS. Multilabel, autoridad, error parcial, equivalencia y 1,000 decisiones sin top-k. |
| Worker | 9 focales; 263 PASS y 3 SKIP en el paquete. Texto completo de 130 fragmentos, partición alterada rechazada, checkpoint, fallo, delta de entradas/correcciones y límite explícito de 8 MiB por resultado. |
| PostgreSQL y BullMQ locales | 3 raíces / 133 fragmentos. Interrupción tras persistir la primera raíz; reanudación de las dos restantes sin duplicar. Segunda generación reutilizó las tres con linaje, cero lectura de texto y cero llamadas al motor. |
| PostgreSQL de autoridad | 3/3 PASS, cero skips, mutaciones en rollback. Approved/rejected humanos con raíz pending, error parcial que conserva decisiones, orden invertido y copia estable, revocación/contexto/catálogo vacío, lector con permisos de lectura y bloqueo de finalización legacy. La tercera prueba guardó 1,001 asignaciones y copió las 1,001 con linaje. |
| Checks integrados | `pnpm typecheck` PASS en 11 tareas; `pnpm lint` PASS, 15 warnings existentes; DB 231 PASS / 50 SKIP en la pasada integrada inicial. La suite PG opt-in se ejecuta por separado; typecheck/lint finales se repitieron tras las últimas correcciones y pasaron en las 11 tareas. |

La prueba PG/cola utilizó decisiones simuladas pendientes; no midió precisión. El delta de una nueva ingesta está probado en las unitarias de este Worker: esta prueba PG de clasificación reutilizó el mismo manifiesto, **no una segunda carga real de archivos**. La preparación incremental de texto tiene su propio recibo previo; no sustituye esa prueba pendiente del recorrido completo. Tampoco se acredita capacidad de dos millones de menciones.

SQL0136 completo pasó el ensayo transaccional local sobre una DB anterior a esa migración. SHA256 exacto: `a8fe308882ab85dcce8956f087bee6a12e39fa98854e6638e42fb64cc581296d`. Revisión independiente y residual de las correcciones: sin P0/P1/P2 pendientes en la superficie revisada. Se corrigieron incompatibilidad de policy, pérdida de decisiones ante error parcial, columna de configuración, copia con contexto/corrección desactualizados, orden del digest, catálogo vacío y finalizador legacy. No se repitieron gates anteriores.

## Límites deliberados

El handler requiere DB, stores y motor explícitamente inyectados. No registra una cola/productor, API, botón, scheduler o proveedor por defecto. Cero filas nuevas de outbox en la prueba y ninguna llamada externa. No hay fallback que finja clasificación emitiendo abstenciones cuando falta un motor.

El registro de nuevos modelos sobre un perfil draft sigue pendiente de la integración semántica real. No se amplió autoridad para fabricar aprobaciones en pruebas. Las correcciones humanas requieren operación, actor, contenido y definición/contexto vigentes. El finalizador legacy rechaza el contrato nativo; Signal y su proyector todavía no consumen estas generaciones.

El commit todavía recompila contexto/catálogo al confirmar cada raíz; su rendimiento debe medirse y, si hace falta, ajustarse al integrar el motor. No se declara resuelta la escala por contar mil asignaciones en una prueba.

## Siguiente resultado concreto

Conectar el cómputo semántico real guiado y el descubrimiento abierto del laboratorio existente (`tools/signal-semantic-lab/src/signal_semantic_lab/discovery.py`) a entradas completas del workspace y a esta persistencia. Implementar el efecto comprobable de Brand OS/intereses, conservar todas las partes de las menciones y permitir descubrimiento aun sin intereses definidos. Preparar contexto no prueba que guíe el fit.

La integración debe persistir el modelo/artefactos necesarios para asignar nuevas menciones, detectar novedad también entre conversaciones ya asignadas y reconciliar IDs estables de Topics. Primero pruebas locales reproducibles sin proveedores, incluida una segunda carga con una conversación nueva; después operación desde Topics/cola existente, interpretación Claude con evidencia, selección y Signal. No exponer otro botón de clasificación simulada ni abrir una nueva auditoría general. NOI-31 y NOI-78 siguen abiertos.

## Continuidad y operación

UAT Studio/Worker permanece `ae3e36c1e8e2f7b9e2159b699acc08ebcf4c5848`; SQL0136 sólo local. National conserva 16 CSV / 9,131 filas, 7,396 raíces, 6,826 preparadas y 570 excluidas. Sin intereses ficticios, embeddings reales, BERTopic, Claude o Signal nuevos. No reimportar ni repetir SQL0131–0135/gates cerrados.

Proveedor deshabilitado; cero gasto nuevo. Saldos: producto USD 11.362961 y Advisor USD 1.343826. Cotización previa de National USD 8.328543 frente al máximo USD 5; no modificar ese máximo ni habilitar proveedor por efecto del loop. La zona SentiOne ya preguntada sigue pendiente; no repetir ni inferir respuesta. Producción y los tres archivos ajenos de contract-drafts se conservan intactos.

Evidencia privada focal: `.data/workspace-classification-2026-09-08/worker-postgres-receipt.json`, `worker-final-receipt.md`, `backend-final-receipt.md`, `backend-contract.log`, `migration-final-rehearsal.json`, `review.md` y logs de checks. Decisión estructural: [ADR024](../../adr/024-workspace-classification-generations.md). [Plan del corte](./WORKSPACE_CLASSIFICATION_INCREMENTAL_2026-09-08.md). Este recibo nutre el Compass y conserva su alcance; no declara terminado el producto self-service.
