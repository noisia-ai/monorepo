# 04 — Source Wizard, conectores, evidence types y provenance

## Principio

No todo entra como `mentions`. El sistema necesita una capa entre organización/marca y corpus para recibir fuentes distintas, detectar su tipo, mapearlas, validarlas y decidir cómo alimentan Signal Pulse.

## Source Wizard

Flujo recomendado:

```text
1. Seleccionar o subir fuente
2. Detectar tipo de fuente
3. Detectar schema/campos
4. Proponer mapping
5. Mostrar preview normalizada
6. Validar calidad
7. Definir rol de la fuente en Signal Pulse
8. Importar o sincronizar
9. Crear provenance
10. Activar para charts/señales/evidencia
```

## Tipos de fuente

| Tipo | Qué es | Ejemplos | Dónde cae |
|---|---|---|---|
| Conversation evidence | Voz del consumidor/conversación pública | SentiOne CSV, TikTok comments, reviews, Reddit, YouTube comments | mentions/evidence items |
| Performance evidence | Desempeño de contenido o pauta | Meta Ads, Meta Organic, TikTok Ads, GA4, Metricool | performance records/evidence items |
| Entity/reference data | Catálogos para join/filtros | tiendas, SKUs, campañas, creators, productos, regiones | entity layer |
| Knowledge/context | Contexto estratégico no-consumidor | briefs, brand book, research previo, claims permitidos | knowledge sources |

## Ejemplo: listening export

Detected:

- text;
- author;
- platform;
- published_at;
- url;
- sentiment;
- engagement;
- source query.

Mapping:

```text
source_type = conversation_evidence
platform = detected
content_type = mention/comment/post/review
text_field = text
published_at = date
engagement = likes/comments/shares if present
```

## Ejemplo: Apify TikTok comments

Detected:

- comment_text;
- create_time;
- author;
- like_count;
- video_url;
- video_caption;
- reply_count.

Mapping:

```text
source_type = conversation_evidence
platform = tiktok
content_type = comment
parent_content = video_url/video_caption
```

## Ejemplo: Meta Ads export

Detected:

- campaign_name;
- adset_name;
- ad_name;
- creative_name;
- post_text;
- spend;
- impressions;
- clicks;
- ctr;
- cpm;
- date.

Mapping:

```text
source_type = performance_evidence
platform = meta
entity_kind = campaign/creative/adset
metrics = spend, impressions, clicks, ctr, cpm
text_fields = post_text, creative_name, campaign_name
```

## Ejemplo: CSV de tiendas / productos / campañas

Detected:

- store_id / sku / campaign_id;
- name;
- location/category;
- aliases;
- external IDs.

Mapping:

```text
source_type = entity_reference
entity_kind = location/product/campaign/creator
usable_for = joins, filters, aliases, segmentation
not usable_as = conversation evidence
```

## Evidence item conceptual

Cada registro normalizado debe poder convertirse en evidencia o contexto.

Campos conceptuales:

- `id`;
- `source_dataset_id`;
- `source_run_id`;
- `source_type`;
- `provider`;
- `platform`;
- `entity_refs`;
- `period`;
- `text` o `metric_payload`;
- `url`;
- `author` cuando aplique;
- `engagement`;
- `performance_metrics`;
- `raw_ref`;
- `mapping_version`;
- `quality_flags`.

## Provenance mínima

Cada señal debe poder responder:

- qué fuente la alimentó;
- qué upload/sync run;
- qué query pack o mapping;
- qué periodo;
- qué registros originales;
- qué evidencia fue usada;
- qué fuente domina;
- qué warnings existen.

## Source health

Mostrar por fuente:

- estado: active, stale, failed, needs mapping, partial;
- último sync;
- filas leídas;
- filas válidas;
- duplicados;
- errores;
- coverage por periodo;
- si alimenta charts;
- si alimenta evidence;
- si solo sirve como contexto.

## Reglas de seguridad de producto

1. Un archivo de entidades no debe contaminar mentions.
2. Un export de performance no debe tratarse como voz de consumidor.
3. Un brief no debe usarse como evidencia de percepción.
4. Las fuentes sensibles pueden requerir permisos específicos.
5. Si una fuente tiene mala cobertura, debe afectar confidence.
6. Si una fuente entra tarde, debe marcarse como no comparable en deltas.

## Regla final

Todo puede ser evidencia o contexto. No todo es corpus conversacional.
