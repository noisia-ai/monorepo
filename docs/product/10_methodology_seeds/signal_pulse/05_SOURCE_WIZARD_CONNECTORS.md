# 05 — Source Wizard and connectors

## Propósito

El Source Wizard es la capa entre organizaciones/marcas y el corpus/signal engine. Permite integrar nuevas fuentes de forma progresiva sin convertir cada fuente en una implementación ad hoc.

El wizard no debe preguntar solo “sube un CSV”. Debe entender qué tipo de fuente es, qué rol juega en el análisis y dónde debe normalizarse.

## Familias de fuente

| Tipo | Qué es | Ejemplos | Entra como mentions |
|---|---|---|---:|
| Conversation evidence | Voz del consumidor o conversación pública | listening CSV, TikTok comments, reviews, YouTube comments, Reddit | Sí, cuando es texto conversacional |
| Performance evidence | Desempeño de contenido, pauta o assets | Meta Ads, Meta organic, TikTok Ads, GA4, Metricool | No |
| Entity/reference data | Catálogos y entidades para joins/filtros | tiendas, SKUs, productos, campañas, creators, regiones | No |
| Knowledge/context | Contexto estratégico no-consumidor | briefs, brand book, research previo, claims permitidos | No, va como knowledge/context |

## Flujo del wizard

```text
1. Elegir tipo de fuente
2. Subir archivo o conectar proveedor/API
3. Detectar schema
4. Proponer mapping
5. Mostrar preview normalizada
6. Validar calidad
7. Definir rol en Signal Pulse
8. Importar o sincronizar
9. Crear provenance
10. Activar para reportes y charts
```

## Paso 1 — Tipo de fuente

El wizard debe ofrecer tarjetas:

- Conversation evidence
- Performance evidence
- Entity/reference data
- Knowledge/context
- “No sé qué tipo es” → autodetectar y explicar propuesta

Cada tarjeta debe explicar:

- qué puede alimentar;
- qué no puede alimentar;
- qué charts activa;
- qué filtros agrega;
- qué calidad mínima requiere.

## Paso 2 — Método de conexión

Opciones:

| Método | Uso |
|---|---|
| File upload | CSV, XLSX, JSON export |
| API key | Apify, proveedores de reviews, listening APIs |
| OAuth | Meta, Google, TikTok cuando aplique |
| Scheduled sync | Fuentes recurrentes |
| Manual entry | Entidades pequeñas o contexto |

## Paso 3 — Schema detection

El wizard debe detectar:

- nombres de columnas;
- tipos de datos;
- fechas;
- texto principal;
- ids externos;
- campos de plataforma;
- métricas;
- entidades;
- idioma probable;
- filas inválidas;
- duplicados;
- rangos temporales;
- campos con alta cardinalidad;
- posibles PII.

## Paso 4 — Mapping

El wizard propone mapping según tipo.

### Conversation evidence mapping

| Campo destino | Descripción |
|---|---|
| external_id | ID externo único |
| text | Texto conversacional principal |
| title | Título o caption si aplica |
| published_at | Fecha de publicación |
| platform | Plataforma |
| content_type | comment, review, post, video, etc. |
| author | Autor o handle si permitido |
| url | Link |
| engagement | Likes, comments, shares, views |
| entity_refs | Marca, campaña, producto, competitor, etc. |
| raw_metadata | Payload adicional |

### Performance evidence mapping

| Campo destino | Descripción |
|---|---|
| external_id | ID de campaña, ad, post o creative |
| entity_kind | campaign, adset, ad, post, creative |
| date | Fecha o periodo |
| platform | Meta, TikTok, Google, etc. |
| spend | Inversión |
| impressions | Impresiones |
| reach | Alcance |
| clicks | Clicks |
| ctr | CTR |
| cpm | CPM |
| conversions | Conversiones si existen |
| creative_text | Copy/caption |
| creative_asset_ref | Asset o link |
| campaign_name | Nombre de campaña |

### Entity/reference data mapping

| Campo destino | Descripción |
|---|---|
| entity_id | ID interno o externo |
| entity_kind | store, sku, campaign, creator, product, region |
| name | Nombre |
| aliases | Variantes para matching |
| parent_entity | Marca, región, campaña padre |
| status | active, inactive |
| metadata | Campos adicionales |

### Knowledge/context mapping

| Campo destino | Descripción |
|---|---|
| title | Nombre del documento |
| source_kind | brief, brand_book, research, legal, campaign_plan |
| period_start/end | Vigencia |
| raw_text | Texto extraído |
| extracted_payload | Claims, objectives, audiences, restrictions |
| confidence | Calidad de extracción |

## Paso 5 — Preview normalizada

Antes de importar, mostrar:

- 10–20 filas representativas;
- conteos de filas válidas/invalidas;
- periodo detectado;
- fields mapped;
- warnings;
- qué pantallas activará;
- qué charts podrá alimentar;
- impacto estimado en corpus.

## Paso 6 — Validación de calidad

Gates mínimos:

| Tipo | Gate |
|---|---|
| Conversation | texto no vacío, fecha válida, source/platform, external_id o hash |
| Performance | fecha, campaña/asset, al menos una métrica, no todos ceros |
| Entity | name + entity_kind + id o alias suficiente |
| Knowledge | texto extraído o payload estructurado útil |

## Paso 7 — Rol en Signal Pulse

El usuario debe definir o confirmar:

- alimentar señales;
- alimentar charts;
- alimentar filtros;
- alimentar evidence drawer;
- solo contexto;
- solo entity matching;
- activar en reportes publicados;
- mantener interno.

## Source health

Cada fuente debe tener:

- status;
- last sync;
- record count;
- valid count;
- duplicate count;
- failed count;
- coverage start/end;
- freshness;
- role;
- owner;
- mapping version;
- schema drift warnings;
- cost estimate si aplica.

## Estados de fuente

| Estado | Significado |
|---|---|
| draft | configurada, no importada |
| validating | detectando schema o quality |
| active | usable en reportes |
| stale | retrasada |
| broken | requiere atención |
| paused | no sincroniza |
| internal_only | no visible cliente |
| archived | fuera de uso |

## Regla clave

Todo puede ser evidencia. No todo debe convertirse en mention. El Source Wizard decide el camino correcto antes de contaminar el corpus.
