# 33 — Development roadmap and branch handoff

## Propósito

Dar continuidad a la rama local actual sin perder el foco. Este plan no usa la palabra MVP. Se organiza por secuencias de implementación completas, manteniendo la visión final.

## Estado asumido del working tree local

Según contexto reportado por el usuario, la rama local contiene piezas no commiteadas:

- Live Intelligence Store con `canonical_signals`, `signal_observations`, evidencia y dedup entre lentes.
- Engine multimétodo runtime con 16 metodologías seed, cost ledger, `analysis_plan`, workers `preflight → retrieve → code → score → synthesize → quality_gates` y APIs para lanzar lentes seleccionados.
- Query packs por lente + provenance con `mention_query_sources`, link `import_batch ↔ pack`, materialización y fan-out CSV.
- Live Composer + corte mensual con `signal_composer_edits`, panel mensual, historia de señales, APIs de overview/history/monthly-analysis.
- Corpus vivo conectado a Signal explorer con rango de fechas y facets.
- Wizard multimétodo.
- Chat guards y tests.

Este paquete no puede verificar esos archivos porque están en local, no en remoto. Codex/Claude debe inspeccionar la rama local antes de implementar.

## Nueva prioridad

Pausar expansión funcional de metodologías estratégicas. Mantenerlas, no romperlas, pero no construir más UI alrededor de ellas hasta terminar Signal Pulse.

Prioridad:

1. estabilizar data foundations;
2. consolidar canonical signals y observations;
3. materializar periodos mensuales;
4. crear pipeline propio Signal Pulse;
5. crear navegación y pantallas;
6. crear charts Overview;
7. crear Composer y publish cut;
8. cerrar gates de producción.

## Secuencia A — Audit and alignment

Objetivo: entender qué existe en working tree y mapearlo a esta spec.

Tareas:

- listar migraciones locales 0025+;
- verificar tablas de signals, observations, evidence, composer;
- verificar APIs existentes;
- verificar workers y step order;
- identificar qué parte está atada a metodologías/lentes;
- decidir qué se reutiliza como infraestructura;
- documentar gaps contra este paquete.

Output:

- gap analysis;
- implementation map;
- no-go list;
- risk register.

## Secuencia B — Data foundation

Objetivo: corpus vivo y periodización.

Tareas:

- asegurar period buckets;
- agregar metrics por señal/periodo;
- source coverage mensual;
- source type classification;
- evidence refs por señal;
- live vs published data refs;
- performance evidence path si existe.

Output:

- period metrics listas;
- data_refs para charts;
- coverage warnings.

## Secuencia C — Source Wizard foundation

Objetivo: dejar la capa de fuentes lista para crecer.

Tareas:

- clasificar source types;
- mapping preview;
- validation report;
- source health;
- roles de fuente;
- no convertir todo en mentions.

Output:

- Sources screen base;
- source health data;
- mapping states.

## Secuencia D — Signal Pulse pipeline

Objetivo: proceso propio.

Tareas:

- readiness;
- period materialization;
- signal detection/dedup;
- marketing interpretation prompt;
- chart spec assembly;
- marketing moves;
- quality gates;
- composer handoff.

Output:

- draft Signal Pulse output;
- chart specs;
- evidence packs;
- quality state.

## Secuencia E — Dashboard navigation

Objetivo: pantallas reales.

Tareas:

- crear navegación grouped sidebar;
- Overview;
- Signals;
- Marketing Moves;
- Content & Creative;
- Paid / Organic;
- Competitive & Category;
- Evidence;
- Corpus View;
- Sources;
- Composer;
- Quality / Settings.

Output:

- dashboard funcional con data real o states correctos.

## Secuencia F — Chart system

Objetivo: charts del Overview y charts soporte.

Tareas:

- Impact × Polarity Map con shadcn Chart;
- Signal Momentum Stream;
- Source Coverage strip;
- Semantic Signal Galaxy custom;
- Emotional Density Map overlay;
- tooltips/drawers;
- chart accessibility summaries.

Output:

- Overview chart-first.

## Secuencia G — Composer and publish

Objetivo: corte mensual seguro.

Tareas:

- promover/fusionar/ocultar signals;
- editar copy;
- seleccionar evidence;
- publish cut;
- live vs published diff;
- history;
- rollback.

Output:

- published Signal Pulse client-ready.

## Secuencia H — Production hardening

Objetivo: listo para prod.

Tareas:

- tests de gates;
- role visibility;
- performance;
- source failure states;
- no invented numbers;
- humanizer QA;
- accessibility;
- analytics;
- deploy checklist.

Output:

- go-live checklist passed.

## Riesgos principales

| Riesgo | Mitigación |
|---|---|
| La rama intenta seguir expandiendo metodologías | Pausar UI/metodologías y enfocar Signal Pulse |
| Signal Pulse se vuelve adapter de T&B | Pipeline propio obligatorio |
| Charts bloquean por complejidad | Implementar cartesianos primero, custom con progressive enhancement |
| Source Wizard crece demasiado | Definir source types y mappings primero |
| Corpus queries pesadas | Materializar aggregates |
| Copy se vuelve largo | Humanizer gate + budgets de card |
| Data sensible visible | Role visibility gates |

## Regla final

La rama debe orientarse a publicar un reporte táctico de Marketing usable, no a demostrar que el motor multimétodo funciona por sí mismo.
