# 51 — Contextual Intelligence Layer (Codex implementation note)

Fecha: 2026-06-14

## Qué se implementó

Signal Pulse dejó de tratar el corte mensual como análisis aislado. El worker ahora prepara una capa de contexto para que Claude nombre e interprete clusters con:

- knowledge base del estudio/marca (`brand_knowledge_sources`);
- retrieval semántico sobre knowledge base cuando hay provider disponible (`semantic_embeddings`, Voyage/OpenAI);
- retrieval semántico sobre menciones del corpus (`scope_type='mention'`) para que Claude vea conversación relacionada más allá de los 6 snippets iniciales;
- brief de marketing del wizard (`analysis_plan.marketing_brief`);
- inventario de fuentes estructuradas (`data_sources`);
- performance mensual de la ventana (`performance_records`);
- mapa mensual de actividad de marketing (`marketing_activity_window`);
- lenguaje/claims repetidos en piezas, campañas u objetivos (`repeated_marketing_language`);
- serie mensual por cluster antes del naming;
- serie semanal por cluster antes del naming cuando hay cobertura suficiente;
- campañas/creativos/performance activos en los periodos donde vive el cluster;
- eventos de performance calculados por delta contra el periodo previo;
- contexto de creativos/performance que matchean el territorio del cluster;
- evidence snippets acotados por cluster, con `mention_id` visible para Claude.

La detección sigue siendo cluster-first. Claude no codifica menciones una por una; recibe clusters acotados y contexto rico para sintetizar.

El pre-run ahora también valida que el RAG esté listo. Al aprobar un corpus, Studio encola `embed_corpus_semantics` en modo `all`; el launch plan y `sp_readiness` bloquean Signal Pulse si hay menciones SP pero todavía no existen embeddings de menciones. Si hay knowledge sources procesadas, también bloquea si faltan embeddings de KB. Esto evita volver al fallback de keywords cuando la cola semántica aún no termina.

`review_mode=deep_read` ya no abre un camino alterno: se normaliza a `cluster_first`. La lectura profunda debe venir del flujo normal con KB + embeddings + ventana completa, no de un parche opcional.

El contrato mental queda explícito: Signal Pulse es una capa de inteligencia sobre 12 meses de actividad de marketing, performance y conversación; el reporte mensual es sólo una vista publicable. Si se cargan 12 meses, el sistema debe explotarlos para detectar repetición, saturación, reactivaciones, anomalías, ausencia de recepción, señales emergentes y conexiones/no-conexiones con acciones de marketing.

Signal Pulse no es una versión light de Triggers & Barriers. Puede reutilizar el músculo cualitativo de Noisia (KB, RAG, contexto de marca, lenguaje del usuario y síntesis editorial), pero la promesa comercial es distinta: aplicar una capa de inteligencia sobre lo que el cliente publicó, pautó, midió y observó alrededor. El cliente ya puede tener dashboards de social, listening de crisis o performance; Noisia debe decir qué aprendió de la relación entre campaña, industria, marca, competencia, búsqueda/reviews/ecomm cuando existan, y conversación viva.

Por eso el pre-run ahora exige **knowledge context**: al menos knowledge base procesada o un brief de marketing suficientemente lleno. Un objetivo suelto como "defender presupuesto de pauta" no basta. Sin KB, el brief debe aportar varias señales accionables (por ejemplo objetivo + campañas/territorios activos + claims permitidos/prohibidos + audiencias + fechas o eventos clave). Studio lo muestra en el checklist de corrida y `sp_readiness` lo bloquea con `missing_knowledge_context`.

La lectura correcta es:

- usar performance/brief como mapa de investigación, no como texto libre;
- buscar conversación alrededor de campañas, caídas, picos, claims repetidos y fechas clave;
- analizar mes a mes y también la ventana completa;
- publicar un corte mensual filtrable sin perder patrones históricos;
- no contar nada si no hay evidencia suficiente;
- no vender causalidad si sólo hay coexistencia temporal.

## Corte actual vs ventana completa

Signal Pulse ahora separa dos planos:

- **Corte actual:** lo que el reporte mensual debe mostrar por default y lo que define publicación.
- **Ventana completa:** las señales, series mensuales y patrones de los 12 meses para explorar, comparar y explicar por qué algo sí/no debería activarse.

El payload publicado conserva `period_metrics` por señal. Las señales con actividad histórica pueden existir en el payload aunque estén inactivas en el corte actual; el API publicado filtra por el mes más reciente por default para no contaminar el reporte mensual.

El worker también materializa `report_periods` semanales (`granularity='week'`) y pasa `weekly_series`/`weekly_pattern` al naming de Claude. Por ahora las métricas publicables (`signal_period_metrics`, charts y gates de publicación) siguen usando meses para mantener estable el corte mensual; el plano semanal sirve para explicar picos, reactivaciones y caídas dentro del mes.

Para evitar que el cruce dependa sólo de keywords, cada cluster recibe también:

- `period_campaigns`: campañas, ads o piezas con pauta/performance en los meses donde el cluster estuvo activo.
- `performance_events`: cambios estructurados de spend, impressions, clicks, engagement y CTR contra el mes previo.
- `matching_creatives`: creativos cuyo texto sí matchea el territorio del cluster.
- `knowledge_matches`: chunks de KB recuperados semánticamente con el query del cluster + brief + actividad de marketing.
- `conversation_matches`: menciones relacionadas recuperadas por embeddings, con `mention_id`, plataforma, fecha, periodo y similitud.
- `investigation_brief`: síntesis pre-LLM del caso por cluster, separando corte actual, patrón de ventana, picos semanales, intersecciones de marketing/performance y mapa de evidencia.

Claude debe usar estos datos para interpretar o descartar conexión; no puede declarar causalidad si la evidencia no lo sostiene.

Además, el contexto global de la corrida incluye:

- `marketing_activity_window`: meses con performance, canales, objetivos, top campañas/piezas y ejemplos de creative text.
- `repeated_marketing_language`: frases de 2-4 tokens repetidas en creativos/campañas/objetivos a lo largo de la ventana, con meses, gasto, impresiones, engagement y ejemplos.

Esto permite detectar casos como "la marca lleva 5 meses empujando el mismo claim" o "la pauta habla de confianza pero la conversación pide claridad" sin convertir performance en mentions ni pedirle a Claude que invente números.

Los snippets que llegan al naming incluyen `id`, `text`, `platform` y `published_at`. El prompt exige que `evidence_basis` cite sample ids/periodos usados, para que la lectura cualitativa quede trazable contra evidencia real y no sólo contra paráfrasis del modelo.

La query semántica ya no se arma sólo con `term`. Incluye título provisional, samples, brief de marketing, lenguaje repetido y últimos meses de actividad para recuperar contexto útil de marca/campaña/conversación. La keyword provisional sólo identifica el cluster; el prompt le prohíbe a Claude convertirla en título.

`matching_creatives` ya no sale de `LIKE '%keyword%'`. El worker carga performance_records de los meses activos del cluster y rankea campañas/piezas contra:

- snippets con `mention_id`;
- conversation_matches semánticos;
- knowledge_matches/brief;
- repeated_marketing_language;
- periodo activo y plataforma como señales débiles.

Cada match llega con `relevance_score`, `match_basis` y `matched_terms`. `evidence_overlap`, `knowledge_or_brief_overlap` y `repeated_marketing_language_overlap` habilitan hipótesis de conexión; `same_active_period` por sí solo sólo significa coexistencia temporal y debe terminar en `performance_connection=no_connection` si no hay evidencia adicional.

El nuevo `investigation_brief` evita que Claude tenga que descubrir la estructura del caso desde tablas crudas. Por cluster incluye:

- `current_cut`: volumen, delta, lifecycle, sentimiento y mix de fuentes del corte publicable.
- `window_pattern`: patrón completo de la ventana.
- `weekly_pattern` y `weekly_pulses`: picos o caídas dentro del mes.
- `strongest_periods`: meses con más tracción.
- `marketing_intersections`: campaña/performance/match por periodo, con basis explícita.
- `evidence_map`: sample ids, semantic mention ids y títulos de KB.
- `synthesis_questions`: preguntas editoriales para decidir si la señal es fricción, oportunidad, riesgo creativo, territorio saturado, claim a testear, gap de pauta o no publicable.

Cada señal sintetizada persiste `context_summary` en `canonical_signals.dimensions`:

- `samples`
- `conversation_matches`
- `knowledge_matches`
- `period_series_points`
- `weekly_series_points`
- `strongest_periods`
- `weekly_pulses`
- `marketing_intersections`
- `evidence_sample_ids`
- `semantic_evidence_ids`
- `active_performance_months`
- `period_campaigns`
- `performance_events`
- `matching_creatives`
- `current_period`, `current_volume`, `active_periods`, `lifecycle_state`

Ese resumen deja auditable si la señal publicable salió del flujo rico de inteligencia o de una lectura débil.

Cada señal sintetizada guarda ahora `analysis_scope` en `canonical_signals.dimensions`:

- `current_cut`: la señal vive principalmente en el corte mensual publicable.
- `window_pattern`: la señal nace de un patrón de varios meses, aunque el corte actual sea sólo una parte.
- `mixed`: la señal importa por el corte actual y por cómo se comporta en la ventana.

Esto deja un ancla para el dashboard filtrable y evita que el sistema trate todo como lectura de "último mes".

Para exploración/dashboard, los endpoints publicados aceptan filtros:

- `period=YYYY-MM`, `period=<report_period_id>` o `period=all`
- `platform=facebook|instagram|tiktok|x|youtube|...`
- `signal_type=risk|opportunity|...`
- `lifecycle=new|accelerating|emerging|inactive_in_cut|...`
- `campaign=...`
- `source_type=organic|paid|reviews|search|...`
- `scope=brand|competitor|category|...`
- `analysis_scope=current_cut|window_pattern|mixed`
- `performance_event=...`
- `move_type=...`
- `status=...`
- `q=...`

Esto deja listo el backend para un dashboard filtrable sin cambiar todavía el UI.

## Archivos principales

- `services/workers/src/workers/signal-pulse-rag-context.ts`
  - Construye contexto de marketing, KB, RAG, performance y series mensual/semanal por cluster.
- `services/workers/src/workers/signal-pulse-prompts.ts`
  - Prompt puro de naming Signal Pulse, testeable sin DB.
- `services/workers/src/workers/signal-pulse-steps.ts`
  - Conecta el contexto al paso `sp_name_signals`, registra costo RAG y persiste `signal_role`, `performance_connection`, `evidence_basis`, `confidence_rationale`.
- `services/workers/src/workers/signal-pulse-budget.ts`
  - Agrega reserva de costo para contexto RAG.
- `apps/studio/src/app/studio/corpora/[id]/analysis/[analysisId]/page.tsx`
  - Review ya no bloquea por menos de 3 señales si existe al menos una señal publicable; sigue bloqueando si hay 0.
- `apps/studio/src/lib/signal-pulse/pulse-api.ts`
  - Agrega filtros publicados por periodo, plataforma, señal, lifecycle, move, status y búsqueda.
- `apps/studio/src/app/api/corpora/[id]/engine-analysis/[analysisId]/signal-output/route.ts`
  - Publica `period_metrics` por señal y conserva señales con actividad histórica para exploración de ventana.

## Taxonomía frontstage

El prompt ya no usa Triggers & Barriers como lenguaje. La salida debe usar taxonomía Signal Pulse:

- Fricción
- Oportunidad
- Riesgo creativo
- Territorio saturado
- Claim a testear
- Señal emergente
- Gap de pauta
- Contención
- Monitoreo

Los prefijos `Barrera:` y `Trigger:` quedan tratados como no publicables en Review/gates.

## Gates ajustados

- `current_cut_signal_presence` bloquea sólo con 0 señales publicables en el corte actual.
- El objetivo editorial de 3 señales sigue vivo, pero no es bloqueo técnico automático.
- `signal_actionability_review` ya no falla por backlog de señales en `needs_human_review`; falla si una señal marcada como `publish_candidate` conserva naming débil/no publicable.
- `contextual_synthesis_complete` bloquea si una señal publicable no viene de `claude_cluster_naming_v3_signal_pulse_rag` o no trae `marketing_read`, `action_hint`, `evidence_basis`, `confidence_rationale`, `signal_role` y `analysis_scope`.
- `semantic_context_used` bloquea si una señal publicable no tiene samples suficientes, RAG semántico de conversación/KB, serie de periodo y performance activa asociada.
- `signal_intelligence_case` bloquea si una señal publicable no trae `investigation_brief` materializado en `context_summary`: periodos fuertes, serie semanal, pulsos semanales, intersecciones de marketing/performance, evidence ids y preguntas de síntesis.
- `performance_connection_qualified` bloquea si `performance_connection` no empieza con `connected:`, `no_connection:` o `insufficient_data:`, o si declara `connected:` sin overlap directo (`evidence_overlap`, `knowledge_or_brief_overlap` o `repeated_marketing_language_overlap`) en los matches de marketing.
- `traceable_evidence_basis` bloquea si una señal publicable no cita al menos un `mention_id` real en `evidence_basis`.
- Las señales históricas sin volumen en el corte sirven para patrones de ventana, pero no bloquean publicación por sí mismas.
- `sp_readiness` bloquea la corrida antes de gastar si no hay `knowledge_sources > 0` ni al menos dos señales sustantivas de brief (`missing_knowledge_context`).

## Marketing moves

Los `marketing_moves` ya no se derivan sólo de lifecycle/impact. El materializador pasa a `buildSignalPulseMarketingMove` las dimensiones que salen del naming:

- `signal_role`
- `performance_connection`
- `evidence_basis`
- `confidence_rationale`

Con eso, una señal de `paid_gap` produce una acción para Paid media + Creative, una de `creative_risk` no se amplifica automáticamente aunque tenga impacto alto, una de `saturation` pide ángulo alterno y una con `performance_connection=no_connection` bloquea vender causalidad de campaña. El move debe decir qué medir y qué no hacer con base en la evidencia, no con base en la keyword.

## Qué NO se cambió todavía

- No se rediseñó el dashboard ni el reporte visual.
- No se agregó todavía UI de filtros por campaña/fuente/plataforma/señal/performance event; sólo quedó listo el contrato API.
- No se cambió la arquitectura de clustering ni se reabrió la decisión cluster-first.
- No se migró a un modelo de causalidad; el prompt exige `no_connection` cuando no hay evidencia para conectar campaña/performance y conversación.
- No se agregó un modo "deep read"; el producto debe ser profundo por default cuando la cobertura semántica está lista.

## Validación recomendada

1. Correr Signal Pulse con workers activos y 12 meses de performance estructurada.
2. Confirmar antes de correr que el launch plan trae `semanticMentionEmbeddings > 0` y, si hay KB procesada, `semanticKnowledgeEmbeddings > 0`.
3. Confirmar que el launch plan marca `Knowledge context` como aprobado: KB procesada o brief suficiente.
4. Confirmar en `sp_readiness` que no aparecen `missing_knowledge_context`, `missing_semantic_mention_embeddings`, `missing_semantic_knowledge_embeddings` ni `missing_embedding_provider`.
5. Confirmar en el ledger evento `sp_rag_context` y eventos `sp_name_signals`.
6. Revisar que las señales publicables no sean keywords crudas como `Seguro`, `Choque`, `Aseguradora`.
7. Revisar que cada señal mencione periodo actual o patrón de ventana cuando sea relevante.
8. Revisar que `performance_connection` no fuerce causalidad.
9. Revisar que `analysis_scope` distinga corte actual vs patrón de ventana.
10. Revisar que `sp_rag_context` registre `marketing_activity_months` y `repeated_marketing_language` > 0 cuando haya performance/creativos.
11. Revisar que los eventos `sp_name_signals` registren `knowledge_matches` y/o `conversation_matches` > 0 cuando haya embeddings.
12. Revisar que `context_summary` esté persistido en cada señal publicable.
13. Revisar que `evidence_basis` cite sample ids reales cuando Claude haya aplicado naming.
14. Revisar que los moves salgan del `action_hint`, `signal_role` y `performance_connection`, no de plantilla genérica.
