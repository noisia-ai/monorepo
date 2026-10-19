# Brand OS Data OS Persistence Audit

**Fecha:** 2026-07-06
**Scope:** New Brand / Brand OS intake, catalog fields, aliases, competitors, Knowledge Base notes, Data OS traceability.

## Resumen

La pantalla de New Brand ya no es sólo formulario plano: al crear una marca, el backend persiste datos en tablas operativas (`brands`, `brand_seeds`, `competitors`, `brand_knowledge_sources`) y, si `NOISIA_DATA_OS_ENABLED=true`, inicializa entidades Data OS (`data_assets`, `brand_os_profiles`, `brand_os_briefs`, `brand_os_seed_sets`, `brand_os_seed_terms`, `brand_os_competitors`, `brand_os_links`, `lineage_edges`).

El gap principal no está en la captura inicial; está en consistencia y evolución:

- Los catálogos de UI (`industry`, `subindustry`, `countries`) todavía son catálogos de código, no términos gobernados en DB.
- La edición de Brand OS actualiza `brands` pero no sincroniza Data OS.
- Competitors y aliases sí se convierten en seeds, pero no conservan todavía source-level confidence, provider, accepted/rejected history ni estado de revisión por item.
- Knowledge Base notes se guarda como `brand_knowledge_sources.raw_text`, pero no se chunkifica automáticamente en `knowledge_chunks` en el mismo request.

## Flujo Actual De Creación

Archivo principal:

- `apps/studio/src/app/api/brands/route.ts`

Payload desde UI:

- `organization_name`
- `slug`
- `name`
- `display_name`
- `industry`
- `industry_sub`
- `countries`
- `description`
- `brand_seed_handles`
- `competitors`
- `knowledge_notes`
- `status`

Validación:

- `apps/studio/src/lib/validation/brand.ts`
- `createBrandSchema`

## Persistencia Operativa

| Campo UI | Tabla / columna | Estado actual |
|---|---|---|
| Brand | `brands.name` | Persistido como identidad primaria. |
| Display name | `brands.display_name` | Persistido. |
| Organization | `organizations.*` + `brands.organization_id` | Se crea/upsertea organización si no existe. |
| Countries / Markets | `brands.countries` | Array de códigos ISO-2; no FK a catálogo DB. |
| Industry | `brands.industry` | Texto plano; viene de catálogo en código. |
| Subindustry | `brands.industry_sub` | Texto plano con valores separados por coma; viene de catálogo en código. |
| Strategic Description | `brands.description` | Texto plano estratégico del Brand OS. |
| Aliases / Handles | `brands.brand_seed_handles` | Array de texto; también se materializa en `brand_seeds.aliases` y `brand_seeds.detection_patterns` para marca propia. |
| Competitors | `brand_seeds` + `competitors` | Cada competidor crea/upsertea `brand_seeds`; relación con marca en `competitors`. |
| Knowledge Base Notes | `brand_knowledge_sources.raw_text` | Se guarda como fuente KB `brand_brief`; `extracted_payload.summary` guarda preview. |

## Persistencia Data OS

Se activa sólo si:

```bash
NOISIA_DATA_OS_ENABLED=true
```

Cuando está activo, `initializeBrandDataOsIntake(...)` crea:

| Entidad Data OS | Tabla | Qué guarda |
|---|---|---|
| Asset de intake | `data_assets` | Registro del intake con `asset_kind=brand_os_intake`, `layer=intake`, `storage_ref=db://brands/{brand_id}` y metadata de industry, subindustry, countries, aliases, competitors. |
| Brand OS profile | `brand_os_profiles` | Profile v1 por marca con metadata de intake. |
| Brand OS brief | `brand_os_briefs` | Brief tipo `brand_intake`; summary = strategic description; link opcional a `brand_knowledge_sources`. |
| Seed set | `brand_os_seed_sets` | Seed set tipo `brand_identity`. |
| Seed terms | `brand_os_seed_terms` | Brand name, slug, aliases, countries, industry, subindustries y competitors como términos trazables. |
| Competitors OS | `brand_os_competitors` | Competidores del Brand OS con prioridad y link opcional a `brand_seeds`. |
| Links | `brand_os_links` | Relaciones profile/brief/seed set/brand/brand seed/knowledge source. |
| Lineage | `lineage_edges` | `data_asset -> brand`, `data_asset -> brand_os_profile`, `data_asset -> brand_os_brief`, `data_asset -> brand_os_seed_set`, etc. |

## Diagnóstico Por Tipo De Catálogo

### Countries

Estado:

- UI usa `COUNTRY_OPTIONS` desde `apps/studio/src/lib/country-catalog`.
- DB guarda códigos en `brands.countries`.
- Data OS duplica países como seed terms tipo `country`.

Gap:

- No existe FK a `taxonomy_terms`.
- No hay source/confidence por país.
- No hay country market object con región, idioma, prioridad o operating status.

### Industry / Subindustry

Estado:

- UI usa `INDUSTRY_OPTIONS` y `subindustriesForIndustry(...)` desde `apps/studio/src/lib/industry-catalog`.
- DB guarda `brands.industry` y `brands.industry_sub` como texto.
- Data OS los guarda como metadata y seed terms.

Gap:

- No están normalizados como taxonomía DB.
- `industry_sub` es string multi-valor separado por coma.
- No hay `taxonomy_terms` ligados al Brand OS profile.

Recomendación:

- Crear taxonomía gobernada `industry` / `subindustry`.
- Migrar UI a leer desde API/catalog DB.
- Persistir selección como `brand_os_links` o tabla de bindings: `brand_os_profile -> taxonomy_term`.

### Aliases / Handles

Estado:

- Se guardan en `brands.brand_seed_handles`.
- Se guardan en `brand_seeds.aliases`.
- Se guardan en `brand_seeds.detection_patterns`.
- Con Data OS activo, se guardan como `brand_os_seed_terms.term_type='alias'`.

Gap:

- No separa alias textual vs handle oficial vs URL/app keyword.
- No guarda fuente de la sugerencia por item.
- No guarda estado `suggested / accepted / rejected / user_added`.
- No guarda confidence por item.

Recomendación:

- Crear `brand_os_seed_terms.metadata` más rico:
  - `source_kind`
  - `source_url`
  - `suggested_by`
  - `accepted_by_user_id`
  - `confidence`
  - `term_origin`
  - `term_kind: alias | handle | domain | app_store_keyword | disambiguator`

### Competitors

Estado:

- Cada competidor upsertea `brand_seeds`.
- La relación competitiva vive en `competitors`.
- Con Data OS activo, se agrega a `brand_os_competitors` y `brand_os_seed_terms.term_type='competitor'`.

Gap:

- `brand_seeds.canonical_name` es unique global, no scoped por país/industria.
- Competidor sugerido no guarda fuente específica ni por qué fue sugerido.
- No hay tipo de competidor: direct, marketplace, retailer, aspirational, benchmark, category substitute.

Recomendación:

- Enriquecer `brand_os_competitors.metadata` con:
  - `competitor_type`
  - `market`
  - `evidence`
  - `source_urls`
  - `accepted_by_user_id`
  - `confidence`

### Knowledge Base Notes

Estado:

- Se guarda en `brand_knowledge_sources.raw_text`.
- `source_kind='brand_brief'`.
- `status='processed'`.
- Data OS brief referencia `knowledge_source_id`.

Gap:

- El texto no se convierte automáticamente en `knowledge_chunks` / assertions al crear la marca.
- No se separan facts, assumptions, sources, risks y disambiguation en entidades.
- La edición de KB posterior sí existe en UI, pero el intake inicial no dispara procesamiento semántico.

Recomendación:

- Al aceptar/crear Brand OS, disparar job de KB processing:
  - chunking
  - assertions
  - source citations
  - brand_os_links a claims/products/audiences/competitors cuando aplique

## Gap Crítico: Edición No Sincroniza Data OS

Archivo:

- `apps/studio/src/app/api/brands/[id]/route.ts`

Estado:

- `PATCH` actualiza sólo:
  - `brands`
  - `brand_knowledge_sources.organization_id` cuando cambia organización

No actualiza:

- `brand_seeds`
- `competitors`
- `brand_os_profiles.metadata`
- `brand_os_briefs`
- `brand_os_seed_sets`
- `brand_os_seed_terms`
- `brand_os_competitors`
- `brand_os_links`
- `lineage_edges`

Implicación:

Crear Brand OS puede inicializar Data OS, pero editar después deja drift entre UI operativa y Data OS.

## Estado Honestamente Productivo

Lo que ya está bien encaminado:

- New Brand captura Brand OS y KB en el mismo flujo.
- Aliases y competitors ya no mueren como texto puro; llegan a seeds.
- Data OS tiene foundation para lineage y links.
- El intake puede crear un asset gobernado por marca.

Lo que todavía no es Data By Design completo:

- Los catálogos no están gobernados en DB.
- No hay audit trail por cada chip aceptado/rechazado.
- No hay sincronización Data OS en edición.
- No hay procesamiento automático de KB notes a chunks/assertions.
- `NOISIA_DATA_OS_ENABLED` está apagado por default en `.env.example`; sin activarlo, sólo corre la persistencia operativa.

## Siguiente Corte Recomendado

1. Crear API de catálogos gobernados:
   - `/api/catalogs/countries`
   - `/api/catalogs/industries`
   - `/api/catalogs/subindustries?industry=...`

2. Migrar UI de Brand OS a catálogos DB, no arrays de código.

3. Persistir accepted suggestions con metadata por item:
   - aliases
   - handles
   - competitors
   - industry/subindustry selections

4. Implementar `syncBrandDataOsIntake(...)` para `PATCH /api/brands/[id]`.

5. Disparar KB processing job después de crear/editar KB notes.

6. Crear smoke Data OS Brand OS:
   - crear marca
   - aceptar suggestions
   - verificar `brands`
   - verificar `brand_seeds`
   - verificar `competitors`
   - verificar `brand_knowledge_sources`
   - con flag activo, verificar `brand_os_*`, `data_assets`, `lineage_edges`
