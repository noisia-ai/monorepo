# 49 - Final review Codex: Signal Pulse listo para validacion externa

> Fecha: 2026-06-12. Rama: `codex/signal-pulse`.
> Punto de entrada obligatorio antes de validar: `AGENTS.md`, luego docs `34`, `43`, `44`, `45`, `46`, `47`, `48` y este documento.

## Veredicto

Signal Pulse quedo implementado como reporte tactico marketing-first sobre la infraestructura viva del repo. No es un adapter de Triggers & Barriers ni UI nueva para los 16 lentes pausados.

El corte actual esta listo para validacion local end-to-end:

- Runtime propio sobre `engine_analyses`, cola/workers existentes y cost ledger.
- Deteccion cluster-first: embeddings/clustering en worker; Claude solo nombra/interpreta clusters cuando hay LLM.
- Periodizacion mensual, metricas por senal, moves, chart aggregates, performance estructurada y fuentes.
- Performance de 12 meses entra a `performance_records` via mapping configurable; no entra a `mentions` ni como texto de contexto.
- `/pulse/[outputId]` publica dashboard tactico, API contract, corpus, composer y deck mensual.
- Visibilidad cliente/interno redacciona paid data, costos y soporte interno por defecto.
- Smoke local genera un reporte completo y el UI fue revisado en browser desktop/mobile/deck.

No encontre blockers abiertos en el review final. Los riesgos residuales estan al final de este documento.

## Commits de implementacion

Rango sobre `codex/live-intelligence-store`: `053374a..1199e88`.

Hitos relevantes:

- `053374a` docs: gap analysis inicial.
- `c97ad1b` foundation de datos/migracion 0034.
- `a2609e0` materializacion de reportes Signal Pulse.
- `2b87140` ingestion estructurada de performance.
- `27bcce5` runtime visible en Studio.
- `d7dd8c4` cluster-first preferido para deteccion.
- `d60c37c` path LLM solo para nombrar clusters.
- `3d3b108` presupuesto pre-run visible.
- `3a7e6ba` budget cap antes de encolar.
- `f24b641` reserva de presupuesto para la siguiente llamada LLM.
- `629a0d9`, `a12ea7b`, `4cd78ae`, `f3ad9c7` hardening de visibilidad/public API/deck.
- `ff074d1` smoke local completo.
- `1199e88` soporte de review UI contra smoke DB + fixes visuales finales.

## Archivos principales para auditar

### Data foundation

- `infrastructure/db/migrations/0034_signal_pulse_foundation.sql`
- `infrastructure/db/schema/index.ts`
- `infrastructure/db/migrations/live-intelligence.test.ts`
- `infrastructure/db/scripts/smoke-migrations.ts`
- `infrastructure/db/scripts/verify-live-intelligence-readiness.ts`

Tablas/columnas esperadas:

- `report_periods`
- `signal_period_metrics`
- `marketing_moves`
- `chart_aggregates`
- `performance_records`
- `data_sources`
- `source_sync_runs`
- `published_outputs.kind`
- `published_outputs.visibility_config`

### Query engine

- `packages/query-engine/src/signal-pulse.ts`
- `packages/query-engine/src/signal-pulse.test.ts`
- `packages/query-engine/src/lens-query-packs.ts`
- `packages/query-engine/src/lens-query-packs.test.ts`
- `packages/query-engine/src/engine.ts`

Validar aqui:

- `impact_v1` y lifecycle son deterministas.
- Query pack `signal-pulse` cubre brand, competitors y category con lenguaje de marketing.
- Los lentes pausados siguen presentes pero no se vuelven UI principal de Signal Pulse.

### Workers/runtime

- `services/workers/src/workers/engine-orchestrator.ts`
- `services/workers/src/workers/signal-pulse-steps.ts`
- `services/workers/src/workers/signal-pulse-clustering.ts`
- `services/workers/src/workers/signal-pulse-budget.ts`
- `services/workers/src/workers/signal-pulse-copy.ts`
- `services/workers/src/workers/signal-pulse-steps.test.ts`
- `services/workers/scripts/smoke-signal-pulse-local.ts`

Validar aqui:

- Step order SP: `sp_readiness`, `sp_periods`, `sp_cluster`, `sp_name_signals`, `sp_metrics`, `sp_interpret`, `sp_charts`, `sp_gates`.
- `sp_cluster` no llama LLM ni hace coding por mencion.
- `sp_name_signals` trabaja por cluster/batch y registra costos.
- Budget guard reserva la siguiente llamada cluster-level antes de ejecutar.
- Costos ejecutados no cuentan forecast `provider='system'` como gasto real.
- Smoke serializa queries y cierra Redis para terminar limpio.

### Studio: create/run/read/publish

- `apps/studio/src/components/corpus/NewStudyForm.tsx`
- `apps/studio/src/components/engine/EngineMethodologyBetaPanel.tsx`
- `apps/studio/src/lib/multimethod/analysis-plan.ts`
- `apps/studio/src/lib/signal-pulse/runtime-contracts.ts`
- `apps/studio/src/lib/signal-pulse/publish-gates.ts`
- `apps/studio/src/lib/signal-pulse/performance-import.ts`
- `apps/studio/src/lib/signal-pulse/performance-summary.ts`
- `apps/studio/src/lib/signal-pulse/pulse-api.ts`

Validar aqui:

- Brief SP persiste en `analysis_plan`.
- Costo LLM estimado y budget cap se muestran antes de correr.
- Readiness bloquea si falta cobertura de conversation/performance.
- Publish gates bloquean sin performance estructurada, periodos comparables, charts, moves con evidencia y costo dentro del tope.
- Performance upload hace mapping configurable, validacion y bulk insert a `performance_records`.

### Studio: APIs y UI de lectura

- `apps/studio/src/app/pulse/[outputId]/page.tsx`
- `apps/studio/src/app/pulse/[outputId]/deck/page.tsx`
- `apps/studio/src/app/pulse/[outputId]/deck/pulse-deck.css`
- `apps/studio/src/app/api/pulse/_lib/load.ts`
- `apps/studio/src/app/api/pulse/[outputId]/overview/route.ts`
- `apps/studio/src/app/api/pulse/[outputId]/signals/route.ts`
- `apps/studio/src/app/api/pulse/[outputId]/signals/[signalId]/route.ts`
- `apps/studio/src/app/api/pulse/[outputId]/moves/route.ts`
- `apps/studio/src/app/api/pulse/[outputId]/chart/[dataRef]/route.ts`
- `apps/studio/src/app/api/pulse/[outputId]/corpus/route.ts`
- `apps/studio/src/components/signal/SignalReportShell.tsx`
- `apps/studio/src/components/signal/SignalCorpusExplorer.tsx`
- `apps/studio/src/components/signal/SignalLiveComposer.tsx`
- `apps/studio/src/app/globals.css`

Validar aqui:

- `/pulse/[outputId]` exige `methodology_slug='signal-pulse'` y `kind='signal_pulse'`.
- El shell reusa infraestructura Signal pero los labels y pantallas son Signal Pulse.
- Overview, signals, moves, content, paid/organic, category, evidence, composer, corpus, sources y quality estan presentes segun visibility.
- Deck mensual solo lee el corte publicado y respeta visibility.
- Corpus Explorer acepta evidencia repetida por senal/rol sin duplicar React keys.
- No hay overflow horizontal en dashboard desktop/mobile ni deck desktop.

### Public API y visibilidad

- `apps/studio/src/lib/reporting/public-api.ts`
- `apps/studio/src/app/api/public/public-api-routes.test.ts`
- `apps/studio/src/lib/signal-pulse/pulse-api.ts`
- `apps/studio/src/app/api/signal/[outputId]/share/route.ts`

Validar aqui:

- Public v1/v2 no exponen paid data ni internal support por defecto.
- Paid data solo aparece si `visibility_config` lo permite explicitamente.
- Costo de corrida no aparece en vistas cliente/public por defecto.
- Deck/share usa `/pulse/[outputId]/deck` para Signal Pulse.

### Soporte local de QA

- `apps/studio/src/lib/auth/local-auth.ts`
- `apps/studio/src/lib/auth/session.ts`
- `apps/studio/src/lib/auth/session.test.ts`
- `apps/studio/src/lib/db.ts`
- `apps/studio/src/lib/db.test.ts`

Este soporte existe para revisar smoke reports locales sin Kinde:

- Requiere `NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE=true`.
- Requiere `NOISIA_LOCAL_AUTH_EMAIL`.
- No crea usuarios; solo acepta usuarios existentes.
- Se desactiva si `NODE_ENV`, `VERCEL_ENV` o `RAILWAY_ENVIRONMENT` son production.
- `DATABASE_SSL=false` permite conectar Studio a Postgres local smoke.

## Smoke local reproducible

Si Docker Desktop esta prendido, levantar la DB smoke. En esta maquina se uso un `DOCKER_CONFIG` temporal para evitar bloqueo de `docker-credential-desktop`:

```sh
tmp_docker_config=$(mktemp -d)
mkdir -p "$tmp_docker_config/cli-plugins"
ln -s "$HOME/.docker/cli-plugins/docker-compose" "$tmp_docker_config/cli-plugins/docker-compose"
printf '{"auths":{}}\n' > "$tmp_docker_config/config.json"
DOCKER_CONFIG="$tmp_docker_config" DOCKER_HOST="unix://$HOME/.docker/run/docker.sock" \
  docker compose -f infrastructure/docker/docker-compose.yml --profile migration-smoke up -d postgres-smoke redis
```

Generar reporte completo:

```sh
NOISIA_SIGNAL_PULSE_SMOKE_SKIP_DOCKER=true pnpm --filter @noisia/workers smoke:signal-pulse:local
```

Ultima corrida validada:

- `outputId`: `8bacf8ba-2b98-4250-9546-77606d399363`
- path: `/pulse/8bacf8ba-2b98-4250-9546-77606d399363`
- 9 steps completos
- 24 signals
- 12 periods
- 288 metrics
- 12 marketing moves
- 4 charts
- 372 evidence rows
- 12 performance_records
- 1 data source
- 1 sync run
- 1 published output
- 0 failed gates

Arrancar Studio contra esa DB smoke:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:55432/noisia_migration_smoke \
DATABASE_SSL=false \
NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE=true \
NOISIA_LOCAL_AUTH_EMAIL=signal-pulse-smoke@noisia.local \
pnpm --filter @noisia/studio dev
```

Abrir:

- Dashboard: `http://localhost:3001/pulse/8bacf8ba-2b98-4250-9546-77606d399363`
- Deck: `http://localhost:3001/pulse/8bacf8ba-2b98-4250-9546-77606d399363/deck?lang=es`

Nota: si se vuelve a correr el smoke, la DB se recrea y el `outputId` cambia. Usar el `pulsePath` que imprime el script.

## Validacion ejecutada por Codex

Comandos verdes:

```sh
pnpm --filter @noisia/query-engine test
pnpm --filter @noisia/query-engine typecheck
pnpm --filter @noisia/workers test
pnpm --filter @noisia/workers typecheck
pnpm --filter @noisia/studio test
pnpm --filter @noisia/studio typecheck
pnpm --filter @noisia/studio build
NOISIA_SIGNAL_PULSE_SMOKE_SKIP_DOCKER=true pnpm --filter @noisia/workers smoke:signal-pulse:local
```

Resultados relevantes:

- Query-engine: 45 tests pass.
- Workers: 41 tests pass.
- Studio: 149 tests pass.
- Studio build: compiled successfully; rutas `/pulse/[outputId]` y `/pulse/[outputId]/deck` aparecen como dynamic server-rendered routes.
- Focus tests de Pulse/API/Corpus tambien pasaron.

QA visual con browser integrado:

- Dashboard desktop `1280x720`: sin 404, sin NaN/undefined/null visible, sin overflow horizontal, charts visibles.
- Dashboard mobile `390x844`: sin 404, sin NaN/undefined/null visible, sin overflow horizontal, topbar compacta.
- Deck desktop `1280x720`: 6 slides, sin 404, sin NaN/undefined/null visible, sin overflow horizontal.
- Terminal dev server no reporto nuevos warnings de React keys despues de los fixes.

## Checklist para Claude Fable 5

Validacion dura:

1. Leer `AGENTS.md` y confirmar que Signal Pulse sigue siendo la unica prioridad.
2. Confirmar que los 16 lentes pausados no recibieron UI nueva como superficie principal.
3. Confirmar que `signal-pulse` vive como metodologia beta propia y no como T&B reetiquetado.
4. Confirmar que `published_outputs.kind='signal_pulse'` y ruta `/pulse/[outputId]` se usan para SP.
5. Confirmar que `canonical_signals.methodology_slug='signal-pulse'` filtra dedup/senales.
6. Confirmar que el worker usa cluster-first y no coding por mencion.
7. Confirmar que los numeros visibles salen de SQL/agregados/payload estructurado, no de texto generado.
8. Confirmar que performance entra a `performance_records` y no a `mentions`.
9. Confirmar que budget cap se valida antes de encolar y durante llamadas LLM de cluster.
10. Confirmar que `engine_cost_events` registra costos y que forecasts `provider='system'` no se cuentan como gasto ejecutado.
11. Confirmar que gates bloquean publicacion insegura.
12. Confirmar que API public y deck respetan visibility.
13. Correr smoke local y abrir dashboard + deck.
14. Correr test/typecheck de query-engine, workers y studio.
15. Revisar browser mobile/desktop por overflow y textos truncados.

Preguntas de producto que deben quedar respondidas con el reporte smoke:

- Que senal requiere atencion este mes?
- Que evidencia la sostiene?
- Que accion concreta puede mover Marketing en 1-4 semanas?
- Que periodo/coverage limita la lectura?
- Que paid/organic se lee desde performance estructurada?
- Que no se debe mostrar a cliente sin permiso?

## Riesgos residuales y siguientes pasos

No bloquean la validacion actual, pero deben considerarse antes de prod real:

- El smoke usa datos sinteticos; validar con un corpus real grande y un export performance real de 12 meses.
- El layout visual del deck esta validado en desktop; falta export PDF real si se requiere entregar archivo final.
- El override local de auth es seguro por flags/env, pero debe mantenerse fuera de cualquier run prod.
- El Source Wizard soporta archivo/mapping; OAuth/scheduled sync sigue siendo Cut 2.
- Campaign-to-signal automatico sigue siendo sugerencia semantica + confirmacion humana, no attribution final de spend por narrativa.
- Las reglas CSS de topbar ahora permiten wrap tambien en Signal legacy; no rompen build ni Pulse, pero conviene hacer una pasada visual rapida sobre `/signal/[outputId]` antes de merge final si hay outputs legacy disponibles.

## Estado local al cierre

- Branch: `codex/signal-pulse`
- Ultimo commit de implementacion: `1199e88 fix: enable signal pulse smoke UI review`
- Worktree esperado: limpio salvo scripts untracked previos en `services/workers/*.mjs`, que no forman parte de Signal Pulse.
- El hotfix de mail del usuario no fue mezclado en esta rama.
