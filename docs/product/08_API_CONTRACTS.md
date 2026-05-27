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

## 16. Jobs endpoints

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

## 17. Webhooks (inbound)

### `POST /api/webhooks/integration/:integration_id`
Endpoint para recibir webhooks de integraciones configuradas.

### `POST /api/webhooks/sentione`
Endpoint específico para SentiOne si configuramos webhook (vs pull).

---

## 18. Admin endpoints

### `GET /api/admin/stats`
Stats globales del sistema (founder only).

### `GET /api/admin/users`
Gestión de usuarios.

### `POST /api/admin/users/:id/impersonate`
Asumir sesión de usuario (debug).

---

## 19. Auto-generación de OpenAPI

Codex debe generar el OpenAPI spec automáticamente desde los Zod schemas usando `zod-to-openapi`. Output en `docs/api/openapi.yaml`. Regenerar en CI.

```typescript
// TODO mejora-futura: cuando llegue a 80+ endpoints, considerar
// dividir en archivos OpenAPI por dominio (org, brands, corpora,
// analysis, dashboards, admin) y juntarlos con $ref.
```

---

## 20. Lo que NO incluye este contrato (postpuesto)

- WhatsApp Business endpoints (postpuesto en decisiones técnicas)
- Billing/Stripe webhooks
- Multi-país: UI de selección de país (schema soporta, UI espera)
- Real-time collaboration en findings (un Insights Manager a la vez en MVP)
- API pública para clientes (toda la API es interna o autenticada con Kinde)

---

## 21. Versionado del contrato

`v1` durante MVP. Cuando rompamos contrato:
- Mantener `v1` por 3 meses paralelo.
- Migrar consumidores.
- Deprecar.

Sufijo en URL: `/api/v1/...` cuando lleguemos a primer cliente productivo.
