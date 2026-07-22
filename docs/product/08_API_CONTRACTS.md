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
- una dimensión desconocida responde `unsupported_dimension`, nunca se ignora.

Dimensiones V1, en orden canónico:

`platform`, `source_type`, `entity`, `product`, `campaign`, `topic`, `taxonomy`,
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
   `contract_version`, `date_range`, `timezone`, `granularity`, `dimensions`.
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
