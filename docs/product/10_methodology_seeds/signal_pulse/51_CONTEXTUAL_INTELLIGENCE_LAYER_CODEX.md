# 51 — Contextual Intelligence Layer (Codex implementation note)

Fecha: 2026-06-14

## Qué se implementó

Signal Pulse dejó de tratar el corte mensual como análisis aislado. El worker ahora prepara una capa de contexto para que Claude nombre e interprete clusters con:

- knowledge base del estudio/marca (`brand_knowledge_sources`);
- retrieval semántico sobre embeddings cuando hay provider disponible (`semantic_embeddings`, Voyage/OpenAI);
- brief de marketing del wizard (`analysis_plan.marketing_brief`);
- inventario de fuentes estructuradas (`data_sources`);
- performance mensual de la ventana (`performance_records`);
- serie mensual por cluster antes del naming;
- serie semanal por cluster antes del naming cuando hay cobertura suficiente;
- contexto de creativos/performance que matchean el territorio del cluster;
- evidence snippets acotados por cluster.

La detección sigue siendo cluster-first. Claude no codifica menciones una por una; recibe clusters acotados y contexto rico para sintetizar.

## Corte actual vs ventana completa

Signal Pulse ahora separa dos planos:

- **Corte actual:** lo que el reporte mensual debe mostrar por default y lo que define publicación.
- **Ventana completa:** las señales, series mensuales y patrones de los 12 meses para explorar, comparar y explicar por qué algo sí/no debería activarse.

El payload publicado conserva `period_metrics` por señal. Las señales con actividad histórica pueden existir en el payload aunque estén inactivas en el corte actual; el API publicado filtra por el mes más reciente por default para no contaminar el reporte mensual.

El worker también materializa `report_periods` semanales (`granularity='week'`) y pasa `weekly_series`/`weekly_pattern` al naming de Claude. Por ahora las métricas publicables (`signal_period_metrics`, charts y gates de publicación) siguen usando meses para mantener estable el corte mensual; el plano semanal sirve para explicar picos, reactivaciones y caídas dentro del mes.

Para exploración/dashboard, los endpoints publicados aceptan filtros:

- `period=YYYY-MM`, `period=<report_period_id>` o `period=all`
- `platform=facebook|instagram|tiktok|x|youtube|...`
- `signal_type=risk|opportunity|...`
- `lifecycle=new|accelerating|emerging|inactive_in_cut|...`
- `campaign=...`
- `source_type=organic|paid|reviews|search|...`
- `scope=brand|competitor|category|...`
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
- Las señales históricas sin volumen en el corte sirven para patrones de ventana, pero no bloquean publicación por sí mismas.

## Qué NO se cambió todavía

- No se rediseñó el dashboard ni el reporte visual.
- No se agregó todavía UI de filtros por campaña/fuente/plataforma/señal/performance event; sólo quedó listo el contrato API.
- No se cambió la arquitectura de clustering ni se reabrió la decisión cluster-first.
- No se migró a un modelo de causalidad; el prompt exige `no_connection` cuando no hay evidencia para conectar campaña/performance y conversación.

## Validación recomendada

1. Correr Signal Pulse con workers activos y 12 meses de performance estructurada.
2. Confirmar en el ledger evento `sp_rag_context` y eventos `sp_name_signals`.
3. Revisar que las señales publicables no sean keywords crudas como `Seguro`, `Choque`, `Aseguradora`.
4. Revisar que cada señal mencione periodo actual o patrón de ventana cuando sea relevante.
5. Revisar que `performance_connection` no fuerce causalidad.
6. Revisar que los moves salgan del `action_hint` sintetizado, no de plantilla genérica.
