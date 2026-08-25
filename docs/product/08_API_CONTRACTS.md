# Noisia Studio — API Contracts MVP

> Endpoints que el Studio expone. Construidos como Next.js Route Handlers en `apps/studio/src/app/api/`. Cada endpoint tiene método, payload, response, auth requerido y descripción.

---

## 1. Convenciones

- **Base URL desarrollo:** `http://localhost:3001/api`
- **Base URL producción:** `https://studio.noisia.ai/api`
- **Auth:** Kinde session (cookie). Si no hay sesión válida → `401 Unauthorized`.
- **Auth roles:** especificados por endpoint. Si la sesión no tiene el rol → `403 Forbidden`.
- **Errors:** formato uniforme `{ "error": "code", "message": "human readable", "details": {...} }`.
- **Pagination:** `?page=1&pageSize=50`, response incluye `{ data: [...], pagination: { page, pageSize, total } }`.
- **Validation:** Zod schemas server-side. Errores de validación → `422 Unprocessable Entity` con `details.fields[]`.

---

## 2. Auth endpoints

### `GET /api/auth/me`
Devuelve la sesión actual del usuario.

**Auth:** sesión válida
**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "alba@church-dwight.com",
    "full_name": "Alba García",
    "user_type": "client",
    "primary_role": "client_owner",
    "organization": {
      "id": "uuid",
      "name": "Church & Dwight",
      "slug": "church-dwight"
    },
    "accessible_brands": [
      { "id": "uuid", "name": "Oxiclean", "slug": "oxiclean" }
    ]
  }
}
```

### `POST /api/auth/logout`
Cierra sesión.

---

## 3. Organizations endpoints

### `GET /api/organizations`
Lista de organizaciones que el usuario puede ver.

**Auth:** founder, admin → todas. KAM → sus org asignadas. Cliente → solo su org.
**Response:** array de `{ id, slug, legal_name, display_name, status, brand_count }`

### `GET /api/organizations/:id`
Detalle de una organización.

### `POST /api/organizations`
Crear organización. **Auth:** founder, admin.

**Body:**
```json
{
  "slug": "church-dwight",
  "legal_name": "Church & Dwight Co Inc",
  "display_name": "Church & Dwight",
  "hq_country": "US",
  "industry_primary": "cpg",
  "is_holding": true,
  "status": "active",
  "account_owner_kam_id": "uuid"
}
```

### `PATCH /api/organizations/:id`
Editar. Mismos campos que POST.

---

## 4. Brands endpoints

### `GET /api/brands`
Lista marcas que el usuario puede ver. Filtros: `?organization_id=...&industry=...`.

### `GET /api/brands/:id`
Detalle. Incluye competidores configurados.

### `POST /api/brands`
Crear marca.

**Body:**
```json
{
  "organization_id": "uuid",
  "slug": "seguros-el-potosi",
  "name": "Seguros El Potosí",
  "industry": "seguros",
  "industry_sub": "seguros_auto",
  "countries": ["MX"],
  "brand_seed_handles": ["@SegurosElPotosi", "Seguros El Potosí"],
  "status": "active",
  "primary_brand_manager_user_id": "uuid"
}
```

### `POST /api/brands/:id/competitors`
Agregar competidor.

**Body:**
```json
{
  "competitor_brand_seed_id": "uuid",
  "priority": 1
}
```

### `DELETE /api/brands/:id/competitors/:competitor_id`

---

## 5. Themes endpoints (estudios temáticos sin marca)

### `GET /api/themes`
Lista temas.

### `POST /api/themes`
Crear tema. **Auth:** insights_manager, admin, founder.

**Body:**
```json
{
  "slug": "cultural-foresight-mexico-2026",
  "name": "Cultural Foresight México 2026",
  "description": "8 señales sobre cansancio de performance",
  "industry_focus": ["general"],
  "geo_focus": ["MX"],
  "status": "draft",
  "is_public": true
}
```

---

## 6. Methodologies endpoints

### `GET /api/methodologies`
Catálogo activo.

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "triggers-barriers",
      "name": "Triggers & Barriers",
      "version": "1.0",
      "status": "active",
      "manifest": { /* objeto YAML parseado */ }
    },
    ...
  ]
}
```

### `GET /api/methodologies/:slug`
Detalle con manifest completo.

### `POST /api/methodologies` (admin only)
Registrar nueva metodología.

**Body:**
```json
{
  "slug": "...",
  "name": "...",
  "version": "1.0",
  "manifest_yaml": "...string YAML completo..."
}
```

---

## 7. Study Corpora endpoints

El núcleo del producto.

### `GET /api/corpora`
Lista corpora. Filtros: `?brand_id=...`, `?theme_id=...`, `?methodology_id=...`, `?status=...`.

### `POST /api/corpora`
Crear nuevo study corpus.

**Body (caso marca):**
```json
{
  "brand_id": "uuid",
  "methodology_id": "uuid",
  "business_question": "...",
  "decision_to_inform": "...",
  "audience_segment": "...",
  "geo_focus": ["MX"],
  "target_window_months": 12,
  "context_form": { /* formulario completo */ }
}
```

**Body (caso tema):**
```json
{
  "theme_id": "uuid",
  "methodology_id": "uuid",
  "business_question": "...",
  ...
}
```

**Validation:** exactamente uno de `brand_id` o `theme_id` debe estar presente.

### `GET /api/corpora/:id`
Detalle.

### `PATCH /api/corpora/:id`
Editar configuración. Status del corpus determina qué se puede editar.

### `POST /api/corpora/:id/run-engine`
Disparar el Engine de Validación de Queries.

**Body:**
```json
{
  "iteration_strategy": "auto" | "manual",
  "max_iterations": 5
}
```

**Response:**
```json
{
  "job_id": "uuid",
  "status": "queued",
  "polling_url": "/api/jobs/:job_id"
}
```

### `GET /api/corpora/:id/query-iterations`
Histórico de iteraciones del Engine para este corpus.

### `POST /api/corpora/:id/approve-corpus`
Insights Manager firma que el corpus está listo.

**Auth:** insights_manager con acceso a esta marca/tema.

### `POST /api/corpora/:id/run-analysis`
Disparar análisis end-to-end de la metodología.

**Body:**
```json
{
  "triggered_by": "manual",
  "force_reanalysis": false
}
```

### `POST /api/corpora/:id/approve-output`
Aprobar el output para publicación al cliente.

---

## 8. Mentions endpoints

### `GET /api/corpora/:id/mentions`
Browser de menciones del corpus. Pagination + filtros.

**Filtros:** `?inclusion_status=included&platform=tiktok&search=mi+casita&mx_only=true&date_from=2026-01-01`

### `GET /api/mentions/:id`
Detalle de una mención incluido raw_metadata.

### `POST /api/corpora/:id/mentions/csv-upload`
Subir CSV manual de menciones.

**Body:** `multipart/form-data` con `file: <csv>` + `source_label: "sentione_export_q2"`.

**Response:**
```json
{
  "import_batch_id": "uuid",
  "stats": {
    "record_count": 1234,
    "included_count": 980,
    "excluded_count": 254,
    "duplicate_count": 12
  }
}
```

### `POST /api/mentions/:id/manual-exclude`
Insights Manager excluye manualmente una mención.

**Body:**
```json
{
  "reason": "ruido_emergente_bimbo_nsfw"
}
```

---

## 9. Findings endpoints

### `GET /api/corpora/:id/findings`
Hallazgos del corpus actual.

### `GET /api/findings/:id`
Detalle con evidencia.

### `PATCH /api/findings/:id`
Editar hallazgo (Insights Manager curating).

**Body parcial:**
```json
{
  "commercial_name": "...",
  "one_liner": "...",
  "cultural_reading": "...",
  "movilidad": "movible_por_marca",
  "confidence_level": "alta",
  "status": "validated"
}
```

### `POST /api/findings/:id/evidence-quotes`
Agregar cita curada al finding.

**Body:**
```json
{
  "mention_id": "uuid",
  "ordered_position": 1,
  "is_lead_quote": true,
  "display_text": "...optional excerpt...",
  "attribution_override": "@user_handle"
}
```

### `DELETE /api/findings/:id/evidence-quotes/:quote_id`

### `POST /api/findings/:id/regenerate-with-humanizer`
Re-pasar cultural_reading + headlines por el skill humanizer.

---

## 10. Dashboards endpoints

### `GET /api/corpora/:id/dashboard`
Configuración actual del dashboard del corpus.

**Response:**
```json
{
  "id": "uuid",
  "current_analysis_run_id": "uuid",
  "status": "published",
  "client_url_slug": "abc123",
  "layout_config": {
    "blocks": [
      { "block_id": "hero_stats", "ordered_position": 1, "visible": true, "props_override": {} },
      { "block_id": "tb_matrix_4layers", "ordered_position": 2, "visible": true, "props_override": {} },
      ...
    ]
  },
  "scrollytelling_config": { ... }
}
```

### `PATCH /api/corpora/:id/dashboard`
Editar layout: agregar/quitar bloques, reordenar.

### `POST /api/corpora/:id/dashboard/publish`
Publicar al cliente. Genera `client_url_slug`.

### `GET /api/dashboards/:slug`
Acceso del cliente al dashboard publicado. Auth: usuario con acceso a esta marca/tema.

### `GET /api/dashboards/:slug/scrollytelling`
Vista Scrollytelling de la misma data.

### `GET /api/dashboards/:slug/export.pdf`
Genera PDF con Puppeteer. Response: binary PDF.

### `GET /api/dashboards/:slug/export.csv`
CSV de findings + evidencia + métricas.

### `GET /api/dashboards/:slug/export.md`
Markdown del análisis completo.

---

## 11. Blocks catalog endpoints

### `GET /api/blocks/catalog`
Banco completo de bloques disponibles.

**Filtros:** `?methodology_compatible=triggers-barriers&category=universal`

### `GET /api/blocks/:block_id/preview`
Preview con datos demo. Útil para que el Insights Manager elija qué agregar.

---

## 12. Comments endpoints

### `GET /api/dashboards/:slug/comments`
Comentarios del cliente sobre el dashboard.

### `POST /api/dashboards/:slug/comments`
Cliente comenta.

**Body:**
```json
{
  "block_instance_id": "uuid",  // opcional
  "finding_id": "uuid",          // opcional
  "comment_text": "...",
  "reaction": "important",       // opcional
  "parent_comment_id": "uuid"    // si es reply
}
```

### `PATCH /api/comments/:id/address`
Insights Manager marca un comentario como atendido.

---

## 13. Change requests endpoints

### `POST /api/dashboards/:slug/change-requests`
Cliente pide cambio formal.

**Body:**
```json
{
  "related_finding_id": "uuid",
  "request_text": "...",
  "request_type": "edit_finding"
}
```

### `GET /api/change-requests`
Lista para Insights Manager. Filtros: status, assigned_to.

### `PATCH /api/change-requests/:id`
Actualizar status, asignar, resolver.

---

## 14. Integrations endpoints

### `GET /api/integrations`
Lista integraciones configuradas.

### `POST /api/integrations`
Crear nueva integración (LinkedIn API custom, Apify, webhook).

**Body:**
```json
{
  "name": "Apify LinkedIn Actor",
  "integration_type": "apify_actor",
  "config": {
    "api_key": "encrypted_value",
    "actor_id": "...",
    "endpoint": "..."
  },
  "field_mapping": {
    "text": "$.text",
    "author_handle": "$.author.handle",
    "published_at": "$.timestamp",
    "url": "$.url",
    "platform": "linkedin"
  }
}
```

### `POST /api/integrations/:id/test`
Trigger validación de 10 menciones de prueba.

**Response:**
```json
{
  "valid": true,
  "sample_mentions": [...],
  "issues": []
}
```

### `POST /api/integrations/:id/activate`

---

## 15. Memory endpoints

### `GET /api/memory/industry?industry=seguros&methodology=triggers-barriers`
Aprendizajes acumulados que el Engine consulta.

### `POST /api/memory/industry`
Insights Manager agrega aprendizaje manual.

### `GET /api/memory/brand/:brand_id`
Memoria específica de una marca.

### `POST /api/corpora/:id/feedback`
Insights Manager registra qué funcionó/no funcionó en este corpus. Alimenta memoria methodology + industry.

---

## 16. Data OS serving endpoints (Cut 1 / shadow)

### Signal backend contract v1

`signal-backend-v1` es el contrato compartido previo a las rutas workspace-centric de
Signal. Vive en `@noisia/query-engine` y puede ser importado por Studio y workers sin
depender de `apps/studio`. SB-01 no crea endpoints: las rutas futuras deben usar estos
tipos y validadores sin reinterpretar filtros, watermarks o estados faltantes.

#### Identidad y locator

El locator siempre incluye `organization_id` y exactamente uno de `workspace_id` o
`workspace_slug`. La identidad resuelta agrega el sujeto estable (`brand` o `theme`) y
timezone IANA. El locator no concede acceso; el resolver de SB-02 aplica authZ desde la
DB antes de devolver identidad o corpora.

```json
{
  "contract_version": "signal-backend-v1",
  "organization_id": "uuid",
  "workspace_slug": "laika-mexico"
}
```

#### Filtro canónico

```json
{
  "contract_version": "signal-backend-v1",
  "date_range": { "start": "2026-05-01", "end": "2026-05-31" },
  "timezone": "America/Mexico_City",
  "granularity": "day",
  "text_search": "entrega rápida",
  "dimensions": {
    "platform": ["instagram", "tiktok"],
    "sentiment_polarity": ["negative", "positive"]
  }
}
```

Reglas de canonicalización:

- fechas estrictas `YYYY-MM-DD`, rango inclusivo y `start <= end`;
- timezone validada y resuelta a su identificador IANA canónico;
- granularidad canónica `day`, `week` o `month`; aliases `daily`, `weekly` y
  `monthly` son válidos;
- claves y aliases de dimensión se resuelven antes de validar;
- valores multiselect usan Unicode NFC, trim, espacios internos colapsados y lowercase;
- vacíos y duplicados se eliminan; arrays se ordenan por bytes UTF-8;
- dimensiones se emiten siempre en el orden de `SIGNAL_DIMENSIONS`;
- `text_search` es opcional, Unicode NFC, whitespace colapsado, lowercase,
  case-insensitive y máximo 200 caracteres; aliases `search`, `query` y `q`;
- una dimensión desconocida responde `unsupported_dimension`, nunca se ignora.

Dimensiones V1, en orden canónico:

`platform`, `source_type`, `entity`, `product`, `campaign`, `topic`, `narrative`, `taxonomy`,
`signal`, `signal_lifecycle`, `audience`, `demographic`, `journey_stage`, `trigger`,
`barrier`, `sentiment_polarity`, `emotion`, `country`, `language`, `content_format`.

Aliases aceptados incluyen `platforms → platform`, `source → source_type`,
`lifecycle → signal_lifecycle`, `sentiment|polarity → sentiment_polarity` y
`content_type|format → content_format`. Query params aceptan nombres directos o
`dimension.<key>` / `dimensions.<key>`, valores repetidos y listas separadas por coma.
El orden de params nunca cambia el filtro normalizado. El serializer canónico emite
`start`, `end`, `timezone`, `granularity` y después `dimension.<key>` en el orden
cerrado de dimensiones, repitiendo cada valor ya ordenado.

#### `filters_hash`

El algoritmo V1 es determinístico y no depende del orden de objetos recibido:

1. Validar y normalizar el filtro con las reglas anteriores.
2. Serializar JSON UTF-8 sin whitespace con claves top-level en este orden:
   `contract_version`, `date_range`, `timezone`, `granularity`, `dimensions` y,
   sólo cuando existe, `text_search`.
3. Serializar `date_range` como `start`, `end` y `dimensions` como una lista ordenada
   de tuplas `[dimension, values]` para no depender del orden de claves JSON.
4. Calcular SHA-256 sobre esos bytes.
5. Emitir lowercase como `sha256:<64 hex>`.

Toda request que envíe filtro y hash debe reconciliar ambos. Un mismatch es
`invalid_filter`. El hash identifica el scope de métricas, interpretaciones y cursores;
no es una firma de seguridad.

#### Metric query, series y breakdown

```json
{
  "contract_version": "signal-backend-v1",
  "workspace": {
    "contract_version": "signal-backend-v1",
    "organization_id": "uuid",
    "workspace_id": "uuid"
  },
  "metric_key": "conversation.volume",
  "metric_version": 1,
  "filter": {},
  "filters_hash": "sha256:...",
  "comparison_date_range": { "start": "2026-03-31", "end": "2026-04-30" },
  "breakdown_dimension": "platform"
}
```

El filtro del ejemplo se abrevia; en wire debe ser `SignalFilterV1` completo. Una ventana
comparativa debe tener el mismo número de días calendario y no traslaparse. Series
devuelven puntos ordenados y no traslapados; breakdowns rechazan buckets duplicados.
Cada punto/bucket contiene `value`, `denominator`, `sample_size` y `state`. Un dato
ausente usa `null` + `not_available`; nunca se convierte silenciosamente en cero.

#### Watermark y freshness

`DataWatermarkV1` identifica `workspace_id`, `corpus_id`, `corpus_revision`, sync runs
aceptados, `data_through_at`, `accepted_at` y `materialized_at`. Instantes se normalizan
a UTC ISO-8601, sync IDs se deduplican/ordenan y `materialized_at` no puede preceder a
`accepted_at`.

`DataFreshnessV1` usa `fresh | stale | partial | not_available` y lleva el watermark
de datos. `InterpretationFreshnessV1` es independiente, usa
`fresh | stale | pending | partial | not_available` y queda ligado a `filters_hash`,
`data_watermark_hash` e `interpretation_watermark_hash`. Data fresca no implica una
interpretación fresca.

#### Drill-down cursor y errores

El cursor es JSON V1 opaco codificado como base64url. Queda ligado a `metric_key`,
`filters_hash` y al sort estable `(occurred_at, subject_id)`. Un cursor con versión,
hash, métrica o forma inválida responde `invalid_filter`; el consumidor debe verificar
además que métrica/hash coincidan con la request activa.

Formato de error:

```json
{
  "contract_version": "signal-backend-v1",
  "error": "invalid_filter",
  "message": "filters_hash does not match the canonical filter.",
  "details": { "field": "filters_hash" }
}
```

Códigos cerrados V1: `invalid_filter`, `unsupported_dimension`, `stale`, `partial` y
`not_available`.

#### Persistencia y resolución de workspace (SB-02)

`signal_workspaces` es la identidad permanente de un Signal y pertenece a una
organización con exactamente uno de `brand_id` o `theme_id`. `(organization_id, slug)`
y el sujeto son únicos; timezone, status y metadata pertenecen al workspace, no a un
output. `signal_workspace_corpora` conserva la relación temporal con `study_corpora`
usando `operational`, `strategic` o `legacy`. Triggers de integridad impiden enlazar un
sujeto o corpus de otra organización incluso si se entrega un UUID válido.

El resolver interno acepta `{ workspaceId, organizationId }` o
`{ workspaceSlug, organizationId }`. Usuarios Noisia pueden resolver cualquier scope;
clientes necesitan la misma organización y, para workspaces de marca, acceso activo en
`user_brand_access`. Una denegación y un workspace inexistente devuelven el mismo
resultado nulo para no filtrar existencia.

Backfill protegido, dry-run por default:

```bash
corepack pnpm --filter @noisia/studio signal:backfill-workspaces
# apply sólo en local o staging/preview aprobado:
NOISIA_SIGNAL_WORKSPACE_BACKFILL_ALLOW_REMOTE=true \
NOISIA_REMOTE_DATABASE_TARGET=staging \
corepack pnpm --filter @noisia/studio signal:backfill-workspaces -- --apply
```

El resumen sólo imprime conteos, es idempotente y la unión corpus/workspace exige
subject y organización coincidentes.

Mapping transitorio legacy: `/signal/{outputId}` y `/api/data-os/pulse/:outputId/*`
siguen resolviendo y sirviendo el output publicado sin cambios. Cuando un consumidor
necesita la identidad nueva, `resolveLegacyOutputSignalWorkspaceForUser` sigue
`published_outputs.study_corpus_id → signal_workspace_corpora → signal_workspaces` y
vuelve a aplicar authZ. Este mapping es sólo compatibilidad; nuevas APIs no deben usar
`published_outputs` como raíz ni como source of truth.

#### Refresh recurrente, watermarks e invalidación (SB-03)

`signal_refresh_policies` gobierna cada `workspace_id + source_key`: adapter, cadence
(`manual | hourly | daily | weekly | monthly`), timezone, owner,
`expected_next_run` y `enabled`. Toda policy nace `enabled=false`; el scheduler además
requiere `NOISIA_DATA_OS_WORKER_ENABLED=true` y
`NOISIA_SIGNAL_REFRESH_SCHEDULER_ENABLED=true`. El tick BullMQ tiene identidad estable
por deploy y sólo encola policies vencidas.

Una aceptación usa la operación compartida `recordSignalDataAcceptance` y la función
transaccional `record_signal_data_acceptance`. El evento debe ser exactamente uno:
`source_sync_run_id` completado o `import_batch_id` completado, y debe pertenecer al
corpus. La misma aceptación repetida no avanza el watermark ni crea otra invalidación.
CSV síncrono/asíncrono, performance uploads y materialización de knowledge sources usan
esta operación.

`signal_data_watermarks` separa:

- source freshness (`fresh | stale | partial | failed | not_available`);
- data freshness (`fresh | stale | partial | not_available`);
- corpus revision, último sync/import aceptado, máxima observación, accepted/materialized
  timestamps y `stale_after`.

`signal_interpretation_freshness` conserva por separado el estado interpretativo ligado
a metric group, `filters_hash` y hashes de watermark. Nueva data no se presenta como
texto fresco: la invalidación sólo marca interpretaciones que declaran dependencia del
corpus/source en `data_scope`.

`signal_refresh_runs` conserva idempotency key, job, trigger, attempt, status y error
sanitizado. Estados terminales: `completed`, `skipped` o `dead_letter`. Los workers usan
job IDs estables, advisory locks, tres intentos y backoff exponencial. El adapter V1
opera sobre imports manuales y `source_sync_runs` ya completados; un pull automático de
SentiOne sigue siendo adapter pendiente.

`signal_data_invalidations` lleva la ventana afectada y scope. El processor marca stale
sólo materializaciones del corpus cuyo `report_period` traslapa esa ventana, y sólo
freshness interpretativa con dependencia explícita. No modifica outputs publicados ni
strategic releases y no invoca Claude.

#### Social Listening metric catalog V1 (SB-04)

El registry canónico continúa siendo `metric_definitions`; `semantic_models` agrupa las
medidas bajo `signal_social_listening_v1`. No existe una tabla paralela de métricas.
`@noisia/query-engine` exporta `SIGNAL_METRIC_CATALOG_V1`, que es la fuente compartida
para seeds, planner, workers y serving.

`metric_definitions` identifica cada fórmula por `(metric_key, version)` y agrega
`metric_group_key`, `formula_hash` y `visibility`. Key y version son inmutables. Un
trigger rechaza un cambio de `definition.formula` dentro de la misma versión; una nueva
fórmula exige insertar otra versión. El seed es idempotente y protegido por los mismos
guardrails de DB:

```bash
corepack pnpm --filter @noisia/db db:seed:signal-metrics
```

Catálogo V1:

| Group | Metric key | Fórmula / denominador | Unit | Visibilidad |
|---|---|---|---|---|
| conversation volume and velocity | `conversation.volume@1` | count de mentions incluidas / ninguno | count | both |
| conversation volume and velocity | `conversation.velocity@1` | `(current - previous) / previous`; previous period igual en días | ratio | both |
| sentiment and emotion | `sentiment.share@1` | bucket polaridad / mentions con polaridad aceptada | ratio | both |
| sentiment and emotion | `emotion.share@1` | bucket emoción / mentions con emoción aceptada | ratio | both |
| platform and source mix | `platform.share@1` | bucket plataforma / mentions con plataforma | ratio | both |
| platform and source mix | `source_type.share@1` | bucket source type / mentions clasificadas | ratio | internal |
| engagement | `engagement.total@1` | suma de componentes gobernados observados / ninguno | count | both |
| engagement | `engagement.average_per_mention@1` | engagement / mentions con medición | ratio | both |
| topics, narratives and governed entities | `topic.volume@1` | mentions distintas con topic aprobado; shares / included o classified mentions | count | both |
| topics, narratives and governed entities | `narrative.volume@1` | mentions distintas con narrative aprobada; shares / included o classified mentions | count | both |
| topics, narratives and governed entities | `governed_entity.volume@1` | mentions distintas con entity link aceptado / ninguno | count | both |

Cada definición incluye fórmula estructurada, SHA-256 de fórmula, grains
`day/week/month`, dimensiones tomadas exclusivamente de `SignalFilterV1`, visibilidad
por dimensión, null semantics, comparabilidad, quality rules y
`drill_down_subject=mention`. Un cero sólo es cero cuando fue observado; falta de
cobertura o denominador produce `not_available`, y cobertura incompleta produce
`partial`. `source_type` permanece interno aun cuando otra dimensión del metric sea
client-visible.

Campaign/event impact queda condicionado a cobertura futura; no forma parte del core
V1. T&B movement pertenece a SB-09. SB-04 no materializa datos ni crea endpoints.

#### Deterministic metric materialization V1 (SB-05)

`@noisia/query-engine` exporta el planner `signal-materialization-v1`. Éste acepta
únicamente un `SignalFilterV1` normalizado y una lista gobernada de corpora. Tanto el
agregado como el drill-down reutilizan el mismo predicate SQL parameterizado y su
fingerprint; no existe un segundo traductor de filtros. El planner rechaza más de 366
días, más de seis dimensiones, más de 50 valores por dimensión o dimensiones que la
versión de la métrica no soporta.

El worker materializa los cinco metric groups en `day`, `week` y `month` desde
`mentions`, `record_tags`, `record_entity_links` y `record_feature_values`. Por cada
periodo persiste en `metric_materializations`: workspace/corpus, definición y versión,
group, filtro normalizado, `filters_hash`, value/denominator/sample size, payload
tipado, quality, watermark + hash, `computed_at`, `stale_after`, estado y cache scope.
Los estados son `fresh | stale | pending | partial | not_available`; ausencia de
cobertura o denominador usa `null`, no cero.

La identidad de fila es SHA-256 sobre workspace, corpus, métrica/version, grain,
periodo y `filters_hash`. El watermark no participa en esa identidad: un avance de
datos invalida y actualiza la misma fila de manera idempotente. La invalidación de
SB-03 selecciona únicamente periodos traslapados y encola un job deduplicado; el worker
usa advisory lock y el Data OS worker continúa apagado por default.

Cache policy:

- `default`: filtro sin dimensiones;
- `precomputed`: una dimensión canónica entre platform, source type, country o
  language con un valor; máximo ocho filtros por ventana;
- `ad_hoc`: cualquier otra combinación aceptada, TTL de 15 minutos y sin fan-out
  automático.

Ventanas operativas mayores a 366 días se parten determinísticamente para el job; una
request individual sigue limitada a 366. `chart_aggregates` no se lee como source of
truth ni se reescribe: queda disponible sólo para adaptadores legacy. El planner y el
worker tampoco leen `published_outputs.payload`.

EXPLAIN protegido para el siguiente operador con Postgres local:

```bash
corepack pnpm --filter @noisia/db signal:materialization:explain
# sólo local, para ejecutar además el plan:
NOISIA_SIGNAL_EXPLAIN_ANALYZE=true \
corepack pnpm --filter @noisia/db signal:materialization:explain
```

El comando redacta identidades. Un target remoto requiere override explícito y target
staging/preview/throwaway; producción se rechaza.

#### Signal workspace serving APIs V1 (SB-06)

Base protegida: `/api/data-os/signal/:workspaceId/*`. `workspaceId` es siempre la
identidad estable de SB-02; nunca se interpreta como `outputId`. Las rutas requieren
sesión Studio, authZ de organización/brand y tres switches explícitos:

```text
NOISIA_DATA_OS_ENABLED=true
NOISIA_DATA_OS_SERVING_ENABLED=true
NOISIA_SIGNAL_WORKSPACE_API_ENABLED=true
```

Los defaults del repositorio son `false`. El cache ad hoc tiene un cuarto switch
independiente, también `false`: `NOISIA_SIGNAL_AD_HOC_MATERIALIZATION_ENABLED`.

El scope operacional se resuelve una vez en el boundary autenticado del workspace con
una sola configuración cerrada por default:

```text
NOISIA_SIGNAL_OPERATIONAL_READ_MODE=legacy | shadow | governed
```

- `legacy` (default) exige un único corpus operational/legacy y conserva el reader
  anterior.
- `shadow` sirve exactamente el payload legacy. La ruta sólo persiste una solicitud
  compacta en el outbox deduplicado; Brand Monitoring, Mentions y Topics & Narratives
  se comparan después de enviar la respuesta. Un lease fallido queda recuperable y
  nunca se guarda texto de menciones.
- `governed` sirve el current pointer operacional `primary_brand`. Una definición
  ausente, retirada o que mezcle scopes responde `not_available`; nunca cae
  silenciosamente a legacy.

El cliente no envía `population_id`. Tampoco puede usar `dimension.corpus_scope` para
ampliar la población gobernada. Competitor, category, reference y unattributed se
conservan en el workspace, pero una futura exploración de esos scopes deberá resolver
otra población gobernada server-side; no son filtros que contaminen el denominador
primario.

Este corte es **Fase 4A: operational serving primary-brand**. Los filtros cliente para
competitor/category están aplazados hasta que exista una población de exploración
server-owned; no forman parte del contrato 4A y no se aceptan como valores arbitrarios
del navegador.

| Route | Semántica |
|---|---|
| `GET /api/data-os/signal/:workspaceId/bootstrap` | identity, subject, read scope, corpus opcional, coverage, data/interpretation freshness y estado por group |
| `GET /api/data-os/signal/:workspaceId/brand-monitoring` | home, periodo/comparison, volumen, sentimiento, plataformas, emociones, topics, narratives, drivers, series, breakdowns y freshness bajo un único scope |
| `GET /api/data-os/signal/:workspaceId/facets` | facets y counts bajo el filtro actual; `source_type` sólo para usuarios internos |
| `GET /api/data-os/signal/:workspaceId/metric-groups` | catálogo visible, versiones, grains, dimensiones y freshness |
| `GET /api/data-os/signal/:workspaceId/interpretations` | interpretación versionada por metric group, ligada al filtro, packet y watermark exactos |
| `GET /api/data-os/signal/:workspaceId/releases` | strategic release actual e histórico inmutable T&B; clientes sólo ven releases publicados/client |
| `GET /api/data-os/signal/:workspaceId/series` | `SignalTimeSeriesV1` para `metric_key@metric_version` |
| `GET /api/data-os/signal/:workspaceId/breakdowns` | `SignalBreakdownV1` para la dimensión gobernada de la métrica |
| `GET /api/data-os/signal/:workspaceId/comparison` | periodos no traslapados de igual número de días |
| `GET /api/data-os/signal/:workspaceId/mentions` | registros canónicos sanitizados, read scope, búsqueda/orden y cursor opaco estable; aliases resuelven a la raíz |
| `GET /api/data-os/signal/:workspaceId/lineage` | definition/version/formula hash, materialization y watermark hash básicos |

Excepto `bootstrap`, toda ruta recibe el mismo filtro canónico en query params:

```http
GET /api/data-os/signal/{workspaceId}/series
  ?metric_key=conversation.volume
  &metric_version=1
  &start=2026-06-01
  &end=2026-06-30
  &timezone=America%2FMexico_City
  &granularity=day
  &dimension.platform=instagram
```

Aliases, arrays y orden se normalizan por `signal-backend-v1`; desconocidos, rangos
mayores a 366 días, más de seis dimensiones o más de 50 valores por dimensión fallan
con error tipado. `series`, `breakdowns` y `comparison` aceptan
`require_fresh=true`: `stale` y `partial` se vuelven errores contractuales en vez de una
respuesta silenciosa. Breakdown V1 sólo sirve la dimensión materializada y gobernada
de la métrica (platform, source type, sentiment, emotion, topic, taxonomy o entity);
otra dimensión responde `unsupported_dimension`.

Si no existe el hash solicitado y el cache ad hoc está apagado, responde
`not_available`. Si está aprobado, encola como máximo cinco métricas con job ID estable,
responde HTTP 202 + `state=pending` y TTL de 15 minutos. No espera al worker dentro de
la request.

Series y breakdowns llevan watermark y freshness; ETags privados se derivan de
watermark/computed state y admiten 304. Stale/partial usan `private, no-cache`. Cursor
de drill-down queda ligado a `metric_key + filters_hash` y pagina por
`(published_at, mention_id)`; cada registro contiene sólo snippet/title/url, platform,
language y country. No se exponen `raw_metadata`, providers/source keys, quality details
internos ni source sync IDs a clientes. `source_type.share` es interno.

Estas rutas leen `metric_materializations`, `mentions` y el semantic layer gobernado;
nunca leen `published_outputs.payload` ni `chart_aggregates`. Los adaptadores
`/api/data-os/pulse/:outputId/*` y `/signal/{outputId}` permanecen intactos con su
fallback legacy. Fixtures TypeScript para el futuro frontend viven en
`signal-workspace-fixtures.ts`; el OpenAPI protegido está documentado en
`docs/api/openapi.yaml`.

En modo governed, home, bootstrap, facets, metric groups, series, breakdowns,
comparison, Mentions y todo el serving TN aceptan un workspace con fuentes, imports y
población activa aunque tenga cero studies/corpora. Las interpretaciones deterministas
se leen sólo cuando su packet pertenece al scope actual. La generación pagada de una
interpretación TN sigue legacy-only y responde fail-closed en governed; no se encola
trabajo corpus-scoped desde una lectura gobernada.

Hardening post-SB-06:

- bootstrap y metric groups calculan el cache desde el peor estado visible; sólo una
  respuesta íntegramente `fresh` usa `private, max-age=30`. `stale`, `partial`,
  `pending` o `not_available` usan `private, no-cache`;
- `conversation.velocity` significa cambio del bucket contra su precedente inmediato.
  El planner consulta ese precedente fuera de la ventana visible cuando hace falta y
  period comparison usa el último cambio materializado, nunca un promedio de ratios;
- facets, filtros, agregados y drill-down de topic/emotion/narrative sólo consideran
  tags aprobados. Evidencia `unreviewed` o pending queda fuera del claim y hace
  `partial` la materialización con `quality_reasons=["review_pending"]`;
- si persisten varios corpora operational activos por datos históricos, el resolver
  responde fail-closed `409 not_available` con
`reason=multiple_active_operational_corpora`.

#### Signal Topics & Narratives serving V1 (TN-07)

El contrato compartido `signal-topics-narratives-v1` vive en
`@noisia/query-engine`. Topics responde de qué se habla; Narratives responde qué
afirmación, historia o marco se construye. Ninguna ruta transforma triggers, barriers,
decision layers, observed signals, findings u oportunidades en estas dimensiones.

Todas las rutas usan el resolver/authZ workspace-centric y el mismo
`SignalFilterV1`, incluida búsqueda textual. Sólo consumen perfiles activos exactos,
`record_tags.review_status='approved'`, `metric_materializations` y `mentions`.
Pending/rejected quedan fuera de métricas y evidencia client-safe. No se consulta
`published_outputs.payload` ni `chart_aggregates`.

| Route | Semántica |
|---|---|
| `GET /api/data-os/signal/:workspaceId/topics-narratives` | overview conjunto con perfiles, coverage, rankings, shares, series, comparación y coocurrencias |
| `GET /api/data-os/signal/:workspaceId/topics-narratives/:kind/:termKey` | detail gobernado de un topic/narrative, serie y términos relacionados |
| `GET /api/data-os/signal/:workspaceId/topics-narratives/:kind/:termKey/evidence` | mention IDs/citas aprobadas reconciliadas, cursor y límite máximo 100 |
| `GET /api/data-os/signal/:workspaceId/topics-narratives/:kind/:termKey/lineage` | perfil, metric materialization, watermark y resumen de imports; IDs/edges sólo internos |

`kind` sólo acepta `topic|narrative`; `termKey` debe ser una key canónica del perfil
activo. `comparison_start` y `comparison_end` deben enviarse juntos, con ventana de
igual número de días y sin traslape. Toda cifra de overview/detail proviene de
`topic.volume@1` o `narrative.volume@1`: mention count, denominador, share sobre
incluidas, share sobre clasificadas, delta y coverage. Coocurrencia se etiqueta
explícitamente `cooccurrence_not_causality`.

Ventanas de una sola mención son válidas. Un perfil procesado sin asignación devuelve
cero observado y coverage cero; un perfil sin procesamiento devuelve
`not_available`. Procesamiento incompleto o revisión pending devuelve `partial`.
Los clientes nunca reciben model IDs, context refs, import batch IDs ni edges internos.
Fixtures TypeScript congeladas para el futuro frontend viven en
`signal-workspace-fixtures.ts`.

El ETag del overview se deriva del contenido semántico servido: read scope, perfiles,
coverage, términos, denominadores, shares, series, coocurrencias, estado y
limitaciones. `computed_at` no participa: un read-through y su rematerialización
equivalente conservan el mismo ETag, pero cualquier cambio de membership que altere
la población o los términos produce un ETag nuevo. Un `If-None-Match` anterior recibe
200 con el contenido actualizado, nunca 304.

El facade raíz `GET /api/data-os/signal/:workspaceId` incluye
`topics_narratives: SignalTopicsNarrativesOverviewV1 | null`, su capability y su
partial state. El ETag incorpora la sección. El filtro default es idéntico al de
metric groups y no dispara clasificación ni proveedores en lectura.

El backfill y el evidence pack staging/preview se operan según
`40_SIGNAL_TOPICS_NARRATIVES_STAGING_RUNBOOK.md`. Un gate separado exige profiles
human-approved, worker real, reconciliación exacta, authZ negativa, lineage y el
release gate Data OS válido antes de declarar este backend listo.

#### Signal metric interpretations V1 (SB-07)

`GET /api/data-os/signal/:workspaceId/interpretations` usa el mismo
`SignalFilterV1`. Cada item devuelve `metric_group_key/version`, estado
`fresh|stale|pending|partial|not_available`, review status, fecha, watermark y el
contenido validado. Usuarios cliente sólo reciben interpretaciones
`auto_published|approved`; `needs_review` es visible únicamente para usuarios internos.
Data scope completo, model/prompt, costo y detalles de ejecución permanecen internos.

Los packets se construyen exclusivamente desde `metric_materializations` SB-05 con
`filters_hash` y `data_watermark_hash` exactos. Claude no calcula: cada número escrito
debe tener un `numeric_ref` que coincida exactamente con `value`, `denominator` o
`sample_size`, y cada evidence ref debe resolver a una materialización del packet.
Facts, hypotheses, causal claims y recommendations se persisten separadas;
hypotheses/causal/recommendations siempre quedan `needs_review`.

El worker es asíncrono, idempotente, acotado a tres intentos y 45 segundos, y no se
habilita con una sola flag. Requiere:

```text
NOISIA_SIGNAL_INTERPRETATIONS_ENABLED=true
NOISIA_SIGNAL_INTERPRETATIONS_LLM_ENABLED=true
ANTHROPIC_API_KEY=<secret>
NOISIA_SIGNAL_INTERPRETATION_BUDGET_CAP_USD=<approved cap>
```

Todos los defaults son cerrados y el cap default es cero. Sin autorización o ante
timeout/error, se persiste un fallback descriptivo determinístico de costo cero y su
motivo; nunca se llama a Claude desde page view. Un cambio de filtro, watermark,
metric definition, prompt o model impide reutilizar texto previo y marca freshness
stale/pending/unavailable según corresponda.

#### T&B temporal y strategic releases V1 (SB-09)

Cada corrida T&B nueva congela antes de ejecutar `period_start/end`, `snapshot_id`,
digest y cantidad exacta de menciones, `corpus_revision`, methodology/pipeline,
prompt y model version. Un trigger impide reescribir ese scope. El brief comparativo y
las métricas sólo recorren `corpus_snapshot_mentions`; una importación operacional
posterior no puede alterar una corrida ya ejecutada.

`tb_temporal_metrics` materializa `finding.frequency`, `finding.share`,
`finding.intensity` y `finding.predictive_capacity` con value, denominator, sample,
quality y dimensiones gobernadas. Los denominadores se calculan al mismo grain
`default | platform | entity`. Las comparaciones leen esas filas canónicas y sólo
comparan corridas del mismo subject, metodología, pipeline, prompt y model con periodos
ordenados no traslapados y snapshots distintos. Movilidad usa
`emerging | growing | declining | persistent | mutated | disappeared`, con razón,
deltas de share y estado de calidad; nunca compara frecuencia cruda entre muestras de
tamaño distinto.

`GET /api/data-os/signal/:workspaceId/releases` devuelve:

```json
{
  "contract_version": "signal-backend-v1",
  "strategic_release_contract_version": "tb-temporal-v1",
  "workspace_id": "uuid",
  "current": null,
  "history": []
}
```

Usuarios internos pueden ver drafts; clientes sólo `published + client`. Crear draft
o promover usa `POST` en la misma ruta con `action=create_draft|promote`, requiere rol
interno con gestión de corpus y conserva authZ del workspace. Un draft sólo acepta una
corrida T&B human-approved, scope congelado, quality gates sin fallas y revisiones
aceptadas/corregidas/limitadas. Promover requiere reviewer humano y actualiza un
puntero separado `signal_workspace_current_releases`; el histórico, artefactos,
findings y materializaciones de una release publicada son inmutables. No hay promoción
automática y ninguna ruta lee `published_outputs.payload`.

#### Strategic consumption workspace-native (bridge 0062–0063)

La identidad cliente de T&B es fija:
`/signal/{workspaceSlug}/reports/triggers-barriers`. `study_corpus_id` continúa sólo
como execution scope interno del Engine; nunca forma parte de la URL ni de la identidad
del reporte.

| Ruta | Semántica |
|---|---|
| `GET|POST /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs` | preflight gratuito y launch gobernado V2; el contrato autoritativo se especifica en “Gate D · Strategic T&B governed launch V2” |
| `GET|DELETE /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs/:analysisId` | polling read-only y solicitud de cancelación durable |
| `POST /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs/:analysisId/review` | Review seleccionada + siguiente release draft en una operación idempotente V2 |
| `GET /api/data-os/signal/:workspaceId/triggers-barriers` | overview relacional de la release current resuelta por `(workspace_id, report_key)` |
| `GET /api/data-os/signal/:workspaceId/triggers-barriers/series` | serie compacta de la release/snapshot current |
| `GET /api/data-os/signal/:workspaceId/triggers-barriers/findings/:findingId` | detail relacional de un finding perteneciente a la release current |
| `GET /api/data-os/signal/:workspaceId/triggers-barriers/findings/:findingId/evidence` | evidence cursor-paginada; cada mention ID se reconcilia contra la membership congelada y devuelve la raíz canónica |

El launch actual exige `Idempotency-Key` y un body sin IDs de authority:

```json
{
  "period_start": "2026-01-01",
  "period_end": "2026-06-30",
  "timezone": "America/Mexico_City",
  "study_size": "medium",
  "business_question": "opcional",
  "decision_to_inform": "opcional",
  "hard_cap_usd": 5,
  "preflight_digest": "sha256:…"
}
```

El request histórico que aceptaba `population.policy` o `population_id` queda
superseded y no es un contrato cliente válido. El servidor reconcilia organización,
marca, workspace, binding, bundle, compilación, evaluación, población y corpus de
ejecución. Timezone debe coincidir con el workspace. Snapshot, muestra, control y
outboxes quedan congelados en una transacción; reintentos compatibles devuelven el
mismo run y un request distinto con la misma key responde conflicto.

Review también exige `Idempotency-Key`. `reusable_assertions` es una selección explícita
de `{record_tag_id, decision, notes?, correction?}`. Aprobar artifacts/findings no
aprueba todos los tags. Cada selección se resuelve a la mención canónica, registra un
evento inmutable y conserva el tag histórico/alias como provenance. En V2, Review y
release draft son una sola operación atómica; la respuesta incluye `workspace_id`,
`report_key`, operation y release. La promoción continúa por `POST /releases`, también
con `Idempotency-Key`, y mueve atómicamente el current pointer composite.

La ruta corpus-scoped legacy no puede lanzar una corrida governed V2 ni seleccionar su
authority. Las rutas GET aceptan temporalmente `?study=` sólo como adapter de una URL
heredada y verifican server-side que pertenezca al workspace; el cliente canónico no lo
envía.

#### Signal workspace home facade V1 (SB-10)

`GET /api/data-os/signal/:workspaceId` es el único facade front-ready. Usa la misma
sesión, flag, resolver de workspace y authZ por organización/brand que todas las rutas
workspace-centric. No acepta `outputId`; el fallback legacy sólo se anuncia como link.

Respuesta congelada:

```json
{
  "contract_version": "signal-backend-v1",
  "facade_version": "signal-workspace-home-v1",
  "workspace": {},
  "corpus": {},
  "coverage": { "date_from": null, "date_through": null, "mentions": 0 },
  "default_filter": null,
  "filters_hash": null,
  "capabilities": [],
  "facets": {},
  "freshness": {},
  "metric_groups": [],
  "interpretations": [],
  "topics_narratives": null,
  "strategic": { "current": null, "history": [] },
  "visibility": { "internal": false, "source_type": false, "quality_details": false },
  "lineage": [],
  "partial_states": [],
  "legacy_fallback": {
    "identity": "outputId",
    "dashboard_route_template": "/signal/{outputId}",
    "api_route_template": "/api/data-os/pulse/{outputId}/*",
    "source_of_truth": false
  },
  "state": "not_available"
}
```

El filtro default es el último mes con menciones incluidas y se normaliza con
`SignalFilterV1`; no inventa fechas cuando no hay cobertura. `state` usa el peor estado
visible y controla `Cache-Control`: sólo `fresh` admite `private, max-age=30`; stale,
partial, pending y not_available usan `private, no-cache`. El ETag incorpora hash,
metric groups y current release.

Internos reciben los detalles permitidos por los loaders existentes. Clientes no
reciben `source_type`, `quality_state`, `data_scope`, raw metadata ni fuentes internas.
Los errores siguen siendo los cinco errores tipados de `signal-backend-v1`. La fixture
autoritativa para el frontend futuro es `SIGNAL_WORKSPACE_HOME_FIXTURE_V1`.

El gate runtime de SB-10 exige un workspace/output/corpus real y produce artifacts
redactados de backfill, reconciliación SQL/drill-down, EXPLAIN y shadow. Mantiene
`NOISIA_SIGNAL_WORKSPACE_API_ENABLED=false` y
`NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false`; pasar el gate no activa clientes.

Endpoints de Studio para leer el primer corte de Noisia Data OS. No son el Public
Reporting API. Las rutas `/corpora/*` son internas; las rutas `/pulse/*` pueden ser
client-visible sólo después de shadow QA/release gate, porque se autorizan por output
publicado y aplican `visibility_config`.

**Auth:** Kinde session. Rutas `/corpora/*`: `canManageCorpus` + acceso al corpus.
Rutas `/pulse/*`: `canViewClientOutputs` + `getSignalOutputForUser`, por lo que un
cliente sólo ve outputs publicados que le corresponden por brand/org access.

**Flags globales requeridos:** `NOISIA_DATA_OS_ENABLED=true` y
`NOISIA_DATA_OS_SERVING_ENABLED=true`.

**Flags Signal Pulse live requeridos:** para rutas `/pulse/*`, además
`NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=true`.

**Render Signal Pulse live:** la API live puede estar activa en shadow sin cambiar el
dashboard. El render server sólo usa periodos/señales/charts básicos de Data OS cuando
`NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=true`; si falta el flag o la DB viva va detrás
del snapshot, la UI conserva `published_outputs.payload`.

**Visibilidad Signal Pulse live:** `/pulse/:outputId/live` sanea el payload según
`visibility_config`: oculta `source_health` si `sources`/`quality` no están visibles y
filtra `dashboard_data_refs` con `visibility.internal=true` salvo usuarios internos o
`raw_metadata=true`. `/pulse/:outputId/corpus` requiere `corpus_view="full"` para
usuarios cliente; si no, responde `403` con `fallback: "published_outputs.payload"`.

**Fallback apagado:** si las flags están apagadas, responde `503` con
`error: "data_os_disabled"` o `error: "signal_pulse_live_api_disabled"` y
`fallback: "published_outputs.payload"`.

### `GET /api/data-os/corpora/:id/readiness`

Contrato interno de trazabilidad end-to-end para el Corpus Engine. Resume cinco etapas
en orden: Brand OS, Sources, Observations, Engine y Signal. `overall="ready"` sólo es
válido cuando las cinco etapas están listas; fuentes materializadas con Engine o Signal
pendientes deben responder `overall="building"`.

**Response:**
```json
{
  "corpusId": "uuid",
  "overall": "building",
  "stages": [
    { "key": "brand_os", "status": "ready" },
    { "key": "sources", "status": "ready" },
    { "key": "observations", "status": "ready" },
    { "key": "analysis", "status": "empty" },
    { "key": "signal", "status": "empty" }
  ],
  "counts": {
    "activeContracts": 13,
    "observations": 18274,
    "acceptedObservations": 18274,
    "includedMentions": 0,
    "analyses": 0,
    "dashboardRefs": 0
  },
  "coverage": {
    "metricFamilies": 7,
    "overlappingMonths": 0,
    "analysisConsumedStructuredData": false
  },
  "monthlySeries": [],
  "blockers": [],
  "warnings": ["Aún no hay menciones incluidas."],
  "nextAction": "Ingiere y aprueba las menciones."
}
```

`monthlySeries` expone únicamente agregados de observaciones aceptadas y listening
incluido. No expone raw rows. Signal puede renderizar el ref `cross_source_timeline`
sólo cuando el output posee el `dashboard_data_ref`, existe al menos una métrica
estructurada y hay overlap real por mes.

### Refs gobernados al guardar Signal

Guardar o publicar un output T&B crea de forma idempotente:

- `brand_os_context`;
- `listening_mentions_monthly`;
- `structured_observations_monthly`;
- `cross_source_timeline`.

Los refs conservan filtros, visibilidad, corpus scope y lineage hacia
`published_outputs`. El render comparativo de Signal prioriza ventas, revenue, órdenes,
unidades, búsqueda, tickets, spend y margen. La UI declara asociación temporal, nunca
causalidad.

### T&B Signal relational serving v2

`GET /api/signal/:outputId/overview` y `GET /api/signal/:outputId/corpus` sirven el
snapshot aprobado al que apunta el output autorizado. Para outputs con
`data_contract.version="signal-serving-v2"`, pantalla, deck y correo usan el mismo
contrato relacional y fallan cerrado si readiness no pasa.

Refs obligatorios del contrato:

- `published_mentions`;
- `social_overview`;
- `social_timeseries`;
- `social_dimensions`;
- `analysis_findings`;
- `analysis_opportunities`;
- `analysis_actions`;
- `analysis_evidence`;
- `cross_source_timeline`.

`analysis_opportunities` apunta a `tb_strategic_opportunities` y
`tb_opportunity_findings`; `analysis_actions` apunta a `tb_action_studio` y
`tb_action_findings`. `tb_recommendations` permanece como playbook operacional y no se
cuenta como oportunidad estrategica.

Readiness bloquea publicacion o serving cuando:

- la cantidad sintetizada no coincide con las filas canonicas;
- existe un finding, oportunidad o accion sin evidencia dentro del snapshot;
- faltan tags/features gobernadas;
- falta cualquiera de los nueve refs.

Un contrato relacional anterior responde `409 signal_serving_contract_outdated` en el
endpoint de overview hasta ejecutar reconciliacion. El payload publicado se conserva
como fallback de compatibilidad; publicar de nuevo sobre la misma fila ya publicada
responde `409 published_output_immutable`.

### Analysis Artifact Graph v1

Review y Signal comparten el contrato interno `analysis-artifacts-v1`:

```json
{
  "contract_version": "analysis-artifacts-v1",
  "analysis_id": "uuid",
  "corpus_id": "uuid",
  "output_id": "uuid-or-null",
  "artifacts": [],
  "evidence_groups": [],
  "evidence_links": [],
  "relations": []
}
```

Cada artefacto tiene `artifact_key`, `artifact_type`, `review_status`, `revision` y
contenido propio. Los links de evidencia usan `source_type` + `source_id`; las
relaciones usan IDs de artefacto. Al leer con `output_id`, solo se incluyen filas
presentes en `published_output_artifacts` con el mismo `artifact_revision`.

El contrato distingue evidencia directa de contexto disponible. Menciones citadas por
findings son `supports`; archivos estructurados consumidos de forma general son
`available_as_context` y declaran `claim_specific=false`. No se permite convertir esa
disponibilidad en soporte de una afirmacion concreta sin una referencia devuelta por el
pipeline.

Los findings pueden agregar links exactos `source_type=data_observation` o
`source_type=data_asset_record`. El token debe existir en el packet RAG gobernado, ser
accepted y pertenecer al mismo corpus. El locator conserva `storage_ref`, asset,
dataset/row, source sync/import y periodo; lineage conecta esas fuentes al artifact.

### `GET|POST /api/data-os/corpora/:id/artifacts/:artifactId/review`

Ruta interna protegida por el mismo ownership y `canManageCorpus` de Data OS. `GET`
devuelve el historial editorial de todas las revisiones del artifact. `POST` acepta:

- `GET /api/data-os/corpora/:id/artifacts/:artifactId/review`
- `POST /api/data-os/corpora/:id/artifacts/:artifactId/review`

```json
{
  "action": "correct",
  "notes": "El alcance aplica sólo a clientes recurrentes.",
  "patch": {
    "summary": "La barrera crece entre clientes recurrentes."
  }
}
```

`action` es `accept`, `correct`, `limit` o `reject`. `correct` exige patch; `correct`,
`limit` y `reject` exigen notas. `correct` y `limit` siempre crean una revisión nueva.
Cualquier acción sobre una revisión ya publicada también crea una revisión nueva.
La respuesta indica `artifact_id`, `previous_artifact_id`, `review_status`, `revision`
y `created_revision`. Una revisión ya superada responde `409 conflict`.

Readiness bloquea aprobacion/publicacion cuando falta el registro de artefactos, un
artefacto no tiene grupo declarado, los findings no coinciden con sus artefactos o sus
menciones verificables no estan dentro del snapshot.

### `GET /api/data-os/corpora/:id/sources`

Inventario de fuentes operativas ligadas al corpus, con último sync conocido.

**Response:**
```json
{
  "corpus_id": "uuid",
  "sources": [
    {
      "id": "uuid",
      "source_type": "social_listening",
      "provider": "sentione",
      "connection_method": "csv",
      "name": "SentiOne export May",
      "role": "primary",
      "status": "active",
      "visibility": "internal",
      "latest_sync_status": "completed",
      "records_total": 1234,
      "records_valid": 1180,
      "records_failed": 54,
      "coverage_start": "2026-05-01",
      "coverage_end": "2026-05-31"
    }
  ]
}
```

### `GET /api/data-os/corpora/:id/source-health`

Estado de calidad por asset y resumen de fuentes.

**Response:**
```json
{
  "corpus_id": "uuid",
  "summary": {
    "assets": 10,
    "passed": 10,
    "warnings": 0,
    "failed": 0,
    "total_sources": 1,
    "active_sources": 1,
    "unhealthy_sources": 0
  },
  "assets": [
    {
      "id": "uuid",
      "name": "mentions.silver",
      "layer": "silver",
      "asset_kind": "table",
      "row_count": 1180,
      "field_count": 8,
      "quality_status": "passed",
      "result_key": "row_count_min"
    }
  ]
}
```

### `GET /api/data-os/corpora/:id/catalog`

Data Catalog vivo para el corpus: assets, campos, contratos y resultados de calidad
vigentes por asset. Esta ruta es la forma de inspeccionar si el corpus ya funciona como
base de datos auditable y no como snapshot de dashboard.

**Response:**
```json
{
  "corpus_id": "uuid",
  "assets": [
    {
      "id": "uuid",
      "name": "mentions.silver",
      "layer": "silver",
      "asset_kind": "table",
      "row_count": 1180,
      "status": "active",
      "fields": [
        {
          "field_name": "text_clean",
          "field_type": "text",
          "semantic_type": "mention_text",
          "nullable": false
        }
      ],
      "contracts": [
        {
          "contract_name": "mentions.silver.contract",
          "version": 1,
          "status": "active"
        }
      ],
      "latest_quality": [
        {
          "result_key": "field_coverage",
          "status": "passed"
        }
      ]
    }
  ],
  "counts": {
    "assets": 10,
    "fields": 65,
    "contracts": 10,
    "quality_results": 10,
    "assets_without_fields": 0,
    "failed_quality": 0
  }
}
```

### `GET /api/data-os/corpora/:id/brand-os`

Brand OS estructurado para el corpus: perfil, objetivos, audiencias, productos,
claims, campañas, competidores, eventos, seed sets y links. Sirve para diagnóstico
interno y para que el dashboard/engine consuman contexto como datos, no sólo prompt.

**Response:**
```json
{
  "corpus_id": "uuid",
  "profiles": [
    {
      "id": "uuid",
      "brand_id": "uuid",
      "name": "Brand OS · ACME",
      "version": 1,
      "objectives": [
        {
          "id": "uuid",
          "objective_type": "business_question",
          "name": "Defender budget allocation",
          "priority": 1
        }
      ],
      "briefs": [
        {
          "id": "uuid",
          "brief_type": "study_intake",
          "title": "Study intake: Signal Pulse",
          "objective_id": "uuid",
          "knowledge_source_id": null,
          "summary": "Business question, decision and audience context captured from intake."
        }
      ],
      "audiences": [],
      "seed_sets": [
        {
          "id": "uuid",
          "seed_set_type": "brand",
          "terms": [{ "term": "ACME", "term_type": "keyword" }]
        }
      ]
    }
  ],
  "counts": { "profiles": 1, "objectives": 1, "briefs": 1, "seed_terms": 2 }
}
```

### `GET /api/data-os/corpora/:id/knowledge`

Knowledge Catalog vivo para el corpus o la marca: fuentes, chunks recuperables y
assertions estructuradas. No expone `raw_text` completo por default; los chunks salen
como `chunk_preview` para inspección interna.

**Query params:** `limit`, `offset`.

**Response:**
```json
{
  "corpus_id": "uuid",
  "sources": [
    {
      "id": "uuid",
      "source_kind": "brief",
      "title": "Marketing brief",
      "status": "processed",
      "chunk_count": 4,
      "assertion_count": 9
    }
  ],
  "chunks": [
    {
      "id": "uuid",
      "knowledge_source_id": "uuid",
      "chunk_index": 0,
      "chunk_preview": "The audience is..."
    }
  ],
  "assertions": [
    {
      "id": "uuid",
      "assertion_type": "audience_context",
      "assertion_text": "Primary audience is..."
    }
  ],
  "counts": { "sources": 1, "chunks": 4, "assertions": 9 }
}
```

### `GET /api/data-os/corpora/:id/lineage`

Grafo de lineage filtrable para el corpus. Incluye edges donde el origen o destino
pertenece al corpus por `data_asset`, `data_source`, `source_sync_run`,
`import_batch`, `dashboard_data_ref`, `published_output` o `study_corpus`.

**Query params:** `limit`, `offset`, `source_type`, `target_type`, `relation_type`.

**Response:**
```json
{
  "corpus_id": "uuid",
  "lineage_edges": [
    {
      "id": "uuid",
      "source_type": "data_asset",
      "source_id": "uuid",
      "source_label": "mentions.gold",
      "target_type": "dashboard_data_ref",
      "target_id": "uuid",
      "target_label": "corpus",
      "relation_type": "serves",
      "metadata": {}
    }
  ],
  "pagination": { "limit": 100, "offset": 0, "count": 1, "total": 18 }
}
```

### `GET /api/data-os/corpora/:id/taxonomies`

Catálogo de taxonomías activas y términos disponibles para el corpus. Incluye conteo de
tags por término cuando exista uso en `record_tags`.

**Response:**
```json
{
  "corpus_id": "uuid",
  "taxonomies": [
    {
      "id": "uuid",
      "key": "journey_stage",
      "name": "Journey Stage",
      "scope": "global",
      "methodology_slug": "signal-pulse",
      "terms": [
        {
          "id": "uuid",
          "key": "consideration",
          "label": "Consideration",
          "tag_count": 42
        }
      ]
    }
  ]
}
```

### `GET /api/data-os/corpora/:id/tags`

Tags versionados por record, filtrables para inspección interna.

**Query params:** `limit`, `offset`, `subject_type`, `taxonomy`, `review_status`.

**Response:**
```json
{
  "corpus_id": "uuid",
  "tags": [
    {
      "id": "uuid",
      "subject_type": "mention",
      "subject_id": "uuid",
      "taxonomy_key": "trigger",
      "term_key": "ingredient_trust",
      "term_label": "Ingredient Trust",
      "value": "ingredient_trust",
      "score": "0.82",
      "confidence": "medium",
      "source": "data_os_backfill_deterministic",
      "review_status": "unreviewed"
    }
  ],
  "pagination": { "limit": 100, "offset": 0, "count": 1 }
}
```

### `GET /api/data-os/corpora/:id/review-queue`

Cola interna de revisión humana para tags y assertions. Sólo devuelve items con
evidencia y está pensada para QA antes de cualquier activación cliente-visible.

**Query params:** `limit`, `offset`, `taxonomy`, `review_status`, `assertion_status`,
`confidence`.

**Response:**
```json
{
  "corpus_id": "uuid",
  "summary": {
    "record_tags_total": 34,
    "record_tags_unreviewed": 34,
    "record_tags_with_evidence": 34,
    "record_tag_taxonomies": 11,
    "knowledge_assertions_candidate": 9,
    "knowledge_assertions_with_evidence": 9,
    "ready_for_human_review": true,
    "required_before_client_visible": true
  },
  "tags": [
    {
      "id": "uuid",
      "subject_type": "mention",
      "taxonomy_key": "barrier",
      "term_label": "Price Sensitivity",
      "confidence": "low",
      "review_status": "unreviewed",
      "evidence": [{ "type": "keyword_rule", "match": "expensive" }],
      "mention_preview": "The product feels expensive..."
    }
  ],
  "assertions": [
    {
      "id": "uuid",
      "assertion_type": "audience_context",
      "status": "candidate",
      "confidence": "medium",
      "evidence": [{ "source": "brief" }],
      "link_count": 3,
      "usage_event_count": 1
    }
  ],
  "pagination": {
    "limit": 100,
    "offset": 0,
    "tag_count": 25,
    "tag_total": 34,
    "assertion_count": 9,
    "assertion_total": 9
  }
}
```

### `POST /api/data-os/corpora/:id/review-queue`

Acción interna para curar tags o assertions de la review queue. Con `tag_id`
actualiza `record_tags.review_status` y crea un evento auditable en
`tag_review_events`. Con `assertion_id` actualiza `knowledge_assertions.status` y
crea un evento auditable en `knowledge_assertion_review_events`.

**Body:**
```json
{
  "tag_id": "uuid",
  "action": "approve",
  "notes": "Evidence matches the journey-stage taxonomy."
}
```

`action` acepta `approve`, `reject` o `needs_review`. Para tags, `approve` escribe
`review_status="approved"`. Para assertions, `approve` escribe `status="active"`.
El body debe incluir exactamente uno de `tag_id` o `assertion_id`.

**Response:**
```json
{
  "corpus_id": "uuid",
  "target_type": "tag",
  "tag": {
    "id": "uuid",
    "taxonomy_key": "journey_stage",
    "term_key": "consideration",
    "review_status": "approved"
  },
  "review_event": {
    "id": "uuid",
    "record_tag_id": "uuid",
    "reviewer_user_id": "uuid",
    "action": "approve",
    "previous_value": { "review_status": "unreviewed" },
    "next_value": { "review_status": "approved" },
    "notes": "Evidence matches the journey-stage taxonomy."
  }
}
```

Para assertions la respuesta cambia `tag` por `assertion` y el `review_event` usa
`knowledge_assertion_id`.

### `GET /api/data-os/pulse/:outputId/live`

Vista live mínima para Signal Pulse: periodos, señales, refs de dashboard y salud de
fuentes. Cut 1 la usa para shadow mode; el dashboard publicado conserva fallback al
payload.

**Response:**
```json
{
  "output_id": "uuid",
  "corpus_id": "uuid",
  "mode": "live",
  "periods": [],
  "signals": [],
  "dashboard_data_refs": [],
  "source_health": {
    "status": "hidden",
    "section": "source_health",
    "reason": "visibility_config",
    "fallback": "published_outputs.payload"
  },
  "visibility": {
    "paid_organic": false,
    "competitive": true,
    "evidence": true,
    "corpus": false,
    "sources": false,
    "quality": false,
    "raw_metadata": false
  }
}
```

### `GET /api/data-os/pulse/:outputId/metrics`

Métricas live de Signal Pulse por periodo y señal.

**Query params:** `limit`, `offset`, `period`, `signal_id`.

**Response:**
```json
{
  "corpus_id": "uuid",
  "metrics": [
    {
      "id": "uuid",
      "canonical_signal_id": "uuid",
      "canonical_title": "TikTok made the claim legible",
      "period_id": "uuid",
      "period_label": "May 2026",
      "volume": 120,
      "impact_v1": "0.72",
      "lifecycle_state": "emerging",
      "confidence": "0.81"
    }
  ],
  "pagination": { "limit": 200, "offset": 0, "count": 1 }
}
```

### `GET /api/data-os/pulse/:outputId/corpus`

Corpus live navegable para Signal Pulse. Devuelve menciones con tags y señales
relacionadas.

**Query params:** `limit`, `offset`, `period`, `platform`, `source_type`,
`inclusion_status`, `taxonomy`, `term`, `lifecycle`, `audience`, `demographic`,
`journey_stage`, `signal_id`, `q`.

**Response:**
```json
{
  "corpus_id": "uuid",
  "mentions": [
    {
      "id": "uuid",
      "text_clean": "Loved how the launch explained the benefit.",
      "published_at": "2026-05-12T10:00:00.000Z",
      "platform": "tiktok",
      "inclusion_status": "included",
      "tags": [
        {
          "taxonomy_key": "journey_stage",
          "term_key": "consideration",
          "label": "Consideration",
          "confidence": "medium"
        }
      ],
      "signals": [
        {
          "canonical_signal_id": "uuid",
          "signal_type": "opportunity",
          "canonical_title": "Benefit clarity is moving attention"
        }
      ]
    }
  ],
  "pagination": { "limit": 100, "offset": 0, "count": 1, "total": 1 }
}
```

## 17. Jobs endpoints

### Engine validation boundary

- `POST /api/corpora/:id/query-iterations/:iteration_id/evaluate` exige una primera
  extracción importada para todos los packs y encola su evaluación post-ingesta. Cada
  pack clasifica hasta 100 menciones ligadas por `query_pack_id`; menos de 25 puede dar
  diagnóstico, pero nunca un estado aprobable. No consulta APIs de proveedores y no
  aprueba el corpus.
- `POST /api/corpora/:id/query-iterations/:iteration_id/approve` conserva únicamente un
  conjunto de query packs `ready` cuya evidencia corresponda a la query exacta vigente.
  Crear una iteración ajustada crea packs nuevos y exige una extracción nueva.
- `POST /api/corpora/:id/assess` certifica la revisión actual del corpus importado.
- `POST /api/corpora/:id/approve` exige una certificación de la revisión actual y crea
  el snapshot de aprobación.

Los estados y evidencias no son intercambiables. Ver
`28_CORPUS_ENGINE_VALIDATION_CONTRACT.md`.

Para que el UI haga polling de workers BullMQ.

### `GET /api/jobs/:job_id`
Status del job.

**Response:**
```json
{
  "id": "uuid",
  "type": "engine_validation" | "analysis_run" | "csv_import" | "pdf_render",
  "status": "queued" | "running" | "completed" | "failed",
  "progress": 0.45,
  "started_at": "...",
  "completed_at": null,
  "current_step": "paso_3_jerarquizacion",
  "result_url": null,
  "error": null
}
```

### `WebSocket /api/jobs/:job_id/subscribe`
Subscribirse a updates en tiempo real del job. Útil para Engine UI.

---

## 18. Webhooks (inbound)

### `POST /api/webhooks/integration/:integration_id`
Endpoint para recibir webhooks de integraciones configuradas.

### `POST /api/webhooks/sentione`
Endpoint específico para SentiOne si configuramos webhook (vs pull).

---

## 19. Admin endpoints

### `GET /api/admin/stats`
Stats globales del sistema (founder only).

### `GET /api/admin/users`
Gestión de usuarios.

### `POST /api/admin/users/:id/impersonate`
Asumir sesión de usuario (debug).

---

## 19.1 Signal workspace data plane (shadow)

Todos estos endpoints requieren sesión y autorización server-side sobre el workspace.
Escritura requiere rol interno con permiso de gestión. Una marca puede usarlos sin
tener un `study_corpus`.

### `GET /api/data-os/signal/{workspaceId}/sources`

Lista fuentes compactas del workspace. No devuelve registros ni payloads crudos.

### `POST /api/data-os/signal/{workspaceId}/sources`

```json
{
  "name": "SentiOne manual export",
  "provider": "sentione",
  "source_type": "social-listening",
  "connection_method": "manual-csv",
  "scope": "primary_brand",
  "entity_id": "brand-uuid"
}
```

`scope` debe ser `primary_brand`, `competitor`, `category`, `reference` o
`unattributed`. La API rechaza brand/competitor cross-workspace y crea una refresh
policy manual deshabilitada; no agenda gasto ni una corrida externa.

### `POST /api/data-os/signal/{workspaceId}/sources/{sourceId}/imports`

El body es CSV en streaming. Metadata viaja como query params:
`file_name` y el opcional `study_corpus_id`. El import no acepta `scope`: scope,
entity y policy version se heredan obligatoriamente de la fuente gobernada. El estudio
sólo queda como contributor provenance; la mención sigue siendo propiedad del
workspace. Un duplicado no crea otra mención, pero sí conserva una atribución por
source/import/scope, su membership de import y, si aplica, la membership del estudio
contribuidor.

La respuesta contiene IDs compactos, stats, revisión de corpus sólo en compatibilidad
y watermarks. No retorna menciones ni snapshot/población completos.

### `GET /api/data-os/signal/{workspaceId}/populations/operational/shadow`

Sólo para gestión interna. Compara población workspace-owned contra el corpus
operacional heredado por `scope`, calidad, periodo y dedup. Reporta por separado filas
legacy, menciones distintas e identidades canónicas; la igualdad se decide por set de
IDs canónicos, no por igualdad entre filas crudas y registros deduplicados.

La respuesta separa dos gates que no son intercambiables:

- `comparison` es el **population membership shadow**: compara el set legacy
  primario deduplicado con las memberships gobernadas.
- `module_serving_shadow` ejecuta los adapters de consulta específicos de Brand
  Monitoring, Mentions y Topics & Narratives. Cada adapter compara IDs canónicos,
  denominador y periodo fuera del camino crítico HTTP. Mentions calcula en SQL el hash
  del conjunto canónico completo —sin límite de 100— y muestrea la primera página y la
  página/cursor solicitados del reader real, en lugar de recorrer hasta 20,000 IDs en
  cada request. TN compara los resultados aprobados por perfil y resuelve assignments
  históricos desde alias hacia la raíz canónica.

Las tres rutas de módulo emiten `Server-Timing` con `signal-visible` y
`signal-shadow-outbox`. Este header mide el trabajo síncrono visible y el INSERT del
outbox; la comparación gobernada completa se registra por separado con `duration_ms`.

El gate no exige igualdad ciega con legacy. `module_serving_shadow.gate_passed=true`
requiere simultáneamente:

- definición y memberships conformes al contrato `primary_brand`;
- cero diferencias inexplicadas;
- diferencias legacy-only explicadas y desglosadas por scope;
- IDs, denominadores, periodos, series, cursores y enrichment correctos sobre el set
  gobernado.

`parity_with_legacy=false` es aceptable cuando legacy contiene category, reference o
unattributed y `legacy_differences.unexplained_count=0`. No se amplía la población
gobernada para imitar un reader legacy semánticamente incorrecto.

### Semantic Review de menciones V1 (Fase 7B)

Estas rutas son **operator-only**. Todas resuelven organización, marca, workspace y
reviewer desde la sesión server-side; un ID enviado por el navegador nunca sustituye
esa resolución. Las respuestas usan `private, no-store` porque pueden contener el
excerpt y contexto autorizado de una mención.

| Ruta | Contrato |
|---|---|
| `GET /api/data-os/signal/{workspaceId}/semantic-review` | Página keyset sobre la proyección versionada de raíces canónicas incluidas; `mention={canonicalMentionId}` enfoca una raíz después de `send_to_review`; admite `state`, `proposed_scope`, `confidence_band`, `data_source_id`, `platform`, `start`, `end`; el cursor queda sellado al snapshot y filtros. La request no vuelve a clasificar el corpus completo |
| `POST /api/data-os/signal/{workspaceId}/semantic-review/candidates` | `dry-run` o creación idempotente de assertions pending/candidate; nunca crea Review events, memberships o pointer V2 |
| `POST /api/data-os/signal/{workspaceId}/semantic-review/assertions` | Assertion manual pending/candidate; exige `Idempotency-Key` y usa al reviewer autenticado |
| `POST /api/data-os/signal/{workspaceId}/semantic-review/assertions/{assertionId}/review` | decisión humana `approve`/`reject`, append-only |
| `POST /api/data-os/signal/{workspaceId}/semantic-review/assertions/{assertionId}/supersede` | crea una nueva versión pending y conserva la anterior |
| `GET /api/data-os/signal/{workspaceId}/semantic-review/assertions/{assertionId}/history` | historial append-only de la assertion dentro del mismo workspace |
| `GET /api/data-os/signal/{workspaceId}/semantic-review/resolve` | polling estrictamente read-only del parent y sus child batches; nunca prepara, reanuda ni encola |
| `GET /api/data-os/signal/{workspaceId}/semantic-review/resolve/preflight?hard_cap_usd=...` | flight card gratuito y read-only: población/exclusiones, provenance y `llm-processing`, estratos, snapshot, modelo/precio pinneados, todos los child batches, estimate, hard cap y readiness; declara cero writes/jobs/provider calls/spend |
| `POST /api/data-os/signal/{workspaceId}/semantic-review/resolve` | único contrato que prepara el parent y todos sus child batches durables; exige `Idempotency-Key`, digest del preflight, hard cap elegido por el operador y confirmación humana; USD 40 es threshold de confirmación, no techo ni causa de truncamiento |
| `DELETE /api/data-os/signal/{workspaceId}/semantic-review/resolve` | solicita cancelación idempotente, bloquea nuevos dispatches y conserva historia append-only |
| `POST /api/data-os/signal/{workspaceId}/semantic-review/resolve/resume` | crea un intento child superseding para el trabajo no terminal de un child fallido; conserva el child anterior y evita volver a aplicar resultados completos |
| `GET /api/data-os/signal/{workspaceId}/admin-mentions` | lista ligera de raíces canónicas con `operator_summary` y facets relacionales sobre **todas** las raíces del workspace; filtros server-side de inclusión, resolución, Review, eligibility, calidad, última acción y source provenance; no usa la población Operational como denominador |
| `GET /api/data-os/signal/{workspaceId}/admin-mentions?mention={mentionId}` | detalle operator-only compuesto sobre la raíz canónica: aliases, provenance, inclusión/calidad saneada, assertions/Review, populations, enrichment y referencias T&B; no expone `raw_metadata` |
| `POST /api/data-os/signal/{workspaceId}/admin-mentions/{mentionId}/governance` | `include`, `exclude`, `revert` o `send_to_review` workspace-native; exige `Idempotency-Key`, resuelve alias→raíz y registra actor/razón append-only |

Cada assertion devuelta a Admin conserva `approval_source`, `approved_at`,
`approved_by_user_id`/identidad operator-safe, `model_version`,
`semantic_policy_key`, `policy_version`, `evidence_kind`, `is_current` y un
`resolution_state` explícito. Por eso una resolución aprobada por Claude no se
presenta como aprobación humana. `send_to_review` no inventa una reclasificación:
registra una solicitud workspace-native y la cola queda `needs_context` hasta una
decisión/supersession gobernada posterior.

Los facets de Admin Mentions declaran `scope=all_workspace_canonical_roots`; sus counts
no se calculan desde el pointer Operational V1/V2. Los filtros operator-only se incorporan
al hash del cursor, por lo que un cursor no puede reutilizarse silenciosamente con otro
estado de inclusión, Review, eligibility, calidad, governance o provenance.

La política `signal-semantic-governed-identity@1` sólo propone coincidencias de alta
precisión contra marca, aliases/handles de Brand OS, competidores con `competitor_id`
estable e intelligence entities activas de category/reference. `source_intent` se
muestra como provenance auxiliar, pero no participa como verdad semántica. Cada
propuesta persiste con `review_status=pending`, `eligibility_status=candidate`, evidence
hash e idempotency key SHA-256 estables. Una coincidencia multi-entidad genera
assertions separadas y no duplica la raíz en ninguna población.

La cola reconcilia cada raíz incluida exactamente una vez entre `candidate_pending`,
`current_approved`, `current_rejected`, `unresolved` y `needs_context`. Las menciones
excluidas no forman parte del primer corte operacional. Candidate generation no es una
decisión humana y no autoriza Operational V2: V1 sigue sirviendo hasta que Review,
reconciliación y promoción tengan un gate separado.

### Governed View resolver V1 (foundation local)

No se agrega todavía un endpoint cliente ni un query param `view`. El contrato
compartido `signal-governed-views-v1` cierra los valores permitidos y el servicio
server-side resuelve, después de AuthZ del workspace:

```text
(workspace_id autorizado, module_key cerrado, view_key cerrada)
→ current binding
→ policy_bundle_key@version + definition_hash
→ population_ref opcional
```

Módulos iniciales: `brand-monitoring`, `mentions`, `topics-narratives`,
`triggers-barriers` y `admin-mentions`. Views iniciales: `brand`, `competition`,
`category`, `all-governed`, `strategic` y `admin-reservoir`. Cada par tiene una matriz
cerrada; `market_context` continúa como facet y no es una view ni un scope.

El resolver no acepta `population_id`, policy expressions ni IDs de bundle del
navegador. Rechaza binding inexistente, retirado, incompatible o cross-workspace. Para
`brand` puede describir explícitamente el pointer operational actual como
`operational-brand-bridge`. La foundation no cambió por sí sola los readers visibles;
Backend 05B conecta después el boundary server-side descrito abajo, todavía sin cambiar
`NOISIA_SIGNAL_OPERATIONAL_READ_MODE` ni activar un canary.

El compilador normaliza la policy y exige una raíz canónica, acceptance/quality,
assertion `mention_semantic` current+approved+eligible, allowlist de scopes/entidades y
deduplicación `canonical-root`. Produce un plan/hash compacto, nunca SQL o memberships
enviadas por la UI. Una compilación relacional liga el bundle y plan exactos a la
población/version/digest/watermark derivados; un binding con `population_id` falla
cerrado si esa prueba no es current y `ready`.

`coverage` y `denominator` tienen descriptores compartidos para la integración futura.
Cada dimensión de coverage usa `{availability:"available",count:n}` o
`{availability:"not_available",count:null}`. Un cero significa una medición observada,
nunca desconocimiento. `captured`, `quality_eligible`, `unreviewed`, `reviewed`,
`resolved_attributed`, `abstained`, `unattributed` y `used_by_view` son dimensiones
separadas; mientras no exista abstention durable, `abstained` es `not_available`.
Esta fase no modifica payloads HTTP, por lo que OpenAPI permanece sin cambios.

### Governed multi-view foundation V1 (Backend 06)

Backend 06 publica únicamente el selector cerrado `view` en los GET workspace-owned de
Monitoring, Mentions y Topics & Narratives. Su default es `brand`; el boundary
autenticado resuelve server-side:

```text
workspace autorizado
+ module_key ∈ {brand-monitoring, mentions, topics-narratives}
+ view_key ∈ {brand, competition, category, all-governed}
→ bundle y entidades server-owned
→ base semántica compatible
→ derivación exacta module/view
→ population + evaluation + compilation verificables
```

El enum público operacional es exactamente `brand | competition | category |
all-governed`. `strategic` y `admin-reservoir` siguen siendo identidades internas de
otros contratos; no son valores aceptables para este resolver client-safe. El browser
puede enviar sólo `view`; nunca envía
`population_id`, `policy_bundle_id`, `binding_id`, read mode, entity IDs ni una policy.
En legacy/shadow sólo `brand` puede usar el bridge. Una view no-brand sin binding current
compatible falla `not_available`, sin ejecutar queries que revelen counts.

Selección de base:

- `brand` exige el contrato 0064
  `signal-operational-primary-brand-semantic-v2`;
- `competition`, `category` y `all-governed` exigen
  `signal-operational-attributable-semantic-v1`, una base neutral workspace-scoped de
  raíces con assertion `mention_semantic` current, approved, eligible y entidad
  gobernada;
- la base neutral no lleva quality, retention, licensing, period, module/view ni
  compiled-plan state. No se crea por migración: un writer interno autorizado debe
  asegurarla y reconciliarla;
- `all-governed` usa el subconjunto explícito no vacío de scopes gobernados del bundle
  y deduplica por canonical root. `unattributed` nunca es elegible.

Cada identidad materializable conserva una derivación distinta por
`(workspace_id,module_key,view_key,policy_bundle_id)`. Por ello dos módulos pueden tener
denominadores diferentes debido a sus usage purposes sin sobrescribir memberships,
digests, watermarks o compilaciones entre sí. El bundle es authority; la population
resuelta continúa siendo estado derivado.

El binding set interno siempre contiene exactamente los tres módulos. Para `brand`, el
retiro atómico es `withdraw-to-bridge` y conserva el pointer operational como fallback.
Para `competition`, `category` y `all-governed`, el retiro es
`withdraw-to-absence`: no existe un bridge legacy autorizado para esas views. Ambos
flujos conservan historial append-only, CAS, actor server-resolved, idempotencia y
rechazo cross-workspace.

La foundation 0073 pasó integración PostgreSQL, runner guarded y smoke `0000–0073`
locales, y fue verificada en `noisia-staging` con 39/39 sentinels. Su migración no creó
bindings current ni cambió readers. El rehearsal posterior creó mediante writers
autorizados nueve bindings/population refs no-brand, reconcilió la unión deduplicada y
obtuvo `unexplained_count=0`; Advisor cerró Backend 06 sin P0/P1. OpenAPI declara el enum
cerrado y su default, pero no publica ninguna identidad de autoridad.

### Governed serving contract V1 (Backend 05B, no visible activation)

Backend 05B conecta el boundary **server-side** de los readers workspace-owned con una
identidad cerrada por módulo y view, pero no activa todavía el serving gobernado visible.
El navegador nunca envía `population_id`, `policy_bundle_id`, `binding_id`, read mode ni
una policy expression. Cada request autenticada resuelve una de estas identidades:

```text
brand-monitoring / brand
mentions / brand
topics-narratives / brand
```

En `legacy`, la fuente visible continúa siendo legacy. En `shadow`, la respuesta visible
continúa siendo byte-compatible con legacy mientras la comparación gobernada durable se
ejecuta fuera del camino crítico HTTP. Sólo `governed` puede agregar el descriptor
`serving_scope` al payload. Por eso este subgate no cambia todavía OpenAPI ni el contrato
cliente activo.

`serving_scope` es un descriptor compacto, no una población ni un snapshot JSON. Declara:

- workspace, `module_key`, `view_key`, rollout y fuente visible/resuelta;
- binding gobernado o bridge operacional, nunca ambos;
- bundle/version/hash de policy;
- population/version/definition hash/membership digest;
- compilation/compiled-plan hash y su vigencia;
- data/source watermarks, governance digest, freshness e invalidation;
- coverage con disponibilidad explícita por dimensión;
- denominator de raíces canónicas para el filtro/periodo solicitado;
- usage purposes cerrados del módulo y visibility class.

La ausencia real de un binding current permite resolver
`operational-brand-bridge`. Un binding current inválido, futuro, expirado, retirado,
stale, sin compilation `ready`, sin derivation exacta o sin watermark durable falla como
`not_available`: nunca cae silenciosamente al bridge.

Monitoring, Mentions y Topics & Narratives resuelven populations derivadas distintas.
Facets, series, breakdowns, comparison, interpretations, detail, lineage y evidence usan
la population exacta del módulo; no reutilizan el denominator de otro módulo. Cuando
Monitoring o Topics & Narratives exponen mentions o excerpts, la evidencia se restringe
además a la intersección con las capabilities/población de Mentions. El denominator
métrico no se reduce por esa intersección y la respuesta distingue
`metric_denominator_count`, `evidence_visible_count` y
`evidence_withheld_count`/`not_available`.

ETags y cursores gobernados quedan ligados a workspace, módulo/view, binding/bridge,
policy hash, population version/digest, compilation/plan, watermarks, capabilities,
filtros y orden normalizados. Un token no puede reutilizarse tras promoción, rollback,
invalidación o cambio de rights. Legacy y shadow conservan sus semillas y payloads
anteriores mientras el canary visible permanezca pendiente.

El servicio interno de Backend 02 asegura el draft `operational-brand-governed@1`
exclusivamente desde workspace/brand/actor resueltos server-side. Sin catálogo canónico
versionado de quality, retention y licensing, el draft se conserva `blocked`: no copia
thresholds de Laika ni crea bindings. La reconciliación compila sobre la candidata V2
existente y deriva memberships por raíz canónica + inclusión + assertion semántica
current, approved, eligible y entidad exacta. El runner draft-aware selecciona esa
candidata por policy/module/view, no por un `population_id` suministrado, y ejecuta los
tres adapters más un baseline SQL dentro de `REPEATABLE READ READ ONLY`.

Backend 03 agrega únicamente contratos internos server-side; no agrega rutas HTTP. Los
writers de quality, retention, licensing y bindings de provenance reciben workspace y
actor ya autorizados, usan `Idempotency-Key`, escriben drafts append-only y requieren
una activación explícita. Ningún string de policy enviado por el navegador puede volver
una compilación `ready`.

El compilador de `brand` resuelve:

```text
canonical root + included + quality policy activa
+ mention_semantic current/approved/eligible + brand exacta
+ al menos una provenance source/import con retention vigente
+ licensing allowed para todos los usage purposes del módulo
```

La excepción exacta del import precede al binding de source; entre provenances
independientes gana cualquier ruta autorizada y el denominador continúa deduplicado por
raíz. La compilación persiste policy IDs/versiones/hashes, digests de retention y
licensing, usages, watermark de evaluación, governance digest y conteos blocked/unknown.
El preflight operator-safe es read-only, agregado y redactado; no devuelve textos,
URLs, UUIDs ni metadata cruda. Esta foundation sigue sin alterar payloads HTTP u
OpenAPI.

### Gate D · Strategic T&B governed launch V2

La identidad pública de la corrida continúa siendo workspace + reporte
`triggers-barriers`. El navegador no envía `population_id`, `policy_bundle_id`,
`binding_id`, `compilation_id`, `evaluation_id`, corpus de ejecución ni policy JSON. El
boundary autenticado resuelve y vuelve a verificar esas identidades server-side para
`triggers-barriers / strategic`.

| Ruta | Contrato |
|---|---|
| `GET /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs` | preflight puro con periodo, timezone, study size y hard cap; corre en `REPEATABLE READ READ ONLY`, devuelve `writes_performed=false`, `jobs_enqueued=0` y `provider_calls=0` |
| `POST /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs` | recomputa el preflight exacto y, sólo con flag pagado server-side, congela snapshot/muestra y crea control + outboxes atómicamente; exige `Idempotency-Key`, hard cap y `preflight_digest` |
| `GET /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs/:analysisId` | polling read-only de lifecycle, step, versiones provider/prompt/pricing, presupuesto, Review y release; nunca encola ni reanuda |
| `DELETE /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs/:analysisId` | solicita cancelación durable sin borrar la corrida o reescribir su autoridad congelada |
| `POST /api/data-os/signal/:workspaceId/reports/triggers-barriers/runs/:analysisId/review` | una operación idempotente registra Review seleccionada y crea la release draft en la misma transacción |
| `POST /api/data-os/signal/:workspaceId/releases` | `promote` exige `Idempotency-Key` y mueve el current release mediante el writer V2; un retry compatible devuelve el resultado original |

El preflight devuelve únicamente hashes y descriptores operator-safe: population
version/count/digest, authority y provenance digests, watermark, policy transition,
muestra determinista, denominator, coverage, provider/prompt/pricing, plan cerrado de
llamadas, presupuesto y readiness. `ready` describe la validez técnica y de governance;
`launch_authorized` es un permiso server-side distinto. Un GET bloqueado es inspección
válida y enumera `blocking_reasons`, pero nunca se convierte en POST por sí solo.

La policy estratégica exige exactamente `llm-processing` y `strategic-analysis` sobre
provenance vigente. Unknown, policy vencida, binding/compilation incompatibles, digest
de memberships distinto, aliases, derechos incompletos, Worker/queue sin readiness o
hard cap insuficiente fallan cerrado. La muestra es determinista y deduplicada por raíz;
el snapshot y su evidence se contienen en la population exacta.

El plan de provider es cerrado y versionado. Antes de cada llamada el Worker relee la
autoridad runtime, adquiere lease, reserva tokens/costo con una operation key única y
después liquida el uso real. El upper bound usa el mismo redondeo conservador hacia
arriba a micro-USD en Query Engine y PostgreSQL. Un fallo previo al dispatch libera la
reserva; un resultado
incierto del provider no se reintenta como si no hubiera costo. Outbox de steps,
transiciones append-only, heartbeat, recovery y dead-letter hacen auditable la
ejecución sin guardar prompts, respuestas ni secretos en errores públicos.

La release V2 sigue siendo una revisión del mismo `(workspace_id, report_key)`. Review
no aprueba en masa tags reutilizables y la publicación vuelve a comprobar snapshot,
quality gates y autoridad client-safe de evidence. Falta de permiso para listado o
excerpt retiene evidence aunque el análisis interno exista.

La migración 0074 implementa este contrato de forma forward-only y data-neutral: no
crea bindings estratégicos, runs, snapshots, jobs, Review events o releases por sí
sola. Está `staging_verified` con SHA-256
`1eb15739c17a17fb4c4f9924971447fbcb6a26bcfa6cfc68cf7847f5b5e13d69`, 108/108
sentinels, ledger único y verify read-only sin cambios en V1, base semántica, bindings,
compilaciones, pointers o readers. El preflight gratuito permanece como operación
explícita posterior; aplicar 0074 no lo ejecuta ni autoriza una corrida. El rehearsal
remoto del GET devolvió `ready=false`, `launch_authorized=false`, cero writes/jobs/calls
y los blockers `provider_authority_unavailable`,
`strategic_governed_binding_unavailable`, `strategic_recovery_not_ready` y
`strategic_worker_not_alive`. Inventar una authority o esconder esos blockers violaría
el contrato. No se ejecutó una corrida T&B pagada.

### Imports CSV workspace-owned asíncronos

Estas rutas son management APIs autenticadas; workspace, source, actor, storage bucket,
job y batch se resuelven server-side. Las mutaciones exigen `Idempotency-Key`.

| Ruta | Contrato |
|---|---|
| `GET /api/data-os/signal/:workspaceId/sources/:sourceId/imports` | historial operator-safe con estado, fase, progreso, conteos finales sólo si completó y errores recuperables |
| `POST /api/data-os/signal/:workspaceId/sources/:sourceId/imports` | con `action=create-upload`, crea o reusa un batch y devuelve `202`, `import_batch_id`, partes firmadas y `polling_url`; el request no transporta el CSV completo |
| `POST /api/data-os/signal/:workspaceId/sources/:sourceId/imports/:importBatchId` | `complete-upload` verifica todos los objetos y encola; `fail-upload` conserva upload abortado/fallido como historia recuperable |
| `GET /api/data-os/signal/:workspaceId/sources/:sourceId/imports/:importBatchId` | polling sin side effects de `uploading/queued/processing/completed/failed`, records/bytes/percent y error tipado |

La creación responde:

```json
{
  "contract_version": "signal-workspace-async-import-v1",
  "import": { "id": "server-owned", "status": "queued", "phase": "uploading" },
  "upload": {
    "protocol": "supabase-multipart-signed",
    "part_size_bytes": 50331648,
    "parts": [
      { "part_number": 1, "expected_size_bytes": 50331648, "upload_url": "ephemeral" }
    ]
  },
  "polling_url": "/api/data-os/signal/.../imports/server-owned"
}
```

Los URLs de upload son efímeros y sólo se entregan al actor autorizado; no aparecen en
evidence ni logs. El browser sube cada parte directamente al storage privado y puede
reintentarla sin mantener viva una request de Studio. El Worker lee las partes en orden y
usa la implementación única de SentiOne de `@noisia/db`: parser, normalización,
deduplicación, persistencia y provenance. El adaptador de compatibilidad de Studio llama al
mismo core; el endpoint workspace-owned y Admin usan siempre el transporte directo.

Un estado incompleto nunca devuelve conteos como finales ni habilita serving. Completion
es transaccional e idempotente: content hash, records reconciliados, provenance,
watermark, sync e invalidaciones se publican una sola vez. Un retry operator-safe envía
`supersedes_import_batch_id` y una nueva key; el failed anterior permanece visible.

### Acquisition Plan workspace-owned (`signal-acquisition-plan-v1`)

Estas rutas son management-only, resuelven workspace/actor server-side y responden con
`Cache-Control: private, no-store`. Toda mutación exige `Idempotency-Key`; el browser
nunca envía owner/entity/plan/slot/query UUIDs, policy IDs, SQL o expressions.

| Ruta | Contrato |
|---|---|
| `GET /api/data-os/signal/:workspaceId/acquisition-plan` | current/draft, `plan_status/version`, slots, summaries de query, referencias candidatas, readiness y blockers operator-safe; sin query privada, raw metadata o IDs internos |
| `POST /api/data-os/signal/:workspaceId/acquisition-plan` | reconcile append-only del draft desde Brand OS/catalog; no promueve ni crea semantic approval |
| `GET/POST /api/data-os/signal/:workspaceId/acquisition-plan/brief` | lee defaults/estado `missing\|sealed\|stale` y sella sólo objetivo, propósito, mercado/países, idiomas, periodo, ventana, modo y uso opcional de Knowledge; Brand OS, catálogo, Knowledge, timezone y contrato provider se resuelven server-side; no genera queries ni llama providers |
| `GET /api/data-os/signal/:workspaceId/acquisition-plan/readiness` | drift/readiness read-only contra Brand OS, identities, connectors, queries y governance |
| `POST /api/data-os/signal/:workspaceId/acquisition-plan/promote` | promoción explícita con `expected_draft_version`, revision, digest, effective date y evidence |
| `POST /api/data-os/signal/:workspaceId/acquisition-plan/reference-decisions` | include/exclude/revert explícito para una reference operator-safe; ledger append-only |
| `POST /api/data-os/signal/:workspaceId/acquisition-plan/slots/:slotKey/query-versions` | crea una query privada versionada contra `source_key`; no cambia semantic truth |
| `GET/POST /api/data-os/signal/:workspaceId/acquisition-plan/query-generation` | preflight gratuito y generación server-owned confirmada/hard-capped; máximo dos llamadas, drafts pending, nunca reference ni promotion |
| `GET/POST /api/data-os/signal/:workspaceId/acquisition-plan/slots/:slotKey/query-versions/:queryVersion` | focused read privado y decisión append-only `approved/rejected`; pending/rejected bloquean promotion |
| `POST /api/data-os/signal/:workspaceId/acquisition-plan/slots/:slotKey/retire` | retiro prospectivo en draft; no borra slot/query/import history |
| `GET/POST /api/data-os/signal/:workspaceId/acquisition-plan/imports` | lista por `source_key` y `slot_key` opcional, o sella un upload target y devuelve `202` multipart/polling |
| `GET/POST /api/data-os/signal/:workspaceId/acquisition-plan/imports/:importBatchId` | polling y complete/fail/retry-from-storage; recovery copia el sello original |

La creación target de connector reutiliza `POST .../sources` con
`contract_version=signal-data-source-connector-v1`, sin scope/entity. La forma legacy
con scope permanece separada como compatibilidad y no se acepta para imports target.

El contrato de import exige `source_key`, `slot_key`, query version, periodo/timezone,
filename/tamaño/MIME y `supersedes_import_key=null` al crear. Server-side se sellan
plan/slot/query digests, Brand OS/catalog, provider schema y rights. Plan/query drift
posterior no altera el batch. Retry desde storage no acepta un sello nuevo.

Typed observations son privadas y nunca se exponen en estas APIs. `raw_metadata`, query
text, storage keys y signed URLs sólo existen en boundaries internos; las signed parts
son la única excepción efímera y se entregan exclusivamente al actor autorizado en la
respuesta inicial.

#### Query Composer workspace-owned (`10A.5A`, application contract)

10A.5A no publica una ruta HTTP nueva. Entrega tres boundaries server-owned para el
futuro transporte de 10A.5B:

- un preflight read-only que devuelve slots requeridos, plan/context digest, modelo,
  pricing, máximo de dos llamadas, costo máximo, hard cap y blockers, siempre con
  `writes_performed=false` y `provider_calls=0`;
- `generateSignalAcquisitionQueryDraftsV1`, función de aplicación con provider inyectado,
  AuthZ previa, CAS antes/después de componer e Idempotency-Key. Genera exactamente
  primary, category y un draft por competitor activo; reference se excluye;
- un focused read autorizado que puede devolver el query text privado y su resumen de
  validation/fallback. Los listados generales sólo muestran origin y estado.

El navegador no puede declarar `engine-generated`, model, digests, lineage ni IDs. 10A.5B
añade el transporte server-owned con confirmación/cap y recheck del mismo CAS. El focused
read es management-only y la aprobación/rechazo vive en un ledger append-only separado:
ningún draft generado o editado participa en promoción hasta tener aprobación explícita.
La revisión de query expresa intención de adquisición y nunca reemplaza Semantic Review
de menciones.

#### Classification Authority 10B (internal application/DB contract)

10B no publica una ruta HTTP nueva. El browser no puede suministrar workspace,
generation, profile, term, policy, model, population o binding IDs. Los writers internos
server-owned crean/finalizan generations, anexan resultados idempotentes y ejecutan el
projector temporal. Un replay con el mismo request digest devuelve el resultado previo;
la misma Idempotency-Key con input distinto falla cerrado.

El descriptor operator-safe `signal-classification-authority-v1` expone únicamente
availability, generation key/version y digests, denominator, resolved, approved,
pending, rejected, abstained, error, coverage y limitations. En `not_available`, counts
y coverage son `null`; una abstención medida sí puede ser `0`. Score/confidence sólo
priorizan Review y no conceden aprobación.

Los writers de evaluación tampoco aceptan métricas declaradas por el caller como
authority. Denominator, disposiciones y precision/recall/F1 se recomputan desde el gold
set y los assignments sellados; los slices se resuelven por `slice_keys` inmutables y
su propia operación idempotente. Una propuesta producida por provider queda `pending`,
nunca `approved`, hasta una decisión humana o policy aprobada/versionada.

Los endpoints T&N legacy de review conservan lectura histórica, pero toda mutación de un
tag asociado a `signal_taxonomy_profile_id` falla con
`signal_classification_ledger_required_10b` hasta que 10C/10D publiquen su control plane.
No se cambió OpenAPI porque no existe transporte nuevo.

## 20. Auto-generación de OpenAPI

Codex debe generar el OpenAPI spec automáticamente desde los Zod schemas usando `zod-to-openapi`. Output en `docs/api/openapi.yaml`. Regenerar en CI.

```typescript
// TODO mejora-futura: cuando llegue a 80+ endpoints, considerar
// dividir en archivos OpenAPI por dominio (org, brands, corpora,
// analysis, dashboards, admin) y juntarlos con $ref.
```

---

## 21. Lo que NO incluye este contrato (postpuesto)

- WhatsApp Business endpoints (postpuesto en decisiones técnicas)
- Billing/Stripe webhooks
- Multi-país: UI de selección de país (schema soporta, UI espera)
- Real-time collaboration en findings (un Insights Manager a la vez en MVP)
- API pública para clientes (toda la API es interna o autenticada con Kinde)

---

## 22. Versionado del contrato

`v1` durante MVP. Cuando rompamos contrato:
- Mantener `v1` por 3 meses paralelo.
- Migrar consumidores.
- Deprecar.

Sufijo en URL: `/api/v1/...` cuando lleguemos a primer cliente productivo.

## 23. Acquisition import Query Evidence V2

`POST /api/data-os/signal/:workspaceId/acquisition-plan/imports` acepta únicamente dos
formas browser-owned y rechaza campos desconocidos:

- `operator_attested`: `query_version` requerida, `reason=null` y confirmación explícita;
- `unavailable`: `query_version=null`, razón cerrada y confirmación explícita.

`provider_verified` no forma parte del request público. Sólo un adapter server-owned puede
crearlo aportando una referencia de ejecución verificable. El servidor resuelve workspace,
source, plan, slot, query y actor; el browser nunca envía IDs internos ni digests.

La respuesta `202` conserva upload multipart y polling e incluye
`acquisition.query_evidence`. Tras `completed`, `observed` devuelve periodo, idiomas,
países, plataformas y warnings contra el envelope declarado. Recovery por storage preserva
el sello V2 exacto. La readiness del plan distingue `ready_for_import` de
`query_playbook_complete`: un connector manual autorizado puede importar con query
`unavailable`, aunque el playbook incompleto permanece visible como warning.

## 24. Strategic authority para benchmark de Acquisition (internal application contract)

10C.2B no agrega una ruta HTTP ni una acción browser-owned. El boundary interno
`authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1` recibe workspace
y actor ya autorizados, Idempotency-Key, evidence operator-safe y el freeze sellado. Los
batches se resuelven server-side por plan/slot/digests; el caller no proporciona UUIDs
de import, policy o binding.

La operación clona la matriz Licensing, cambia únicamente `strategic-analysis` a
`allowed`, activa una policy corpus-scoped y bindings import-level, y crea sucesoras
append-only de las typed observations. La vigencia máxima es 30 días y queda acotada por
retention/licensing actual. El contrato falla cerrado ante drift, rights incompatibles,
`llm-processing` previamente permitido, cross-workspace, replay incompatible o un
payload de observación alterado. El preflight de exportación permanece estrictamente
read-only y declara `required_usage=strategic-analysis`; nunca crea jobs ni ejecuta un
modelo.

## 25. Operator Topic Discovery Review (`10C.3A-R`)

Las rutas management-only viven bajo
`/api/data-os/signal/:workspaceId/topic-discovery-review`. Exigen sesión Kinde, AuthZ
DB-owned del mismo management boundary estratégico y actor interno. `workspaceId` del
path sólo selecciona contexto: el servidor vuelve a resolver ownership. Nunca son
endpoints de Signal serving.

| Método/ruta | Contrato |
|---|---|
| `GET /` | runs registrados y resumen/progreso |
| `GET /proposals` | keyset pagination; cursor sellado al digest de filtros |
| `GET /proposals/:proposalKey` | un detalle y hasta ocho excerpts rights-current |
| `POST /draft` | draft rubric append-only e idempotente |
| `GET|POST /outliers` | reservoir y decisión separada |
| `POST /finalize` | census completo + outliers, cierre atómico |
| `GET /exports/:kind` | score/decision sheet sólo después de finalizar |
| `GET /history` | revisions y events append-only |
| `POST /supersede` | nueva revisión correctiva abierta |

Los request schemas son strict. El browser no puede proporcionar workspace/owner,
reviewer, digests, candidate/run authority, evidence refs o blind key. El actor proviene
de la sesión; `Idempotency-Key` es obligatorio en writers. `none_acceptable=true` y
`convert_to_topic_contract_candidate=true` son incompatibles.

Las respuestas son `private,no-store`, paginadas y operator-safe. La lista busca sólo
términos/frases del packet, nunca full text. El detalle carga evidencia bajo demanda y
revalida `strategic-analysis`, completed provenance, retention y Licensing vigentes.
Cada respuesta válida incluye `Server-Timing` sin texto ni identificadores privados.
Blind key, paths `.data`, raw packet, raw JSON, mention IDs y hashes completos no se
devuelven.

`candidate_preferred` significa exclusivamente utilidad humana aparente para generar
proposals. Toda finalización devuelve y conserva:

```text
modeling_adopted=false
ten_c3b_authorized=false
ten_d_ready=false
holdout_opened=false
```

El endpoint no crea Topic Contracts, assignments, tags, jobs, serving materializations,
pointers o governed bindings.

## Semantic Context Pack management — 10C.3B-A / NOI-71

**Registrado:** 2026-08-22T01:00:09-06:00 (`America/Mexico_City`).

Base: `/api/data-os/signal/{workspaceId}/semantic-context`.

Todos los contratos son management-only, requieren AuthN, AuthZ DB-owned y actor interno,
y responden `Cache-Control: private, no-store`. El path selecciona el workspace, pero el
servidor vuelve a resolver ownership. Los writes requieren `Idempotency-Key`; el browser
no aporta workspace, profile/Knowledge IDs, digests, prompt, modelo, pricing, reviewer ni
authority IDs.

| Método/ruta | Contrato |
|---|---|
| `GET /` | generación operator-safe y versiones actuales de elementos |
| `POST /` | crea draft con `{action:"create_draft"}`; snapshots resueltos server-side |
| `GET /readiness` | digests current, counts, locale/market coverage, drift y readiness |
| `GET /diff` | compara digests sealed contra Brand OS/Knowledge/locale current |
| `GET /preflight` | máximo una llamada futura, modelo/pricing pinneados, estimate/hard cap, `provider_calls=0` |
| `POST /reconcile` | crea/no-op de successor append-only con razón cerrada; authority y provider lineage server-owned |
| `POST /decisions` | approve/reject/edit o bulk approve explícito y máximo 100 |
| `POST /publish` | publicación separada con confirmación literal |

No existe endpoint browser para `appendSignalSemanticContextProposalsV1`: es un boundary
server-owned para una proyección determinística o un adapter de provider futuro. Una
edición HTTP sólo cambia texto/locale/relación operator-safe y vuelve a `pending`; no
acepta entity UUIDs. Publication falla si queda cualquier pending, no existe un approved,
hay colisión canónica o cambiaron Brand OS, Knowledge o locale.

El focused GET conserva `origin`, timestamps, disposition y lineage de supersession. Los
refs de actor, entidad y evidencia se pseudonimizan server-side; ningún UUID de autoridad
o bloque Knowledge crudo cruza el contrato del navegador.

El preflight es estrictamente read-only. La configuración incompleta se representa como
`blocked/provider_configuration_unavailable`; nunca dispara provider, job u outbox.

`POST .../semantic-context/reconcile` acepta únicamente `reason` del enum cerrado y
requiere `Idempotency-Key`. Relee Brand OS, Knowledge, locale/market y provider lineage
después del lock. Si la hoja effective ya coincide, devuelve `outcome=noop`; si existe
drift crea un successor `draft` y devuelve `outcome=created`. Una corrida provider en
`queued|processing|validating` devuelve 409. La respuesta sólo incluye generation key,
versión, status y outcome; no expone predecessor ID, snapshots, hashes completos,
modelo o pricing.

### Ejecución acotada de propuestas — 69A.2

`POST /api/data-os/signal/{workspaceId}/semantic-context/proposals` inicia un run durable
con `Idempotency-Key`, `generation_key`, `preflight_digest`, la confirmación literal
`GENERATE_PENDING_SEMANTIC_CONTEXT_PROPOSALS` y un `hard_cap_micro_usd` explícito. El
servidor fija provider/model/pricing/prompt y relee Brand OS, Knowledge y locale.

`GET .../proposals/{runKey}` devuelve únicamente estado, progreso, lineage de provider,
budget/settlement, proposal count, result digest y error sanitizado. `POST
.../proposals/{runKey}/retry` acepta body vacío y sólo reencola un intento cuyo transporte
demostró que no envió una request. Un outcome ambiguo es `dead_letter` y no es retryable.
Ningún endpoint devuelve prompt, response cruda, bloques Knowledge o evidence UUIDs.

### Diagnóstico cerrado de outputs y presupuesto — 69A.4

**Registrado:** 2026-08-22T23:31:58-06:00 (`America/Mexico_City`).

El preflight V2 declara además `maximum_proposals`, calculado server-side desde el
presupuesto sellado de output. La reserva usa el tamaño UTF-8 del prompt materializado
como cota conservadora de tokens de entrada, no el máximo teórico completo del modelo.
El transporte Anthropic compartido recibe el JSON Schema cerrado; el Worker vuelve a
validar la respuesta completa antes del único append atómico.

Los fallos conservan códigos específicos como
`semantic_context_provider_response_truncated`,
`semantic_context_provider_element_kind_invalid` o
`semantic_context_provider_required_field_invalid`. El estado privado conserva sólo
path lógico, conteos y digest del diagnóstico; el GET management devuelve únicamente
el código y copy operator-safe. Nunca cruza la respuesta del provider, valores
inválidos, prompt o Knowledge. Una corrida con `provider_call_count=1` sigue sin ser
retryable aunque el error sea de truncamiento o schema.

### Capacity planner server-owned — 69A.5

**Registrado:** 2026-08-23 (`America/Mexico_City`).

`GET .../semantic-context/preflight` devuelve ahora
`signal-semantic-context-proposal-preflight-v3`. El servidor deriva una capacidad
determinística desde los conteos sellados de Brand OS y Knowledge: aliases, productos,
competidores, locales, mercados, code-switching, campos de categoría, términos
estructurados, bloques Knowledge y tipos de fuente de evidencia. El navegador no puede
enviar ni modificar esos conteos, la fórmula o el presupuesto.

La respuesta añade `capacity.minimum_useful_proposals`, `target_proposals`,
`maximum_proposals`, `output_token_budget`, sus digests y una explicación por factores.
`target_proposals` es capacidad, no cuota: el provider debe omitir propuestas sin
evidencia. `max_output_tokens` es el presupuesto calculado para esa generación, separado
de `configured_output_token_ceiling` y `model_max_output_tokens`. El preflight falla
cerrado si la complejidad satura el contrato, el modelo no soporta el presupuesto o el
ceiling server-owned es insuficiente.

El costo máximo se calcula con el prompt materializado y el presupuesto de salida
calculado. `recommended_hard_cap_micro_usd` permanece server-owned y nunca supera
`platform_hard_cap_micro_usd`; el POST sigue rechazando cualquier cap insuficiente o
superior al límite de plataforma. No cambia el límite de una sola llamada, el append
atómico, el estado `pending` ni la prohibición de resultados parciales.

### Contract V2 y revalidación de response pagado — 69A.6

**Registrado:** 2026-08-23T02:13:03-06:00 (`America/Mexico_City`).

El output `signal-semantic-context-proposal-output-v2` ya no acepta `entity_type` del
provider. `element_kind` describe el conocimiento propuesto; `entity_ref` es nullable y
sólo contextualiza contra una entidad opaca existente. El servidor resuelve el ref y
deriva el tipo. Un candidato `category` sin ref es válido y un candidato `product` puede
quedar contextualizado bajo una entidad `brand` sin confundir ambas dimensiones.

`POST /api/data-os/signal/{workspaceId}/semantic-context/proposals/{runKey}/revalidate`
es management-only, exige `Idempotency-Key` y la confirmación literal
`REVALIDATE_PAID_SEMANTIC_CONTEXT_RESPONSE`. El browser no envía response digest,
authority digests, IDs de evidencia, provider ni tipos. La operación usa la respuesta
privada persistida, verifica settlement y autoridad current, adapta explícitamente V1 a
V2 y responde sólo con refs opacas, conteos y estado `completed|rejected`.

La operación añade siempre `provider_calls_added=0` y
`additional_cost_micro_usd="0"`. Un conflicto de duplicado u otro fallo integral crea
una revalidación `rejected` con cero propuestas; nunca un append parcial ni retry pagado.
El GET operator-safe del run incluye `paid_response_revalidation` nullable y sigue sin
exponer prompt, response privada o Knowledge crudo.

### Descubrimiento server-owned del run terminal — 69A.6C

**Registrado:** 2026-08-23 (`America/Mexico_City`).

`GET /api/data-os/signal/{workspaceId}/semantic-context?generation_key=...` incluye
`latest_proposal_run`, nullable y limitado a un único resumen operator-safe. La selección
se resuelve en PostgreSQL dentro del workspace y la generación efectiva: prefiere un run
`queued|processing|validating`; en ausencia de trabajo activo devuelve el resultado
terminal/revalidación más reciente de esa misma generación. Una generación superseded no
puede aportar el run current y un workspace distinto devuelve ausencia, no historia ajena.

La respuesta reutiliza `SignalSemanticContextProposalRunV1`, incluida
`paid_response_revalidation`, sin prompt, response privada, diagnósticos provider, IDs de
evidencia ni stack traces. `sessionStorage` deja de descubrir historial: sólo conserva un
hint acotado para un run activo iniciado en esa pestaña, y el servidor debe corroborar que
coincide con el run canónico antes de usarlo para polling.

Este cambio es exclusivamente de read model: no crea revalidaciones, proposals,
reservations, outboxes ni jobs; tampoco modifica settlement, Topic Contracts, assignments,
tags o serving.

### Successor gratuito después de una corrida terminal — 69A.7A

**Registrado:** 2026-08-23T14:07:30-06:00 (`America/Mexico_City`).

`POST /api/data-os/signal/{workspaceId}/semantic-context/reconcile` acepta ahora la causa
cerrada `terminal_provider_run`. Continúa siendo management-only y requiere
`Idempotency-Key`; el browser no envía generation IDs, hashes, snapshots, modelo,
pricing ni authority IDs. La operación preserva el draft y run históricos y crea, si la
hoja es elegible, un successor draft sin trabajo provider. Replay y concurrencia
convergen en la misma hoja efectiva.

El preflight gratuito añade `semantic_context_generation_run_exists` cuando la
generación solicitada ya tiene cualquier run durable y mantiene `readiness=blocked`.
El start writer vuelve a resolver esa condición dentro de la misma transacción y bajo el
advisory lock del workspace. Un replay con la misma idempotency key devuelve su resultado
durable; una key nueva no puede saltar el guard ni chocar tarde con la unicidad del run.

### Merge, correction, annotations y publicación sellada — 69B.2

**Registrado:** 2026-08-24 (`America/Mexico_City`).

Las cuatro mutaciones management-only requieren rol interno DB-owned,
`Idempotency-Key`, body cerrado y respuesta `private, no-store`:

- `POST .../semantic-context/merge` resuelve de 1 a 100 source keys same-kind hacia un
  target key; el servidor resuelve versiones, evidence y actor. Cada fuente termina
  `merged` y el target vuelve a `pending`. `target_annotation_resolutions` no admite
  dos entradas con el mismo `annotation_key`.
- `POST .../semantic-context/corrections` crea un successor
  `operator_correction/pending` y conserva annotations abiertas mediante successors
  re-bound. `annotation_resolutions` también exige keys únicas; duplicados
  contradictorios nunca son last-wins.
- `POST .../semantic-context/annotations` crea, amplía o resuelve sólo los tipos y
  resoluciones cerrados del contrato 69B.2A.
- `POST .../semantic-context/publish` acepta únicamente `generation_key`, el token
  opaco `preflight_digest` y `publish_reviewed_semantic_context_v2`. La confirmación V1
  está retirada y el writer legacy devuelve 410 antes de escribir.

`GET .../semantic-context/publish/preflight?generation_key=...` corre en una transacción
`REPEATABLE READ READ ONLY`. Devuelve conteos exactos —incluido `merged`—, collisions,
blockers, referencias abreviadas de componentes, el token completo y
`writes_performed=false`, `provider_calls=0`; no expone UUIDs, rationale, evidence refs
ni el envelope privado. El POST recompone el grafo bajo lock y sella candidate,
evidence, review, autoridad y pack antes del único cambio de estado.

Las respuestas de merge/correction exponen `draft_digest_ref` abreviado, nunca el
`draft_digest` completo. El preflight incluye `invalid_relation_targets` y bloquea toda
`typed_relation` approved cuyo target no sea una hoja current approved de la misma
generación/workspace. Modelo, pricing o cualquier otro campo del provider lineage
completo cambian el token y bloquean publish hasta reconciliación.

### Decisiones deliberadas de Semantic Context — 69B.4C-A

**Registrado:** 2026-08-25 (`America/Mexico_City`).

`POST .../semantic-context/decisions` acepta únicamente el contrato V2. Approve y
reject requieren un reason cerrado y rationale NFC de 1–1000 Unicode scalars; approve
además exige `approve_selected_semantic_context_element`. Bulk approve acepta 2–15
hojas pending, explícitamente seleccionadas y del mismo `element_kind`, con una base
compartida y `apply_shared_decision_basis_to_all_selected_elements`. Actor, workspace,
versión, evidence y digests continúan server-owned. Los entrypoints de decisión V1 son
tombstones 410 y reject V2 usa el mismo writer de decisión, sin fabricar una annotation.

El servidor sella ese payload operator-owned en el ledger; PostgreSQL reconcilia al
commit el input exacto con todo el grafo de successors y eventos. Por ello un writer SQL
directo no puede ampliar el bulk a 16, omitir o sustituir keys, mezclar kinds/bases,
insertar rejected bajo bulk ni completar un single con más de un successor.

El GET gratuito de publicación puede devolver `decision_basis_missing` cuando una hoja
current approved/rejected de un draft procede de historia anterior a 0098. El blocker
no muta esa historia: exige una reparación append-only posterior antes de publicar.

### Resolución deliberada de annotations — 69B.5E-C

**Registrado:** 2026-08-25 (`America/Mexico_City`).

`POST .../semantic-context/annotations` conserva el comando cerrado de creación y añade
dos comandos disjuntos. `action=resolve` exige la resolución cerrada, reason, rationale
NFC y `resolve_semantic_context_annotation_with_deliberate_basis`; `action=repair` exige
los mismos campos operator-owned y la confirmación distinta
`repair_semantic_context_annotation_resolution_basis`. El servidor deriva workspace,
actor, generación, annotation current, subject, snapshots y digests. El navegador no
puede enviar authority IDs/digests ni reutilizar automáticamente el rationale histórico.

Un repair sólo aplica a una hoja current resolved anterior al contrato y conserva su
resolución; crea una nueva versión con basis completo. Replay devuelve el mismo resultado
y concurrencia converge en un único successor. El detalle operator-safe marca el basis
como `complete`, `missing_historical` o `not_applicable`, y el preflight gratuito añade
`annotation_resolution_basis_missing` sin escribir. La UI sólo llama al endpoint tras
reason, rationale y confirmación explícitos; abrir o cancelar el formulario no muta.

### Decisión gobernada locale/global — 69B.5H-B

**Registrado:** 2026-08-25 (`America/Mexico_City`).

`POST .../semantic-context/locale-authority` requiere `Idempotency-Key` y uno de dos
comandos cerrados: `global` con `locale: null`, o `locale_specific` con un locale de la
generación. El payload incluye de 1 a 15 `element_keys` explícitas, un reason cerrado,
rationale NFC y `apply_semantic_context_locale_authority_decision`. Workspace, actor,
generation current, snapshots, locales permitidos, authority y digests se resuelven en
el servidor. La respuesta sólo confirma el cohort pending y una referencia abreviada
del draft; no devuelve IDs privados ni concede aprobación.

El workbench lista, filtra y detalla el estado operator-safe, pero no preselecciona
disposición, locale, reason ni confirmación. Cada comando reabre sus hojas como pending;
la aprobación deliberada posterior conserva una operación separada. El GET gratuito de
publication preflight añade el contador y blocker cerrado
`locale_market_required_unresolved` sin escribir.

69B.5H-C retira `locale` de `SignalSemanticContextCorrectionFieldsV2`; ni
`POST .../corrections` ni `POST .../merge` pueden cambiarlo mediante una corrección
genérica. Ambas operaciones preservan el locale y lineage actuales. El único contrato
management-only que acepta una decisión locale/global continúa siendo
`POST .../locale-authority`, con selección, basis y confirmación explícitas.
