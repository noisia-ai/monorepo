# 57 · Signal Acquisition Plan Schema & Contract Audit

> **Estado:** 10A.1 auditado, Backend 10A.2 y Frontend 10A.3 implementados/validados
> localmente; staging y readers permanecen fuera de alcance.
> **Fecha:** 2026-08-15 (`America/Mexico_City`).
> **Alcance:** schema, contratos, writers, compatibilidad, backfill y pruebas de la
> foundation workspace-owned de adquisición.
> **No autoriza:** staging/producción, backfills remotos, UI, readers, imports reales,
> provider calls de producto, jobs remotos, commit o push.
> **Canon superior:** [North Star](./31_SIGNAL_PRODUCT_NORTH_STAR.md),
> [workspace ownership](./42_SIGNAL_WORKSPACE_DATA_OWNERSHIP.md),
> [governed views](./50_SIGNAL_GOVERNED_VIEWS_AND_POPULATION_POLICIES.md),
> [contrato de adquisición y cascada](./55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md),
> [plan 10A–10H](./56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md),
> [ADR 014](../adr/014-signal-workspace-owned-data-plane.md) y
> [ADR 015](../adr/015-signal-semantic-cascade-and-topic-contracts.md).

> **Criterio de producto posterior al cierre:** Laika, Alexa y cualquier workspace
> existente son fixtures desechables de preproducción. Frontend 10A.3 se acepta mediante
> un workspace greenfield creado desde la UI; no mediante backfills o excepciones para
> fixtures históricos. 0084 se conserva porque implementa capacidad general y
> reproducible del producto, no porque migre datos de prueba.

## 1. Veredicto Ejecutivo

`ACQUISITION_PLAN_10A1_READY_FOR_10A2=true`.

10A.2 ya no necesita decidir ownership, grain, compatibilidad ni rollback. La
foundation seleccionada es:

- un solo plan current por workspace, independiente del provider;
- una fila de slot por versión de plan y una identidad lógica estable por `slot_key`;
- una query version ligada a la versión exacta del slot y a un `data_source` reutilizable;
- un import sellado al plan/slot/query y a su periodo, sin inferir verdad semántica;
- una proyección `signal_provider_mention_observations` cuyo grain es el membership de
  import/provider record y que referencia la mención canónica sin copiar su texto;
- historia append-only, effective dating, CAS, advisory locks e idempotencia;
- campos study-first y scope/entity de source/import conservados sólo como bridge;
- historial ambiguo explícitamente `unknown`, nunca inferido por filename, query o tag.

Backend 10A.2 cerró localmente esos P0 con la migración forward-only
`0084_signal_acquisition_plan_control_plane.sql`. Frontend 10A.3 consume ya ownership,
keys, estados, CAS, blockers y contratos operator-safe sin inventarlos.

### 1.1 Cierre local 10A.2

| Corrección obligatoria | Contrato implementado |
|---|---|
| C1 · digest draft | `definition_hash` queda NULL en draft; `draft_revision` y `draft_digest` sólo cambian por writers bajo lock; promotion exige ambos CAS y sella `definition_hash=draft_digest` |
| C2 · reference | `signal_acquisition_reference_decisions` es un ledger append-only preexistente al slot; include/exclude/revert no depende de events del slot |
| C3 · events | `signal_acquisition_plan_events` usa `(operation_id,event_index)` y permite varios events ordenados por una sola operación idempotente |
| C4 · platform | `signal_provider_mention_observations.platform` es explícita, normalizada una vez e indexada con workspace/time/id |
| C5 · source key | `data_sources.source_key` es server-generated, inmutable y unique por workspace; las APIs target no reciben source UUID |
| C6 · rights | typed observations sellan sólo `provenance_binding_id`, `rights_definition_hash` y `retention_until`; acceptance relee el binding y sus policies vigentes |
| C7 · competitors | status/effective dating y `signal_competitor_lifecycle_events` preservan created/retired/reactivated; DELETE físico queda bloqueado |

La fixture PostgreSQL sintética demostró primary, category, dos competitors, reference
explícita, una source compartida, query supersession, plan promote/forward rollback,
import completed, failed+recovery, history legacy unknown, source intent pending/no
elegible, typed observations, concurrencia/idempotencia y aislamiento cross-workspace.
No usó Alexa, Laika ni estado remoto.

## 2. Método Y Evidencia

La auditoría fue estática y local. Se inspeccionaron schema Drizzle, migraciones
`0026`, `0079`–`0083`, handlers de Admin, services workspace-owned, parser canónico,
worker y recovery. No se abrió ninguna conexión de base de datos. Los procesos Studio y
Workers previos estaban detenidos antes de comenzar.

También se inspeccionaron sólo los headers y estadísticas estructurales de los CSV
locales de Alexa. Los 16 exports SentiOne comparten 47 headers. La muestra neutral
`Alexa Plus - Competencia (muestra).csv` contiene 408 registros y el header normalizado
tiene SHA-256
`46e1a83538982192d2c04ee114c538510282c97cfffd25d14dd21ca7131ddf07`.
No se copió texto de menciones ni valores personales al documento.

La revisión Advisor ya registrada se reutilizó; no se ejecutó otra inferencia. Su
veredicto fue `approve_with_p2_p3`, `can_advance=true`, P0/P1=0 y su artefacto sanitizado
tiene SHA-256
`30cf137ff5178e4d200b5f4974d3fb9cc70b3ccb9a1de83313de8df7a92635f8`.
El P3 aplicable —marcar `study_corpus_id`, `query_pack_id`, `mention_type` y scope/entity
legacy como compatibilidad— queda resuelto aquí.

## 3. Estado Pre-0084 Verificado

### 3.1 Brand OS, identidad y ownership

| Objeto | Autoridad/estado real | Writer o reader actual | Consecuencia para Acquisition Plan |
|---|---|---|---|
| Workspace de marca | `signal_workspaces` tiene organization, brand, timezone y un único subject (`infrastructure/db/schema/index.ts:312-345`) | La creación Admin crea organización, marca y workspace en una transacción (`apps/studio/src/app/api/brands/route.ts:55-139,286-400`) | El workspace es el owner único del plan |
| Marca primaria | `brands` guarda identidad operativa, industria, subindustria y handles (`schema/index.ts:95-122`) | Brand create/PATCH; el workspace valida el brand exacto | Origina siempre el slot `primary-brand`; `industry` no origina por sí sola category |
| Seed/aliases primarios | `brand_seeds.aliases`, `detection_patterns` y `brands.brand_seed_handles` (`schema/index.ts:144-156`) | Brand create actualiza el seed (`brands/route.ts:141-171`) | Son términos candidatos para una query, nunca semantic approval |
| Competidores | `competitors` enlaza brand→brand seed, pero hoy no tiene status, effective dating ni version (`schema/index.ts:158-173`) | POST crea; DELETE borra físicamente (`brands/[id]/competitors/route.ts:37-86,89-118` y `competitors/[competitorId]/route.ts:27-47`) | Cada competidor current origina un slot. El hard delete es P0 y debe volverse retiro forward-only antes de referenciarlo |
| Category/reference | `intelligence_entities` guarda type/name/status y `entity_aliases` (`schema/index.ts:4352-4373,5110-5126`) | Governance API permite `upsert-identity` sólo a internos y valida workspace (`apps/studio/src/app/api/data-os/signal/[workspaceId]/governance/route.ts:71-80,98-143`; service `signal-governance-control-plane.ts:537-568`) | Category sólo es aplicable con identidad activa inequívoca. Reference exige además decisión explícita de inclusión |
| Brand OS snapshot | `brand_os_profiles` es versionado y su reconciler retira/crea por snapshot hash; copia competidores y seed terms (`signal-governance-control-plane.ts:595-681`) | Brand, competitor y KB mutations disparan reconcile | El plan sella profile id/version/hash, pero necesita además `identity_catalog_digest`: el snapshot actual no incluye category/reference ni sus aliases |
| Cross-workspace | Los handlers resuelven sesión y ownership; management usa `loadSignalWorkspaceContextForManagement` | Source/governance routes; los services validan org/brand/entity exactos | Todos los writers nuevos deben repetir boundary y constraint DB, no confiar en IDs del browser |

#### Objetos que pueden originar slots

- **Automático a draft:** la marca primaria; cada `competitors` current cuyo
  `brand_seed` siga activo; una category sólo cuando existe exactamente una identidad
  `category` activa y gobernada del mismo org/brand.
- **Nunca automático:** reference; category basada sólo en strings `industry` o
  `industry_sub`; aliases, filenames, tags, query text o source intent.
- **Ambigüedad:** cero categorías deja el slot `not_applicable/blocked` en readiness;
  más de una categoría activa exige selección del operador. Ninguna se elige por orden.

#### Edición y retiro

Agregar/editar una marca, competitor, KB o catálogo de identidad cambia el input digest
y vuelve `stale` el plan current para **nuevos** imports. Reconcile crea un draft nuevo;
no modifica el plan ni los imports históricos. Retirar un competitor cierra su lifecycle,
bloquea nuevos uploads para su slot y crea un draft que lo excluye. La fila de competitor,
el slot antiguo, sus query versions e imports permanecen referenciables.

### 3.2 `data_sources`: clasificación campo por campo

`data_sources` debe seguir siendo el conector estable. Su schema actual está en
`infrastructure/db/schema/index.ts:3095-3141`.

| Campo | Clasificación | Uso target |
|---|---|---|
| `id` | autoridad vigente | Identidad interna del conector; server-resolved |
| `workspace_id` | autoridad vigente | Owner; FK restrict y boundary de todos los joins |
| `study_corpus_id` | compatibilidad legacy | Sólo readers study-first; nullable; no se escribe en paths nuevos |
| `organization_id` | reutilizable denormalizado | Debe coincidir con workspace; no se acepta del browser |
| `brand_id` | reutilizable denormalizado | Debe coincidir con subject del workspace |
| `source_type` | autoridad vigente | Tipo cerrado de conector |
| `provider` | autoridad vigente | Provider del conector, validado contra registry server-owned |
| `connection_method` | autoridad vigente | Manual CSV/API/etc.; no implica scope |
| `name` | autoridad vigente | Label operator-safe del conector |
| `source_contract_version` | nueva autoridad target | `signal-data-source-connector-v1`; legacy conserva `signal-data-source-scope-compat-v1` |
| `source_key` | nueva autoridad target | Server-generated, opaca, inmutable y unique por workspace; no prueba AuthZ |
| `mapping` | reutilizable | Mapping técnico versionado; no semantic truth |
| `mapping_version` | autoridad vigente | Versión del mapping técnico |
| `role` | candidato a deprecación | JSON duplica scope actual; paths nuevos no lo consultan como autoridad |
| `governed_scope` | compatibilidad legacy | Scope intent histórico; no origina slots ni attributions nuevas |
| `governed_entity_type` | compatibilidad legacy | No es semantic entity authority target |
| `governed_entity_id` | compatibilidad legacy | No se copia a imports nuevos como decisión semántica |
| `scope_policy_version` | compatibilidad legacy | Mantener sólo para auditoría del bridge |
| `scope_review_status` | compatibilidad legacy | No equivale a plan/query aprobado |
| `scope_approved_by_user_id` | compatibilidad legacy | Historia del bridge, no actor del plan |
| `scope_approval_source` | compatibilidad legacy | Historia del bridge |
| `scope_approved_at` | compatibilidad legacy | Historia del bridge |
| `status` | autoridad vigente | Sólo sources active pueden recibir query versions/imports |
| `visibility` | autoridad vigente | Capability de administración, no licenciamiento de registros |
| `created_at`, `updated_at` | autoridad vigente | Auditoría operativa |

El API vigente aún acepta `scope` y `entity_id` del navegador
(`packages/query-engine/src/signal-workspace-data-plane-v1.ts:141-150`) y los persiste
como aprobados (`workspace-ingestion.ts:237-320`). Admin incluso construye siempre una
source primary (`admin-workspace-source-contract.ts:1-15`). Es un bridge productizado,
no el contrato target.

10A.2 añade `source_key` mediante backfill exacto no semántico para toda source existente.
Las APIs target reciben esa key y resuelven `data_source_id` sólo después del boundary
workspace/AuthZ. Las rutas legacy por UUID permanecen compatibility-only. Una source target
nueva tiene `source_contract_version='signal-data-source-connector-v1'`, todos los campos
`governed_scope/entity/approval` NULL y review pending; nunca hereda semantic authority.

### 3.3 `import_batches`: clasificación campo por campo

Schema: `infrastructure/db/schema/index.ts:1239-1325`.

| Campo | Clasificación | Uso target |
|---|---|---|
| `id`, `workspace_id`, `data_source_id` | autoridad vigente | Identidad, owner y connector exactos |
| `study_corpus_id` | compatibilidad legacy | Nullable; nunca requerido/escrito por upload target |
| `contributed_by_study_corpus_id` | compatibilidad legacy | Adapter study-first; no authority de adquisición |
| `query_iteration_id` | compatibilidad legacy | Engine query workflow |
| `query_pack_id` | compatibilidad legacy | Referencia histórica; nunca se convierte automáticamente en query version |
| `query_validation_run_id` | compatibilidad legacy | Evaluación study-first |
| `mention_type` | compatibilidad legacy | Mezcla provider intent con scope; no semantic truth |
| `competitor_id` | compatibilidad legacy | No se usa para resolver slot/entity target |
| `corpus_entity_id` | compatibilidad legacy | Corpus study-owned |
| `entity_kind` | compatibilidad legacy | Provider/source intent histórico |
| `entity_label` | compatibilidad legacy | Label, no identidad |
| `source_system` | reutilizable/autoridad de lineage | Provider/source exacto del archivo |
| `source_file_name` | lineage privado | Nunca scope, entity o query authority |
| `source_file_hash` | autoridad vigente | Identidad de contenido aceptado |
| `ingestion_phase` | autoridad vigente | Upload/queue/processing/closure |
| `storage_bucket`, `storage_object_key`, `upload_protocol` | autoridad vigente privada | Manifiesto durable server-owned; nunca se expone raw |
| `expected_file_size_bytes`, `storage_part_count`, `storage_part_size_bytes` | autoridad vigente | Integridad multipart |
| `processed_bytes`, `progress_record_count` | reutilizable operativo | Progreso; no counts finales |
| `processing_started_at`, `completed_at`, `failed_at` | autoridad vigente | Lifecycle auditable |
| `failure_code`, `failure_detail` | autoridad vigente operator-safe | Error/recovery; detail nunca texto crudo |
| `worker_job_id` | autoridad vigente interna | Idempotencia y recovery del Worker |
| `supersedes_import_batch_id`, `storage_source_import_batch_id` | autoridad vigente | Recovery append-only, no borrado del fallido |
| `storage_content_hash` | autoridad vigente | Hash verificado antes de recovery |
| `processing_metrics` | reutilizable operativo | Stage timings/query counts, sin contenido |
| `product_idempotency_key`, `product_request_digest` | autoridad vigente | Replay/compatibilidad de request |
| `imported_by_user_id` | autoridad vigente | Actor server-resolved |
| `record_count`, `included_count`, `excluded_count`, `duplicate_count` | autoridad vigente sólo al completar | Invariante de cierre; no se publican desde batch incompleto |
| `status` | autoridad vigente | `queued|processing|completed|failed` |
| `created_at`, `updated_at` | autoridad vigente | Auditoría |

El endpoint actual acepta aún `study_corpus_id` y no acepta slot/query/period
(`sources/[sourceId]/imports/route.ts:35-105`). `createWorkspaceImportUploadV1` sella la
source y copia su scope/entity legacy (`workspace-async-import.ts:19-149`). Recovery sí
es durable, workspace-scoped e idempotente (`workspace-async-import.ts:295-355`). La
aceptación correcta ya es atómica: materializa source intent, cierra counters, crea sync,
watermark/invalidation y outbox completion sólo al pasar todos los checks
(`0081_signal_workspace_import_recovery_integrity.sql:480-553`).

### 3.4 Membership, verdad semántica y batches incompletos

- `mentions` es el único record store y materializa campos canónicos/indexables
  (`schema/index.ts:1509-1583`).
- `signal_mention_import_memberships` es el grain mention↔import↔source y conserva la
  disposition (`schema/index.ts:1614-1638`).
- `signal_mention_attributions` separa `source_intent` de `mention_semantic`, versiona y
  exige current/approved/eligible (`schema/index.ts:1640-1715`). El slot sólo puede crear
  source intent pending/not-eligible; nunca aprobación.
- `signal_mention_has_only_incomplete_imports_v1` excluye raíces sin ningún batch
  completed, y triggers bloquean membership serving y semantic approval
  (`0079_signal_workspace_async_imports.sql:120-192`).
- El Worker comparte el parser canónico con Studio y sólo marca 100% tras el cierre
  (`services/workers/src/workers/mentions-csv-ingest.ts:222-375`).

### 3.5 Query packs: ownership y adapter permitido

`query_packs.study_corpus_id` es NOT NULL; el objeto contiene iteration, lens,
`signal_intent`, scope, entity key, query, evaluación y cost budget
(`schema/index.ts:1020-1068`). Lo materializan rutas/Workers del Engine y lo consumen
retrieval, validation, Engine Wizard y Signal Pulse. Su ownership real es un corpus de
estudio, no un workspace ni un connector.

Se permite un adapter **read-only** que muestre `query_pack_id` como
`legacy_query_reference`. Un operador puede copiar deliberadamente su texto a una query
version nueva, registrando `origin_kind=legacy-query-pack` y evidencia. No se enlaza el
import antiguo al slot, no se cambia el query pack y no se deriva entity/scope de sus
labels. No se elimina ni se modifica el store existente.

### 3.6 `signal_observations` no aplica

`signal_observations` exige `study_corpus_id` y representa ventanas/métricas analíticas
como share, intensidad y sentiment (`schema/index.ts:3013-3067`). No representa una fila
del provider. Reutilizarla recrearía ownership study-first y un segundo significado para
la tabla. La typed projection debe ser nueva y workspace/import-owned.

## 4. Inventario Real Del CSV SentiOne

El parser único vive en `infrastructure/db/sentione-csv-ingest.ts`. Acepta aliases
genéricos (`:104-125`), normaliza a `mentions` (`:971-1016`), conserva toda la fila en
`raw_metadata.row`, y persiste chunks set-based (`:404-463,941-969`). La tabla siguiente
usa evidencia de la muestra de 408 registros. `unknown` significa que no existe contrato
formal del provider aunque la muestra no tenga vacíos.

| # | Campo provider | Tipo normalizado propuesto | Nullable evidenciado | Destino actual | Consultable target / decisión | Sensibilidad y uso |
|---:|---|---|---|---|---|---|
| 1 | `id` | text key → hash | unknown (0/408 vacíos) | `mentions.provider_record_id`; raw | hash/key de uniqueness; no duplicar raw | lineage/dedup; privado |
| 2 | `Specific type` | enum/text | unknown | `platform` candidate + `content_type`; raw | `provider_source_type`, `provider_content_type` | filtro/thread; hereda rights |
| 3 | `Title` | text | sí | `mentions.title`; raw | no copiar; join a mention | contenido potencialmente personal |
| 4 | `Author` | text | sí | `raw_metadata.author` | no columna visible; hash opcional | dato personal, lineage privado |
| 5 | `Author id` | text | sí | sólo raw row | `author_ref_hash`, nunca ID crudo en API | identificador personal |
| 6 | `Content of posts` | text | unknown | `mentions.text_raw/clean/snippet`; raw | no copiar | texto canónico/licensing |
| 7 | `Created` | timestamptz | unknown | `mentions.published_at`; raw | `published_at` en observation para índice | periodo/dedup |
| 8 | `Added to system` | timestamptz | unknown | sólo raw | `provider_collected_at` | freshness/lineage |
| 9 | `Context` | text | sí | sólo raw | no copiar; sólo relaciones thread derivadas | contenido sensible |
| 10 | `Link to the source` | URL/text | unknown | `mentions.url`; raw | no duplicar; dominio/hash en projection | referencia pública sujeta a capability |
| 11 | `Domain` | hostname/text | unknown | sólo contribuye al detector de platform; raw | `public_domain` | facet y referencia segura |
| 12 | `Sentiment` | closed label | sí | `sentiment_source`; raw | `provider_sentiment_label` | provider signal, no verdad semántica |
| 13 | `Sentiment points` | numeric | sí | **sólo raw**; alias actual no lo reconoce | `provider_sentiment_score` | filtro/model feature |
| 14 | `Domain group` | enum/text | unknown | platform candidate; raw | `platform` | facet |
| 15 | `Tag` | text[] lógico | sí (408/408 vacíos en muestra) | sólo raw | child term `tag` | acquisition origin; no approval |
| 16 | `Keywords` | text[] lógico | unknown | sólo raw | child terms `keyword` | acquisition origin; privado Admin |
| 17 | `Gender` | provider label | unknown | sólo raw | no projection visible | atributo personal inferido; máximo riesgo |
| 18 | `Project name` | text/key | unknown | sólo raw | `provider_project_ref_hash`; query version es authority | config privada del provider |
| 19 | `Domain category` | text | sí | sólo raw | `provider_domain_category` | facet técnico |
| 20 | `influenceScore` | numeric | unknown | sólo raw | `influence_score` | ranking; perfilado, privado |
| 21 | `Total interactions` | bigint | unknown | **sólo raw**; key actual no coincide | `engagement_total` | engagement |
| 22 | `comments` | bigint | unknown | `engagement.comments` JSON; raw | `comments_count` | engagement |
| 23 | `views` | bigint | unknown | `engagement.views`; raw | `views_count` | engagement |
| 24 | `shares` | bigint | sí | `engagement.shares`; raw | `shares_count` | engagement |
| 25 | `wow` | bigint | unknown | sólo raw | `reaction_wow_count` | engagement |
| 26 | `love` | bigint | unknown | sólo raw | `reaction_love_count` | engagement |
| 27 | `like` | bigint | unknown | sólo raw (`likes` plural sí mapea) | `reaction_like_count` | engagement |
| 28 | `haha` | bigint | unknown | sólo raw | `reaction_haha_count` | engagement |
| 29 | `sad` | bigint | unknown | sólo raw | `reaction_sad_count` | engagement |
| 30 | `angry` | bigint | unknown | sólo raw | `reaction_angry_count` | engagement |
| 31 | `thankful` | bigint | unknown | sólo raw | `reaction_thankful_count` | engagement |
| 32 | `uniqueVievs` | bigint | sí | sólo raw | `unique_views_count`; conservar spelling sólo en mapper | engagement |
| 33 | `fans` | bigint | sí | sólo raw | `fans_count` privado | perfil/audience |
| 34 | `Facebook page category` | text | sí | sólo raw | `provider_profile_category` privado | perfil |
| 35 | `retweet` | bigint | sí | sólo raw | `repost_count` | engagement |
| 36 | `favs` | bigint | sí | sólo raw | `favorites_count` | engagement |
| 37 | `hearts` | bigint | sí | sólo raw | `hearts_count` | engagement |
| 38 | `likes` | bigint | sí | `engagement.likes`; raw | `likes_count` | engagement |
| 39 | `dislikes` | bigint | sí | sólo raw | `dislikes_count` | engagement |
| 40 | `followers` | bigint | sí | sólo raw | `followers_count` privado | perfilado/audience |
| 41 | `Geolocation` | unknown | sí (408/408 vacíos) | sólo raw | no projection hasta contrato/privacy review | ubicación potencialmente precisa |
| 42 | `Language` | BCP-47-like text | unknown | `mentions.language` truncado a 2; raw | `language_code` normalizado + valor raw privado | facet |
| 43 | `Country` | ISO-like char(2) | sí | `mentions.country`; raw | `country_code` | facet |
| 44 | `Rating` | numeric | sí | sólo raw | `rating_value` | provider metric |
| 45 | `Thread ID` | text key → hash | unknown | sólo raw | `provider_thread_key_hash` | thread/dedup, no ID crudo |
| 46 | `Replied` | unknown boolean/enum | sí (408/408 vacíos) | sólo raw | `unknown`; no columna hasta ejemplos válidos | thread action potencial |
| 47 | `Liked` | unknown boolean/enum | sí (408/408 vacíos) | sólo raw | `unknown`; no columna hasta ejemplos válidos | user action potencial |

Todos los campos heredan la intersección de quality, retention y licensing del binding de
provenance del import. Ninguna columna typed concede un usage. Author, author ID, gender,
geolocation, audience/profile y thread IDs permanecen privados y nunca se exponen por
estar tipados. `raw_metadata` sigue siendo lineage privado, no filtro ni API.

## 5. Schema Seleccionado Para 10A.2

Los hashes se almacenan con forma `sha256:<64 lowercase hex>`. Timestamps usan
`timestamptz`; timezone usa un IANA name validado server-side. Todos los FKs de dominio
son `ON DELETE RESTRICT`.

### 5.1 `signal_acquisition_plans`

| Columna | Tipo / nullability | Contrato |
|---|---|---|
| `id` | uuid PK | Identidad interna |
| `workspace_id` | uuid NOT NULL | FK workspace; owner |
| `plan_version` | int NOT NULL >0 | Unique `(workspace_id, plan_version)` |
| `status` | text NOT NULL | `draft|current|retired` |
| `brand_os_profile_id` | uuid NOT NULL | Profile exacto usado |
| `brand_os_profile_version` | int NOT NULL | Snapshot version |
| `brand_os_digest` | text NOT NULL | `metadata.snapshot_hash` validado |
| `identity_catalog_digest` | text NOT NULL | Hash de category/reference/aliases activos y current competitors |
| `draft_revision` | int NOT NULL, default 0 | CAS monótono del aggregate mientras `status='draft'` |
| `draft_digest` | text NOT NULL | Digest reproducible del aggregate draft; sólo el writer puede recomponerlo |
| `definition_hash` | text NULL | NULL en draft; al promover se sella exactamente con `draft_digest` |
| `supersedes_plan_id` | uuid NULL | Versión anterior; mismo workspace |
| `effective_from`, `effective_to` | timestamptz | Rango válido; `to > from` |
| `created_by_user_id` | uuid NOT NULL | Actor server-resolved |
| `promoted_by_user_id`, `retired_by_user_id` | uuid NULL | Requeridos por transición correspondiente |
| `created_at`, `promoted_at`, `retired_at` | timestamptz | Auditoría |
| `creation_idempotency_key` | text NOT NULL | Unique workspace + key hash |
| `request_digest` | text NOT NULL | CAS del input exacto |

Índices/constraints:

- unique current parcial `(workspace_id) WHERE status='current'`;
- unique open draft parcial `(workspace_id) WHERE status='draft'`;
- unique `(workspace_id,id)` para FKs compuestos;
- current exige `definition_hash=draft_digest`, `promoted_*` y `effective_from`; retired exige `retired_*` y
  `effective_to`; draft prohíbe ambos;
- mientras es draft, cada change-set append-only de slots, queries o decisiones reference
  incrementa `draft_revision`, recompone `draft_digest` y emite events ordenados. Sólo el
  writer server-owned puede modificar esos dos campos;
- promotion toma advisory lock, relee todo y exige `expected_draft_revision` más
  `expected_draft_digest`; entonces copia `draft_digest` a `definition_hash` y cambia a
  current;
- un trigger protege UPDATE/DELETE: sólo permite los campos del aggregate draft mientras
  está draft, draft→current y current→retired por writers. Current/retired nunca cambian
  digest ni composición;
- promotion falla si Brand OS/catalog digest cambió, falta query aprobada, source active,
  governance vigente o existe otro current inesperado.

### 5.2 `signal_acquisition_slots`

Una fila representa **la versión del slot dentro de un plan**. Su identidad lógica entre
planes es `(workspace_id, slot_key)`; el UUID de fila no se reutiliza.

| Columna | Tipo / nullability | Contrato |
|---|---|---|
| `id` | uuid PK | Versión de slot |
| `workspace_id`, `plan_id` | uuid NOT NULL | FK compuesto al plan del workspace |
| `slot_key` | text NOT NULL | Server-owned, estable; nunca entity ID |
| `slot_version` | int NOT NULL >0 | Incrementa por `slot_key` |
| `scope` | text NOT NULL | `primary_brand|competitor|category|reference` |
| `entity_type` | text NOT NULL | `brand|competitor|category|reference` exacto |
| `entity_id` | uuid NOT NULL | Interno, nunca request/response primario |
| `entity_revision_digest` | text NOT NULL | Snapshot de nombre/aliases/status/ownership |
| `label` | text NOT NULL | Operator-safe; no authority |
| `desired_state` | text NOT NULL | `active|retired` dentro de la versión |
| `position` | int NOT NULL >=0 | Orden determinístico |
| `supersedes_slot_id` | uuid NULL | Slot row del plan anterior |
| `reference_decision_id` | uuid NULL | Decisión current preexistente; obligatoria sólo para reference activo |
| `definition_hash` | text NOT NULL | Hash de los campos de autoridad |
| `created_by_user_id`, `created_at` | actor/timestamp | Audit |

Keys server-owned:

- `primary-brand` es constante;
- los demás usan `<scope>-sha256-<hash completo de la identidad interna>` y se copian
  sin regenerar al siguiente plan; el label nunca forma parte de la identidad;
- unique `(plan_id,slot_key,slot_version)`, `(workspace_id,slot_key,slot_version)` y
  `(plan_id,position)`.

Constraint trigger por scope:

- primary: workspace brand exacto;
- competitor: competitor del workspace brand y seed activo al crear draft; los slots
  históricos siguen válidos después del retiro;
- category/reference: `intelligence_entities` mismo org/brand, type exacto, status active;
- reference active exige una fila current preexistente de
  `signal_acquisition_reference_decisions`; un event genérico no es autoridad;
- slot de plan current es inmutable.

### 5.2.1 `signal_acquisition_reference_decisions`

Ledger append-only, independiente del slot para evitar una dependencia circular. Columnas:
`id`, `workspace_id`, `intelligence_entity_id`, `action include|exclude|revert`,
`evidence_hash`, `evidence_reference` operator-safe, `actor_user_id`, `operation_id`,
`effective_from`, `effective_to`, `decision_hash`, `supersedes_decision_id` y `created_at`.
La unicidad parcial permite una sola decisión vigente por workspace+entity. `revert` crea
una nueva fila que supersede la anterior; nunca edita ni elimina historia. El constraint
trigger valida organization/brand/type/status de la intelligence entity y que operation,
actor y workspace coincidan. Un slot reference activo sólo puede apuntar a la decisión
current `include` ya existente.

### 5.3 Lifecycle necesario para `competitors`

10A.2 debe añadir forward-only a `competitors`: `status current|retired`,
`effective_from`, `effective_to`, `updated_at`, `retired_by_user_id`. Filas existentes
empiezan current. Los DELETE handlers se convierten en writer de retiro. Un trigger/FK
impide delete una vez referenciado. Esto no reescribe perfiles Brand OS antiguos ni
imports.

`signal_competitor_lifecycle_events` es append-only y registra `created|retired|reactivated`
con `operation_id,event_index`, actor, estado previo/siguiente, evidence hash y event digest.
El bulk retire usa una sola operación y event indexes ordenados. Reactivar sólo cambia el
lifecycle current bajo writer y conserva todos los events; hard DELETE queda bloqueado.

### 5.4 `signal_acquisition_query_versions`

La query pertenece a la **versión del slot dentro del plan**, no a un slot flotante.
Un plan nuevo que conserva la query crea una fila nueva con igual `query_hash` y
`carried_from_query_version_id`.

| Columna | Tipo / nullability | Contrato |
|---|---|---|
| `id` | uuid PK | Query version interna |
| `workspace_id`, `plan_id`, `slot_id` | uuid NOT NULL | FKs compuestos y misma versión |
| `query_key` | text NOT NULL | Stable por slot/provider/source |
| `query_version` | int NOT NULL >0 | Monótona por query key |
| `data_source_id` | uuid NOT NULL | Connector reusable; mismo workspace |
| `provider_key` | text NOT NULL | Registry cerrado, inicialmente `sentione` |
| `provider_syntax_version` | text NOT NULL | Sintaxis pinneada |
| `provider_schema_version` | text NOT NULL | Mapper pinneado; inicialmente `sentione-csv-47-v1` |
| `query_text_private` | text NOT NULL | Nunca se devuelve en listados ni evidence |
| `structured_terms` | jsonb NOT NULL | Schema cerrado de terms/aliases; no SQL/policy |
| `query_hash`, `definition_hash` | text NOT NULL | Hash texto normalizado y contrato completo |
| `cadence` | text NOT NULL | `manual|ad-hoc|daily|weekly|monthly` |
| `default_period_start`, `default_period_end` | date NULL | Envelope/default, no periodo ejecutado |
| `timezone` | text NOT NULL | IANA |
| `status` | text NOT NULL | `draft|current|superseded|retired` |
| `effective_from`, `effective_to` | timestamptz | Vigencia |
| `supersedes_query_version_id`, `carried_from_query_version_id` | uuid NULL | Historia exacta |
| `origin_kind`, `origin_reference_id` | text/uuid NULL | `operator|legacy-query-pack`; nunca autoridad implícita |
| `created_by_user_id`, `created_at` | actor/timestamp | Audit |
| `creation_idempotency_key`, `request_digest` | text | Unique/CAS workspace |

Una query referenciada por cualquier import es inmutable y no eliminable. Corregirla o
volver a una anterior crea versión nueva. Plan promotion activa sólo las query rows del
plan; retiro cierra nuevas capturas sin tocar imports ya sellados.

Un slot admite una o más query versions current cuando usa connectors/providers
distintos. La unicidad current es `(plan_id,slot_id,provider_key,data_source_id)`; una
source puede aparecer en varios slots. Promotion exige al menos una query current por
slot active y ninguna combinación duplicada.

### 5.5 Extensiones exactas de `import_batches`

Todas son nullable para historia; el nuevo `acquisition_contract_version` las vuelve
obligatorias como conjunto.

| Columna nueva | Tipo | Regla |
|---|---|---|
| `acquisition_contract_version` | text NULL | `signal-acquisition-import-v1` |
| `acquisition_plan_id` | uuid NULL | Plan current exacto al crear upload |
| `acquisition_slot_id` | uuid NULL | Slot active del plan |
| `acquisition_query_version_id` | uuid NULL | Query current exacta y source coincidente |
| `capture_period_start`, `capture_period_end` | date NULL | Periodo solicitado del archivo; `end>=start` |
| `capture_timezone` | text NULL | IANA, server-validado |
| `acquisition_plan_digest` | text NULL | Copia sellada |
| `acquisition_slot_digest` | text NULL | Copia sellada |
| `acquisition_query_digest` | text NULL | Copia sellada |
| `brand_os_digest` | text NULL | Input snapshot |
| `identity_catalog_digest` | text NULL | Catálogo exacto |
| `provider_schema_version` | text NULL | Mapper exacto |
| `acquisition_sealed_at` | timestamptz NULL | Momento de resolución server-side |

Rules:

- FK compuestos prueban workspace; trigger prueba plan↔slot↔query↔source;
- browser sólo envía `slot_key`, `query_version`, periodo y timezone; el server resuelve IDs;
- el sello ocurre al crear el upload, antes de emitir signed parts, y es inmutable;
- request digest incluye source, plan/slot/query hashes, filename/size, capture
  period/timezone y supersession; finalize añade/verifica content hash sin cambiar intent;
- retry-from-storage copia exactamente el sello del batch fallido y vuelve a verificar
  ownership/size/hash; no resuelve contra el plan current del día del retry;
- el predecessor permanece failed y el successor lo referencia;
- imports históricos tienen columnas NULL y readiness `legacy-unplanned/unknown`; no se
  infiere slot por `query_pack_id`, `mention_type`, filename, tags o query text;
- queued/processing/failed nunca son accepted ni serving-eligible.

En `complete_signal_workspace_import_v1`, el target de
`materialize_signal_workspace_import_source_intent_v1` debe ser el slot sellado para
imports `signal-acquisition-import-v1`. Debe crear sólo `source_intent`, pending y
not-eligible. La lectura desde `data_sources.governed_scope/entity*` queda exclusivamente
en la rama de compatibilidad para imports históricos; nunca se usa como semantic approval.

El periodo pertenece a ambos niveles con sentidos distintos: query version define el
default/envelope; import sella la captura concreta. El import no puede salir del envelope
sin una query version nueva.

### 5.6 `signal_provider_mention_observations`

Nombre definitivo: `signal_provider_mention_observations`.

Grain: una observación normalizada por `(import attempt, provider record/canonical
membership)`. Un root puede tener observaciones de varios imports/sources porque query,
periodo y rights difieren. No es otro mention store.

| Grupo | Columnas |
|---|---|
| Identidad | `id`, `workspace_id`, `data_source_id`, `import_batch_id`, `mention_id`, `provider_key`, `provider_record_key_hash` |
| Acquisition | `acquisition_plan_id`, `acquisition_slot_id`, `acquisition_query_version_id`, `acquisition_plan_digest`, `acquisition_slot_digest`, `acquisition_query_digest` (nullable sólo legacy) |
| Versionado | `provider_schema_version`, `provider_header_hash`, `observation_version`, `observation_hash`, `supersedes_observation_id`, `created_at` |
| Origen | `provider_project_ref_hash`, `platform`, `public_domain`, `provider_domain_category`, `provider_source_type`, `provider_content_type` |
| Thread | `provider_thread_key_hash`, `thread_role` (`root|reply|unknown`) |
| Locale/tiempo | `language_code`, `country_code`, `published_at`, `provider_collected_at`, `imported_at` |
| Provider signals | `provider_sentiment_label`, `provider_sentiment_score`, `rating_value`, `influence_score` |
| Engagement bigint | `engagement_total`, `comments_count`, `views_count`, `shares_count`, `reaction_wow_count`, `reaction_love_count`, `reaction_like_count`, `reaction_haha_count`, `reaction_sad_count`, `reaction_angry_count`, `reaction_thankful_count`, `unique_views_count`, `fans_count`, `repost_count`, `favorites_count`, `hearts_count`, `likes_count`, `dislikes_count`, `followers_count` |
| Privacy | `author_ref_hash`; no author/name/gender/geolocation/text/URL crudos |
| Rights snapshot | `provenance_binding_id`, `rights_definition_hash`, `retention_until` |

Supporting table `signal_provider_mention_observation_terms`:

- `observation_id`, `workspace_id`, `term_kind` (`provider-tag|provider-keyword`),
  `ordinal`, `term_private`, `term_hash`, `normalized_term`;
- unique `(observation_id,term_kind,term_hash)`;
- management-only; serving recibe aggregates/capability-filtered values, no raw terms.

La URL pública segura no se duplica: se resuelve desde `mentions.url` al unir
`mention_id`, después de comprobar las capabilities/licensing vigentes. La proyección
guarda sólo `public_domain` y hashes de referencias necesarios para filtros/lineage.

Constraints/indexes:

- unique `(import_batch_id, provider_record_key_hash, observation_version)`;
- FK `(workspace_id,mention_id)` y `(workspace_id,import_batch_id)` con ownership exacto;
- observation payload es append-only; nueva interpretación/mapping crea version y
  `supersedes_observation_id`;
- índices `(workspace_id,published_at,id)`, `(workspace_id,mention_id,import_batch_id)`,
  `(import_batch_id,mention_id)`, `(workspace_id,platform,published_at,id)`, thread hash y
  terms kind/hash;
- mapper `sentione-csv-47-v1` exige el header normalizado/hash reconocido. Un schema
  desconocido conserva raw lineage y deja typed readiness `not_available`; no inventa
  mapping;
- insert set-based `INSERT … SELECT/UNNEST … ON CONFLICT DO NOTHING`; cero fallback por fila;
- replay del mismo batch no duplica; recovery crea lineage del nuevo attempt, pero sólo
  el batch completed es elegible. El content acceptance lock existente garantiza un solo
  batch accepted por source/content;
- `mention_id` señala la raíz observada. Canonical merge se resuelve uniendo
  `mentions.canonical_mention_id`; no se reescribe la observación ni se duplica texto;
- `platform` es columna text normalizada con el mismo registry que `mentions.platform`; no
  se deriva otra vez en readers;
- los readers vuelven a evaluar rights vigentes. `provenance_binding_id` resuelve el
  contrato inmutable de quality/retention/licensing; `rights_definition_hash` y
  `retention_until` son el snapshot mínimo. No se duplican policy IDs como autoridades
  paralelas ni se conceden permisos perpetuos.

## 6. Events, Writers Y Transacciones

### 6.1 Event ledger

Crear `signal_acquisition_plan_events` append-only:

- `id`, `workspace_id`, `operation_id`, `event_index`, `event_kind`, `plan_id`, `slot_id`,
  `query_version_id`, `import_batch_id`;
- event kinds: `draft-created|draft-reconciled|promoted|retired|slot-retired|query-created|query-superseded|import-sealed|drift-detected|rollback-promoted`;
- `previous_state_digest`, `next_state_digest`, `event_digest`, `detail` operator-safe y
  `created_at`;
- unique `(operation_id,event_index)` y trigger que prohíbe UPDATE/DELETE;
- constraint trigger valida workspace, operation, actor implícito y object references.

`signal_governance_control_operations` sigue siendo la única autoridad de request,
Idempotency-Key, actor e input digest; 10A.2 extiende sus acciones. Una operación puede
emitir plan+slot+query+drift events con indexes consecutivos, por lo que nunca se reutiliza
`(workspace,idempotency_key)` como unicidad de cada event. El ledger de events registra
historia de dominio, no un segundo store de estado.

### 6.2 Writers server-owned

| Writer | AuthZ/input | Lock, CAS e idempotencia | Efecto / replay / rollback |
|---|---|---|---|
| `reconcileSignalAcquisitionPlanDraftV1` | actor interno autorizado; workspace resuelto; expected current/profile/catalog digests; reference decisions explícitas | SERIALIZABLE; advisory `acquisition-plan:<workspace>`; request digest + Idempotency-Key | Crea un draft y slots/query carry-forward. Igual key/input devuelve mismo draft; input distinto rechaza. No activa |
| `promoteSignalAcquisitionPlanV1` | expected draft version, `expected_draft_revision`, `expected_draft_digest` y effective_from | mismo lock; relee Brand OS, catalog, sources, queries y governance después del lock | Sella `definition_hash=draft_digest`, retira current y promueve draft atómicamente. Rollback crea/promueve una versión nueva de forma histórica |
| `createSignalAcquisitionQueryVersionV1` | `slot_key`, source key, provider, private query, terms, cadence/default period; jamás IDs owner/entity | lock workspace+slot+provider; CAS draft/hash; idempotency | Inserta draft version; nunca actualiza una ejecutada. Replay exacto no-op |
| `retireSignalAcquisitionSlotV1` | slot_key + reason/evidence, competitor/reference decision legítima | lock workspace; expected current plan | Crea plan draft con slot retired; no muta current/imports. Rollback crea otra plan version |
| `sealSignalAcquisitionImportV1` | source path ya autorizado; slot_key/query version/period/timezone | lock workspace+source+idempotency; relee current plan/query/source/governance | Inserta queued batch y sello antes de signed upload. Replay devuelve mismo batch; no semantic approval |

Todos:

- resuelven actor desde sesión y workspace desde path/ownership;
- no aceptan organization/workspace/entity/plan/slot/query UUIDs del browser;
- escriben operación + estado + event en una transacción;
- validan cross-workspace también en PostgreSQL;
- los rollbacks son nuevas transiciones, nunca UPDATE destructivo.

## 7. API Contracts Target

Base: `/api/data-os/signal/{workspaceId}`. `workspaceId` del path se revalida por sesión;
no se acepta en JSON.

### 7.1 `GET /acquisition-plan`

Read-only, `private,no-store`. Respuesta operator-safe:

```json
{
  "contract_version": "signal-acquisition-plan-v1",
  "state": "missing|draft|ready|current|stale|retired",
  "current_plan": {
    "version": 1,
    "status": "current",
    "effective_from": "timestamp",
    "brand_os_revision": 3,
    "drift": { "state": "in-sync|stale", "reasons": [] }
  },
  "draft_plan": null,
  "slots": [{
    "slot_key": "primary-brand",
    "scope": "primary_brand",
    "label": "Marca primaria",
    "applicability": "applicable|not_applicable|blocked",
    "query": { "provider": "sentione", "version": 1, "status": "current" },
    "source": { "source_key": "operator-safe-key", "status": "active" },
    "blockers": []
  }],
  "readiness": { "ready_to_promote": true, "blockers": [] }
}
```

Hashes/IDs sólo pueden aparecer en un bloque técnico explícito para internos; nunca como
acción primaria ni authority enviada de vuelta.

### 7.2 `POST /acquisition-plan/reconcile`

Header `Idempotency-Key` obligatorio. Body strict:

```json
{
  "expected_current_version": 1,
  "expected_brand_os_revision": 3,
  "reference_decisions": [
    { "identity_key": "reference-key-from-server-list", "action": "include", "evidence": "operator evidence" }
  ]
}
```

Primary/current competitors/category aplicable se resuelven server-side. Reference sólo
se incluye desde este input explícito. Responde draft version, state, counts y blockers.
`identity_key` es un token estable calculado por el servidor como
`<type>-sha256-<hash completo del entity_id>`; no es el UUID de la entidad ni permite
resolver objetos de otro workspace.

### 7.3 `POST /acquisition-plan/promote`

Header obligatorio. Body:

```json
{
  "expected_draft_version": 2,
  "expected_draft_revision": 4,
  "expected_draft_digest": "sha256:…",
  "effective_from": "timestamp",
  "evidence": "operator approval"
}
```

El hash es CAS emitido por GET, no policy/SQL. Promueve todos los slots/queries o ninguno.

### 7.4 Query version creation

`POST /acquisition-plan/slots/{slotKey}/query-versions`, header obligatorio:

```json
{
  "source_key": "connector-key-from-server-list",
  "provider": "sentione",
  "provider_syntax_version": "sentione-query-v1",
  "provider_schema_version": "sentione-csv-47-v1",
  "query_text": "private operator query",
  "structured_terms": { "include": [], "exclude": [], "aliases": [] },
  "cadence": "manual",
  "default_period": { "start": null, "end": null, "timezone": "America/Mexico_City" }
}
```

La respuesta no repite el query text: devuelve version, provider, status, period y una
preview redactada/hash en detalles técnicos.

`POST /acquisition-plan/slots/{slotKey}/retire` crea draft; no elimina.

### 7.5 Create upload/import

Se conserva la ruta durable
`POST /sources/{sourceId}/imports`, pero el body target de `create-upload` añade:

```json
{
  "action": "create-upload",
  "file_name": "export.csv",
  "file_size_bytes": 123,
  "content_type": "text/csv",
  "slot_key": "primary-brand",
  "query_version": 2,
  "capture_period": {
    "start": "2026-01-01",
    "end": "2026-01-31",
    "timezone": "America/Mexico_City"
  }
}
```

`study_corpus_id`, scope, entity, query pack y digests enviados por browser se rechazan.
Server devuelve 202/import/polling como hoy y sella IDs/hashes privados.

### 7.6 Errores cerrados

`acquisition_plan_missing`, `acquisition_plan_stale`, `slot_not_applicable`,
`slot_retired`, `query_version_missing`, `query_version_stale`, `source_provider_mismatch`,
`capture_period_outside_query`, `governance_not_ready`, `brand_os_drift`,
`idempotency_conflict`, `cross_workspace`, `provider_schema_unknown`. Mensajes visibles no
incluyen UUIDs, query text, storage keys, SQL ni policy IDs.

## 8. Compatibilidad Y Deprecación

| Objeto/campo legacy | Reader/writer actual | Uso durante bridge | Autoridad target | Criterio de retiro |
|---|---|---|---|---|
| `data_sources.study_corpus_id` | Data OS/legacy study | Read-only para corpora existentes | workspace source | cero writers workspace nuevos y lectores study explícitos |
| `data_sources.governed_scope/entity*` | source API/workspace ingest | Adapter para imports sin plan | plan slot | todos los uploads soportados sellan slot/query; no readers dependen de source scope |
| `data_sources.role.scope/entity_id` | source creator | Diagnóstico histórico | plan slot/query | igual que anterior; luego dejar de escribir |
| `import_batches.study_corpus_id` | corpus CSV + Engine | Lineage legacy | nullable contribution adapter | ningún import workspace nuevo lo acepta del browser |
| `contributed_by_study_corpus_id` | workspace import compatibility | Link explícito de contribución ya existente | no acquisition authority | rutas study migradas o declaradas legacy |
| `query_pack_id` | parser/provenance/Engine | Mostrar `legacy_query_reference` | acquisition query version | Engine histórico permanece; ningún upload target lo escribe |
| `query_iteration_id`, `query_validation_run_id` | Engine validation | Historia study-first | no equivalente automático | separación completa de rutas |
| `mention_type` | import legacy y UI | Label histórico | slot intent sellado | cero writers target y ningún resolver lo consulta |
| `competitor_id`, `entity_kind`, `entity_label`, `corpus_entity_id` | parser bridge | Diagnóstico, nunca verdad | slot snapshot + semantic assertions | cero new writes y readers target migrados |
| query packs study-owned | Engine/corpus workers | Adapter read-only y explicit copy | acquisition query version | no se elimina; queda feature study-first |
| rutas `/api/corpora/.../csv-upload` | corpus ingestion | Compatibilidad explícita | workspace source import route | consumers study legacy retirados |
| ruta workspace body streaming | compatibility para archivos chicos | Puede seguir si sella slot/query igual | multipart workspace import | ninguna ruta puede omitir el sello |
| operational corpus/pointer fallbacks | Signal legacy readers | Rollback ya gobernado | binding/resolver server-side | fuera de 10A; nunca se usa para acquisition |

No hay migración destructiva. Los campos deprecados conservan comments DB
`compatibility-only; never acquisition or semantic authority` y métricas de uso antes de
considerar retiro.

## 9. Backfill Seguro Diseñado, No Ejecutado

### 9.1 Exacto demostrable

- ownership workspace/source/import cuando FKs actuales coinciden;
- estado `legacy-unplanned` para cada import sin plan;
- observed period derivado de memberships + `published_at` + timezone, etiquetado
  `observed`, nunca `capture_period` solicitado;
- typed observation v1 desde `raw_metadata.row` sólo si existen los 47 keys reconocidos,
  provider/source exactos y mapper/header contract demostrable; no añade slot/query;
- hashes, import/source/root refs y campos escalares determinísticos;
- lifecycle current inicial de competitors existentes, sin alterar perfiles históricos.

### 9.2 Debe permanecer `unknown`

- plan/slot/query de cualquier import sin sello;
- provider schema si raw row/header no prueban la versión;
- category/reference inferida de industry, filename, tag, project o query;
- significado de `Replied`, `Liked` y geolocation sin ejemplos/contrato;
- approval semántico, eligibility o rights no existentes.

### 9.3 Requiere decisión del operador

- crear/seleccionar category gobernada cuando falta o hay más de una;
- incluir reference;
- aprobar el query text/terms/cadence/period;
- copiar un legacy query pack a una query version;
- asociar evidencia histórica a un slot cuando exista prueba externa;
- promover/retirar el plan.

La decisión puede crear una relación prospectiva o un evento de documentación, pero no
reescribe el import ni las assertions históricas.

## 10. Invalidation, Reconcile Y Rollback

| Cambio | Invalidation | Automatizable | Acción humana |
|---|---|---|---|
| Import completed | watermarks/compilations existentes, una vez | typed projection + readiness reconcile | ninguna para derivación; semantic Review permanece separada |
| Query version nueva | readiness del draft | compilar hash y carry-forward | aprobar query y promover plan |
| Competitor agregado | Brand OS/catalog drift | crear slot propuesto en draft | completar query y promover |
| Competitor retirado | bloquea uploads del slot inmediatamente; plan stale | draft con slot retired | promover retiro; rollback = plan nuevo |
| Category/reference/alias | catalog digest drift | reconcile draft | seleccionar category/reference si aplica |
| Governance/rights | bloquea import/readiness si falta/expira; observations no cambian | reevaluar estado | crear/activar policy legítima |
| Canonical merge | invalida derived projections; observation une al root current | reconcile set-based | sólo Review/merge ya autorizado |
| Source paused/retired | query readiness blocked | status recompute | elegir connector/query nuevo |

Historical imports, query versions y provider observations son inmutables. Rollback nunca
reactiva una fila retirada: crea una plan/query version nueva que referencia la histórica.

## 11. Matriz De Pruebas Para 10A.2

### Unit/contract

- canonical plan/slot/query/observation hashes estables normal/reverse;
- validator rechaza browser `workspace_id`, `organization_id`, `entity_id`, plan/slot/query
  UUID, population/policy IDs, SQL y unknown fields;
- mapper exacto de los 47 headers; `Sentiment points`, `Total interactions`, reactions y
  thread se tipan; schema desconocido da `not_available`;
- reference nunca aparece sin decisión; industry string nunca crea category;
- source única puede ser usada por primary/category/múltiples competitors;
- period/timezone y query envelope con fronteras/DST.

### PostgreSQL real

- primary + category + múltiples competitors; reference explícita;
- category cero=`not_applicable/blocked`, múltiple=`ambiguous`, no elección silenciosa;
- one draft/one current, promotion atómica, retiro y rollback como versión nueva;
- competitor retirement conserva slot/import histórico y bloquea nuevos uploads;
- query supersession, carry-forward e inmutabilidad después del primer import;
- source compartida entre slots sin duplicarla;
- historical import permanece NULL/unknown aun con `query_pack_id` o filename sugestivo;
- import seal exacto, cross-workspace FKs/triggers, Brand OS drift post-lock;
- retry-from-storage copia sello y content hash; failed + recovery visibles;
- duplicate/intra-file/cross-import/restart/replay no duplica typed observations accepted;
- concurrent same key produce un resultado; same key/incompatible input rechaza;
- events/plan/slot/query/observation UPDATE y DELETE fabricados fallan;
- batches incompletos no alimentan observation reader, Semantic Review, governed views ni
  source intent eligible;
- semantic attribution creada desde slot queda pending/not-eligible; nunca approved;
- canonical merge conserva lineage y resuelve root current;
- governance expiry/invalidation bloquea sin modificar observation;
- `raw_metadata`, query text, author/profile/storage IDs no aparecen en responses.

### Regresión

- parser canónico único Studio/Worker y set-based query count;
- async import, recovery, outbox, watermark/sync/invalidation siguen exactamente una vez;
- Semantic Review 100K, governed views y Workers no cambian poblaciones por el slot;
- query packs/Engine study-first siguen leyendo historia;
- migration smoke `0000→0084` (o ordinal libre real), reapply idempotente y schema Drizzle;
- DB, Query Engine, Studio y Workers typecheck/tests; OpenAPI; `git diff --check`.

## 12. Riesgos Priorizados

### P0 — exit criteria de 10A.2

1. **Source equivale hoy a scope/entity aprobado.** El contrato target debe separar
   connector de slot y dejar de copiar source scope a imports target.
2. **Competitor se borra físicamente.** Sin lifecycle forward-only no se puede conservar
   FK/historia del plan.
3. **Import no sella plan/slot/query/period.** El browser todavía puede enviar
   `study_corpus_id`; el target debe rechazarlo.
4. **No existe typed provider projection.** Los campos consultables siguen dentro de
   `raw_metadata`.
5. **Source intent se materializa hoy desde el source.** Para imports target debe leerse
   exclusivamente del slot sellado y permanecer pending/not-eligible.

### P1

1. Brand OS snapshot no incluye category/reference/aliases; usar y persistir
   `identity_catalog_digest` y extender reconcile/invalidations.
2. El parser genérico no tiene schema gate y no reconoce varios headers SentiOne
   (`Sentiment points`, `Total interactions`, reactions/thread).
3. Entity aliases e intelligence entities no tienen lifecycle/version completo; el plan
   debe snapshotear digest y nunca depender de nombre mutable.
4. El source/import bridge sigue escribiendo labels study-first; debe llevar deprecation
   comments, telemetría y cero nuevos consumers.

### P2

1. Normalizar valores multivaluados de `Keywords`/`Tag` exige fixtures sin contenido
   sensible y un delimiter contract; hasta entonces el mapper puede conservar un term
   completo por campo, no adivinar separators.
2. Geolocation, Replied y Liked permanecen `unknown`; no bloquean el plan, pero sí su
   exposición typed.
3. Provider schema registry puede comenzar como catálogo cerrado en Query Engine; si se
   vuelve operator-configurable requerirá tabla/ADR, no JSON abierto.

## 13. Diez Decisiones Cerradas

| # | Decisión final | Tradeoff resuelto |
|---:|---|---|
| 1 | Plan current **por workspace**, no por provider | Source/query ya expresan provider; un plan por provider fragmentaría promotion y Brand OS drift |
| 2 | Slot conserva identidad lógica por `(workspace,slot_key)`; cada plan tiene una fila/version nueva | Permite snapshots inmutables y comparar historia sin mutar |
| 3 | Query version pertenece a la versión del slot dentro del plan | Sella exactamente qué plan se ejecutó; carry-forward explícito evita query flotante |
| 4 | Periodo vive en ambos: default/envelope en query, captura exacta en import | Cadencia reusable y archivo reproducible sin conflar intención con observación |
| 5 | Category requiere `intelligence_entities.category` activa e inequívoca; industry strings sólo generan blocker/proposal | No inventa identidad gobernada |
| 6 | Import antiguo con sólo `query_pack_id` queda `legacy-unplanned/unknown`; adapter read-only, copy sólo por operador | Preserva historia y ownership study-first |
| 7 | Observation grain es import membership/provider record, con refs directas a root/source | Conserva provenance por import; canonical mention sigue único store |
| 8 | Brand OS/entity/source/query/governance/import/merge invalidan readiness/derived projections según tabla de §10; nada reetiqueta historia | Fail-closed con incrementalidad |
| 9 | Automático: reconcile draft, hashes, typed projection, drift e invalidation. Operador: identity ambigua/reference, query, promotion/retiro y commercial rights | Automatiza sólo estado derivado |
| 10 | 10A.2 implementa schema/lifecycle, writers, contracts, import seal, typed mapper/projection y PG tests; no UI ni staging | Mantiene gates 10A.3/10A.4 separados |

## 14. Flight Card 10A.2 Ejecutada

### Preflight

1. releer AGENTS/canon y confirmar siguiente ordinal (hoy `0084`);
2. snapshot local del dirty worktree; preservar todo cambio ajeno;
3. confirmar cero remote env/commands y usar PostgreSQL desechable.

### Implementación, orden obligatorio

1. Migration forward-only: competitor lifecycle; plans/slots/query/events; import columns;
   typed observations/terms; constraints/triggers/comments/deprecation.
2. Drizzle schema y migration smoke.
3. Query Engine: enums, validators, canonical hashes, field mapper contract y hostile inputs.
4. Server writers con SERIALIZABLE/advisory locks/idempotency/events.
5. GET/reconcile/promote/query/retire routes y operator-safe errors.
6. Adapt source creation para connector-only manteniendo endpoint v1 como compatibilidad.
7. Extender create-upload/finalize/recovery para sellar/copy plan/slot/query/period.
8. Enlazar typed mapper al parser canónico; no segundo parser ni per-row fallback.
9. Invalidation Brand OS/catalog/source/query y competitor retirement.
10. PostgreSQL/contract/regression suite completa. Detenerse antes de frontend/staging.

### Gate de salida

- marca sintética, no Laika/Alexa, con primary/category/dos competitors y una reference
  explícita;
- una source sirve varios slots;
- plan draft→promote→retire/rollback auditable;
- import sellado y retry exacto;
- typed rows correctas sin raw API;
- historical imports unknown;
- slot intent no semantic approval;
- cross-workspace/idempotency/concurrency/Brand OS drift fail-closed;
- zero writes remotos/provider/jobs y validaciones verdes.

## 15. Archivos De La Implementación 10A.2

### Crear

- `infrastructure/db/migrations/0084_signal_acquisition_plan_control_plane.sql`
  (usar el ordinal realmente libre);
- `infrastructure/db/migrations/signal-acquisition-plan-contract.test.ts`;
- `packages/query-engine/src/signal-acquisition-plan-v1.ts` y `.test.ts`;
- `apps/studio/src/lib/data-os/signal-acquisition-plan.ts`, su integración PostgreSQL
  y sus pruebas estáticas de API;
- `apps/studio/src/app/api/data-os/signal/[workspaceId]/acquisition-plan/route.ts`;
- subroutes `promote`, `readiness`, `reference-decisions`,
  `slots/[slotKey]/query-versions`, `slots/[slotKey]/retire` e `imports`;
- helper typed mapper en `infrastructure/db/` importado por el parser canónico, con test.

### Modificar

- `infrastructure/db/schema/index.ts`, DB package scripts y migration smoke;
- `packages/query-engine/src/index.ts` y el contrato data-plane manteniendo v1 legacy;
- `apps/studio/src/lib/data-os/workspace-ingestion.ts`;
- `apps/studio/src/lib/data-os/workspace-async-import.ts`;
- ruta workspace imports y su polling/retry contract;
- `infrastructure/db/sentione-csv-ingest.ts` (un solo parser/persistence path);
- `services/workers/src/workers/mentions-csv-ingest.ts` sólo si necesita transportar el
  sello, no para duplicar parsing;
- Brand OS governance reconciler y competitor DELETE routes para lifecycle;
- OpenAPI, schema/API canon y tests estáticos correspondientes.

No modificar 0079–0083 ni migraciones previas. No crear corpus, assertion, population,
taxonomy, observation analítica o mention stores alternos.

## 16. Declaración De Cierre Local 10A.2

- Base remota leída: **no**.
- Base remota escrita: **no** (`remote_writes=0`).
- Provider calls de producto: **0**.
- Jobs enqueued: **0**.
- Imports/backfills remotos ejecutados: **0**.
- PostgreSQL local: **sí**, contenedor desechable creado desde cero y migraciones
  `0000–0084` aplicadas/reaplicadas.
- Frontend/readers/pointers/bindings modificados por 10A.2: **no**.
- Commit/push: **no**.

Validaciones locales: Query Engine 272/272; DB 76/76 ejecutados (25 opt-in omitidos);
Studio 359/359 ejecutados (1 skip); Workers 168/168 ejecutados (3 skips); integración
Acquisition 4/4; migration smoke 85 migraciones, 60 tablas y 48 índices requeridos.
Checksum final 0084:
`d959f17e1af5378d798bc1ca089bc6802bf6c3e8455a6054a98aeec3359fd26b`.

Advisor `claude-fable-5` cerró la segunda re-review con
`approve_with_p2_p3`, `can_advance=true` y P0/P1=0. La revisión final consumió 56,368
input / 2,204 output tokens (USD 0.67388). Las tres llamadas 10A.2 (review + dos
re-reviews) costaron USD 2.95256; el ledger agregado quedó en USD 14.61893 de USD 20.
Permanecen como deuda no bloqueante: el endpoint UUID de imports legacy (P2),
el default vacío de `source_key` protegido por trigger (P3) y definir explícitamente si
recovery queda permitido mientras un connector está paused (P3). Ninguno es autoridad
del path target; deben revisarse en 10A.3/operación antes del retiro legacy.

Evidence manifest 0600:
`.data/signal-acquisition-plan/backend-10a2/manifest.sanitized.json`, SHA-256
`8258ab1638659f65a980cc2ebba1a69cf213ee940b30fa0fe7e009d20db4c02a`.

No se modificó el documento 31 porque no apareció una contradicción con el North Star.

## 17. Cierre Frontend 10A.3

**Registrado:** 2026-08-15T17:47:04-06:00 (`America/Mexico_City`).

Data & Sources dejó de modelar una source por scope. La superficie canónica ahora:

- prepara y reconcilia el draft de Acquisition Plan desde Brand OS;
- exige una identidad gobernada de categoría y muestra un blocker accionable si falta;
- materializa un slot de marca primaria, uno de categoría y uno por competidor activo;
- crea conectores provider-owned sin `scope/entity` y reutiliza uno entre varios slots;
- crea queries privadas, versionadas y con periodo/timezone por slot;
- muestra readiness y bloquea promoción hasta resolver queries y governance;
- promueve el plan completo con evidence en una sola transición auditable;
- habilita import únicamente sobre slots current y sella query, periodo y timezone;
- lista historial filtrado por `source_key + slot_key` y conserva retry-from-storage;
- mantiene referencias como decisiones explícitas include/exclude/revert.

El QA browser se ejecutó contra PostgreSQL local desechable con una marca creada desde
la UI, categoría `Smart speakers QA`, dos competidores, cuatro slots, un conector, cuatro
queries, policies, provenance y promoción a plan current. El drawer de import mostró el
periodo `2026-01-01`–`2026-08-15` y `America/Mexico_City` heredados de la query. El
historial vacío fue slot-scoped y el responsive pasó a 390 × 844 px. No se transfirió un
CSV porque el storage configurado pertenece a staging y este rehearsal no autorizaba
cruzarlo con la base local.

El recorrido descubrió y corrigió dos defectos de integración:

1. el alta de marca legacy no enviaba `status/effective_from/updated_at` al lifecycle
   versionado de competidores de 0084;
2. un plan current mostraba blockers de creación de draft y acciones de edición directa;
   ahora la edición exige `Editar plan`, mientras import e historial permanecen current.

También se cerró el caso de cero categorías como `category_identity_required`; no puede
activarse silenciosamente un plan greenfield que omita el slot category.

### 17.1 Delta de QA: generación automática y pulido

**Registrado:** 2026-08-15T18:17:34-06:00 (`America/Mexico_City`).

El estado vacío observado es válido para el fixture local, pero la experiencia todavía
requiere pulido serio antes de ser client-ready: first-use guiado, jerarquía y copy menos
técnicos, helpers accesibles, skeleton/error/empty states canónicos y acciones claras a
nivel plan y slot.

Más importante: el campo manual de query no es la entrada principal del producto. El
Query Engine existente ya genera primary, category y queries separadas por competidor
desde Brand OS + Study OS/Knowledge RAG. 10A.5 debe adaptarlo al ownership workspace-owned
de 0084: propuesta `engine-generated`, validación vigente, query version append-only,
review y aprobación humana. La edición manual permanece como override
avanzado y auditable, no como tarea inicial obligatoria.

La query de este contrato es la expresión externa que se ejecuta en SentiOne para traer
menciones. No es SQL interno ni el Topic & Narrative Contract que clasifica el corpus ya
importado. 10B comienza después de cerrar 10A.5. 10A.4 continúa siendo un rehearsal remoto
con autorización separada, no una migración para rescatar fixtures.

Advisor Fable 5 rechazó el primer prompt 10A.5 por mezclar backend, compiler, async
orchestration, API family y polish frontend. También confirmó que clonar el motor o
conectar el plan a `study_corpus/query_iterations` crearía una segunda arquitectura. El
orden corregido es 10A.5A —núcleo puro compartido, adapter workspace-owned, Acquisition
Brief sellado y extensión mínima `engine-generated`— seguido por 10A.5B —review/approval
y first-use— y después 10B.

### 17.2 Implementación local 10A.5A

**Registrada:** 2026-08-15 (`America/Mexico_City`).

La migración aditiva `0085_signal_workspace_query_composer.sql` implementa el delta sin
reabrir 0084: sella el Acquisition Brief dentro del agregado draft y permite
`origin_kind='engine-generated'` únicamente con lineage tipado y protegido. El checksum
local es `f36a32c1562147c0c94e7e00927d04902f4c4c3df446a5b28ea8ea3ff7b419d4`.

El contrato final conserva una sola implementación del compositor. Study OS traduce su
input legacy mediante un adapter; el servicio Acquisition Plan resuelve server-side el
draft, Brand OS, category, competitors, source y Knowledge workspace-owned. Invoca un
provider inyectable, valida el set exacto por `slot_key` y persiste drafts mediante el
writer canónico. Reference no se genera, regeneration crea supersession y nunca se
promueve el plan ni se toca una query usada por un import.

El preflight de aplicación es read-only y declara slots, modelo/pricing, dos llamadas
máximas, estimate, hard cap y CAS de plan/context. No se añadió HTTP, BullMQ, run ledger,
provider real o UI; esos boundaries pertenecen a 10A.5B. Smoke `0000–0085`, reapply e
integración PostgreSQL greenfield quedaron verdes sin conexiones remotas.

### 17.3 Implementación local 10A.5B

**Registrada:** 2026-08-16 (`America/Mexico_City`).

El Query Composer workspace-owned ya tiene transporte HTTP management-only. `GET
query-generation` ejecuta un preflight gratuito y read-only; `POST` exige
`Idempotency-Key`, connector, hard cap y `confirmation=true`, mantiene API key/provider
server-side y limita el compositor a dos llamadas. La persistencia vuelve a comprobar el
CAS de plan/contexto y crea sólo query versions draft.

Admin reutiliza componentes canónicos para el flight card, estados y drawer. El operador
genera/regenera el set completo, inspecciona cada query y sus términos, ve fallback y
comparación contra current, y puede aprobar, rechazar o abrir el editor avanzado. El
editor siempre crea otra versión append-only; nunca muta el texto existente.

La migración 0086 añade un ledger append-only para review por query version. Una versión
nueva queda `pending`; la última decisión `approved/rejected` se expone operator-safe y
pending/rejected bloquean promoción. Approval no se hereda por supersession, no activa
un import y nunca concede Review semántico a menciones.

El browser QA local de 10A.5B pasó el 2026-08-16 en desktop (1280 px y 917 px) y
móvil (390 × 844). Se comprobaron el plan, los slots, el preflight gratuito, el flight
card bloqueado y el review drawer. La corrida observada declaró cuatro queries, dos
llamadas máximas, estimate USD 0.27 y hard cap USD 1.00; no se ejecutaron provider calls.

## Corrección 10A.6 · Query Evidence V2

El supuesto “query exacta” queda retirado para CSV manual. Una query versionada conserva
intención y memoria operacional, pero sólo un adapter server-side puede probar ejecución.
El contrato definitivo es:

- `provider_verified`: query y evidencia de ejecución server-side obligatorias;
- `operator_attested`: query versionada, actor y timestamp obligatorios;
- `unavailable`: query `NULL`, razón cerrada y confirmación del operador.

Los imports target V2 siguen sellando plan, slot, source, periodo/timezone y digests. El
query playbook ya no es requisito absoluto de promoción/import para un connector manual:
`ready_for_import` y `query_playbook_complete` son estados distintos. Historia anterior
permanece V1 o `legacy-unplanned/unknown`; no hay backfill heurístico.

`source_intent` toma scope/entity exclusivamente del slot y sólo proyecta evidencia para
lineage. Queda pendiente/no elegible y nunca transforma attestation en semantic approval.
Query editing y Query Composer siguen append-only; completar el playbook después no
reescribe imports anteriores ni mejora artificialmente su evidence class.
