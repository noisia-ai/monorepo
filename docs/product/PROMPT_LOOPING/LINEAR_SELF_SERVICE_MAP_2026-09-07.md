# Linear — mapa self-service y cobertura de deuda

Actualización vigente 8 septiembre: **Studio 561ecc3 y Worker 67569e9 comprobados en UAT**, SQL0133 aplicado, proveedor deshabilitado y cero llamadas pagadas. [Recibo de embeddings](./DELIVERY_WORKSPACE_EMBEDDINGS_FOUNDATION_2026-09-08.md). Root terminó integración, QA real, push y verificación; los tres agentes están finalizados. NOI-31/78/27/55 enriquecidos conservando sus alcances abiertos. [NOI-81](https://linear.app/noisia/issue/NOI-81/ss-e2e-resolver-costos-y-respuestas-inciertas-de-embeddings-desde-el) conserva conciliación de respuestas/costos inciertos y presupuesto self-service antes de activar ejecución pagada en producción. Próximo: clasificación y descubrimiento completos/incrementales con toda la evidencia, primero localmente sin proveedores. La base de embeddings no cierra estos pendientes. Loop existente activo en el mismo chat; no reabrir gates cerrados.

---

## Historial anterior conservado — no instrucción vigente

Actualización 8 septiembre: embeddings del manifiesto preparado en validación local, proveedor deshabilitado. [Contrato de ejecución](./WORKSPACE_EMBEDDINGS_EXECUTION_2026-09-08.md). NOI-81 conserva resolución de respuestas/costos inciertos desde el producto antes de activar ejecución pagada en producción. NOI-31/78 conservan clasificación y descubrimiento completos/incrementales; el nuevo corte no los cierra.

## Vigente — preparación de texto entregada, 8 septiembre 2026

**Studio y Worker UAT `bed52d9bdea7d72f986e994bc13d0a8f1ee260a7` activos y comprobados.** [Recibo del corte](./DELIVERY_WORKSPACE_CORPUS_TEXT_PREPARATION_2026-09-08.md). National terminó una solicitud normal por UI:7,396raíces recorridas,6,826menciones preparadas,570excluidas,20,821fragmentos; run `ea577ad4-06ac-4752-9a6e-49237a122bbd`, revisión1 vigente. POST202en611ms; duración74.11s; recarga durante/después y ES/EN comprobados. Los16CSV/9,131filas siguen aceptados; ocho competidores sin archivo no bloquean. No volver a subir ni preparar National sólo para repetir evidencia.

SQL0132 aplicado y verificado; checks/revisión/PG+BullMQ50,001/recuperación/incremental local cerrados. Tres contract-drafts ajenos siguen sucios y excluidos. Texto preparado **no es** embeddings, clasificación, BERTopic, Claude ni Signal. Cero llamadas pagadas; productoUSD11.362961 y AdvisorUSD1.343826. Zona SentiOne ya preguntada sigue pendiente; no repetir pregunta ni reparar fechas por intuición. Leer Compass, plan y recibo antes de elegir código. Historia inferior conservada, no instrucciones actuales.

Preparación es un avance de NOI-31/78; no cierra clasificación ni descubrimiento. NOI-80 documenta retención/retirada material. NOI-27/55 reciben evidencia UAT; no declarar todo el programa Done.

> Cierre 8 sept: NOI-17/27/55 se enriquecen con65926c0, corpus visible y GET937ms, y NOI-31 con la siguiente preparación workspace-native. Se conservan estados abiertos de los alcances restantes: esta entrega no acredita preparación, BERTopic ni clasificación. [Recibo](./NATIONAL_CORPUS_VISIBILITY_2026-09-08.md). No crear tickets duplicados por el P2 ya resuelto.

> Actualización 8 sept: NOI-12/17/55 enriquecidos con entrega70604a4+2c2e3f4, validación temporal previa, zona editable y corrección de hidratación. Siguen abiertos los alcances restantes. NOI-79 separa el bloqueo legacy23514; no desplaza preparación completa NOI-27 ni incrementalidad del Compass.

## Ampliación — National, 8 septiembre 2026

NOI-12/17/27/55 conservan recepción, UX, preparación y entrega de National. [Aceptación](./NATIONAL_IMPORT_ACCEPTANCE_2026-09-08.md) y [normalización temporal](./NATIONAL_TIMESTAMP_NORMALIZATION_2026-09-08.md) distinguen lo recibido de lo analizado y los datos pendientes de corrección. Se añadió [NOI-79](https://linear.app/noisia/issue/NOI-79/acq-resolver-incompatibilidad-de-importadores-legacy-con-procedencia), incompatibilidad anterior entre importadores legacy y procedencia durable; no autoriza recuperar datos viejos ni cambiar la prioridad self-service. El mapa original siguiente se conserva.


7 de septiembre de 2026. **45 tickets existentes enriquecidos y seis nuevos (NOI-73 a NOI-78)**. Se conservaron proyectos, IDs, relaciones previas y descripciones históricas. Ninguna actualización de planificación declara una capacidad entregada. Los tickets históricos de experimentos siguen conservados con prioridad baja y aviso de no ejecución; su estado Backlog no autoriza repetirlos.

## Programa y documentos

- [Programa de lanzamiento NOI-73](https://linear.app/noisia/issue/NOI-73/ss-e2e-lanzar-monitorizacion-self-service-marca-nueva-corpus-completo).
- [Proyecto Noisia V0.2](https://linear.app/noisia/project/noisia-v02-product-completion-program-6dc60acfa1be).
- [Compass](https://linear.app/noisia/document/noisia-compass-self-service-corpus-completo-y-monitorizacion-c2c0ccd7673e).
- [Auditoría completa](https://linear.app/noisia/document/auditoria-de-admin-y-descubrimiento-evidencia-y-deuda-al-7-sep-2026-e8359f6280c8).
- [Plan de entrega](https://linear.app/noisia/document/plan-de-entrega-marca-nueva-a-signal-e-incrementalidad-rumbo-a-cd1a035e2c85).

Responsables de las tablas son frentes funcionales; no se asignó trabajo arbitrariamente a personas ni se enviaron mensajes personales. Las dependencias explícitas están guardadas en Linear. Los nuevos tickets son Todo; se conserva el estado previo de los existentes y se aclara el pendiente real en la descripción. In Progress antiguo no prueba que haya un agente trabajando.

## Orden de trabajo

1. **NOI-74:** contratos compartidos/capacidades/seguimiento/estados. Resolver el mínimo y comenzar integración, sin abrir otro programa de diseño.
2. **P1:** frontend alta/contexto/Topics/importación; backend import/eventos, corpus completo, intereses, discovery/Claude, selección y Signal. QA integrado NOI-10/20, no cierre por pantalla.
3. **P2 obligatorio:** NOI-31/7/13/78, imports nuevos y emergentes con ID estable; NOI-34/37, Signal actualizado. Diseñar esta dependencia desde P1.
4. **P3:** NOI-26/56/58/59, calidad/capacidad/operación/producción. Instrumentación y medición temprana desde P1; no acumular sorpresas al final.
5. **P4:** agentes/reportes/MCP y deudas periféricas priorizadas después del núcleo.

## Huecos nuevos registrados

| Ticket | Fase | Responsable | Resultado |
|---|---|---|---|
| [NOI-73](https://linear.app/noisia/issue/NOI-73) | Programa P1–P3 | Orquestador | Lanzamiento del núcleo self-service inicial + incremental |
| [NOI-74](https://linear.app/noisia/issue/NOI-74/ss-01-acordar-contratos-de-contexto-ejecucion-topics-incrementalidad-y) | P0 | Orquestador + Frontend + Backend | [SS-01] Acordar contratos de contexto, ejecución, Topics, incrementalidad y Signal |
| [NOI-75](https://linear.app/noisia/issue/NOI-75/ss-02-resolver-controles-semanticos-rutinarios-automaticamente-y) | P1/P2 | Backend + Frontend | [SS-02] Resolver controles semánticos rutinarios automáticamente y escalar sólo excepciones útiles |
| [NOI-76](https://linear.app/noisia/issue/NOI-76/ss-03-integrar-capacidades-utiles-de-reglas-y-cohortes-en-topics-y) | P1 | Frontend + Backend | [SS-03] Integrar capacidades útiles de reglas y cohortes en Topics y retirar el recorrido diagnóstico obligatorio |
| [NOI-77](https://linear.app/noisia/issue/NOI-77/ss-04-unificar-estados-de-preparacion-y-corregir-errores-de-brand-os) | P1 | Frontend + Backend | [SS-04] Unificar estados de preparación y corregir errores de Brand OS, adquisición y salud |
| [NOI-78](https://linear.app/noisia/issue/NOI-78/ss-05-detectar-topics-emergentes-en-cargas-incrementales-con-residual) | P2 obligatorio | Backend | [SS-05] Detectar Topics emergentes en cargas incrementales con residual completo e identidad estable |

## Tickets existentes enriquecidos

| Ticket | Fase vigente | Responsable | Título |
|---|---|---|---|
| [NOI-15](https://linear.app/noisia/issue/NOI-15/adm-01-redesign-brand-creation-with-canonical-admin-ui-and-governed) | P1 | Frontend + Backend | [ADM-01] Redesign brand creation with canonical Admin UI and governed IANA timezone catalog |
| [NOI-69](https://linear.app/noisia/issue/NOI-69/adm-01a-productize-structured-brand-os-fields-and-readiness-contract) | P1 | Frontend + Backend | [ADM-01A] Productize structured Brand OS fields and readiness contract |
| [NOI-71](https://linear.app/noisia/issue/NOI-71/adm-01c-generar-y-utilizar-contexto-de-brand-os-con-edicion-simple-y) | P1 | Backend + Frontend | [ADM-01C] Generar y utilizar contexto de Brand OS con edición simple y excepciones |
| [NOI-72](https://linear.app/noisia/issue/NOI-72/adm-01d-add-bounded-semantic-context-proposal-adapter-and-execution) | P1 | Backend | [ADM-01D] Add bounded Semantic Context proposal adapter and execution gate |
| [NOI-70](https://linear.app/noisia/issue/NOI-70/adm-01b-collapse-brand-os-base-relationships-by-default) | P1, sólo delta pendiente | Frontend | [ADM-01B] Collapse Brand OS base relationships by default |
| [NOI-16](https://linear.app/noisia/issue/NOI-16/adm-02-make-data-preparation-understandable-with-helpers-visible) | P1 | Frontend + Backend | [ADM-02] Make Data Preparation understandable with helpers, visible defaults and responsive policy layout |
| [NOI-10](https://linear.app/noisia/issue/NOI-10/acq-01-repeat-the-complete-greenfield-acquisition-flow-on-a-second) | P1/P2 | Orquestador + Frontend + Backend | [ACQ-01] Repeat the complete greenfield acquisition flow on a second workspace |
| [NOI-12](https://linear.app/noisia/issue/NOI-12/acq-03-productize-multi-file-queue-per-file-preflight-progress-and) | P1 | Frontend + Backend | [ACQ-03] Productize multi-file queue, per-file preflight, progress and retry |
| [NOI-13](https://linear.app/noisia/issue/NOI-13/acq-04-add-source-cadence-pauseresume-failure-triage-and-recurring) | P2 obligatorio | Backend + Frontend | [ACQ-04] Add source cadence, pause/resume, failure triage and recurring import operations |
| [NOI-27](https://linear.app/noisia/issue/NOI-27/tn-01-hacer-topics-una-seccion-principal-con-catalogo-procedencia-y) | P1 | Frontend + Backend | [TN-01] Hacer Topics una sección principal con catálogo, procedencia y operación a escala |
| [NOI-28](https://linear.app/noisia/issue/NOI-28/tn-02-implement-mergesplitnamereject-and-append-only-topic-decisions) | P1/P2 | Frontend + Backend | [TN-02] Implement merge/split/name/reject and append-only topic decisions |
| [NOI-29](https://linear.app/noisia/issue/NOI-29/tn-03-implement-bounded-claude-contextual-naming-with-brand-os-locale) | P1/P2 | Backend | [TN-03] Implement bounded Claude contextual naming with Brand OS, locale and evidence packet |
| [NOI-30](https://linear.app/noisia/issue/NOI-30/tn-04-define-and-compile-closed-topicnarrative-rule-spec-to-postgres) | P1 | Backend | [TN-04] Define and compile closed Topic/Narrative Rule Spec to Postgres FTS/trgm/pgvector |
| [NOI-31](https://linear.app/noisia/issue/NOI-31/tn-05-propagate-current-contracts-full-pop-and-incrementally-with) | P1/P2 obligatorio | Backend | [TN-05] Propagate current contracts full-pop and incrementally with versioned assignments |
| [NOI-32](https://linear.app/noisia/issue/NOI-32/tn-06-build-novelty-false-positivenegative-abstention-and-drift-review) | P1/P2 | Backend + Frontend | [TN-06] Build novelty, false-positive/negative, abstention and drift Review queues |
| [NOI-68](https://linear.app/noisia/issue/NOI-68/tn-01a-ejecutar-descubrimiento-de-corpus-completo-desde-topics-con) | P1 | Backend | [TN-01A] Ejecutar descubrimiento de corpus completo desde Topics con contexto y vía emergente |
| [NOI-26](https://linear.app/noisia/issue/NOI-26/sem-06-measure-spanish-mx-english-us-and-cross-scope-quality-by-slice) | P1/P2/P3 | Backend + Orquestador | [SEM-06] Measure Spanish-MX, English-US and cross-scope quality by slice |
| [NOI-25](https://linear.app/noisia/issue/NOI-25/sem-05-clasificar-automaticamente-con-calidad-medida-abstencion-y) | P1/P2 | Backend | [SEM-05] Clasificar automáticamente con calidad medida, abstención y excepciones |
| [NOI-6](https://linear.app/noisia/issue/NOI-6/dos-02-reconcile-policies-bindings-denominators-and-evidence-across) | P1/P2 | Backend + Frontend | [DOS-02] Reconcile policies, bindings, denominators and evidence across all modules/views |
| [NOI-7](https://linear.app/noisia/issue/NOI-7/dos-03-prove-longitudinal-import-invalidation-materialization-without) | P2 obligatorio | Backend | [DOS-03] Prove longitudinal import → invalidation → materialization without rebuilding payloads |
| [NOI-17](https://linear.app/noisia/issue/NOI-17/adm-03-finish-admin-mentions-table-filters-bulk-actions-and-canonical) | P1 delta focal; resto posterior | Frontend | [ADM-03] Finish Admin Mentions table, filters, bulk actions and canonical detail drawer |
| [NOI-18](https://linear.app/noisia/issue/NOI-18/adm-04-finish-semantic-review-navigation-bounded-resolution-and) | P1/P2 | Frontend + Backend | [ADM-04] Finish Semantic Review navigation, bounded resolution and mention preview |
| [NOI-19](https://linear.app/noisia/issue/NOI-19/adm-05-complete-workspace-access-lifecyclearchive-and-settings-authz) | P1/P3 | Backend + Orquestador | [ADM-05] Complete workspace access, lifecycle/archive and settings AuthZ QA |
| [NOI-20](https://linear.app/noisia/issue/NOI-20/adm-06-verificar-marca-nueva-topics-signal-y-cargas-incrementales-sin) | P1/P2 | Orquestador | [ADM-06] Verificar marca nueva → Topics → Signal y cargas incrementales sin ingeniería |
| [NOI-33](https://linear.app/noisia/issue/NOI-33/sig-01-implement-clear-governed-view-selector-and-scope-explanations) | P1/P2 | Frontend + Backend | [SIG-01] Implement clear governed view selector and scope explanations |
| [NOI-34](https://linear.app/noisia/issue/NOI-34/sig-02-bind-overview-mentions-and-tandn-to-generationwatermarkcoverage) | P1/P2 | Backend + Frontend | [SIG-02] Bind Overview, Mentions and T&N to generation/watermark/coverage contract |
| [NOI-35](https://linear.app/noisia/issue/NOI-35/sig-03-complete-signal-evidence-loading-responsive-i18n-and) | P1/P2/P3 | Frontend + Orquestador | [SIG-03] Complete Signal evidence, loading, responsive, i18n and performance QA |
| [NOI-37](https://linear.app/noisia/issue/NOI-37/sig-05-seguir-topics-seleccionados-y-publicar-actualizaciones) | P1/P2 | Backend + Frontend | [SIG-05] Seguir Topics seleccionados y publicar actualizaciones multiámbito automáticamente |
| [NOI-55](https://linear.app/noisia/issue/NOI-55/plat-01-maintain-canonical-uat-deployment-workers-queues-and-rollback) | P1/P2/P3 | Orquestador + Backend | [PLAT-01] Maintain canonical UAT deployment, workers, queues and rollback evidence |
| [NOI-56](https://linear.app/noisia/issue/NOI-56/plat-02-design-and-run-2m-mention-capacity-benchmark-with-per-stage) | P3, instrumentar P1 | Backend + Orquestador | [PLAT-02] Design and run 2M mention capacity benchmark with per-stage SLO/cost |
| [NOI-57](https://linear.app/noisia/issue/NOI-57/plat-03-add-longitudinal-observability-for-imports-generations-drift) | P1 instrumentación; P2/P3 cierre | Backend + Frontend | [PLAT-03] Add longitudinal observability for imports, generations, drift and deliverables |
| [NOI-58](https://linear.app/noisia/issue/NOI-58/plat-04-complete-securityauthzdata-rights-review-for-signal-and) | P3, permisos P1 | Backend + Orquestador | [PLAT-04] Complete security/AuthZ/data-rights review for Signal and delivery surfaces |
| [NOI-59](https://linear.app/noisia/issue/NOI-59/plat-05-produce-10h-production-audit-restore-migration-canary-and) | P3 | Orquestador + Backend | [PLAT-05] Produce 10H production audit, restore, migration, canary and rollback pack |
| [NOI-60](https://linear.app/noisia/issue/NOI-60/plat-06-retire-v1-readers-navigation-and-payload-bridges-forward-only) | Posterior o focal si bloquea | Backend | [PLAT-06] Retire V1 readers, navigation and payload bridges forward-only |
| [NOI-9](https://linear.app/noisia/issue/NOI-9/dos-05-retire-legacy-payloadread-adapters-after-governed-cutover) | Posterior o focal si bloquea | Backend | [DOS-05] Retire legacy payload/read adapters after governed cutover |
| [NOI-43](https://linear.app/noisia/issue/NOI-43/del-01-specify-11a-signal-intelligence-contract-and-closed-query-spec) | P4; contrato núcleo reutilizable P1 | Backend + Orquestador | [DEL-01] Specify 11A Signal Intelligence Contract and closed query spec |
| [NOI-46](https://linear.app/noisia/issue/NOI-46/del-04-build-insights-agent-phase-0-taxonomyschema-aggregate-qanda-and) | P4 después del núcleo | Backend + Frontend | [DEL-04] Build Insights Agent phase 0: taxonomy/schema, aggregate Q&A and chart drafts |
| [NOI-50](https://linear.app/noisia/issue/NOI-50/mcp-01-define-mcp-threat-model-tool-scopes-authz-rights-and-rate) | P4 después del núcleo | Backend + Orquestador | [MCP-01] Define MCP threat model, tool scopes, AuthZ, rights and rate limits |
| [NOI-67](https://linear.app/noisia/issue/NOI-67/canon-01-noisia-v02-canonical-program-state-and-nomenclature) | P0 y mantenimiento | Orquestador | [CANON-01] Noisia V0.2 canonical program, state and nomenclature |
| [NOI-21](https://linear.app/noisia/issue/NOI-21/sem-01-approve-or-reject-the-explicit-10c2-execution-flight-card) | Histórico fuera de la cola activa | Orquestador | [SEM-01] Approve or reject the explicit 10C.2 execution flight card |
| [NOI-22](https://linear.app/noisia/issue/NOI-22/sem-02-execute-10c2-smoke-calibration-full-under-the-signed-plan) | Histórico fuera de la cola activa | Orquestador | [SEM-02] Execute 10C.2 smoke → calibration → full under the signed plan |
| [NOI-23](https://linear.app/noisia/issue/NOI-23/sem-03-freeze-finalists-open-holdout-once-and-complete-blind-operator) | Histórico; nueva calidad en NOI-26 | Orquestador + Backend | [SEM-03] Freeze finalists, open holdout once and complete blind operator review |
| [NOI-24](https://linear.app/noisia/issue/NOI-24/sem-04-write-the-adoptionno-adoption-adr-for-the-exact-artifact) | P1 decisión de implementación medida | Backend | [SEM-04] Write the adoption/no-adoption ADR for the exact artifact |
| [NOI-11](https://linear.app/noisia/issue/NOI-11/acq-02-complete-query-composer-generation-review-approval-and-first) | Posterior, salvo bloqueo real de import | Frontend + Backend | [ACQ-02] Complete Query Composer generation, review, approval and first-use |
| [NOI-14](https://linear.app/noisia/issue/NOI-14/acq-05-verify-query-evidence-states-without-treating-a-query-as-proof) | P1 | Backend + Frontend | [ACQ-05] Verify query evidence states without treating a query as proof of CSV origin |

## Cobertura de la auditoría y ampliación del operador

Cada hallazgo tiene dueño en Linear o decisión explícita de conservación/aplazamiento; esto evita abrir una limpieza global antes del flujo.

| Parte / pendiente | Ticket o decisión |
|---|---|
| Alta de marca y continuación sin estudio | NOI-15, NOI-10 |
| Brand OS identidad/competidores/Knowledge/contexto amigable y uso real | NOI-69, NOI-71, NOI-72, NOI-70 |
| Intereses definidos y representación semántica discriminante | NOI-30, NOI-26 |
| Importación completa multiarchivo/embeddings faltantes/todos los chunks | NOI-12, NOI-14, NOI-31 |
| Adquisición/query opcional y captura distinta de atribución | NOI-11, NOI-14, NOI-6 |
| Errores Context Pack/Acquisition, defaults y bloqueo genérico | NOI-77, NOI-16 |
| Procesamiento integral y origen genérico sin constantes Alexa | NOI-68, NOI-31 |
| Emergentes en corpus inicial y delta completo/residual, incluidos temas dentro de asignadas | NOI-78, NOI-32 |
| Claude naming/ranking/evidencia accesible de universo, costo y recuperación | NOI-29, NOI-75, NOI-57 |
| Topics principales, editor completo, lista/candidatos/resultados a escala | NOI-27, NOI-28, NOI-35 |
| Origen manual/histórico/BERTopic, scope heredado y pertenencia real | NOI-27, NOI-30, NOI-33 |
| Paneles reglas/sugerencias/refinamiento/cohortes sin montaje | NOI-76 |
| Discovery Review rúbricas diagnóstico, merge/split efectivo | NOI-76, NOI-28 |
| Revisión semántica con efecto real y excepciones automatizables | NOI-18, NOI-25, NOI-75 |
| Incrementalidad/cadencia/late arrivals/correcciones/dedup/rewrites | NOI-13, NOI-7, NOI-31, NOI-78 |
| Seguimiento selectivo real y actualización automática, sin adoptar emergentes solos | NOI-37 |
| Competencia/categoría y publicación multiámbito | NOI-6, NOI-33, NOI-37 |
| Pending/cobertura/frescura/denominadores/generación/narrativas históricas | NOI-34, NOI-77 |
| Dashboard/Overview/salud/configuración/serving efectivo | NOI-77, NOI-57 |
| Menciones/eligibilidad/detail/export y acceso a evidencia | NOI-17, NOI-6 |
| Equipo, acceso cliente self-service y aislamiento workspace | NOI-19, NOI-58 |
| Governed views, preparación automática y retiro focal de lectores | NOI-6, NOI-16, NOI-9, NOI-60 |
| Estudios/Engine/Themes avanzados, 16 lentes pausados | NOI-76 (decisión de navegación); no expansión activa |
| Reportes T&B y preflight estratégico contradictorio | NOI-77 (estado); NOI-38–42 (T&B posterior existente) |
| Reportes con agente, componentes/formatos y contrato de inteligencia | NOI-43–49, después del núcleo |
| MCP sobre mismas consultas | NOI-50–54, después del núcleo |
| Calidad independiente, cold-start, negativos difíciles, semántica vs léxico | NOI-26, NOI-25, NOI-32 |
| Capacidad 2M/1000, límite64, memoria de fit y matching denso | NOI-56, NOI-31, NOI-68 |
| Límites por cuenta/workspace, costos, job estancado, cancelación/recovery | NOI-57, NOI-55 |
| Lanzamiento producto nuevo, restore, canary y rollback sin migrar prod vieja | NOI-59, NOI-58, NOI-56 |
| Continuidad del contexto y nomenclatura/contratos entre tareas | NOI-67, NOI-74 |
| Experimentos/holdout históricos; no volverlos cola activa | NOI-21, NOI-22, NOI-23; nueva decisión focal NOI-24 |

## Seguimiento

La [orquestación](./ORCHESTRATION_SELF_SERVICE_2026-09-07.md) conserva identidad de tareas, responsabilidades y puntos de lectura. El plan tiene aceptación por recorrido, corpus íntegro, dos/tres imports, nuevo tema, recuperación y escala. No se duplicaron los proyectos de Delivery/MCP ni se marcaron Done por existir código.

Recibo de sincronización: `.data/self-service-planning-2026-09-07/linear-sync-receipt.json`. El recibo se valida contra lectura fresca de Linear antes del cierre de preparación. El proyecto Linear aloja el análisis; las capturas y recibos privados permanecen en el expediente local enlazado por la auditoría interna.
# Ampliación — preparación de corpus, 8 septiembre 2026

NOI-31 está en implementación de snapshot, texto íntegro, checkpoints y actualización incremental en Worker; NOI-78 conserva el descubrimiento incremental posterior, aún pendiente. La evidencia local y la comparación de rendimiento están en [ejecución](./CORPUS_PREPARATION_EXECUTION_2026-09-08.md). UAT conserva65926c0 hasta el nuevo recibo.

Se añadió [NOI-80](https://linear.app/noisia/issue/NOI-80/ss-aplicar-retencion-y-retirada-de-contenido-a-textos-y-manifiestos): ciclo autorizado de retención/retirada de textos y derivados compartidos antes del lanzamiento. La inmutabilidad de checkpoints no debe impedir una retirada autorizada. Ninguna limpieza se ejecuta por registrar esta deuda.
