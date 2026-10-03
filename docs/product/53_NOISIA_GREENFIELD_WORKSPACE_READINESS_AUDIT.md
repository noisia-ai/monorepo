# Noisia V0.2 — Greenfield Workspace Readiness Audit

**Fecha:** 2026-08-12
**Alcance:** Backend 08, auditoría local no pagada
**Veredicto global:** `GREENFIELD_PARTIALLY_PRODUCTIZED`

## Resumen ejecutivo

Noisia V0.2 no tiene todavía un camino de producto completo para llevar una marca nueva desde Admin hasta Signal governed y el preflight estratégico. La arquitectura relacional y los writers de Backend 04–07 son mayoritariamente genéricos, pero la orquestación que crea policies, compilaciones, populations derivadas, bindings y authority estratégica sigue disponible sólo como servicios internos y scripts de staging. La UI Admin no expone esas decisiones ni sus promociones.

La prueba greenfield sí demostró, sin Laika, SQL funcional manual ni proveedores:

- alta real de organización, marca, Brand OS, workspace, report registry, population V1, pointer de compatibilidad y candidata semántica;
- alta real de source primary-brand e import CSV;
- ingesta de 8 filas con 7 menciones persistidas, 1 duplicado, 1 exclusión por calidad, provenance, watermark e invalidación, sin crear estudio;
- Admin Mentions sobre 7 raíces canónicas;
- generación determinista y Review semántico: primary brand, competitor, rechazo, unattributed final y una raíz multi-entidad;
- fallo cerrado de las doce combinaciones governed cuando no existe su authority;
- GET estratégico gratuito con cero escrituras, jobs y provider calls.

La misma prueba demostró los bloqueos:

1. No existe Admin ni ruta HTTP para decidir y activar quality, retention, licensing y provenance bindings. Los writers son genéricos, pero sólo los invocan scripts.
2. No existe orquestador de producto para crear/reconciliar/promover las doce combinaciones module/view. Las doce quedaron sin bundle, evaluation, compilation, derivation ni binding.
3. El operational bridge de una marca recién importada queda sin `membership_digest`; las tres rutas brand governed fallaron cerrado.
4. Competition tenía identidad y datos elegibles, pero no pudo compilarse desde producto. Category tenía metadata/dato sintético, pero no una identidad gobernada disponible en el camino manual no pagado.
5. La authority `triggers-barriers/strategic`, su execution corpus y su binding sólo tienen orquestación de staging. El GET gratuito fue correctamente bloqueado.
6. Review y release estratégicos tienen APIs genéricas, atómicas e idempotentes, pero no existe una UI operable de Review/publicación; el launcher sólo informa readiness.

**Respuesta Alexa:** puede crearse el registro de Alexa desde Admin sin contaminar el modelo, pero no debe considerarse el primer onboarding greenfield completo. Sin cambios de código puede avanzar con seguridad hasta source/import y Review manual de scopes cuya identidad ya exista. Antes del primer import real conviene productizar la captura de decisions de data governance; antes de Signal governed es obligatorio productizar la orquestación derivada y corregir el digest del bridge.

## Metodología y límites

Se auditó código, SQL, rutas, UI y pruebas; después se ejecutó un rehearsal en PostgreSQL 16 + pgvector desechable. Se aplicaron las 77 migraciones `0000–0076`. Se creó únicamente un usuario AuthZ sintético por SQL directo, permitido por el encargo. Toda creación funcional G1–G5 pasó por las rutas y services del producto. No se creó ninguna policy por SQL ni se usaron scripts de rehearsal.

- Marca sintética neutral; sin nombres, IDs, policies o seeds de Laika.
- `remote_reads=0`, `remote_writes=0`.
- `provider_calls=0`, `jobs_enqueued=0`, `spend_usd=0`.
- No se ejecutó semantic resolution pagada ni T&B.
- Los artefactos sanitizados están en [`.data/noisia-greenfield-readiness/backend-08/`](../../.data/noisia-greenfield-readiness/backend-08/), todos con modo `0600`.
- Los UUIDs locales, payloads privados y texto sintético quedaron únicamente en artefactos privados ignorados por git; este documento no los reproduce.

No se considera feature operable la mera existencia de una tabla, función SQL o test unitario. `Ready=true` en la matriz final exige evidencia runtime del rehearsal.

## Registro de evidencia

| Ref | Evidencia verificable |
|---|---|
| E01 | Alta Admin: [`apps/studio/src/app/api/brands/route.ts:55`](../../apps/studio/src/app/api/brands/route.ts#L55) autoriza y abre una transacción; líneas 73–270 crean org/brand/workspace/Brand OS; líneas 285–398 crean workspace, V1, pointer, report y refresh policy. Resultado: [`g1-counts.sanitized.json`](../../.data/noisia-greenfield-readiness/backend-08/g1-counts.sanitized.json). |
| E02 | Brand OS: [`apps/studio/src/app/api/brands/route.ts:140`](../../apps/studio/src/app/api/brands/route.ts#L140) crea seeds/aliases/competitors/KB; línea 243 condiciona la proyección Data OS a `NOISIA_DATA_OS_ENABLED`; líneas 415+ crean profile, brief y seed set. Resultado G1/G2 en [`checkpoint-summary.sanitized.json`](../../.data/noisia-greenfield-readiness/backend-08/checkpoint-summary.sanitized.json). |
| E03 | Source/import UI real: [`WorkspaceSourcesManager.tsx:64`](../../apps/studio/src/components/admin/WorkspaceSourcesManager.tsx#L64) crea source y línea 88 importa CSV. El builder visible limita alta a primary brand. [`workspace-ingestion.ts:127`](../../apps/studio/src/lib/data-os/workspace-ingestion.ts#L127) valida y crea source; línea 290 ingiere. Resultados [`g3-counts`](../../.data/noisia-greenfield-readiness/backend-08/g3-counts.sanitized.json) y [`g4-counts`](../../.data/noisia-greenfield-readiness/backend-08/g4-counts.sanitized.json). |
| E04 | Ingesta: [`sentione.ts:117`](../../apps/studio/src/lib/csv/sentione.ts#L117) hace streaming; líneas 188–197 deduplican; líneas 303–368 crean raíz y provenance; quality score se observa en líneas 337–340. Resultado G4 en el summary. |
| E05 | Semantic Review UI: [`SemanticReviewQueue.tsx:193`](../../apps/studio/src/components/admin/SemanticReviewQueue.tsx#L193) carga la cola; líneas 369–416 ejecutan create/approve/reject/correct con Idempotency-Key. La página Admin es [`data/review/page.tsx:15`](../../apps/studio/src/app/studio/brands/[id]/data/review/page.tsx#L15). |
| E06 | Semantic Review API/writers: [`signal-semantic-review-api.ts:39`](../../apps/studio/src/lib/data-os/signal-semantic-review-api.ts#L39) cierra schemas; líneas 102–165 exponen candidate/assertion/review. [`infrastructure/db/signal-semantic-review.ts:266`](../../infrastructure/db/signal-semantic-review.ts#L266) genera candidatos deterministas; líneas 353–468 persisten y revisan. Resultado: [`g5-decisions.sanitized.json`](../../.data/noisia-greenfield-readiness/backend-08/g5-decisions.sanitized.json). |
| E07 | Resolver semántico pagado: [`semantic-review/resolve/route.ts:35`](../../apps/studio/src/app/api/data-os/signal/[workspaceId]/semantic-review/resolve/route.ts#L35) exige queue y encola; [`signal-semantic-resolution.ts:207`](../../infrastructure/db/signal-semantic-resolution.ts#L207) puede crear category identity desde Brand OS al preparar ese flujo. No se ejecutó. |
| E08 | Governance genérica: [`signal-data-governance.ts:59`](../../apps/studio/src/lib/data-os/signal-data-governance.ts#L59) exige actor interno y workspace; líneas 77–218 exponen drafts/activation de quality, retention, licensing y provenance; líneas 220+ evalúan. Ningún componente/ruta los importa; sólo scripts. |
| E09 | Policies/views genéricas: [`signal-governed-view-policy.ts:256`](../../apps/studio/src/lib/data-os/signal-governed-view-policy.ts#L256) crea drafts server-owned; líneas 393–500 resuelven governance; líneas 503+ reconcilian. [`signal-governed-view-bindings.ts:93`](../../apps/studio/src/lib/data-os/signal-governed-view-bindings.ts#L93) preflight y líneas 114–143 promueven/retiran sets. |
| E10 | Contrato 12 celdas: [`signal-governed-views-v1.ts:98`](../../packages/query-engine/src/signal-governed-views-v1.ts#L98) define usages exactos para 3 módulos × 4 views; líneas 619–652 scopes/compatibilidad; líneas 1027–1089 compilador fail-closed. |
| E11 | Serving: [`signal-module-serving-scope.ts:98`](../../apps/studio/src/lib/data-os/signal-module-serving-scope.ts#L98) rechaza authority del browser; líneas 130–228 resuelven por module/view. [`signal-governed-view-resolver.ts:122`](../../apps/studio/src/lib/data-os/signal-governed-view-resolver.ts#L122) valida binding/compilation/watermark; líneas 284–335 limitan bridge a brand. Resultado: [`g7-governed-readers.sanitized.json`](../../.data/noisia-greenfield-readiness/backend-08/g7-governed-readers.sanitized.json). |
| E12 | Rutas visibles: [`brand-monitoring/route.ts`](../../apps/studio/src/app/api/data-os/signal/[workspaceId]/brand-monitoring/route.ts), [`mentions/route.ts`](../../apps/studio/src/app/api/data-os/signal/[workspaceId]/mentions/route.ts) y [`topics-narratives/route.ts`](../../apps/studio/src/app/api/data-os/signal/[workspaceId]/topics-narratives/route.ts) usan `loadSignalWorkspaceModuleContext`; el boundary está en [`_lib/load.ts:89`](../../apps/studio/src/app/api/data-os/_lib/load.ts#L89). |
| E13 | Scripts específicos: [`signal-governed-brand-staging-rehearsal.ts:50`](../../apps/studio/scripts/signal-governed-brand-staging-rehearsal.ts#L50), [`signal-governed-multi-view-staging-rehearsal.ts`](../../apps/studio/scripts/signal-governed-multi-view-staging-rehearsal.ts) y [`signal-strategic-authority-staging.ts:99`](../../apps/studio/scripts/signal-strategic-authority-staging.ts#L99) contienen selección/decisiones Laika. Son tooling, no producto. |
| E14 | Strategic generic service: [`signal-strategic-authority.ts:47`](../../apps/studio/src/lib/data-os/signal-strategic-authority.ts#L47) reconcilia base, bundle, derivation, evaluation, compilation y binding; su único consumidor no-test es el script de staging. |
| E15 | Preflight/launch: [`signal-strategic-consumption.ts:213`](../../apps/studio/src/lib/data-os/signal-strategic-consumption.ts#L213) ejecuta preflight; líneas 247+ usan `REPEATABLE READ READ ONLY`; líneas 600–704 declaran cero writes/jobs/providers; líneas 755+ lanzan sólo con autoridad sellada. Ruta: [`runs/route.ts:36`](../../apps/studio/src/app/api/data-os/signal/[workspaceId]/reports/triggers-barriers/runs/route.ts#L36). Resultado: [`g8-strategic-preflight.sanitized.json`](../../.data/noisia-greenfield-readiness/backend-08/g8-strategic-preflight.sanitized.json). |
| E16 | Launcher Admin: [`StrategicReportLauncher.tsx:67`](../../apps/studio/src/components/admin/StrategicReportLauncher.tsx#L67) hace GET→confirmación→POST; líneas 190–216 hacen polling/cancel; no ejecuta Review/publicación. |
| E17 | Workers globales: [`services/workers/src/index.ts:23`](../../services/workers/src/index.ts#L23) levanta worker + ambos drainers + heartbeat una vez por proceso. [`signal-strategic-step-outbox.ts:75`](../../services/workers/src/workers/signal-strategic-step-outbox.ts#L75) hace claim/lease/recovery; [`tb-analysis.ts:16`](../../services/workers/src/queues/tb-analysis.ts#L16) define heartbeat. |
| E18 | Review/release API: [`runs/[analysisId]/review/route.ts:30`](../../apps/studio/src/app/api/data-os/signal/[workspaceId]/reports/triggers-barriers/runs/[analysisId]/review/route.ts#L30) y [`signal-strategic-releases.ts:367`](../../apps/studio/src/lib/data-os/signal-strategic-releases.ts#L367) hacen Review+draft atómico; líneas 448+ promueven. [`signal-triggers-barriers-serving.ts:139`](../../apps/studio/src/lib/data-os/signal-triggers-barriers-serving.ts#L139) sirve release current relacional. |
| E19 | Governance relational: [`0069:188`](../../infrastructure/db/migrations/0069_signal_data_governance_policies.sql#L188) modela bindings source/import; líneas 857+ y 910+ aplican AuthZ, effective dating e inmutabilidad; líneas 2129+ invalidan por provenance. La migración declara cero policy seed en línea 3. |
| E20 | Integraciones existentes: [`signal-governed-brand-shadow.postgres.test.ts:113`](../../apps/studio/src/lib/data-os/signal-governed-brand-shadow.postgres.test.ts#L113) prueba multi-view sintético y líneas 974/1324 aislamiento/promoción; [`signal-strategic-gate-d.integration.test.ts:14`](../../infrastructure/db/migrations/signal-strategic-gate-d.integration.test.ts#L14) prueba 0074; [`signal-strategic-consumption.test.ts:238`](../../apps/studio/src/lib/data-os/signal-strategic-consumption.test.ts#L238) prueba preflight. Prueban arquitectura, no un onboarding de producto. |
| E21 | Admin Mentions runtime: [`admin-mentions/route.ts`](../../apps/studio/src/app/api/data-os/signal/[workspaceId]/admin-mentions/route.ts) devuelve reservoir workspace-owned. Resultado: [`g4-admin-mentions.sanitized.json`](../../.data/noisia-greenfield-readiness/backend-08/g4-admin-mentions.sanitized.json). |

## Resultado greenfield G0–G8

### G0 — Base vacía

- 77 migraciones `0000–0076` aplicadas desde cero; 169 tablas públicas.
- Antes de G1: cero organizaciones, marcas, workspaces, sources, policies, populations de marca, runs o jobs.
- Configuración global necesaria: PostgreSQL/pgvector; flags Data OS/Signal; Redis + proceso Workers para semantic resolution/T&B; provider/model/pricing sólo para flujos pagados.
- Las migraciones no crean estado de workspace, policies, bundles, bindings ni strategic runs.

### G1 — Alta real de marca

`POST /api/brands` creó en una transacción: org, brand, workspace/slug, report `triggers-barriers`, V1 operational definition y pointer, refresh policy manual deshabilitada, Brand OS profile/brief/seed set, seed propia, un competitor, KB y candidata semántica V2. No creó source, watermark, policies, bundles, compilations, bindings ni access grants. Timezone quedó hard-coded a `America/Mexico_City` (E01–E02).

### G2 — Brand OS

PATCH brand, POST competitor y POST knowledge funcionaron por rutas Admin. Aliases subieron a 3, competitors a 2 y KB sources a 2. El Brand OS profile siguió en versión 1: editar marca/competitor/KB no recompuso la proyección inicial. No apareció category/reference identity gobernada. Category puede crearse al preparar el resolver semántico pagado, pero no existe control Admin directo; reference no tiene path de producto localizado (E02, E07).

### G3 — Source

Admin creó una source primary-brand aprobada y su refresh policy manual deshabilitada. No creó quality/retention/licensing policy ni provenance binding; esto es correcto como no-inferencia comercial, pero falta una superficie para capturar la decisión antes del import. La UI sólo construye primary-brand; el service soporta scopes cerrados adicionales (E03).

### Configuración exigible antes del primer import real

El importer sólo exige hoy workspace autorizado, source aprobada, scope cerrado y CSV válido. No exige data-right authority y por eso G4 pudo almacenar datos con governance `not_available`. Para un onboarding real y gobernado deben estar resueltos antes del import: timezone del workspace, identity exacta del scope, quality policy, retention policy, licensing usages y binding de provenance source/import. Quality, retention y licensing son decisiones del operador; el producto puede crear drafts bloqueados y reconciliar estado derivado, pero no puede activarlas ni inferirlas. La ausencia actual de una superficie Admin/HTTP para registrar esas decisiones es el primer P0.

### G4 — Import

El CSV sintético produjo 7 roots de 8 filas: 6 included, 1 excluded, 1 duplicate, 1 low-quality. Creó 7 import memberships, source intent, un watermark e invalidación; no creó estudio. El duplicado se vinculó como provenance de la raíz existente pero no produjo alias row. Admin Mentions devolvió HTTP 200, 7 sujetos canónicos únicos y operator summary (E04, E21).

### G5 — Semantic Review sin proveedor

El endpoint determinista encontró 7 candidatos sobre 6 roots. Los writers/handlers reales registraron 8 assertions y 8 review events: 4 current approved+eligible, 3 rejected, 1 final unattributed; una raíz quedó aprobada simultáneamente para primary brand y competitor. El reconciler dejó 2 memberships en la candidata primary-brand. No hubo category review porque no existía identity gobernada; no se creó por SQL (E05–E07).

### G6 — Policies y doce module/views

Se detuvo sin inventar decisiones. Resultado observado: cero quality, retention, licensing, provenance binding, bundle, evaluation, compilation, derivation y current binding. Hay services/writers genéricos e integración PostgreSQL, pero no Admin/HTTP de governance ni orquestador genérico de producto. Los scripts que realizan la secuencia están ligados a rehearsal/staging (E08–E10, E13, E20).

### G7 — Signal governed

Se llamaron las rutas visibles reales en modo governed para 3 módulos × 4 views. Nueve requests competition/category/all-governed devolvieron `not_available: governed_view_binding_not_available`. Los tres brand devolvieron 503 porque el bridge inicial no tenía `membership_digest` SHA-256. Hubo cero fallback legacy y cero output/corpus como authority. No fue posible probar denominator/facets/cursors/evidence porque no existía autoridad productizada (E11–E12).

### G8 — Preflight estratégico gratuito

El GET real devolvió HTTP 200, `ready=false`, `launch_authorized=false`, population/denominator/coverage/digest nulos y blockers exactos:

- `provider_authority_unavailable`;
- `strategic_governed_binding_unavailable`;
- `strategic_recovery_not_ready`;
- `strategic_worker_not_alive`.

Se conservaron `writes_performed=false`, `jobs_enqueued=0`, `provider_calls=0`. El preflight existe como feature, pero no puede crear su propia authority; eso pertenece a tooling de staging (E14–E17).

## Matriz de evidencia — creación, governance y semántica

| Capability | Categoría | Evento | Genérico o Laika-specific | UI Admin | API/service | Persistencia | Test | Resultado greenfield | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| Organización | `automatic_on_brand_create` | Alta de brand sin org existente | Genérico | Sí, Brand form | `POST /api/brands` (E01) | `organizations` | Runtime G1 | 1 | Ninguno |
| Marca | `automatic_on_brand_create` | Alta Admin | Genérico | Sí | `POST /api/brands` | `brands` | Runtime G1 | 1 | Ninguno |
| Brand OS profile/brief/seed set | `automatic_on_brand_create` + `platform_configuration` | Alta con `NOISIA_DATA_OS_ENABLED=true` | Genérico | Sí, en intake | E02 | `brand_os_*` | Runtime G1 | 1 de cada uno | Flag de plataforma |
| Identidades y aliases de marca | `automatic_on_brand_create` | Alta | Genérico | Sí | E01–E02 | `brand_seeds`, profile aliases | Runtime G1/G2 | Seed + 3 aliases | Edits no reversionan profile |
| Competidores | `automatic_on_brand_create` + `operator_action_available` | Alta o POST posterior | Genérico | Sí | Brand POST / competitors route | `competitors`, `brand_seeds` | Runtime G1/G2 | 2 | Ninguno para competitor identity |
| Category identity | `operator_action_available` + `platform_configuration` | Preparar semantic resolution pagada | Genérico | Sólo botón Resolver, no editor de identidad | E07 | `intelligence_entities` | No ejecutado; provider prohibido | 0 | Acoplada al resolver pagado; falta path manual gratuito |
| Reference identity | `missing_product_path` | — | Arquitectura genérica, writer no localizado | No | No ruta/service de creación localizado | `intelligence_entities` soporta tipo | Sin runtime | 0 | Falta path soportado |
| Signal workspace + slug | `automatic_on_brand_create` | Alta | Genérico | Implícito | E01 | `signal_workspaces` | Runtime G1 | 1 | Ninguno |
| Report registry T&B | `automatic_on_brand_create` | Alta | Genérico | Implícito | E01 | `signal_workspace_reports` | Runtime G1 | 1 | Ninguno |
| Population operacional inicial | `automatic_on_brand_create` | Alta | Genérico | No | E01 | `signal_population_definitions` | Runtime G1 | V1 active | Digest no se actualizó tras import |
| Candidata semántica V2 | `automatic_on_brand_create` | Trigger/ensure de workspace | Genérico | No | 0064 + E01 | `signal_population_definitions` | Runtime G1/G5 | Draft; 2 memberships tras Review | No pointer, correcto |
| Pointer compatibilidad | `automatic_on_brand_create` | Alta | Genérico | No | E01 | `signal_workspace_population_pointers` | Runtime G1 | 1 operational | Sólo legacy bridge |
| Source manual inicial | `operator_action_available` | Acción Add source | Genérico primary-brand | Sí | E03 | `data_sources` | Runtime G3 | No se auto-creó; luego 1 | Correcto no inventar provider/source |
| Freshness inicial | `automatic_on_brand_create` + `automatic_on_import` | Alta crea policy; import crea watermark | Genérico | Estado visible | E01/E03/E04 | `signal_refresh_policies`, watermarks | Runtime G1/G4 | policy disabled + 1 watermark | No scheduler automático |
| Profiles iniciales | `automatic_on_brand_create` | Alta | Genérico Brand OS | Sí parcial | E02 | Brand OS profile; taxonomy profile separado | Runtime G1 | Brand OS=1, taxonomy=0 | Taxonomy requiere otra acción |
| Access grants | `operator_action_available` | Invite/login de cliente, no brand create | Genérico | Team Admin | [`org-sync.ts:7`](../../apps/studio/src/lib/auth/org-sync.ts#L7) | `user_brand_access` | G1 + code | 0 al crear brand | Cliente preexistente obtiene grant al resincronizar sesión, no atómico con alta |
| Timezone | `automatic_on_brand_create` | Alta | Default global hard-coded | No editable en alta | E01 línea 311 | `signal_workspaces.timezone` | Runtime G1 | America/Mexico_City | No sirve como default universal |
| Quality policy aprobada | `operator_decision_required` + `backend_api_only` | Decisión previa a compilation | Writer genérico | No | E08 | `signal_quality_policies` | Integración E20 | 0 | Sin superficie de operador |
| Quality observations | `automatic_on_import` | Normalización de cada row | Genérico | Visible en Admin Mentions | E04 | `mentions.quality_score/flags` | Runtime G4 | 1 low-quality | Escala fija del importer; no equivale a policy aprobada |
| Retention policy | `operator_decision_required` + `backend_api_only` | Decisión legal/operador | Writer genérico | No | E08 | `signal_retention_policies` | Integración E20 | 0 | Sin superficie de operador |
| Licensing policy | `operator_decision_required` + `backend_api_only` | Decisión contractual | Writer genérico | No | E08 | `signal_licensing_policies/usages` | Integración E20 | 0 | Sin superficie de operador |
| Provenance binding | `operator_decision_required` + `backend_api_only` | Asociar policies a source/import | Writer genérico | No | E08/E19 | `signal_provenance_policy_bindings` | Integración E20 | 0 | Sin superficie de operador |
| `client-derived-metrics` | `operator_decision_required` | Decisión por provenance | Genérico | No | Licensing writer | usages relacionales | Integración | not_available | No inferir |
| `client-mention-list` | `operator_decision_required` | Decisión por provenance | Genérico | No | Licensing writer | usages relacionales | Integración | not_available | No inferir |
| `client-text-or-excerpt` | `operator_decision_required` | Decisión por provenance | Genérico | No | Licensing writer | usages relacionales | Integración | not_available | No inferir |
| `llm-processing` | `operator_decision_required` | Decisión por source/import | Genérico | No | Licensing writer | usages relacionales | Backend 07 fixture tests | not_available | Nunca implícito |
| `strategic-analysis` | `operator_decision_required` | Decisión por source/import | Genérico | No | Licensing writer | usages relacionales | Backend 07 fixture tests | not_available | Nunca implícito |
| Effective dating/expiración | `backend_api_only` | Draft/activate/retire | Genérico | No | E08/E19 | `effective_from/to`, `retain_until` | Integración | No filas | Requiere input legítimo |
| Imports futuros | `operator_decision_required` | Elegir source-wide vs import-specific | Genérico | No | Provenance writer acepta import nullable | Binding relacional | Integración | Sin autorización | No se autoautoriza import nuevo |
| Invalidación por provenance nueva | `automatic_on_import` + `automatic_on_reconcile` | Insert/delete provenance/membership | Genérico | No | E19 | invalidations/outbox | Integración E20; G4=1 | 1 invalidación | Sin compilation no hay rebuild automático de producto |
| Candidate generation | `backend_api_only` | Dry-run/apply explícito | Genérico | Propuestas visibles; endpoint no está cableado como acción separada | E06 | `signal_mention_attributions` pending | Runtime G5 | 7 candidates | UI principal ofrece resolver pagado |
| Semantic resolution LLM | `operator_action_available` + `platform_configuration` | Click Resolver + confirmación budget | Genérico | Sí | E07 | runs/items/assertions | No ejecutado | not run | Requiere queue/provider/gasto |
| Current assertions | `automatic_on_review` | Approve/reject/supersede | Genérico | Sí | E05/E06 | `signal_mention_attributions` | Runtime G5 | 8 current | Ninguno para scopes con identity |
| Review events | `automatic_on_review` | Cada decisión | Genérico | Sí, history | E05/E06 | review events append-only | Runtime G5 | 8 | Ninguno |
| Eligibility | `automatic_on_review` | Review writer | Genérico | Literal en UI | E06 | assertion eligibility | Runtime G5 | 4 eligible, 3 rejected, 1 not_eligible | Ninguno |
| Membership reconciliation | `automatic_on_review` | Review function/trigger | Genérico | No | 0064 + E06 | population memberships | Runtime G5 | 2 primary-brand | Derived views aún ausentes |
| Unattributed final | `operator_decision_required` + `automatic_on_review` | Manual assertion + approve | Genérico | Sí | E05/E06 | approved/not_eligible unattributed | Runtime G5 | 1 | No se infiere de ausencia |
| Multi-entity | `automatic_on_review` | Aprobar scopes coexistentes | Genérico | Sí | E05/E06 | 2 assertions, 1 root | Runtime G5 | 1 multi-entity root | Candidate puede sobreproponer aliases |
| Alias→canonical root | `automatic_on_import` | Inserción normal | Parcial | No | E04 | `canonical_mention_id` | Runtime G4 | 7 roots, 0 aliases | Duplicate exacto se omite; no queda alias row |
| No autoaprobar semántica | `operator_decision_required` | Review | Genérico | Sí | E05/E06 | pending hasta decisión | Runtime G5 | 0 pending tras decisiones elegidas | Correcto |

## Matriz de las doce combinaciones operacionales

Las doce celdas tienen contrato, usages, resolver, writers e integración genéricos (E09–E12, E20). Ninguna tiene una acción Admin/HTTP que cree governance, bundle, evaluation, compilation y binding. En el rehearsal todas quedaron con `bundle=0`, `evaluation=0`, `compilation=0`, `derived_population=0`, `binding=0`; por eso denominator/coverage/digest/watermark no existieron.

| Capability | Categoría | Evento | Genérico o Laika-specific | UI Admin | API/service | Persistencia | Test | Resultado greenfield | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| brand-monitoring / brand | `script_only` | Reconcile + promote | Service genérico; orquestación Laika | No | E09 | Bundle/eval/comp/derivation/binding | PG E20 | Todo 0; reader 503 | Governance UI/orchestrator + bridge digest |
| mentions / brand | `script_only` | Reconcile + promote | Igual | No | E09 | Igual | PG E20 | Todo 0; reader 503 | Igual |
| topics-narratives / brand | `script_only` | Reconcile + promote | Igual | No | E09 | Igual | PG E20 | Todo 0; reader 503 | Igual |
| brand-monitoring / competition | `script_only` | Sólo si identity+eligible data | Service genérico; orquestación Laika | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Había identity/data; falta product path |
| mentions / competition | `script_only` | Sólo si aplica | Igual | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Igual |
| topics-narratives / competition | `script_only` | Sólo si aplica | Igual | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Igual |
| brand-monitoring / category | `missing_product_path` | Sólo si category identity+data | Compiler genérico | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Identity no disponible en flujo manual no pagado |
| mentions / category | `missing_product_path` | Sólo si aplica | Igual | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Igual |
| topics-narratives / category | `missing_product_path` | Sólo si aplica | Igual | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Igual |
| brand-monitoring / all-governed | `script_only` | Unión de scopes aplicables | Service genérico; orquestación Laika | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Falta product path; no es un filtro ad hoc |
| mentions / all-governed | `script_only` | Unión aplicable | Igual | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Igual |
| topics-narratives / all-governed | `script_only` | Unión aplicable | Igual | No | E09 | Igual | PG E20 | Todo 0; reader 404 | Igual |

Invariantes disponibles pero no operables desde Admin:

- population/membership por module+view, canonical-root dedupe y capability envelope exacto;
- promotion/withdrawal atómico de tres módulos por view;
- invalidación por semantic assertion, membership, provenance, policy y watermark;
- resolver server-side, `view` cerrada y rechazo de population/policy/binding del browser;
- evidence de Monitoring/T&N intersectada con Mentions de la misma view.

## Matriz estratégica T&B

| Capability | Categoría | Evento | Genérico o Laika-specific | UI Admin | API/service | Persistencia | Test | Resultado greenfield | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| Authority `triggers-barriers/strategic` | `script_only` | Después de governance completa | Service genérico; caller Laika | No | E14 | Bundle/eval/comp/binding | PG/tests | 0 | No product orchestration |
| Population purpose=analysis | `script_only` | Authority reconcile | Genérico | No | E14 + 0076 | population/derivation | PG | 0 | Authority ausente |
| Unión primary+competitor+category | `automatic_on_reconcile` | Reconcile neutral base | Genérico | No | E14/0076 | neutral/derived memberships | PG | No ejecutada | Depende de identities + governance |
| Strategic bundle | `script_only` | Ensure authority | Genérico writer | No | E14 | policy bundle/entities | PG | 0 | Caller sólo script |
| Evaluation/compilation/binding | `script_only` | Reconcile/ensure/promote | Genérico | No | E14 | relational | PG | 0 | Caller sólo script |
| Execution corpus server-owned | `script_only` | Setup de staging | Script específico | No | [`signal-strategic-execution-corpus-staging.ts`](../../apps/studio/scripts/signal-strategic-execution-corpus-staging.ts) | workspace corpus | Tests parciales | 0 | No generic product writer |
| Modelo pinneado | `platform_configuration` | Deploy/runtime | Global | Visible en preflight | E15 | Sellado al run | Tests | provider null | Env ausente en rehearsal |
| Pricing pinneado | `platform_configuration` | Deploy/runtime | Global | Visible en preflight | E15 | Sellado al run | Tests | provider null | Env ausente |
| Server hard cap | `platform_configuration` + `operator_decision_required` | Global máximo + cap por corrida | Global/run | Sí, launcher | E15/E16 | Sellado al run | Tests | budget null | Provider authority ausente |
| Estimate/reservation/settlement | `automatic_on_reconcile` | Preflight/llamada provider | Genérico | Estimate visible | 0074/0075 + Workers | controls/reservations | PG/Workers tests | No ejecutado | Preflight bloqueado |
| Permisos estratégicos | `operator_decision_required` + `backend_api_only` | Licensing por provenance | Genérico | No | E08/E14 | usages + bindings | PG | 0 | No inferir |
| Worker T&B | `platform_configuration` | Levantar proceso compartido | Global reusable | No | E17 | Redis/BullMQ | Tests | apagado | Infra global |
| Heartbeat | `platform_configuration` | Worker activo | Global reusable | Preflight lo consume | E17 | Redis TTL | Tests | false | Worker apagado |
| Recovery drainers | `platform_configuration` | Worker activo | Global reusable | No | E17 | outbox leases/events | PG tests | false | Worker apagado |
| GET preflight | `operator_action_available` | Check en launcher | Genérico | Sí | E15/E16 | Read-only | Runtime G8 | 200, ready=false | 4 blockers exactos |
| POST launch | `operator_action_available` | Confirm cap + preflight exacto | Genérico | Sí | E15/E16 | snapshot/control/outbox | Tests, no runtime | No ejecutado | Correctamente no autorizado/no ready |
| Snapshot | `automatic_on_reconcile` | Launch atómico | Genérico | No | 0074 | snapshot + sealed sample | PG | 0 | Requiere launch |
| Review | `backend_api_only` + `operator_decision_required` | Run needs_review | Genérico | No UI localizada | E18 | review events + draft release | PG/static | No run | Falta UI |
| Release r1/current | `backend_api_only` + `operator_decision_required` | Promote draft | Genérico | No UI localizada | E18 | releases + current pointer | PG/static | 0 | Falta UI |
| Revisión r2 | `backend_api_only` | Nueva run + release | Genérico versionado | No UI completa | E18 | historial immutable/current | PG | 0 | Depende de flujo anterior |
| Enrichment reusable | `operator_decision_required` + `backend_api_only` | Review selecciona assertions | Genérico | Payload soportado; UI no localizada | E18 | reusable review events | PG | 0 | Falta run/UI |
| Mostrar r1 en Signal | `automatic_on_reconcile` | Release published/current | Loader genérico | UI Signal | E18 | current release relacional | Tests | No release | Depende de r1 |

## Auditoría de automatización segura

| Paso manual actual | ¿Automatizable? | Evento correcto | Default seguro | Input que sigue siendo humano | Draft/current | Idempotencia | Invalidación | Reversión | Riesgo | ¿Antes de Alexa? |
|---|---|---|---|---|---|---|---|---|---|---|
| Crear category identity desde industry metadata | Sí, determinista | Alta/update Brand OS | Draft/active identity sólo si nombre no vacío | Confirmar/editar taxonomía | Draft preferible | Sí, external key estable | Brand OS version | Retirar identity y recompilar | Taxonomía errónea | Antes de importar category data |
| Crear reference identity | No sin definición | Acción Admin explícita | Ninguna | Nombre, tipo y alcance | Draft | Sí | Entity change | Retire | Inventar mercado/contexto | Sólo si se usará reference |
| Quality policy | No como decisión; sí como draft vacío | Source onboarding | `not_available`, nunca threshold | Threshold/flags/disposition | Draft | Sí | Policy version | Retire/new version | Certificación falsa | Antes del primer client-serving import |
| Retention policy | No como decisión | Source onboarding | `not_available` | Estado, modo, plazo/evidencia | Draft | Sí | Transition/effective dates | Retire/new version | Riesgo legal | Antes del primer import real |
| Licensing policy/usages | No como decisión | Source/import onboarding | Todo `not_available` | Usos permitidos/prohibidos | Draft | Sí | Policy/binding/import | Retire/new version | Sobreautorización | Antes del primer import real |
| Provenance binding | Sí después de policies | Activación de policy + source/import | Import-specific si la decisión lo exige | Scope source vs import | Draft→active explícito | Sí | Nueva provenance | Retire/new version | Autorizar futuros imports | Antes de serving; idealmente antes de import |
| Bundle draft por view aplicable | Sí | Identity o authority cambia | Draft bloqueado | Ninguno adicional | Draft | Sí | Entity/policy | Retire/version | Crear views vacías | Puede ser después del import |
| Evaluation + derived memberships | Sí | Review/policy/provenance/watermark cambia | Reconcile sólo con authority completa | Ninguno | Current derivado | Sí | Outbox existente | Recompile previous authority | Coste/latencia | Después del import |
| Promote operational binding set | Parcial | Compilation ready + operador publica | No auto-promote inicial | Confirmación de publicación | Current | Sí + CAS | Compilation invalidation | Withdraw/rollback | Exposición prematura | Después del import/QA |
| Strategic authority draft | Sí tras rights exactos | Both strategic usages + identities | Draft bloqueado | Licensing y ventana | Draft | Sí | Policies/provenance | Withdraw binding | Exponer datos a LLM | Después del import |
| Execution corpus estratégico | Sí | Report registry/authority ready | Server-owned, no data copy | Ninguno | Active config | Sí | Methodology/version | Retire membership | Corpus ambiguo | Antes de primer preflight ready |
| Worker/heartbeat/drainers | Sí, infraestructura | Deploy | Proceso global, no por brand | Operación plataforma | Runtime | Sí | Health | Stop process | Consumir jobs inesperados | Antes de launch, no antes de brand create |
| T&B launch | No | Confirmación por corrida | GET read-only; POST deshabilitado si no ready | Periodo, pregunta, decisión, cap | Frozen run | Sí | Preflight CAS | Cancel antes de claim | Gasto | Sólo cuando operator decide |

## Matriz de readiness por etapa

| Etapa | Ready | Funciona sin Laika | Funciona sin SQL manual | Funciona desde Admin | Bloqueadores |
|---|---:|---:|---:|---:|---|
| Crear marca | true | true | true | true | Timezone hard-coded y access eventual son P2 |
| Configurar Brand OS | false | true | true | partial | Profile no se reversiona; category/reference sin editor soportado |
| Crear source | true | true | true | true | UI sólo primary-brand; governance todavía unknown |
| Importar | true | true | true | true | Import permitido aun sin data-right decisions; queda fuera de client views |
| Admin Mentions | true | true | true | true | Ninguno observado; 7/7 roots runtime |
| Semantic Review | true | true | true | true | Manual funciona para identities existentes; resolver automático requiere provider |
| Compilar views | false | true | false | false | Services genéricos, pero decisions/orquestación sólo backend/scripts |
| Promover bindings | false | true | false | false | Writer genérico sin Admin/HTTP |
| Signal governed | false | true | false | false | 12/12 fallaron; bridge brand sin digest |
| Preflight T&B | false | true | false | true | Authority/corpus/provider/Workers ausentes |
| Lanzar T&B | false | true | false | true | Preflight no ready; no se ejecutó por diseño |
| Review | false | true | true | false | API existe; falta run y UI operable |
| Publicar r1 | false | true | true | false | API existe; falta UI y draft |
| Mostrar r1 en Signal | false | true | true | false | Loader cliente existe; no hay release r1 ni acción Admin |

## Gaps por severidad

### P0 — bloquean el objetivo greenfield completo

1. **Governance no operable:** quality/retention/licensing/provenance decisions carecen de Admin/HTTP. Un operador no puede preparar legalmente una source sin scripts.
2. **Views no productizadas:** no hay acción de producto que cree/reconcilie/promueva las doce celdas; competition tenía datos aplicables y aun así quedó sin camino.
3. **Authority estratégica no productizada:** bundle/evaluation/compilation/binding/execution corpus requieren scripts de staging, aunque el service sea genérico.

### P1 — bloquean o degradan etapas concretas

1. **Bridge digest:** import/review no actualizan `membership_digest` de la V1 inicial; brand governed falla cerrado.
2. **Brand OS drift:** PATCH brand/competitor/KB no crea nueva versión/proyección del profile inicial.
3. **Category/reference:** category sólo se asegura dentro del resolver pagado; reference no tiene path soportado localizado.
4. **Strategic Review/release UI:** APIs existen, pero Admin sólo muestra flags; no enlaza/ejecuta Review ni promote r1.
5. **Duplicate lineage:** dedupe exacto conserva provenance sobre la raíz, pero no crea alias row; no demuestra merge/split de contenido distinto.

### P2 — no bloquean el alta básica

1. Timezone se fija a `America/Mexico_City` y no es input de alta.
2. Access grants no se crean en la transacción de brand; clientes se sincronizan por sesión/invite.
3. Source Admin sólo construye primary-brand aunque el backend soporta scopes cerrados.
4. La acción visible “Resolver” es pagada; el endpoint determinista de candidates no tiene control Admin explícito separado.

## Plan de cierre mínimo

### Antes de crear Alexa como onboarding real

1. Crear Admin + rutas management para drafts/activation/versionado de quality, retention, licensing y provenance bindings, con effective dates, evidence e Idempotency-Key.
2. Convertir source onboarding en un checklist fail-closed: scope/entity/timezone, rights/retention/quality decididos o estado explícito `not_available`; no bloquear almacenamiento interno, pero impedir serving.
3. Añadir editor/reconciler Brand OS para category/reference y reversionar profile/seeds al editar brand/competitors/KB.
4. Corregir/reconciliar automáticamente el `membership_digest` de V1/bridge tras import y governance changes.

### Puede cerrarse después del primer import, antes de client serving

5. Orquestador genérico product-owned: detectar views aplicables, crear drafts, evaluar, materializar las 12 populations nombradas, exponer preflight y promover/withdraw por view.
6. Admin de governed views: estado, blockers, denominator, coverage, watermarks, hashes y botones explícitos promote/withdraw.
7. Orquestador estratégico genérico y execution corpus server-owned sin slug/IDs de fixture.
8. UI workspace-native para Review estratégico, draft release, promote r1 y navegación a r2.
9. Rehearsal E2E greenfield en CI/local que use handlers reales y una fixture sintética, no scripts de staging.

## Respuestas obligatorias

1. **¿Podemos crear Alexa ahora desde Admin sin comprometer el roadmap?** Sí para crear el shell de marca/Brand OS/workspace. No para iniciar un onboarding de datos que prometa Signal governed o T&B. Recomiendo implementar la superficie de governance antes del primer import real.
2. **¿Hasta qué checkpoint podemos avanzar sin modificar código?** Hasta G5 para primary-brand, competitor, unattributed y multi-entity con identities existentes. Category sólo después de un resolver pagado o intervención no soportada; G6 está bloqueado.
3. **¿Primer blocker real?** Falta una superficie de producto para decisiones data-governance. El siguiente blocker técnico visible es la ausencia de orquestación de policies/views y el bridge digest.
4. **¿Qué es genérico vs Laika?** Schema, writers, compiler, resolver, binding sets, preflight, launch, Workers, Review y release son genéricos. La secuencia de creación/aprobación/promoción de Backend 04–07 está en scripts de staging con selectors/decisions Laika.
5. **¿Las doce compilaciones/bindings pueden producirse para cualquier workspace por camino soportado?** No. Pueden producirse por services genéricos e integraciones, pero no por una ruta/UI de producto.
6. **¿La authority estratégica puede producirse para cualquier workspace por camino soportado?** No. El service es genérico; el único caller no-test es staging-specific.
7. **¿Quality, retention y licensing tienen writers genéricos?** Sí (E08).
8. **¿Superficie de producto o sólo services/scripts?** Sólo services internos; la orquestación aprobada está en scripts.
9. **¿Workers/recovery globales o por workspace?** Infraestructura global reusable, una vez por proceso (E17).
10. **¿Modelo/pricing/hard cap reusable o Laika?** Modelo/pricing/max cap son platform configuration reusable; el cap de corrida es operator-owned y sellado por preflight. No son estado Laika.
11. **¿Qué debe implementarse antes de crear Alexa?** Para crear el registro, nada. Para usarla como primer greenfield real: governance Admin/API, source onboarding fail-closed y category/reference/profile reconciliation; idealmente bridge digest antes del primer import.
12. **¿Qué puede esperar hasta después del primer import?** Derived compilation/bindings, Signal governed UI, strategic authority/corpus y Review/release UI, siempre antes de exposición cliente o T&B.

## Veredicto

`GREENFIELD_PARTIALLY_PRODUCTIZED`

El software es genérico en su núcleo, pero no es todavía operable end-to-end para cualquier marca. Backend 04–07 no dejó los contratos limitados a Laika; dejó la **orquestación indispensable** limitada a scripts/fixtures de staging. Alexa puede ser creada como shell y usada para completar el producto, pero no debe ser presentada como el primer workspace greenfield listo hasta cerrar P0.

## Backend 09 · cierre verificado de los gaps

Esta sección supersede el veredicto histórico anterior; conserva la auditoría original
como evidencia del delta. El 2026-08-12 se comprobó:

- los tres P0 tienen rutas HTTP genéricas, management UI y writers server-owned;
- bridge digest, Brand OS drift, category/reference, timezone y Review/release V2 tienen
  caminos soportados;
- una fixture sintética no-Laika completó localmente G0–G8, Review, r1 y consumo;
- una marca QA creada desde Admin en `noisia-staging` completó decisions, import, Review,
  doce bindings, tres readers visibles y el preflight T&B sin provider calls;
- ninguna decision comercial se creó por default y ninguna promotion fue automática.

Veredicto actualizado: `GREENFIELD_READY_WITH_OPERATOR_CONFIGURATION`.

Alexa puede crearse ahora desde `/studio/brands/new`. Antes del primer import el operador
debe definir identities y timezone; antes de serving o T&B debe aprobar quality,
retention, los seis usos de licensing y provenance desde “Preparación de datos”. La
derivación posterior es reproducible, pero promote/withdraw/release y el presupuesto T&B
siguen siendo acciones humanas explícitas.

El evidence verificable de Backend 09 está en
[`backend-09`](../../.data/noisia-greenfield-productization/backend-09/). Producción,
pointers y Alexa no fueron tocados.
