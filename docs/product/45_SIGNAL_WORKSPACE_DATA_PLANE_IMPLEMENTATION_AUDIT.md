# Signal workspace-owned data plane — implementation audit

Fecha de corte: 2026-08-03
Rama inspeccionada: `codex/noisia-data-os-cut-1-wip`
HEAD inspeccionado: `b2637b3`
Merge-base con `main` local: `904c4ba`
Merge-base con `codex/signal-pulse`: `e329136`

Este documento registra implementación observada, no intención. `main` local estaba
cinco commits detrás de `origin/main`; por lo tanto **no equivale a Producción**.

## 1. Capas encontradas

### Baseline heredado / Engine

Antes de `e329136`, la ejecución real era:

`brand/theme → study_corpora → query/import → mentions → snapshot → analysis → published_output`.

Engine T&B ya tenía piezas que deben conservarse: query packs, import batches,
`mention_query_sources`, inclusión/exclusión, revisión de corpus, snapshots relacionales,
coding, jerarquía, evidence, quality gates, Review y publicación. En esa capa
`study_corpus_id` significa simultáneamente ownership, ejecución y autorización.

### Data OS / Signal comprometido en la rama

`e329136..b2637b3` agrega catálogo/lineage, artifact graph, workspaces,
refresh/watermarks, materializaciones SQL, releases estratégicos, perfiles TN y las
fachadas Signal V2. Conserva `published_outputs.payload` sólo como fallback.

### WIP local no comprometido al iniciar este corte

El worktree contenía, entre otros, frontend Signal V2 adicional, T&B serving,
TN insights, ADR 014 y docs 38/41–44. Se preservó: no hubo reset, stash, checkout ni
reformateo general. Los cambios de este corte se montan sobre esa implementación.

### Producción observada

El navegador autenticado alcanzó `https://studio.noisia.ai/` y leyó el título
`Noisia Studio`; la política de seguridad del navegador bloqueó lecturas posteriores
del dominio. No se observó build/commit ni se recorrió el flujo. Ninguna afirmación de
Prod en este documento se infiere desde `main`, screenshots o docs.

## 2. Auditoría de `study_corpus_id`

| Superficie | Uso encontrado antes de 0059 | Semántica real | Decisión de migración |
|---|---|---|---|
| `mentions.study_corpus_id` | NOT NULL; filtros, dedup, serving y authZ | ownership heredado + execution scope | se conserva nullable como provenance; `workspace_id` + canonical root pasan a ownership |
| `import_batches.study_corpus_id` | NOT NULL; upload y query provenance | ownership heredado + ejecución | se conserva nullable; `workspace_id`, `data_source_id` y `contributed_by_study_corpus_id` son explícitos |
| `data_sources.study_corpus_id` | nullable pero todos los 19 locales estaban ligados a corpus | ownership operativo accidental | `workspace_id` obligatorio; corpus queda provenance/compatibilidad |
| `source_sync_runs` | ownership indirecto por `data_sources` | provenance de fuente | `workspace_id` explícito y validado contra source |
| query iterations/packs | siempre por corpus | execution scope | se conserva; no es canonical ownership |
| `mention_query_sources` | mention + corpus + pack | provenance/membership de ejecución | se conserva; se suma `signal_mention_study_memberships` para data compartida |
| inclusión/exclusión | columnas de mention y acciones por corpus | QA/acceptance heredada | se conserva; población cliente exige canonical + included + scope permitido |
| corpus revision | incrementa por upload/cleanup | watermark de ejecución | se conserva en dual-write; workspace obtiene watermark independiente |
| `signal_workspace_corpora` | operational/strategic/legacy; un operational activo | compatibilidad + execution routing | ya no define ownership ni identidad de página T&B |
| migration 0056 | crea workspace después del corpus y adjunta cada T&B como página | compatibilidad superseded | brand creation crea workspace antes del estudio; navegación agrupa todas las corridas bajo `report_key` |
| `requireOperationalCorpus` | bloqueaba context y serving si no había corpus | dependencia heredada en lectura operacional | eliminado de home, Monitoring, Mentions y TN overview/detail/evidence/lineage; permanece en Review/generación TN y T&B legacy, fuera del reader Fase 4 |
| `signal_data_watermarks` | workspace + corpus + source key | freshness corpus-scoped | 0059 permite corpus null; Fase 4 emite identidad de población o corpus, nunca ambas |
| materializaciones y refresh | workspace + corpus; predicates por corpus | serving compatibility | 0060 agrega scope exclusivo de población y jobs population-aware; 0061 invalida en transiciones reales de membership; filas legacy siguen legibles |
| Brand Monitoring | `requireOperationalCorpus`; menciones included del corpus | dependencia que debía desaparecer | home, coverage, comparison, métricas, series, breakdowns, facets, freshness e interpretations resuelven el read scope compartido |
| Mentions | drill-down por corpus y mention estable | dependencia compatible temporal | initial load/API/paginación/search/order/detail usan read scope; governed deduplica raíces y los aliases navegan a la raíz |
| Topics & Narratives | profile workspace, assignments validados contra corpus operational | enrichment reusable con population heredada | overview/detail/evidence/lineage/shares/series/sentiment usan read scope; tags alias se unen por canonical ID |
| T&B | análisis y artifacts por corpus; snapshot relacional | execution + frozen snapshot membership | se conserva Engine; release identity cambia a workspace + report key |
| `signal_workspace_current_releases` | PK sólo workspace | identidad insuficiente | se conserva dual-read; nuevo puntero composite `(workspace_id, report_key)` |
| `record_tags` | subject mention, profile/model/review/TB analysis | enrichment persistido | se conserva; no se recrea store TN/T&B paralelo |
| `corpus_snapshots` / `corpus_snapshot_mentions` | snapshot de IDs por corpus | frozen membership correcto | se agregan population/version/hash/period/watermarks; no payload JSON |
| authZ Studio | `getCorpusForUser`/`canManageCorpus` | autorización heredada | source APIs resuelven workspace + brand access y exigen manage; triggers bloquean cross-workspace |
| public/reporting API | output/corpus y manifest relacional | compatibilidad publicada | no se cambia ni se lee payload como serving nuevo |
| backfill/staging scripts | IDs corpus/output obligatorios | evidence gate heredado | 0059 sólo tiene backfill local/migración; no se escribió staging/Prod |

## 3. Evidencia local antes de 0059

- 5 marcas activas; 3 tenían workspace y 2 no.
- 10 corpora; los 10 tenían una membership activa y ninguno estaba en dos workspaces.
- 18,996 mentions, 24 imports y 19 sources.
- 211 `text_hash` aparecían en más de un corpus: duplicación histórica real.
- Laika, included por scope: category 29, competitor 502, primary_brand 192 y 6
  unknown. Monitoring mostraba ejemplos de competidor/categoría dentro del total.
- No había releases ni current pointer T&B en la DB local observada.

## 4. Contrato implementado en 0059

```text
Organization + Brand
→ Signal workspace (misma transacción)
→ workspace source / import / sync
→ canonical mentions (una raíz por workspace + text/provider record)
→ explicit attribution + reusable enrichment
→ governed operational population
→ relational snapshot IDs + source watermarks
→ strategic analysis run / Review
→ immutable release revision
→ current pointer by (workspace_id, report_key)
```

Aliases históricos no se borran: apuntan a `canonical_mention_id`. Ingesta nueva usa
`ON CONFLICT DO NOTHING` sobre claves canónicas del workspace y adjunta provenance al
registro raíz. `signal_mention_import_memberships` conserva cada observación del
registro raíz por import, incluyendo duplicados posteriores, y
`signal_mention_study_memberships` conserva la contribución opcional del estudio. No
se crea un corpus oculto para una marca sin estudio.

La aplicación de schema usa `db:apply:signal-workspace-data-plane`: exige target de
escritura seguro, aprobación explícita, lock transaccional y verificación posterior.
Rechaza estados parcialmente aplicados y no se ejecuta automáticamente contra remoto.

### 4.1 Invariantes semánticas cerradas

- El scope del import se deriva de `data_sources.governed_scope`; la ruta y el worker
  no aceptan un override. La función SQL ignora campos legacy contradictorios del
  batch y materializa provenance de la fuente.
- Una aparición deduplicada ejecuta `record_signal_mention_import_provenance` sobre la
  raíz canónica. Cada source/import conserva membership y attribution propias.
- La población se reconcilia en insert/update/delete de attribution y en cambios de
  inclusión, calidad, periodo o raíz canónica. `rejected` y `pending` dejan de ser
  elegibles aunque antes hubieran estado incluidos.
- Una fuente con scope gobernado no puede limpiarlo a `NULL` (`23514`). Invalidar su
  review a `pending`/`rejected` actualiza todas sus attributions gobernadas a un
  estado no elegible, elimina approval provenance y reconcilia las memberships en la
  misma transición.
- Un current pointer no puede apuntar a una definición retirada. El retiro directo
  falla con `23514`; `promote_signal_workspace_population` bloquea el puntero y ambas
  definiciones, desactiva memberships viejas, retira/activa, mueve el puntero y
  reconcilia en una sola transacción. Un fallo intermedio revierte toda la operación.
- El shadow separa `legacy accepted rows`, `distinct mentions` y `canonical
  identities`; una reducción esperada por dedup no produce un falso mismatch.
- El shadow conserva dos estados independientes: `comparison` demuestra igualdad de
  membership canónica; `module_serving_shadow` ejecuta los paths/adapters reales de
  Monitoring, Mentions y TN. El primero nunca promueve artificialmente el segundo.
- Mentions compara el set completo mediante hash SQL canónico. El reader conserva su
  límite de página de 100. El shadow durable usa el hash SQL completo como identidad
  del conjunto y muestrea la primera página y la página/cursor solicitados; no pagina
  hasta 20,000 IDs dentro de cada request HTTP.
- Una transición real de membership (`1→0`, `0→1` o eliminación) marca stale las
  materializaciones population-scoped e inserta una invalidación durable en la misma
  transacción. Cambiar sólo el reason sin cambiar elegibilidad no invalida.
- Tags TN históricos ligados a una fila alias no se borran ni duplican. Predicates,
  materialización, overview y evidence los resuelven por `canonical_mention_id`; la
  evidencia devuelve siempre la raíz estable.
- `create_signal_workspace_population_snapshot` congela IDs, definición, periodo y
  watermarks. El Engine T&B consume esa membership sin volver a filtrar por el corpus
  legacy de la mención.
- La identidad T&B es `(workspace_id, report_key)`. Las corridas publican revisiones
  append-only y sólo mueven el current pointer; no crean navegación ni reemplazan un
  release anterior.

## 5. Evidencia Postgres desechable observada

Se ejecutó un PostgreSQL 16 local con la imagen `pgvector/pgvector:pg16`. La suite
creó un schema vacío, aplicó `0000–0058`, insertó fixtures pre-0059 con dos
organizaciones, dos marcas, varios corpora, imports, scopes y duplicados, y aplicó
`0059–0061`. Resultado: **14/14 tests pasaron** (suite principal más 13 subtests).

Conteos SQL observados:

| Check | Resultado observado |
|---|---|
| Fixture pre-0059 | 2 marcas; 2 workspaces; 114 filas mention; 112 included; 111 textos included distintos; topic aprobado ligado a alias |
| Backfill 0059 | 114 filas legacy; 113 registros/identidades canónicas; 114 import memberships; 114 attributions; 107 memberships operacionales |
| Brand sin estudio | 1 workspace; 1 población; 1 registry T&B; 0 studies |
| Dedup directo | 1 canonical mention; 2 import memberships; 2 attributions; 2 scopes |
| Denominador primario | 1 included; competitor/category/reference/unattributed/pending/rejected/excluded fuera del set primario |
| Fuente fail-closed | clear scope bloqueado con `23514`; 2 attributions rechazadas; memberships activas `1→0→1` al rechazar/reaprobar source review |
| Invalidación por membership | `1→0`: membership 0, 1 materialización stale y 1 invalidación; `0→1`: membership 1 y 1 invalidación nueva |
| Lifecycle población | versión current `2 active`; anterior `retired`; memberships activas anterior/nueva `0/1`; retiro directo current bloqueado con `23514` |
| AuthZ / integridad | escritura cross-org bloqueada con SQLSTATE `23514`; consulta no autorizada devolvió 0 filas |
| Snapshot/release | snapshot 1→1 después de nueva ingesta; release anterior 1→1; revisiones T&B `1,2`; current revision `2`; 1 enrichment reusable canónico |
| Population shadow por identidad | legacy primary rows/canonical 107; governed 107; missing 0; additional 0; `state=exact` |
| Mentions >100 | legacy `110` y governed `107`; hash SQL completo; páginas `100+10` y `100+7`; overlap `0`; ambos cursores válidos |
| Alias enrichment TN | 1 assignment topic histórico resuelto desde alias; overview/evidence governed 1; evidence navega al canonical root |
| Legacy explicado | 3 legacy-only: category 1, reference 1, unattributed 1; unexplained 0 |
| Gate gobernado | contract violations 0; checks Monitoring/Mentions/TN true; `state=correct_with_explained_legacy_differences`; `gate_passed=true`; parity legacy false |

Además se ejecutó el flujo real de ingestión de Studio sobre la misma clase de DB:
primer import `record=1/included=1/duplicate=0`; reimport
`record=1/duplicate=1`; import desde fuente competitor `duplicate=1`. SQL final:
1 canonical mention, 3 imports, 3 import memberships, 3 attributions, 2 scopes,
1 membership operacional y 0 studies.

### 5.1 Population shadow exact

El resolver de membership devolvió `state=exact` y `reconciled=true`: legacy primary
accepted rows `107`, identidades canónicas `107`, governed records `107`, missing `0` y
additional `0`. Este resultado demuestra la igualdad del set primario deduplicado;
no demuestra por sí solo igualdad de serving.

### 5.2 Module serving correcto con diferencias legacy explicadas

La misma ejecución invocó consultas específicas, no el conteo compartido tres veces:

- Brand Monitoring ejecutó el adapter de conversation window/series: legacy `110`,
  governed `107`; el set/series governed coincide con el baseline SQL independiente.
- Mentions ejecutó `loadSignalMentionsV1` y un hash SQL sin límite: legacy `110`,
  governed `107`. El population shadow separado recorrió `100+10` y `100+7` para
  validar cursores; el module outbox valida la primera página y la página/cursor
  solicitados sin recorrer el conjunto completo dentro de cada request.
- Topics & Narratives ejecutó el adapter de assignments aprobados usado por overview:
  legacy `110`, governed `107`; hashes topic/narrative coinciden con el baseline
  governed. Un topic aprobado pre-0059 ligado al alias se resolvió una vez sobre la
  raíz, y evidence devolvió el canonical mention ID.

Las tres filas adicionales de legacy son exactamente category `1`, reference `1` y
unattributed `1`. No pertenecen al denominador primario. El gate reportó
`unexplained_count=0`, `governed_correct=true`, `gate_passed=true` y
`parity_with_legacy=false`. Esto significa corrección gobernada con diferencias
explicadas, no paridad ciega. No se realizó cutover.

## 6. Fase 4A — operational serving `primary_brand` local

Una sola abstracción, `resolveSignalOperationalReadScopeV1`, se ejecuta después de
authZ y resuelve workspace, modo, current population/version/hash, corpus legacy sólo
cuando aplica y el predicate canónico. La única configuración es
`NOISIA_SIGNAL_OPERATIONAL_READ_MODE`:

- `legacy` es el default y sirve el corpus operational/legacy sin tocar el reader
  gobernado;
- `shadow` conserva exactamente el payload legacy visible y sólo inserta una solicitud
  compacta en un outbox PostgreSQL; los adapters gobernados reales de Monitoring,
  Mentions y TN se ejecutan post-response;
- `governed` sirve el current pointer `primary_brand`; población ausente, retirada,
  cross-workspace o con scopes mezclados falla cerrado sin fallback.

El navegador nunca elige `population_id`. En governed se rechaza
`dimension.corpus_scope`; competitor/category/reference/unattributed requieren una
futura población de exploración server-side y no amplían el denominador primario.
Los payloads internos compactos declaran `read_scope`, pero no exponen operator
metadata como control cliente.

Este estado no es toda la Fase 4. Competitor/category quedan aplazados explícitamente:
no existe aún una población de exploración server-owned ni filtros cliente para esos
scopes. Fase 4A cubre exclusivamente el denominador `primary_brand`.

### 6.1 Módulos migrados

- Brand Monitoring: facade/home, periodo default, coverage, bootstrap, conversation
  volume, comparison, sentiment, platforms, emotions, topics, narratives, drivers,
  series, breakdowns, facets, freshness y read-through de materializaciones usan la
  misma población.
- Mentions: initial server load y API workspace, búsqueda, orden, offset/cursor,
  páginas >100, detalle enriquecido y deep link trabajan con raíces canónicas. El path
  governed no depende de `outputId`.
- Topics & Narratives: overview/comparison, detail, presence series, shares,
  sentiment, co-occurrence, evidence y lineage usan el mismo predicate. Assignments
  históricos sobre aliases se resuelven una vez sobre la raíz.
- `SignalV2WorkspacePage` determina vacío desde data sources/current population/
  coverage; un workspace con cero corpora puede abrir los tres módulos.

La generación pagada de research/interpretations TN no fue migrada ni ejecutada: en
governed queda deshabilitada y responde fail-closed para evitar encolar un job con
scope de corpus. Los insights ya persistidos sólo se leen si su packet coincide con el
scope actual. Esto no altera el serving determinista del módulo.

### 6.2 Materializaciones, freshness y observabilidad

La migración 0060 agrega identidad exclusiva de población a
`metric_materializations` y `signal_data_invalidations`. El planner, queue contract y
workers incluyen population ID/version/definition hash; un nuevo accepted watermark o
un pointer nuevo marca stale el scope correcto y vuelve a materializarlo de forma
idempotente. Recalcular exactamente los mismos datos no cambia el watermark hash sólo
por `materialized_at`.

La migración 0061 agrega invalidación transaccional de membership y
`signal_operational_shadow_requests`. El serving no acepta ninguna colección de cache
que contenga una fila stale/vencida: hace read-through al SQL gobernado actual mientras
el worker procesa la invalidación. El smoke observado materializó count `1`, rechazó
la attribution (`membership=0`), sirvió `0` antes y después del refresh, re-aprobó
(`membership=1`) y volvió a servir/materializar `1`.

`signal_operational_serving_shadow_results` conserva por módulo únicamente hashes,
denominadores, periodo, cursores/resultados relevantes, diferencias por scope y
duración. El gate exige contrato primary_brand válido, cero violaciones, cero
diferencias inexplicadas e igualdad con baseline SQL independiente. No exige
`parity_with_legacy=true` cuando legacy mezcla scopes.

El outbox deduplica por workspace, módulo, filtro, versión/hash de población, request y
ventana horaria. `pending/failed` es recuperable; un lease `processing` abandonado se
reabre después de cinco minutos. Cada request shadow registra un drenaje post-response
de hasta tres filas. Las rutas exponen `Server-Timing: signal-visible` y
`signal-shadow-outbox`; nunca esperan overview/detail/evidence/baseline gobernados.
La prueba post-response observó `3 ms` para insertar y programar las tres solicitudes,
`3/3/3 ms` por escritura, cero resultados antes del drain y `78 ms` para el trabajo
diferido completo. Es una medición local del boundary de ruta, no un benchmark de red.

### 6.3 Rollback y compatibilidad

Rollback es cambiar una sola configuración a `legacy`; no requiere migración ni borrar
datos. La compatibilidad mantiene:

- columnas legacy `study_corpus_id`;
- `signal_workspace_corpora`;
- watermarks/materializaciones corpus-scoped, junto con filas population-scoped
  separadas;
- `signal_workspace_current_releases`;
- `published_outputs.payload` intacto.

También siguen legacy Signal Pulse, Public Reporting, Review/generación TN y el Engine
T&B corpus-scoped como adapter de ejecución. Fase 5 agrega un contrato workspace-native
sin retirar ese rollback. Las rutas `/api/signal-v2/{outputId}` permanecen operativas
sólo durante rollback/compatibilidad; los tres módulos workspace en governed usan
`/api/data-os/signal/{workspaceId}`.

### 6.4 Evidencia manual local y rendimiento

Se levantó Studio en un puerto aislado contra el Postgres desechable y se inspeccionó
DOM, requests, payloads y consola:

- legacy y shadow mostraron el mismo payload visible (110); shadow no filtró la UI;
- governed mostró 107 primary-brand en el workspace de reconciliación y abrió
  Monitoring, Mentions y TN;
- un workspace Brand→Workspace→imports con 0 studies y 0 corpora abrió los tres
  módulos; TN informó honestamente `not_available` al no existir perfil;
- Mentions recorrió 1–50, 51–100 y 101–107; el deep link a un alias abrió la raíz y el
  enrichment histórico;
- TN list/detail/evidence quedó sincronizado y `Ver mención enriquecida` navegó al ID
  canónico;
- no aparecieron errores de consola ni keys i18n crudas en es-MX/en-US; shell y filtros
  permanecieron montados durante navegación. No se observó reemplazo de navegación o
  layout shift del shell.

Sobre una población local sintética de 10,001 memberships, `EXPLAIN (ANALYZE,
BUFFERS)` observó: serie diaria 8.362 ms, facet de plataforma 5.548 ms y primera página
de 51 con conteo completo 17.379 ms. Los planes usaron
`idx_signal_population_memberships_serving` y los índices de fecha de mentions. Son
tiempos de Postgres local caliente, no un benchmark de staging; el primer compile de
Next dev no se reporta como latencia de serving.

Después del compile de desarrollo, las rutas HTTP reales en shadow observaron:

| Ruta | curl total warm | `signal-visible` | `signal-shadow-outbox` |
|---|---:|---:|---:|
| Brand Monitoring | 97 ms | 46 ms | 2 ms |
| Mentions | 67 ms | 23 ms | 2 ms |
| Topics & Narratives | 46 ms | 25 ms | 2 ms |

El response terminó antes de la comparación gobernada. Los primeros requests fríos
incluyeron compilación Next dev (4.89 s / 2.56 s / 0.93 s) y no se interpretan como
latencia del serving ni como benchmark de staging.

## 7. Hardening local Fase 4A — staging bloqueado

- `db:smoke:local`: pasó `0000–0061` (62 migraciones), 44 tablas requeridas y 30
  índices requeridos sobre Postgres 16 + pgvector.
- Integración opt-in: pasó 13/13 subtests en Postgres (14 tests reportados por Node al
  incluir el suite padre). Incluye lifecycle de source/población, invalidación de
  membership por `included→excluded`, `excluded→included` y eliminación física, y
  los tres adapters module-shadow, 107 registros gobernados, paginación >100 y
  enrichment histórico sobre alias.
- Runtime Studio: pasó Brand→Workspace→3 imports sin estudio; observó 1 canonical,
  3 import memberships, 3 attributions, 2 scopes y 1 membership operacional. La
  aceptación usa un único timestamp para que `materialized_at >= accepted_at` sea
  determinista.
- El runtime smoke también demuestra que governed inválido falla cerrado y que un
  `corpus_scope` arbitrario del navegador es rechazado. Home, Monitoring, Mentions y
  TN declararon `read_scope=governed_population` y `corpus=null`.
- El module shadow opt-in pasó con population membership `state=exact`, payload shadow
  visible idéntico a legacy, tres module checks en true, 107 memberships gobernadas,
  legacy 110, diferencias category/reference/unattributed `1/1/1` e inexplicadas `0`.
- La integración condicional de TN obtuvo overview/ETag con denominadores `107/107` y
  dos términos, excluyó la mención que sostenía ambos términos y observó read-through
  `106/106`, cero términos, HTTP 200 ante el `If-None-Match` anterior y un ETag nuevo.
  Tras rematerializar conservó el mismo payload/ETag semántico `106/0`; al restaurar
  la membership recuperó `107/2` y el ETag original.
- Antes de drenar el outbox se observaron 3 requests `pending` y 0 resultados shadow;
  después del response hook las tres terminaron `completed`, intento 1. En la última
  repetición, los adapters persistieron Monitoring `32 ms`, Mentions `32 ms` y TN
  `48 ms`; el drain diferido completo tomó `78 ms` y no formó parte del camino crítico
  HTTP.
- El smoke de materialización ejecuta dos materializaciones governed idempotentes,
  una invalidación population-scoped y la rematerialización real; verifica que no se
  crean filas legacy y que una versión inválida responde `not_available`. Pasó 1/1;
  el watermark hash fue estable en ambas ejecuciones y tras refresh.
- Typecheck pasó en DB, Studio, Query Engine y Workers. Tests: DB 68 passed + 1
  integración opt-in skipped; Studio 278/278; Query Engine 227/227; Workers 145
  passed + 1 integración opt-in skipped. El test PostgreSQL autónomo del worker se
  ejecutó por separado, antes del runtime smoke de Studio, y pasó 1/1; creó y limpió
  su propio catálogo métrico, organización, marca/workspace, mención, población y
  watermark.
- `docs/api/openapi.yaml` parseó como YAML y `git diff --check` pasó.
- No se declara handoff de staging ni Fase 4 completa. Antes de cualquier escritura
  remota debe existir una decisión/contrato para exploration scopes, confirmarse un
  target staging/preview y emitirse autorización explícita separada. Los readers
  remotos permanecen en legacy.
- En staging se debe exigir `gate_passed=true`, `contract_violation_count=0`,
  `unexplained_count=0`, checks de los tres módulos en `true` y revisar el breakdown
  por scope. `parity_with_legacy=false` no bloquea si todas las diferencias están
  explicadas por scopes fuera del contrato primario.
- Staging no se ejecutó en este hardening. No se escribió staging/Prod y no existe aún
  evidencia remota para cutover cliente.

## 8. Fase 5 — Strategic Consumption local

Fase 5 conserva el pipeline metodológico T&B y cambia únicamente sus límites de
ownership, freeze, Review, publicación e identidad cliente. La ejecución todavía puede
usar un `study_corpus_id` compatible porque el Engine lo requiere, pero producto y
release se identifican por `(workspace_id, report_key='triggers-barriers')`.

### 8.1 Auditoría P0 de containment por etapa

Esta tabla registra las lecturas observadas antes del cambio y el contrato aplicado.
“Contexto” significa un asset versionado; nunca permite introducir una mención o una
métrica de listening fuera del snapshot.

| Etapa | Tablas/inputs de listening | Prueba de membership | Context assets y lineage | Puede observar listening posterior al freeze |
|---|---|---|---|---|
| preflight | antes: `mentions.study_corpus_id`; ahora `corpus_snapshot_mentions → mentions` | join directo por `analysis.snapshot_id`; count/plataforma/idioma acotados al snapshot | audit Data OS y limitations; refs separadas | no |
| open pass | `corpus_snapshot_mentions → mentions` | join directo; cada coding dispara trigger de containment | coding conserva analysis/snapshot provenance | no |
| coding | textos sólo de IDs producidos por open pass en `tb_mention_codings` | seguridad transitiva más gate formal antes/después de la etapa | codings versionados por analysis/model/prompt | no |
| hierarchy | codings/findings del mismo analysis | seguridad transitiva más gate formal | finding lineage y artifact graph | no |
| mobility | findings, métricas y comparaciones congeladas | no incorpora una lectura corpus-wide de mentions; gate del analysis | comparación refiere analysis/snapshot base | no |
| comparative | `tb_temporal_metrics` y snapshot actual/anterior | ambos lados tienen snapshot distinto y membership congelada | versiones pipeline/prompt/model y comparison lineage | no |
| synthesis | findings, citations, artifacts y codings del analysis | triggers bloquean citations/evidence fuera del snapshot; gate pre/post | artifact/evidence graph | no |
| RAG context | antes: serie mensual por `study_corpus_id`; ahora serie listening por snapshot | join directo por snapshot para series/counts | Brand OS, Study OS, KB y data assets se registran en `tb_analysis_context_refs` con versión/digest/captured_at | listening: no; contexto estructurado: puede capturarse durante la ejecución, pero queda versionado por referencia y nunca entra como mention evidence |
| source inventory | antes: count listening del corpus; ahora count por snapshot | join directo por snapshot | inventario estructurado y context refs versionadas | no |
| Data OS bridge | codings del analysis, `record_tags` y features | gate de analysis; tags se resuelven a `canonical_mention_id` | `derived_from` y evento Review conservan alias/origen | no |
| Review | artifacts/findings/evidence del analysis y assertions seleccionadas | `assert_signal_tb_snapshot_containment` debe pasar antes de aprobar | eventos inmutables de artifact Review y reusable assertions | no |
| publication | release, artifact refs, quality gates y snapshot | release scope trigger exige analysis estratégico y snapshot exacto | refs relacionales append-only | no |
| serving | current release por workspace/report, findings, metrics y evidence relacionales | cada evidence pertenece a artifact/analysis/snapshot y devuelve raíz canónica | release/snapshot/artifact IDs internos; payload cliente compacto | no |

Los hallazgos P0 se reprodujeron: preflight, RAG listening y source inventory eran
corpus-wide; Step 1 y Step 5 ya unían snapshot; Step 2 y Step 3 dependían transitivamente
de los IDs/codings anteriores. La corrección agrega contención directa donde faltaba y
un gate reutilizable en cada boundary del pipeline, sin reescribir prompts ni método.

### 8.2 Contrato workspace-native y schema 0062

La migración aditiva `0062_signal_strategic_consumption.sql` agrega:

- poblaciones `purpose='analysis'` explícitas, aprobadas, versionadas y period-bound;
- snapshot relacional con digest de IDs, timezone, freeze y watermarks;
- identidad estratégica en `tb_analyses`, manteniendo el corpus como execution scope;
- outbox durable e idempotente para dispatch;
- context refs versionadas;
- Review selectivo de enrichment reusable alias→raíz;
- triggers/gate SQL de containment e inmutabilidad;
- promoción transaccional del current release composite.

`POST /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs` autoriza por
workspace/brand, requiere `Idempotency-Key`, valida la policy
`primary-brand-analysis`, resuelve el execution corpus server-side y congela antes de
encolar. Población ausente/cross-workspace/no aprobada, timezone incorrecto, identidad
no canónica o dos runs abiertos incompatibles fallan cerrado. La ruta corpus legacy
delega al mismo orquestador; no hay dos implementaciones de creación.

### 8.3 Review, enrichment y release único

Review no convierte aprobación de findings/artifacts en aprobación masiva de tags.
Sólo `reusable_assertions` elegidas pueden pasar a `approved`, `corrected` o `rejected`.
El SQL resuelve el subject histórico a la raíz canónica, serializa reintentos, persiste
previous/next state y lineage, y deja el tag alias como provenance.

La release draft se crea después de Review y quality gates. La promoción toma un
advisory lock por workspace/report, asigna una revisión append-only y mueve un solo
current pointer composite. `published_outputs.payload` no se borra ni se consulta para
serving. Una corrida posterior crea otra revisión del mismo reporte y nunca otra fila
de navegación.

### 8.4 Evidencia PostgreSQL de dos corridas

La integración determinista de PostgreSQL aplica `0000–0062` y luego ejecuta el ciclo
sin Claude/Voyage/T&B real:

| Evidencia | Corrida 1 | Corrida 2 |
|---|---:|---:|
| population version | 1 | 2 |
| snapshot membership | 107 | 108 |
| mención ingerida después del primer freeze | 0 | 1 |
| release revision | 1 | 2 |

Resultados observados adicionales:

- `release history=[1,2]`, current revision `2` y una sola identidad de report registry;
- snapshot 1, release 1 y sus artifact refs quedaron bit-a-bit iguales después de la
  segunda ingesta/promoción;
- coding, citation y evidence contenidos: violations `0`; intentos externos fallaron
  con SQLSTATE `23514`;
- población, run, snapshot, Review y release permanecieron en una fila ante reintento
  concurrente;
- población operacional usada como estratégica, población cross-workspace y segundo
  open run incompatible fallaron cerrado (`23514`/`23505`);
- un tag T&B histórico sobre alias produjo exactamente un enrichment approved en la
  raíz, cero approved duplicados sobre el alias, un evento con `source_mention_id`
  alias y un edge de lineage.

El runtime smoke del reader real devolvió `contract_version=signal-triggers-barriers-v2`,
revisiones `[1,2]`, current `2`, `finding_count=1`, `evidence_count=1` y el mention ID
canónico. El adapter legacy resolvió la misma current release.

### 8.5 Navegación, rollback y límites

La navegación contiene una sola entrada `triggers-barriers` y la URL estable es
`/signal/{workspaceSlug}/reports/triggers-barriers`. Los fetches cliente ya no anexan
`?study=`. Una URL workspace legacy que todavía lo contiene redirige al path estable y
conserva filtros no relacionados; las APIs aceptan el parámetro sólo como adapter
temporal y reconcilian el corpus server-side.

El rollback conserva la ruta corpus de inicio, readers legacy, published outputs y
punteros heredados. No se ejecutó staging, cutover, migración remota, LLM ni un T&B real.
Phase 4A primary-brand permanece cerrada; exploration competitor/category sigue fuera
de ese contrato y de esta entrega. La verificación manual de navegador y las suites finales se
registran abajo sólo después de ejecutarse contra el Postgres desechable.

### 8.6 Validación local y handoff

La validación final se ejecutó únicamente contra PostgreSQL 16 + pgvector desechable:

- `db:smoke:local`: `0000–0063`, 64 migraciones aplicadas, 44 tablas y 30 índices;
- integración PostgreSQL Signal data plane: 15/15, incluido el ciclo estratégico de
  dos corridas;
- integración PostgreSQL aislada del worker de materialización: 1/1, con fixture y
  limpieza propios;
- integración PostgreSQL del outbox estratégico: 2/2, incluido `Queue.add/getJob`
  contra BullMQ + Redis local desechable y reconciliación post-ACK;
- runtime smoke operacional sin estudio: tres imports, una raíz canónica, tres vínculos
  de provenance, dos scopes, una membership primaria y cero studies;
- runtime smoke estratégico: revisiones `[1,2]`, current `2`, un finding, una evidence
  canónica y adapter legacy resolviendo el mismo current;
- tests: DB 69 passed + 1 integración opt-in skipped; Studio 278/278; Query Engine
  227/227; Workers 151 passed + 3 integraciones opt-in skipped;
- typechecks de DB, Studio, Query Engine y Workers y build de Studio: pass;
- OpenAPI parseable y `git diff --check`: pass.

En navegador autenticado local se observó `T&B revision 2`, una sola entrada Reports,
evidence de la revisión actual y navegación del drawer a la raíz canónica. El redirect
legacy retiró `study` sin loop y preservó `start/end`. Al alternar Reports → Mentions →
Reports, header `1280×48`, sidebar `208×672` y main `1072×672` conservaron exactamente
su geometría; no aparecieron errores de consola ni keys i18n crudas en es-MX. La suite
de mensajes cubre es-MX/en-US, pero no se cambió manualmente la sesión autenticada a
en-US durante esta pasada.

El handoff de staging queda preparado, no ejecutado. Requiere autorización explícita,
configuración remota y evidence pack propio; esta evidencia local no se presenta como
prueba de staging o producción. Tampoco se observó build/commit del deploy de producción.

### 8.7 Recuperación operativa del outbox estratégico

La auditoría posterior encontró que 0062 persistía una fila durable, pero Studio hacía
el único intento de `Queue.add` después del commit. Una caída en esa ventana podía dejar
`pending` o `dispatching` indefinidamente. 0063 agrega lease token/expiry, BullMQ job ID
y dead-letter timestamp; Studio deja el dispatch y Workers pasa a ser su único dueño.

El drainer se ejecuta al arrancar y periódicamente, reclama con
`FOR UPDATE SKIP LOCKED`, no solapa ticks dentro del proceso, aplica backoff exponencial
acotado y cierra limpiamente en `SIGTERM/SIGINT`. El job
`signal-tb-<tb_analysis_id>` se consulta antes de agregarlo. Si Redis aceptó el job pero
se perdió el ACK o la actualización PostgreSQL, un nuevo lease encuentra ese mismo job
y marca `dispatched` sin otro análisis efectivo.

La integración PostgreSQL autónoma del worker usa un broker determinista para inyectar
fallos y una segunda prueba contra BullMQ + Redis local desechable. No usa Redis remoto,
LLM ni un consumidor T&B. Observó:

- commit `pending` recuperado tras reinicio: un claim, un add aceptado y un job efectivo;
- dos drainers concurrentes: un claim total y un job efectivo;
- lease `dispatching` huérfano: attempt `1→2`, estado `dispatched`;
- ACK perdido después de aceptación: `reconciled=1`, un job efectivo;
- job preexistente incluso al alcanzar el máximo de intentos: `reconciled=1`,
  `attempt=3`, `add_calls=0`; el drainer consulta BullMQ antes de decidir dead letter;
- tres fallos consecutivos: `attempt=3`, estado `dead_letter`;
- fila creada después del arranque: drenada por el tick periódico;
- cierre del fixture: seis `dispatched`, un `dead_letter`, sin duplicados.

Con este hardening la **Fase 5 queda estructuralmente cerrada localmente**. Un T&B real
continúa siendo gate de staging con autorización y presupuesto explícitos; no se
simula ni se sustituye por esta prueba de transporte.

Comando reproducible contra PostgreSQL y Redis locales desechables, sin LLM ni servicio
remoto:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:55432/noisia_migration_smoke \
DATABASE_SSL=false \
NOISIA_SIGNAL_STRATEGIC_OUTBOX_REDIS_URL=redis://localhost:56379 \
NOISIA_SIGNAL_STRATEGIC_OUTBOX_INTEGRATION_APPROVED=true \
corepack pnpm --filter @noisia/workers test:integration:signal-strategic-outbox
```

## Fase 6 — Unified Admin Workspace + Settings

### Arquitectura observada e implementada

Signal V2 ya contenía los patrones correctos de shell persistente, feedback, headers,
drawers y responsive. Fase 6 extrajo primitives estructurales y compuso dos productos:

- `AdminShell`: interno, manifest permission-aware y rail contextual por marca;
- Signal: client-facing, manifest propio y sin controles operator-only.

No se copiaron Brand Monitoring ni sus módulos. `SignalV2ModuleHeader`, evidence drawer
y root shell ahora componen primitives compartidas manteniendo clases y geometría
Signal. Admin obtiene datos mediante SQL relacional en `admin-workspace.ts`; no lee
`published_outputs.payload` ni snapshots completos.

### Vertical Admin probada

El navegador autenticado local recorrió Dashboard → Brands → Brand → Data → Reports →
Settings → Brand OS → Brands/new → Advanced/Corpora. Se observó:

- Dashboard: 6 marcas y 112 menciones gobernadas antes del import manual de Fase 6;
- Brand A: 107 menciones, 4 sources y release T&B r2 antes del import;
- alta de `Phase 6 browser CSV source`: source workspace-owned aprobada primary-brand;
- import: `records=1`, `included=1`, `excluded=0`, `duplicates=0`;
- después: 5 sources, 108 menciones y coverage diciembre 2025–agosto 2026;
- Reports: una identidad `triggers-barriers`, current r2 y preflight listo; el launcher
  mostró periodo/timezone/budget, pero no se envió la corrida;
- Settings: population v1, acceso, cadencias, perfiles topic/narrative, report current y
  2 corpora sólo como compatibilidad;
- Brand OS conservó BrandEditForm, CompetitorManager, KnowledgeBaseManager y los dos
  estudios legacy;
- Brands/new conservó aliases, competitors, Knowledge Base y asistencia “Investigar
  marca/Refinar”; no se invocó Claude;
- Corpora/New Study permaneció accesible dentro de Advanced operations.

El runtime smoke independiente confirmó además un workspace con 0 studies y 0 corpora,
serving gobernado en home/Monitoring/Mentions/TN y el loader Admin sobre el mismo
workspace.

### Responsive, navegación y regresión Signal

- 1280×720: Signal Settings → Monitoring conservó topbar 48 px, sidebar 208 px y main
  1072 px; `scrollWidth=clientWidth=1280`.
- 1024×768: Admin global rail 190 px, context rail 172 px, main 662 px, sin overflow.
- 760×720: global rail vive fuera de canvas como drawer de 292 px, context rail no se
  muestra, selector accesible sí se muestra y no existe overflow horizontal.
- el selector compacto navegó Data → Reports;
- el shell mostró pending inmediato y conservó contenido durante fetch; el loading de
  Studio ya no duplica navegación;
- el selector existente de idioma cambió ES→EN→ES, persistió el valor visible y no mostró
  keys crudas;
- con rol analyst desapareció Team y `/studio/team` falló cerrado; al restaurar
  `noisia_admin`, Team volvió al manifest;
- no hubo nuevos errores/warnings de consola después de corregir key de lista, el valor
  CSS `flex-end` y la sincronización del selector de idioma.

Durante la prueba real se corrigieron dos bugs que no detectaba la inspección estática:
el source form enviaba claves con underscore rechazadas por el contrato kebab-case, y
un enlace de sección jerárquicamente activo impedía volver de Brand OS a Brands. Ambos
paths se reprodujeron de nuevo en navegador después del fix.

### Suites locales de cierre

- DB: typecheck; 70 tests (69 pass, 1 integración opt-in skipped en suite general);
- Studio: typecheck; 285/285; production build verde;
- Query Engine: typecheck; 227/227;
- Workers: typecheck; 151 pass y 3 integraciones opt-in skipped en suite general;
- data plane PostgreSQL opt-in: 15/15;
- operational materialization PostgreSQL aislada: 1/1;
- strategic outbox PostgreSQL + Redis: 2/2;
- `git diff --check`: requerido al cierre después de documentación.

### Límite De La Declaración

Esta sección cubre **Fase 6 local**. Competitor/category exploration permanece aplazada
a Fase 4B. No se validó staging/producción, no se ejecutó T&B real, Claude, Voyage ni
backfill remoto, y no se hizo commit/push. Production seguía sin ser evidencia accesible;
`origin/main` no se trata como deploy.

## 10. Fase 7A.1 — Semantic Scope Hardening local y rehearsal remoto

La auditoría real de Laika demostró que el scope del batch describe adquisición, no la
semántica individual. La migración 0064 se implementó localmente como transición, sin
aplicarla a `noisia-staging`:

- todas las filas existentes quedan explícitamente como `source_intent/not_eligible`;
- Review crea eventos append-only sobre assertions `mention_semantic` versionadas;
- approval, rejection y supersession reconcilian sólo una población operational v2
  draft, nunca el pointer actual;
- writers de import conservan provenance y no crean/autoaprueban semantic assertions;
- competitor/category sin identidad gobernada fallan cerrado;
- nuevas poblaciones y snapshots estratégicos aceptan sólo semantic assertions current,
  approved y eligible.

La integración PostgreSQL parte de un fixture 0059–0063. Antes y después de aplicar
0064 comparó el objeto completo de la definition v1, pointer, todas sus memberships,
conteo reader y hash ordenado de IDs: permanecieron idénticos. La candidata v2 coexistió
sin pointer y con cero memberships iniciales. El ciclo observado fue `0→1→0→1`, la
supersession volvió temporalmente a `0` y el approval de la nueva versión regresó a
`1`. Dos assertions elegibles para entidades distintas produjeron una sola membership
primary-brand. Un import posterior creó una fila source-intent y cero semantic/v2.

El snapshot estratégico contuvo una sola mención semantic elegible y excluyó las dos
menciones sostenidas sólo por source intent. Reintentar population/run devolvió las
mismas identidades; reaplicar 0064 mantuvo una sola definición v2, tres semantic
assertions, seis eventos de Review, una membership v2, una población estratégica y una
corrida. No se usaron datos privados de `.data` como verdad ni se autoaprobaron los 146
candidatos del scan.

El 2026-08-06 se ejecutó el rehearsal remoto acotado sobre `noisia-staging`. Preflight
confirmó 0064 `absent` (`0/27` sentinels), fingerprint y checksum autorizados, restore
point vigente, 0056–0063 completas, cero conexiones Noisia y el sync stale intacto. El
apply exclusivo de 0064 terminó en una transacción con advisory lock y una sola entrada
de ledger. Verify y el preflight posterior clasificaron 0064 `complete` (`27/27`), sin
acciones ni escrituras adicionales.

Operational V1 permaneció exacta: seis pointers, seis definitions, `18,996`
memberships, `927` incluidas y `927` IDs canónicos visibles; los hashes de pointers,
definitions, memberships y canonical IDs, junto con el digest agregado
`sha256:1af54acbc0c6a25139ec2e35fec9a0ebabdc9fa31f9929b49e8f5954214ba3ba`,
fueron idénticos antes y después. 0064 dejó `18,996` source intents no elegibles, cero
assertions semánticas, cero eventos de Review, seis candidatas V2 draft, cero pointers
V2 y cero memberships V2.

No hubo Review masivo, shadow, promoción, cutover, Claude, Voyage, T&B, modificación
del sync stale, commit ni push. El siguiente gate es Review semántico real y sigue
requiriendo una autorización separada.

## 11. Fase 7B — Backend de Semantic Review

Se añadió una vertical server-side única para que Noisia Admin liste la cola semántica,
genere candidatos deterministas, cree assertions manuales y ejecute approval, rejection,
supersession e historial append-only. No se añadió UI ni otra población.

La política `signal-semantic-governed-identity@1` no usa `batch.mention_type` como
verdad. Sólo propone identidades gobernadas y deja cualquier falta de identidad como
`unresolved` o `needs_context`. Cada candidato usa evidencia e idempotencia SHA-256
estables, queda `pending/candidate` y no crea eventos de Review. La cola pagina más de
100 raíces con cursor ligado al digest del conjunto; un cambio de cola invalida un
cursor viejo en vez de mezclar páginas.

La integración PostgreSQL aislada cubre 111 raíces incluidas: página `100+11`, cero
overlap, 110 assertions candidatas, una unresolved y una needs-context. Comprueba
primary desde un source intent competitor, competitor/category con IDs gobernados,
multi-entidad, alias→raíz, exclusión, AuthZ cross-workspace, idempotencia, concurrencia,
Review append-only y source intent posterior sin autoassertion. Candidate generation
deja definition/pointer/memberships V1, source intent, V2 pointer/memberships, eventos y
approvals sin cambios.

La creación remota de candidatos de Laika sigue siendo un subgate acotado. No significa
Operational V2 completa: no autoriza approval, membership, pointer, reader switch,
shadow, canary ni cutover.

El rehearsal remoto dirigido se completó después de preflight y dry-run read-only.
Sobre 729 raíces incluidas produjo 178 raíces con candidato y 551 unresolved; cinco
raíces fueron multi-entidad, por lo que persistieron 183 assertions (`99 primary_brand`,
`84 competitor`). Todas quedaron `pending/candidate`; una segunda ejecución creó cero
filas y encontró las mismas 183. El verify confirmó candidate digest
`sha256:16e7b6503737889ca89bd5d34f9e23e9d51edab52f813cbdc1a895e22aa65524`.

No cambiaron la definición, pointer ni 192 memberships V1 activas, las 4,587 filas de
source intent, el sync stale ni los otros cinco workspaces. V2 permaneció draft con
cero pointer/memberships; approvals y Review events permanecieron en cero. Los
artefactos públicos omiten texto, PII y UUIDs; los logs originales quedan privados
`0600` bajo `.data/signal-7b`.
