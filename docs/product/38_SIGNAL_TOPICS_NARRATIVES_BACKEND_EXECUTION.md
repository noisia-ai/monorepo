# 38 · Signal Topics & Narratives Backend Execution

> **Estado:** handoff de ejecución backend.
> **Alcance:** Data OS, clasificación, workers, materializaciones y APIs.
> **Fuera de alcance:** UI de Signal, rediseño visual, activación cliente y producción.

## 1. Propósito

Construir el backend canónico de la página viva **Topics & Narratives** de Signal.

La página debe contestar, para cualquier periodo y combinación de filtros:

1. **¿De qué se está hablando?** — topics.
2. **¿Qué historias, afirmaciones o marcos se están construyendo?** — narratives.
3. **¿Cómo cambian contra un periodo comparable?**
4. **¿Qué evidencia original explica cada resultado?**
5. **¿Con qué cobertura, confianza, frescura y lineage puede afirmarse?**

El resultado no puede ser un JSON editorial producido por Claude. Topics, narratives,
sus asignaciones a menciones, sus métricas y su evidencia deben vivir en Postgres y
servirse mediante contratos Data OS. Claude puede clasificar e interpretar; no puede
ser la base de datos ni calcular los números que se muestran.

## 2. Contexto de producto

Signal combina dos ritmos dentro de un mismo workspace de marca:

- **Always-on:** corpus actualizado diaria, semanal o mensualmente; charts y filtros
  consultan la base viva.
- **Estratégico:** estudios como Triggers & Barriers se ejecutan en cortes deliberados,
  se revisan y se publican como releases.

Topics & Narratives pertenece principalmente al ritmo **always-on**. Su enriquecimiento
debe poder ejecutarse después de cada importación sin volver a correr Triggers &
Barriers. Un estudio T&B puede aportar contexto, pero no define ni sustituye la
taxonomía de Topics & Narratives.

Canon relacionado:

- `docs/product/22_NOISIA_DATA_OS_CUT_1.md`
- `docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md`
- `docs/product/32_SIGNAL_BACKEND_EXECUTION_ROADMAP.md`
- `docs/product/34_SIGNAL_BRAND_MONITORING_V1.md`
- `docs/product/35_SIGNAL_FILTERING_ARCHITECTURE.md`
- `docs/product/36_SIGNAL_MONTHLY_INSIGHTS_V1.md`
- `docs/product/37_SIGNAL_WORKSPACE_INFORMATION_ARCHITECTURE.md`
- `docs/adr/008-analysis-artifact-evidence-graph.md`
- `docs/adr/009-signal-always-on-strategic-dashboard.md`

## 3. Estado actual confirmado

El repositorio ya contiene una buena parte de la infraestructura genérica:

- workspaces de Signal estables;
- `SignalFilterV1`;
- catálogo de métricas y materializaciones;
- watermarks, invalidaciones y refresh runs;
- `record_tags`, taxonomías, términos, rulesets, model versions y review events;
- APIs Data OS de bootstrap, series, breakdowns, comparison, facets, mentions,
  lineage, interpretations, metric groups y releases;
- workers de refresh y materialización.

También existen contratos nominales:

- `topic.volume@1`
- `narrative.volume@1`

Sin embargo, el corpus de prueba de Laika todavía no demuestra el producto final:

- no tiene una taxonomía canónica y activa de `topic`;
- no tiene una taxonomía canónica y activa de `narrative`;
- no tiene materializaciones reales de ambos contratos para el workspace;
- la dimensión de narrative todavía se representa ambiguamente como `taxonomy`;
- la navegación legacy `#emerging-patterns` consume un snapshot publicado, no una
  página Data OS viva.

La misión no es crear otro payload. Es cerrar esas brechas.

## 4. Semántica obligatoria

### 4.1 Topic

Un **topic** es el sujeto concreto y recurrente de la conversación: problema, necesidad,
producto, servicio, comportamiento, momento o territorio del que hablan las menciones.

Ejemplos válidos:

- claridad de promociones;
- disponibilidad de producto;
- fallas de registro;
- alimento para gatos castrados;
- donaciones a refugios.

Características:

- nombre corto, estable y entendible;
- normalmente nominal;
- clasificación multi-label;
- debe poder reconocerse en evidencia textual;
- no expresa por sí mismo una conclusión estratégica.

### 4.2 Narrative

Una **narrative** es una afirmación, historia o marco recurrente que conecta sujetos,
causas, valores o consecuencias.

Ejemplos válidos:

- “los descuentos digitales no se respetan en la operación”;
- “la marca ayuda a animales más allá de vender productos”;
- “comprar en línea agrega fricción en vez de conveniencia”;
- “la comunidad premia a las marcas que tratan a las mascotas como familia”.

Características:

- se redacta como proposición verificable en el corpus;
- puede abarcar varias menciones y varios topics;
- es multi-label;
- necesita evidencia y límites explícitos;
- no equivale a sentimiento ni a un resumen generado.

### 4.3 Lo que no es Topic o Narrative

No convertir automáticamente en topic o narrative:

- sentimiento;
- plataforma, fuente, idioma o país;
- entidad, marca o competidor;
- campaña;
- observed signal de una sola mención;
- trigger, barrier o decision layer;
- finding, opportunity o recomendación;
- resumen editorial de Claude.

`trigger`, `barrier`, `tb_layer` y `observed_signal` pertenecen a T&B. Pueden cruzarse
después como dimensiones relacionadas, pero no deben renombrarse ni copiarse como
Topics & Narratives.

### 4.4 Cobertura y “Other”

- `unclassified` es un estado de cobertura, no un término.
- `not_available` es ausencia válida, no cero.
- `Other` solo puede existir como término explícito, revisado y documentado.
- Un término rechazado o pendiente no entra a métricas cliente.

## 5. Principio de cómputo

Aplicar la regla del query engine:

> **Claude interpreta y clasifica; SQL cuenta; Voyage recupera contexto.**

### Determinista en SQL

SQL debe calcular:

- volumen;
- share;
- delta y percent change;
- series temporales;
- cobertura;
- sentimiento por topic/narrative;
- engagement observado;
- coocurrencias;
- distribución por fuentes y demás dimensiones;
- evidencia y reconciliación.

### Claude

Claude puede:

- proponer taxonomías candidatas;
- clasificar menciones contra términos aprobados;
- sugerir fusiones, divisiones o descripciones;
- redactar interpretación editorial a partir de facts gobernados.

Claude no puede:

- inventar conteos, shares, deltas o denominadores;
- publicar directamente términos nuevos;
- reemplazar evidencia con un resumen;
- convertir el corpus en un único JSON;
- hacer que los charts dependan de una llamada LLM en tiempo de lectura.

### Voyage / RAG

Voyage debe usarse para recuperar:

- Brand OS;
- Study OS;
- Brief OS;
- Knowledge Base;
- definiciones y ejemplos de la taxonomía activa;
- evidencia representativa del corpus.

Los hashes y versiones de todo contexto recuperado deben persistirse en lineage.

## 6. Arquitectura objetivo

```text
Importación o sync de menciones
  → revisión/inclusión del corpus
  → watermark + invalidación
  → enrichment job incremental
      → retrieval de contexto versionado
      → clasificación topic/narrative
      → record_tags + score + evidence + model version
      → revisión/promoción según política
  → materializaciones SQL
  → APIs Data OS filtrables
  → Signal Topics & Narratives
```

La lectura de la página no espera a Claude. Consume la última versión materializada y
expone su frescura. Si el enriquecimiento está pendiente, responde `partial` con
cobertura; nunca finge cero ni bloquea todo el reporte.

## 7. Modelo de datos

### 7.1 Reutilizar

Reutilizar como fuente de verdad:

- `taxonomies`
- `taxonomy_terms`
- `taxonomy_term_edges`
- `tagging_rule_sets`
- `tagging_model_versions`
- `record_tags`
- `tag_review_events`
- `signal_data_watermarks`
- `signal_data_invalidations`
- `signal_refresh_runs`
- `metric_materializations`
- `lineage_edges`

No crear tablas paralelas que dupliquen tags, runs, review events o materializaciones.

### 7.2 Perfil activo por workspace

Agregar, si el modelo actual no lo resuelve sin ambigüedad, una relación aditiva
versionada equivalente a `signal_taxonomy_profiles`:

| Campo | Propósito |
|---|---|
| `id` | identidad |
| `workspace_id` | workspace de marca |
| `taxonomy_id` | taxonomía en `taxonomies` |
| `kind` | `topic` o `narrative` |
| `version` | versión monotónica |
| `status` | `draft`, `active`, `retired` |
| `context_hash` | contexto RAG usado para proponerla |
| `rule_set_id` | ruleset de clasificación |
| `model_version_id` | modelo/prompts/versiones |
| `approved_by_user_id` | aprobación humana |
| `approved_at` | fecha de aprobación |
| `metadata` | parámetros no estructurales |
| timestamps | auditoría |

Invariantes:

- máximo un perfil activo por `workspace_id + kind`;
- topics y narratives tienen perfiles separados;
- activar una versión es atómico;
- la versión anterior conserva lineage;
- una nueva versión debe clasificarse y validarse antes de activarse;
- releases estratégicos ya publicados no cambian retroactivamente.

Si se elige otra implementación, debe preservar estas invariantes y documentarse en un
ADR cuando constituya una decisión estructural.

### 7.3 Asignación por mención

Persistir la clasificación en `record_tags`, ligada a:

- la mención original;
- el término;
- corpus/workspace/brand;
- score y confidence;
- evidence;
- source;
- model version;
- review status;
- timestamps.

La llave de idempotencia lógica debe impedir duplicar la misma asignación para:

`mention + taxonomy profile version + term + model/ruleset version`.

## 8. Lifecycle de taxonomía

### Fase A · Discovery

1. Recuperar contexto de KB, Brand OS, Study OS y Brief OS.
2. Muestrear/clusterizar menciones incluidas.
3. Proponer términos, definiciones, ejemplos y exclusiones.
4. Deduplicar candidatos semánticamente.
5. Guardar la propuesta como `draft`.
6. Exigir aprobación humana antes de volverla `active`.

### Fase B · Clasificación

1. Resolver el perfil activo.
2. Recuperar definiciones y ejemplos relevantes.
3. Clasificar menciones nuevas o cambiadas en batches resilientes.
4. Guardar tags, confidence, evidence y lineage.
5. No sobrescribir silenciosamente decisiones humanas.

### Fase C · Evolución

- sugerir términos emergentes sin publicarlos automáticamente;
- registrar merge/split/deprecation;
- versionar el perfil;
- hacer backfill controlado;
- reconciliar antes de activar;
- conservar trazabilidad histórica.

## 9. Enriquecimiento incremental

Topics & Narratives debe ejecutarse de forma independiente a T&B:

1. una importación aceptada incrementa la revisión del corpus;
2. se crea/reutiliza `signal_data_invalidation`;
3. se encola un job idempotente de enrichment;
4. solo se procesan menciones nuevas, modificadas o faltantes para la versión activa;
5. al terminar se invalidan los periodos afectados;
6. el worker de materialización recompone los buckets necesarios;
7. el watermark refleja cobertura y frescura.

Requisitos operativos:

- retries con backoff;
- heartbeats;
- dead-letter;
- recuperación de jobs huérfanos;
- tolerancia a un batch inválido;
- resultados parciales explícitos;
- no duplicados al reintentar;
- `ANALYZE` después de backfills grandes;
- presupuesto y uso LLM persistidos por run.

## 10. Contratos métricos

### 10.1 Contratos base

Implementar y reconciliar:

- `topic.volume@1`
- `narrative.volume@1`

Ambos cuentan **menciones incluidas distintas** con un término aprobado perteneciente
al perfil activo.

### 10.2 Multi-label

Una mención puede tener más de un topic y más de una narrative. Por eso:

- la suma de términos puede exceder las menciones totales;
- el API debe declarar `multi_label: true`;
- no presentar la suma de shares como si debiera ser 100%.

### 10.3 Denominadores obligatorios

Cada respuesta debe distinguir:

- `included_mentions`;
- `classified_mentions`;
- `unclassified_mentions`;
- `tag_assertions`;
- `coverage = classified_mentions / included_mentions`;
- `share_of_included`;
- `share_of_classified`.

Para sentimiento:

- denominador = menciones del término con sentimiento clasificable;
- exponer cobertura de sentimiento aparte.

Para engagement:

- usar solamente componentes observados;
- exponer menciones/posts medidos;
- nunca imputar faltantes entre proveedores.

### 10.4 Comparación

La comparación usa `SignalFilterV1` y una ventana equivalente:

- mismo número de días;
- mismo timezone;
- mismos filtros;
- delta absoluto;
- percent change cuando el baseline lo permite;
- estado explícito si el baseline es cero o no está disponible.

### 10.5 Coocurrencias

Contar menciones distintas que contengan ambos términos aprobados. El endpoint debe
aclarar que coocurrencia no significa causalidad.

### 10.6 Quality states

Usar:

- `ready`
- `partial`
- `not_available`
- `failed`

No exigir una cantidad arbitraria como 1,000 menciones. Ventanas pequeñas son válidas:
se sirven con sample size, cobertura y limitaciones.

## 11. Dimensiones y filtros

Toda métrica, chart y evidencia debe aceptar el mismo `SignalFilterV1`:

- `start`
- `end`
- `timezone`
- `granularity`
- `comparison`
- búsqueda textual;
- platform/source;
- sentiment;
- content type/conversation role;
- language;
- country;
- corpus scope;
- `topic`;
- `narrative`.

Cerrar la brecha actual:

- agregar `narrative` como dimensión canónica;
- conservar `taxonomy` solamente como alias general/legacy compatible;
- `narrative.volume@1` debe usar `narrative`, no depender semánticamente de
  `taxonomy`;
- facets, mentions, materialization y serving deben compartir exactamente el mismo
  contrato.

No usar `LIKE '%topic%'` o `LIKE '%narrative%'` como regla semántica definitiva cuando
pueda resolverse por IDs y perfiles activos.

## 12. APIs

### 12.1 Principio

Las rutas canónicas reciben el `workspaceId` estable. La ruta cliente
`/signal/{workspaceSlug}` resuelve el slug en servidor. No crear una dependencia nueva
de `outputId`.

Reutilizar los endpoints Data OS existentes y agregar solamente una composición
específica cuando reduzca round trips sin duplicar la verdad:

```text
GET /api/data-os/signal/:workspaceId/topics-narratives
GET /api/data-os/signal/:workspaceId/topics-narratives/:kind/:termKey
```

`kind` solo acepta `topic | narrative`.

### 12.2 Overview

Debe devolver, con contrato versionado:

- filtro aplicado y comparación;
- `filters_hash`;
- `data_watermark_hash`;
- freshness y cobertura;
- perfil topic/narrative activo y versiones;
- ranking de topics;
- ranking de narratives;
- current, previous, delta, shares y sample sizes;
- series temporales;
- sentimiento/engagement opcional con sus denominadores;
- coocurrencias/relaciones;
- quality state y limitaciones;
- lineage refs.

Default de ranking: 10. Máximo: 25.

### 12.3 Detail

Debe devolver:

- término, definición y versión;
- volumen/share/delta;
- serie temporal;
- breakdowns solicitados;
- sentimiento y engagement con cobertura;
- términos relacionados;
- evidencia paginada;
- lineage;
- quality state.

La evidencia usa el endpoint de mentions o un adapter común, con máximo 100 registros
por página. Debe enlazar la mención original; nunca sustituirla con prosa generada.

### 12.4 Seguridad

- authN y authZ server-side;
- scoping por organización, brand y workspace;
- no filtrar UUIDs o corpora ajenos;
- no exponer nombres de proveedores de listening al cliente;
- no debilitar guards para facilitar smoke tests.

## 13. Lineage y revisión

Desde cualquier cifra debe poder recorrerse:

```text
métrica
  → materialización
  → term/profile version
  → record_tags aceptados
  → mention_ids
  → source record original
```

Desde cualquier tag:

```text
tag
  → rule/model/prompt version
  → context hash
  → evidence
  → review event
```

Estados `pending` y `rejected` no entran a métricas client-safe. Si existe trabajo
pendiente relevante, la respuesta es `partial` y muestra la cobertura faltante.

## 14. Plan de ejecución

### TN-00 · Audit y contrato congelado

- inventariar implementación real;
- escribir matriz “reutilizar / corregir / agregar”;
- congelar semántica y contratos;
- añadir ADR si el perfil activo requiere una decisión nueva.

### TN-01 · Perfil y versión de taxonomía

- migración SQL forward-only;
- Drizzle schema;
- constraints e índices;
- tests de migración;
- sin regenerar snapshots drifted de Drizzle.

### TN-02 · Discovery y aprobación

- servicio de propuesta de términos;
- RAG versionado;
- persistencia draft;
- aprobación/rechazo humano;
- activación atómica;
- sin UI nueva: exponer servicio/route/operator script mínimo.

### TN-03 · Worker incremental

- job payload e idempotency key;
- clasificación por batches;
- retries/heartbeat/dead-letter;
- tags + evidence + model lineage;
- protección de revisiones humanas;
- uso y costo por run.

### TN-04 · Coverage y promotion

- política de aceptación;
- pending/rejected excluidos;
- cobertura por kind;
- reconciliación antes de activar/backfill;
- emerging candidates separados del producto cliente.

### TN-05 · Materializaciones

- corregir predicates y natural dimensions;
- materializar volumen, series y breakdowns;
- comparison y cooccurrence;
- freshness/invalidations;
- reconcile contra rows.

### TN-06 · Facets y filtros

- dimensión canónica `narrative`;
- paridad entre overview, detail, facets y mentions;
- texto, fechas y dimensiones existentes;
- hashes deterministas;
- ninguna lectura de payload legacy.

### TN-07 · Serving API

- overview;
- detail;
- evidence;
- lineage;
- authZ;
- estados parciales/errores;
- contrato y fixtures.

### TN-08 · Laika staging backfill

- crear propuestas topic/narrative;
- aprobación humana;
- backfill contra corpus real;
- materializar;
- reconciliar;
- evidence pack de staging/preview.

Esta tarjeta requiere:

- credenciales y target real de staging/preview;
- cap USD explícito antes de Claude/Voyage;
- aprobación humana de taxonomías;
- no puede falsificarse con fixtures.

### TN-09 · Gates

- unit/integration tests;
- worker runtime real;
- authZ;
- EXPLAIN ANALYZE;
- índices;
- Data OS staging shadow;
- evidencia de paridad y lineage.

### TN-10 · Handoff

- actualizar canon de esquema y API;
- runbook operativo;
- costos;
- limitaciones conocidas;
- commits temáticos;
- rama limpia y sincronizada, nunca `main`.

## 15. Criterios de aceptación

La misión está completa solo cuando:

1. Laika tiene perfiles activos aprobados de topic y narrative.
2. Existen tags no vacíos, ligados a menciones incluidas y a términos versionados.
3. `topic.volume@1` y `narrative.volume@1` se materializan desde Postgres.
4. Cambiar fechas cambia resultados sin invocar Claude.
5. Todos los filtros afectan métricas, charts y evidencia de forma consistente.
6. El conteo de un término reconcilia exactamente con sus mention IDs.
7. Multi-label y denominadores están declarados.
8. Pending/rejected quedan fuera y producen cobertura parcial cuando corresponde.
9. Una importación nueva dispara enrichment incremental y rematerialización sin correr
   T&B.
10. Un fallo de Claude no rompe las últimas métricas válidas.
11. Retries no duplican tags ni materializaciones.
12. Lineage llega hasta la mención original y la versión de clasificación.
13. No se lee `published_outputs.payload` ni `chart_aggregates` como fuente.
14. No existe un gate artificial por cantidad mínima de menciones.
15. AuthZ impide leer otro workspace.
16. Staging/preview produce evidence pack real.

## 16. Pruebas mínimas

### Database

- constraints de un perfil activo;
- forward-only migration;
- idempotencia;
- índices;
- cascade/set-null intencionales.

### Query engine

- topic y narrative volumes;
- multi-label;
- denominadores;
- comparison;
- baseline cero;
- coocurrencia;
- pending/rejected;
- filtros;
- granularidades/timezone.

### Workers

- import → classify → invalidate → materialize;
- retry;
- dead-letter;
- stale job recovery;
- partial batch;
- protección de review humano;
- budget stop.

### Studio API

- authZ y ownership;
- overview/detail;
- filter parity;
- pagination;
- facets;
- evidence reconciliation;
- freshness/lineage;
- error contracts.

### Runtime

- corpus Laika staging/preview;
- worker real;
- Postgres real;
- EXPLAIN ANALYZE;
- materialization reconcile;
- no payload fallback.

## 17. Gates de entrega

Ejecutar, como mínimo:

```bash
corepack pnpm --filter @noisia/db typecheck
corepack pnpm --filter @noisia/db test
corepack pnpm --filter @noisia/query-engine typecheck
corepack pnpm --filter @noisia/query-engine test
corepack pnpm --filter @noisia/workers typecheck
corepack pnpm --filter @noisia/workers test
corepack pnpm --filter @noisia/studio typecheck
corepack pnpm --filter @noisia/studio test
corepack pnpm --filter @noisia/studio build
corepack pnpm data-os:verify
```

Y, solamente con valores reales aprobados:

```bash
corepack pnpm data-os:staging-check
corepack pnpm data-os:staging-shadow
```

No declarar completado si el release gate no contiene evidencia real de staging/preview.

## 18. Guardrails

- No frontend ni UI de Topics & Narratives.
- No producción ni activación cliente.
- No PR o push a `main`.
- No migraciones destructivas.
- No borrar o modificar la compatibilidad de `published_outputs.payload`.
- No introducir Kinde middleware ni debilitar authZ.
- No correr Claude/Voyage sin un cap USD explícito en la tarea que ejecuta el gasto.
- No asumir que cambios preexistentes del worktree pertenecen a esta misión.
- No hacer commits con archivos ajenos.

## 19. Entrega esperada al siguiente chat

El chat ejecutor debe entregar:

- audit inicial;
- arquitectura final y decisiones;
- migraciones;
- servicios/workers;
- materializaciones;
- APIs;
- tests;
- evidencia runtime;
- gasto LLM real, si fue autorizado;
- commits y SHAs;
- blockers exactos;
- estado honesto: completo, local-complete/runtime-blocked o no completo.
