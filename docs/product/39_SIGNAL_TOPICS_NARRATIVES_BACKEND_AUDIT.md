# 39 · Signal Topics & Narratives Backend Audit

> Estado: TN-00→TN-07, TN-09 y TN-10 local completos; TN-08 staging/Laika con
> perfiles aprobados y clasificación completa, pendiente revisión humana de tags,
> 2026-07-28.
> Alcance: inventario verificable, implementación local y runtime disposable; no
> afirma evidencia staging/preview.

## Resultado ejecutivo

La infraestructura Data OS de Signal es reutilizable, pero Topics & Narratives todavía
no constituye un producto backend vivo. Existen taxonomías genéricas, tags, filtros,
materializaciones y serving workspace-centric; faltan la identidad versionada del
perfil, el lifecycle de discovery/aprobación, la clasificación incremental y los
contratos específicos de overview/detail.

El backend TN extiende esos stores. No crea un payload editorial, catálogo métrico,
filtro, tag store, run store o materialization store paralelo.

## Estado real observado

| Capacidad | Evidencia en el repositorio | Decisión |
|---|---|---|
| Workspace y authZ | `signal_workspaces`, resolver por ID/slug y brand access | Reutilizar |
| Filtro compartido | `SignalFilterV1`, hash estable y planner SQL | Corregir agregando `narrative` como dimensión canónica |
| Vocabulario | `taxonomies`, `taxonomy_terms`, edges | Reutilizar |
| Reglas/modelos | `tagging_rule_sets`, `tagging_model_versions` | Reutilizar |
| Asignaciones | `record_tags`, evidence, confidence, review events | Extender con perfil versionado e identidad idempotente |
| Runs resilientes | `signal_refresh_runs`, BullMQ, retries/dead-letter | Extender para enrichment; no crear otra tabla de runs |
| Invalidation | `signal_data_invalidations` y materializer incremental | Reutilizar con scope TN explícito |
| Métricas | `topic.volume@1`, `narrative.volume@1` nominales | Corregir denominadores, coverage, perfil exacto y coocurrencia |
| Materializaciones | `metric_materializations` | Reutilizar |
| Serving | facets/series/breakdowns/mentions/lineage | Extender con overview/detail/evidence TN |
| Discovery/aprobación | No existe perfil workspace-centric ni activación atómica | Agregar |
| Worker TN | No existe clasificación incremental independiente de T&B | Agregar |
| Runtime Laika | No evaluable sin target DB aprobado, cap y aprobación humana | TN-08 bloqueable, nunca simulado |

## Brechas verificadas

1. No existe una relación que seleccione una versión `topic` y otra `narrative` por
   workspace.
2. `narrative` no pertenece a `SIGNAL_DIMENSIONS`; `taxonomy` carga una semántica
   general/legacy.
3. El planner usa coincidencias `LIKE '%topic%'` / `LIKE '%narrative%'` para decidir
   pertenencia. Eso no identifica una versión aprobada.
4. La llave actual de `record_tags` no contiene perfil/version y no expresa la
   idempotencia de clasificación TN.
5. No existe un ciclo import → classify → invalidate → materialize separado de T&B.
6. Las respuestas de `topic.volume` y `narrative.volume` no declaran todavía
   `included_mentions`, `classified_mentions`, `unclassified_mentions`,
   `tag_assertions`, `share_of_included`, `share_of_classified` y coverage.
7. No existen endpoints específicos de overview/detail con coocurrencia, evidence y
   lineage de perfil/modelo.

## Contrato congelado

### Semántica

- `topic` identifica el sujeto concreto de la conversación.
- `narrative` identifica una afirmación, historia o marco recurrente.
- `trigger`, `barrier`, `tb_layer`, `observed_signal`, findings y recomendaciones no
  pueden promoverse automáticamente a ninguno de los dos kinds.
- La clasificación es multi-label. La suma de shares no tiene que ser 100%.
- `unclassified` es coverage; no es un término.
- No existe un mínimo arbitrario de menciones.

### Identidad y revisión

- Cada workspace puede tener como máximo un perfil activo por kind.
- Un perfil liga una taxonomía, ruleset, model version y `context_hash`.
- Activar una nueva versión retira la anterior dentro de una transacción.
- Una asignación TN se identifica por
  `mention + profile + term + model_version`.
- Sólo `review_status=approved` y términos/perfiles activos son client-safe.
- `pending`, `unreviewed`, `needs_review` y `rejected` nunca cuentan como evidencia
  aceptada. Trabajo pendiente degrada coverage a `partial`.

### Cómputo

- SQL calcula volumen, shares, comparison, series, coocurrencia, coverage y
  denominadores.
- Claude puede proponer y clasificar; Voyage puede recuperar contexto versionado.
- Ninguna lectura de página invoca proveedores.
- El mismo predicate de `SignalFilterV1` gobierna agregado, facets, evidence y
  drill-down.
- El lineage mínimo es
  materialization → profile/term → approved tag → mention → import/source.

### Runtime

- Los switches de discovery/enrichment nacen apagados.
- Un run pagado exige cap USD positivo, credenciales y target permitido.
- TN-08 exige además aprobación humana explícita de ambos perfiles de Laika.
- Fixtures y Postgres disposable validan infraestructura, pero no sustituyen la
  evidencia staging/preview de Laika.

## Decisión estructural

La relación activa/versionada se implementa con `signal_taxonomy_profiles`, documentada
en ADR 012. `taxonomies`, `taxonomy_terms`, `record_tags`, `signal_refresh_runs`,
`metric_materializations`, `signal_data_invalidations` y `lineage_edges` continúan
siendo los stores canónicos.

## Addendum de ejecución

- `0057_signal_topics_narratives_profiles.sql` se aplicó junto con las 56 migraciones
  anteriores en Postgres 16 + pgvector disposable.
- El runtime fixture procesó 5,000 menciones. `topic.volume@1` reconcilió buckets de
  5,000 y 1,000 IDs; `narrative.volume@1`, 2,500 y 1,666 IDs. Agregado, SQL base y
  drill-down paginado fueron idénticos.
- Pending topic tags quedaron fuera de los conteos aprobados y produjeron `partial`;
  narrative sin pending quedó `fresh`.
- `EXPLAIN ANALYZE` usó los índices idempotentes de `record_tags` y
  `record_feature_values`. No hubo Claude/Voyage ni gasto.
- El dry-run de Laika con corpus `3d32472d-9720-4fae-b6d2-a73152c5f0a4` y referencia
  histórica `aaafa040-ca2f-49a6-afd0-e872b6706476` se detuvo antes de resolver IDs
  porque no existe `DATABASE_URL`.
- TN-08 exige todavía target staging/preview, cap USD explícito y aprobación humana de
  las dos propuestas. Hasta entonces el Goal y el backend-ready gate permanecen
  incompletos.

## Addendum TN-08 staging

- El operador confirmó el target staging/preview y un cap total de USD 10.
- `0057_signal_topics_narratives_profiles.sql` se aplicó mediante un wrapper remoto
  específico, transaccional y verificado; no se ejecutó `drizzle-kit generate`.
- El corpus/output de Laika resolvió exactamente un workspace operational gobernado y
  una revisión de corpus real.
- Voyage recuperó contexto versionado y Claude generó dos perfiles `draft` v1: 15
  topics y 15 narratives. Ninguno está activo ni client-safe todavía.
- El costo conocido del intento exitoso fue USD 0.231129. Se reservó USD 1 adicional
  de forma conservadora por un intento previo no parseable, dejando USD 1.231129
  contabilizados contra el cap de USD 10.
- La ejecución se detiene en el gate humano: los términos, definiciones, ejemplos,
  exclusiones y statements deben revisarse antes de activación y backfill.

## Addendum TN-08 clasificación

- El reviewer interno gobernado aprobó los perfiles topic v1 y narrative v1, con
  timestamp y notes persistidos. Ambos quedaron activos sin activar clientes.
- El backfill resolvió 723 menciones incluidas y creó dos runs durables,
  idempotentes y separados de T&B.
- Los workers procesaron 723/723 menciones por perfil. Topic produjo 1,155 tags
  pending y 77 rejected; narrative produjo 1,184 pending y 99 rejected.
- El gasto de clasificación fue USD 3.558508 para topic y USD 3.469908 para
  narrative. Sumado al discovery y las reservas conservadoras, el gasto total
  contabilizado es USD 8.259545 de un cap explícito de USD 10.
- Un fallo previo a persistencia se reservó conservadoramente dentro del cap. El
  worker ahora acumula costo/tokens en la misma transacción de cada batch y resta
  gasto previo antes de autorizar el siguiente batch.
- Ambos runs terminaron `completed` y emitieron invalidaciones selectivas.
- Ningún tag se aprobó automáticamente. Hasta revisión humana separada de las
  asignaciones, métricas y evidence client-safe permanecen bloqueadas; TN-08 y el
  backend-ready gate no se declaran completos.

El procedimiento operativo y los formatos de evidencia están en
`40_SIGNAL_TOPICS_NARRATIVES_STAGING_RUNBOOK.md`.
