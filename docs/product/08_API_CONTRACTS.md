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
