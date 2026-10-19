# 39 · Signal Topics & Narratives Backend Audit

> Estado: TN-00→TN-10 implementados; TN-08 validado con datos reales de Laika en
> staging/preview. El release gate Data OS general permanece separado y exige su
> muestra humana de review antes de declarar backend-ready, 2026-07-28.
> Alcance: inventario verificable, implementación local, runtime disposable y
> reconciliación staging/preview; no activa frontend ni clientes.

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

## Addendum TN-08 revisión y materialización

- El usuario autorizó explícitamente la revisión en bloque de los 2,339 assignments
  `pending` después de revisar y aprobar ambos perfiles v1.
- El wrapper operator-only resolvió un único reviewer interno gobernado y registró un
  `tag_review_event` por assignment. No acepta un reviewer UUID por argumento y no
  aprueba por umbral de confidence.
- Quedaron 1,155 topic tags y 1,184 narrative tags `approved`. Los 77 topic y 99
  narrative `rejected` permanecieron sin cambios; no quedan tags `pending`.
- La revisión emitió una invalidación selectiva y ejecutó el materializer SQL con
  interpretaciones y LLM apagados. Se ejecutaron 528 planes y se escribieron 14,953
  filas; el estado resultante fue `fresh`.
- La reconciliación real comprobó 11 métricas, 125 periodos de series, 77 periodos de
  breakdown y 11 recorridos paginados de drill-down. Valor, denominador, sample size,
  breakdown y mention IDs coincidieron con SQL base; no hubo materializaciones
  pendientes.
- `topic.volume@1` y `narrative.volume@1` reconciliaron 11 periodos cada uno y
  excluyeron asignaciones rejected.
- `EXPLAIN ANALYZE` en staging/preview verificó
  `idx_mentions_signal_facets`,
  `idx_metric_materializations_signal_facade` e
  `idx_record_tags_signal_approved_subject`. Los planes críticos quedaron entre
  0.040 ms y 1.975 ms para las 723 menciones reales de Laika.
- El gasto total conservador de Claude/Voyage se mantiene en USD 8.259545 de un cap
  explícito de USD 10. La revisión, invalidación, materialización y reconciliación no
  invocaron proveedores pagados.
- No se ejecutó T&B, no se leyó `published_outputs.payload` ni `chart_aggregates`, no
  se activó frontend o clientes y no se usó producción.
- El gate TN sólo puede declararse backend-ready cuando el evidence pack también
  contenga un `release-gate.json` Data OS real con
  `ready_for_production_review=true`. La aprobación de perfiles/tags TN no sustituye
  la muestra humana general de assertions/tags exigida por ese gate.
- `data-os:staging-check` pasó contra la base remota redacted y confirmó target
  `staging`, formato Postgres y las tres aprobaciones de shadow/backfill/EXPLAIN.
- `data-os:staging-shadow` se detuvo correctamente en su preflight anterior a crear
  evidence. El output histórico obligatorio de Laika es
  `methodology=triggers-barriers`, `kind=signal`, y su corpus también es
  `triggers-barriers`; el wrapper general exige un par Signal Pulse con
  `report_periods`, `canonical_signals` y `signal_period_metrics`.
- No se sustituyó el output por otro ID. Por esa incompatibilidad de contrato no
  existen `release-gate.json` ni un backend-ready gate válido para este run. El
  unblock requiere que un operador designe un output/corpus Signal Pulse real
  compatible, o que el release gate incorpore explícitamente un preflight TN
  workspace-centric revisado; ninguna de las dos decisiones se asume aquí.

El procedimiento operativo y los formatos de evidencia están en
`40_SIGNAL_TOPICS_NARRATIVES_STAGING_RUNBOOK.md`.

## Addendum de hardening operativo

- `0058_signal_taxonomy_operational_hardening.sql` agrega estados recuperables
  `partial` y `blocked`, provenance de aprobación y activación de perfiles en dos
  fases. Es forward-only y no toca payloads legacy.
- Un run que agota presupuesto persiste el número realmente clasificado y pendiente,
  conserva costo/tokens y queda `partial`. Un nuevo apply operator-only puede aumentar
  el cap y continuar el mismo run/idempotency key; los features y tags canónicos
  impiden repetir assignments ya persistidos.
- Flags apagadas, credenciales ausentes o un perfil todavía no activo producen
  `blocked`, no un `skipped` terminal. Corregir configuración y reencolar mediante el
  wrapper gobernado conserva auditoría sin retries infinitos. `skipped` queda reservado
  para condiciones permanentemente no aplicables, como una revisión de corpus
  reemplazada.
- El worker drena páginas de hasta 500 menciones, configurable entre 50 y 1,000,
  ordenadas por `(published_at NULLS LAST, id)`. Cada página vuelve a excluir features
  ya persistidos; no usa `OFFSET`, no carga el corpus completo y admite más de 10,000
  menciones sin cambiar artificialmente `corpus_revision`.
- Invalidaciones parciales declaran `coverage_state=partial`,
  `classified_mentions` y `pending_mentions`. Sólo el drenado total declara cobertura
  completa.
- Todo caller TN usa `requireOperationalCorpus`. Cero o más de un operational vigente
  falla cerrado con `not_available`; strategic y legacy nunca se seleccionan por
  posición.
- La política `signal-taxonomy-acceptance-v1` autoaprueba únicamente evidencia no
  vacía, confidence `high` y score `>=0.90` sobre términos activos de un perfil
  aprobado. Persiste `approval_source=policy`, versión, score, modelo, evidence y
  timestamp sin inventar reviewer. Medium o high bajo threshold queda pending; baja
  confianza queda rejected. El override humano posterior sigue creando su review
  event y cambia provenance a `human`.
- Una aprobación de perfil nuevo lo deja `activating`; el perfil anterior sigue siendo
  el único client-safe. Cuando el backfill demuestra cero menciones pendientes, una
  función transaccional retira el anterior y activa el nuevo. Así no hay doble serving
  ni ventana vacía.
- Estas correcciones hacen recurrente el backend para workspaces elegibles, pero no
  resuelven el release blocker general Signal Pulse/T&B descrito arriba.

## Addendum de validación runtime del hardening

Fecha: 2026-07-28. Target: `staging` remoto redactado; no producción.

- `0058_signal_taxonomy_operational_hardening.sql` se aplicó con el wrapper
  transaccional protegido. `0057` ya existía y no se reejecutó. Una segunda ejecución
  del wrapper reportó `applied=[]`, con columnas, constraints, índices y funciones
  verificadas. No se tocó `published_outputs.payload`, no se ejecutó T&B y los dos
  perfiles v1 de Laika siguieron activos.
- El runtime descubrió y corrigió dos incompatibilidades que los tests estáticos no
  detectaban: el fixture SQL no poblaba la nueva provenance de tags aprobados y serving
  consultaba un `profile.activated_at` inexistente en vez de exponer
  `approved_at AS activated_at`. También se corrigió `completeRun` para fusionar el
  resumen final con el historial y no borrar el marker durable de continuación.
- Una importación de staging aislada y etiquetada agregó 6 menciones al corpus
  operational de Laika y avanzó su revisión una sola vez. Los 723 registros anteriores
  conservaron sus checkpoints; únicamente las 6 menciones nuevas se clasificaron para
  topic y narrative.
- Con subcap inicial de USD 0.09 total, ambos runs reales quedaron `partial` después de
  un batch: 2 clasificadas y 4 pendientes por perfil. Emitieron dos invalidaciones
  `coverage_state=partial`, conservaron costo/tokens y no duplicaron assignments.
  Al ampliar el mismo trabajo a USD 0.30, los mismos runs y la misma revisión drenaron
  6/6 por perfil y emitieron dos invalidaciones finales `complete`.
- Resultado de aceptación: 6 assignments autoaprobados cumplieron evidence no vacío,
  `confidence=high`, score `>=0.90`, `approval_source=policy`,
  `approval_policy_version=signal-taxonomy-acceptance-v1` y `approved_at`; 9
  assignments quedaron pending para revisión humana y no se sirven. El proveedor no
  produjo assignments low-confidence en este fixture; los casos sin evidencia quedaron
  sin assignment. La transición low → rejected permanece cubierta por los tests de
  política, no se presenta como evidencia real del proveedor.
- Se procesaron las cuatro invalidaciones con enrichment/interpretations apagados. La
  materialización ejecutó 539 planes y escribió por upsert 15,144 filas; una segunda
  ejecución repitió esos conteos sin duplicados. El `watermark_hash` cambia cuando
  cambia `materialized_at`, por lo que idempotencia significa igualdad de claves,
  valores y cardinalidad, no identidad del timestamp de cómputo.
- Serving real del periodo 2026-07-01→2026-07-25 resolvió un único corpus operational,
  rechazó un usuario de otra organización, devolvió 13 topics, 12 narratives, 15
  coocurrencias, paginación sin solapamiento y lineage gobernado. El estado fue
  `partial` por las 9 excepciones pendientes, que es la semántica correcta. Después de
  materializar el periodo anterior, la comparación cargó 15 terms de cada kind.
- Para un term topic, materialización, SQL base y drill-down reconciliaron exactamente
  6 mention IDs; denominador 32 y sample size 21. Las consultas no leen
  `published_outputs.payload` ni `chart_aggregates`.
- El fixture Postgres transaccional recorrió 10,050 menciones sin proveedores, con
  reconciliation exacta para agregado y drill-down. La activación v2 mantuvo un perfil
  anterior client-safe durante `activating`, falló cerrado con backfill incompleto y
  cortó a exactamente un perfil activo al completar coverage.
- `EXPLAIN ANALYZE` sobre Laika quedó dentro de presupuesto. Los planes generales
  materialization/drill-down/series/facets tardaron 0.199–1.905 ms. Los planes TN
  overview/series/breakdown/cooccurrence/detail/evidence/lineage/pending/cursor tardaron
  0.223–104.169 ms; overview, series, breakdown y cooccurrence usaron
  `idx_metric_materializations_signal_facade`, evidence usó
  `idx_record_tags_signal_approved_subject`, y cursor usó
  `idx_mentions_signal_materialization`. Lineage hizo seq scan en 17.660 ms sobre el
  volumen actual; se conserva como observación, no como blocker.
- Gasto de esta validación: USD 0.210538 total, 6 requests Claude y 6 Voyage,
  61,479 input tokens y 1,736 output tokens. Desglose modelado por el ledger:
  Claude USD 0.210502 y Voyage USD 0.000036. Saldo del cap USD 15:
  USD 14.789462. No hubo llamadas pagadas durante materialización o serving.
- El release gate general sigue bloqueado por su preflight Signal Pulse: el output
  histórico de referencia de Laika es T&B y no se sustituyó por un ID inventado. Esta
  limitación no invalida la evidencia workspace-centric TN, pero impide declarar el
  release Data OS general aprobado.
