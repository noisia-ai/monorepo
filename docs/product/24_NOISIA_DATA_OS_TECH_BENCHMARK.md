# 24 · Noisia Data OS Technology Benchmark

> Fecha de revision: 2026-07-02.
> Decision: construir Noisia Data OS como **Customer Intelligence Lakehouse con
> capacidades CDP-like**, no como CDP completo ni como dashboard custom que lee JSON.
> Machine key: `customer_intelligence_lakehouse_cdp_like`.

Este documento aterriza el benchmark de tecnologia y proceso para profesionalizar
Noisia sin sobredisenar el primer corte productivo. La pregunta central no es "que
herramienta compramos", sino que capacidades de plataforma de datos debemos tener
desde Cut 1 para que Signal Pulse, Brand OS, Knowledge Base y futuras metodologias
lean una base viva por cliente.

## 1. Conclusion Ejecutiva

Noisia debe avanzar en tres capas:

1. **Data OS propio sobre Postgres/Supabase en Cut 1.**
   Catalogos, contratos, taxonomias, tags, features, lineage, quality gates,
   Brand OS, Knowledge Catalog y serving APIs viven en nuestra DB actual. Esto ya
   resuelve el problema principal: el output deja de ser el source of truth.

2. **Patrones de lakehouse, CDP y catalogo, sin comprar una plataforma enterprise.**
   Adoptamos los principios de data catalog/context graph, tracking plans/data
   contracts, semantic layer, asset lineage y warehouse-native CDP; no adoptamos
   todavia identity resolution 360, reverse ETL, object lake table format ni un
   orquestador externo.

3. **Upgrade por umbrales medibles.**
   ClickHouse, Iceberg/Parquet, dbt formal, OpenMetadata/DataHub o Dagster entran
   cuando volumen, equipo o auditoria lo justifiquen. Antes de eso, meterlos haria
   mas lenta la salida a produccion.

La decision es conservar el stack TypeScript + Postgres + Drizzle + BullMQ, pero
modelar Noisia como una plataforma de datos: ingestion -> normalized records ->
governed tags/features -> semantic metrics -> serving APIs -> dashboards.

## 2. Benchmark De Capacidades

| Categoria | State of the art observado | Que copiamos en Noisia Cut 1 | Que no hacemos todavia |
|---|---|---|---|
| Data catalog / context graph | OpenMetadata y DataHub conectan assets, owners, glossary, lineage, classifications, quality, observability y contexto de negocio. | `data_assets`, `data_asset_fields`, `data_contracts`, `data_quality_*`, `lineage_edges`, Brand OS links y Knowledge links. | No montamos OpenMetadata/DataHub hasta necesitar UI enterprise de catalogo o integraciones cross-warehouse. |
| CDP | Segment/RudderStack colectan, limpian, unifican identidad y activan datos hacia destinos. | Unificamos fuentes por cliente, seeds, audiencias, campanas, performance, menciones y entidades de marketing. | No prometemos Customer 360 ni identity resolution personal. No hacemos reverse ETL en Cut 1. |
| Tracking plans / data contracts | Segment Protocols valida eventos contra tracking plans y genera violaciones. | `data_contracts`, `data_quality_rules`, `data_quality_results`, staging check y release gate. | No bloqueamos imports productivos automaticamente hasta tener coverage real y UI de remediacion. |
| Lakehouse | Iceberg separa datos de metadata y permite schema evolution, snapshots y engines multiples para tablas grandes. | Modelo bronze/silver/gold conceptual, lineage, contratos y snapshots publicados como fallback. | No movemos datos a Parquet/Iceberg hasta pasar umbrales de volumen/costo. |
| Asset orchestration | Dagster modela assets como unidades logicas con dependencias, metadata, particiones y lineage. | Scripts idempotentes y evidence packs que tratan catalogos/materializaciones como assets verificables. | No introducimos Dagster/Temporal mientras BullMQ + scripts cubran shadow/backfill. |
| Semantic layer | dbt define semantic models como base de MetricFlow; metricas usan entidades, medidas y dimensiones. | `semantic_models`, `metric_definitions`, `metric_materializations`, `dashboard_data_refs`. | No adoptamos dbt Semantic Layer formal hasta tener multiples dashboards/equipos compitiendo por metricas. |
| Real-time analytics serving | ClickHouse usa materialized views/projections para acelerar queries y agregados a escala. | Postgres materializa y sirve suficientes agregados para Cut 1, con `ANALYZE` post-backfill. | No agregamos ClickHouse hasta que Postgres no sostenga latencia o volumen. |
| AI context | Catalogos modernos estan migrando de metadata graph a context graph para que agentes razonen con estructura y significado. | Brand OS y Knowledge Catalog dejan rastro de assertions, chunks, usage events, links y lineage hacia outputs. | No dejamos que prompts sean la unica memoria. El LLM enriquece datos; no reemplaza la DB. |

## 3. Decision De Producto: Noisia No Es Un CDP Completo En Cut 1

Un CDP completo normalmente necesita:

- coleccion de eventos first-party en tiempo real;
- identity resolution de usuarios/personas;
- perfiles Customer 360;
- audiencias activables;
- destinos de marketing/reverse ETL;
- governance de tracking plans.

Noisia necesita otra cosa primero:

- inteligencia social y cultural por cliente;
- menciones, performance, campanas, knowledge y Brand OS en una base comun;
- taxonomias de triggers, barriers, journey, value perception, audience,
  demographics, emotion, content format y source type;
- evidencia y lineage desde fuente hasta dashboard;
- serving APIs para Signal Pulse y futuros exploradores;
- fallback seguro al snapshot publicado.

Por eso el nombre operativo correcto es **Customer Intelligence Lakehouse con
features CDP-like**. Esto deja abierta la puerta a CDP real despues, pero evita
prometer identidad personal y activacion de audiencias antes de tener el dato base
bien gobernado.

## 4. Decision De Tecnologia Por Horizonte

### Cut 1: ahora

Stack:

- Supabase Postgres + Drizzle;
- Next.js Route Handlers como serving API;
- BullMQ + workers Node para shadow/backfill;
- scripts idempotentes para preflight, backfill, smoke, analyze, evidence y release;
- `published_outputs.payload` como fallback/rollback.

Capacidades obligatorias:

- data catalog por cliente y corpus;
- Brand OS catalogado y ligado a seeds/objetivos;
- Knowledge Catalog con chunks, assertions, usage events y links;
- taxonomias controladas;
- tags/features versionados;
- quality gates y lineage;
- semantic/metric layer minima;
- APIs de serving live detras de flags;
- evidence pack staging/preview antes de PR productivo.

### Cut 2: despues de primer shadow real

Agregar:

- UI interna de Corpus/Data Explorer;
- review queue para tags y assertions;
- metric definitions editables;
- dashboards leyendo live APIs por default para usuarios internos;
- backfill incremental por periodo/fuente;
- quality issue inbox para imports.

### Cut 3: cuando haya volumen o equipo de datos

Evaluar:

- dbt formal para transformaciones/semantic layer si hay multiples analistas o
  metricas compartidas con BI externo;
- Dagster o Temporal si los pipelines requieren retries stateful largos, particiones
  avanzadas o observabilidad de assets;
- OpenMetadata/DataHub si necesitamos catalog UI enterprise y ownership cross-team;
- ClickHouse si los filtros por tags/periodos/fuentes exceden la latencia aceptable
  de Postgres;
- Iceberg/Parquet si el almacenamiento historico supera la comodidad operacional de
  Postgres.

## 5. Umbrales Para Cambiar De Stack

| Decision futura | Umbral recomendado |
|---|---|
| Adoptar dbt formal | Mas de 25 metricas reutilizadas por 3+ dashboards o analistas editando definiciones semanalmente. |
| Adoptar Dagster/Temporal | Pipelines de mas de 8 pasos, ejecuciones >1h con recovery parcial, o necesidad de particiones dinamicas por fuente/periodo. |
| Adoptar OpenMetadata/DataHub | 100+ assets activos, owners multiples, auditoria externa o necesidad de catalog UI para usuarios no ingenieros. |
| Adoptar ClickHouse | Postgres supera 1s p95 en filtros Pulse internos o 10M+ records analiticos activos por cliente/corpus. |
| Adoptar Iceberg/Parquet | 100GB+ historicos analiticos o necesidad de engines multiples sobre el mismo storage. |
| Convertirse en CDP real | Necesidad comercial validada de identity resolution, audience builder y activation/reverse ETL. |

## 6. Que Nos Hace Falta Para Produccion

Ya existe el corte local de schema, backfill, smoke, serving APIs, worker contracts y
evidence gates. Para ir a produccion falta probarlo con datos reales fuera de local:

1. **Staging/preview shadow pack.**
   Ejecutar `data-os:staging-shadow` contra un corpus/output real no productivo, con
   `DATABASE_URL` remoto verificado y `NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true`.

2. **Release gate verde.**
   `data-os:release-gate` debe producir `ready_for_production_review: true` con
   `database_format: "postgres_url"`, gate `database_format_postgres_url`, evidence
   pack sin secretos, sin UUIDs en `evidence.md`, checksums SHA-256 y target
   `staging` o `preview`.

3. **Decision de primer corpus.**
   Elegir un Signal Pulse real suficientemente rico: knowledge source procesada,
   performance estructurada, menciones actuales y output publicado/draft/ready.

4. **Review humana de tags/assertions.**
   Cut 1 puede arrancar con tagging deterministico `unreviewed`, pero antes de
   cliente-visible necesitamos revisar una muestra y documentar precision/ruido.

5. **Decision UX despues de APIs.**
   El dashboard no se reimplementa hasta que las APIs vivas pasen shadow. Si el
   problema era dato muerto, redisenar antes solo embellece el problema equivocado.

## 7. Checklist De Arquitectura Para PR

- La PR parte de `codex/signal-pulse`, no de `main`.
- No toca `main` directo.
- No rompe `published_outputs.payload` como fallback.
- No activa `NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED` ni
  `NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED` por default.
- No imprime `DATABASE_URL`, API keys/tokens ni corpus/output UUIDs en artifacts de PR.
- Incluye `data-os:verify`, `data-os:validate-local-smoke` y `data-os:staging-shadow`
  cuando haya entorno staging/preview.
- Si no hay staging/preview evidence pack, la PR no se considera lista para merge
  productivo.

## 8. Fuentes Revisadas

- OpenMetadata: data glossary, data assets, lineage, governance, quality and context
  graph: <https://docs.open-metadata.org/>
- DataHub: metadata platform for discovery, governance and observability:
  <https://docs.datahub.com/docs/introduction>
- dbt Semantic Layer: semantic models as the foundation for metrics:
  <https://docs.getdbt.com/docs/build/semantic-models>
- Dagster: software-defined assets and asset lineage:
  <https://docs.dagster.io/getting-started/concepts>
- Apache Iceberg: table metadata, schema, partitioning and snapshots:
  <https://iceberg.apache.org/spec/>
- Twilio Segment: CDP collection, cleaning, activation and Protocols tracking plans:
  <https://www.twilio.com/docs/segment>
- RudderStack: warehouse-native/customer data lifecycle and profiles:
  <https://www.rudderstack.com/docs/>
- ClickHouse: materialized views and projections for analytical serving:
  <https://clickhouse.com/docs/materialized-views>
