# Engine Multimétodo — Prod Readiness Tracker

> ⏸️ **PAUSADO (2026-06-09)** por cambio de dirección: nueva metodología en diseño.
> Fuente de verdad para reanudar: **[Issue #2](https://github.com/noisia-ai/website/issues/2)** (estado, pendientes con checkboxes y runbook de reanudación).
>
> Última actualización: 2026-06-09 (sesión de estabilización con Takis).
> Regla: nada de esta lista se considera cerrado hasta tener commit + prueba. Actualizar este doc en cada sesión.

## ✅ Arreglado en esta sesión (SIN COMMIT todavía — branch `codex/live-intelligence-store`)

| # | Fix | Archivos | Validación |
|---|-----|----------|------------|
| 1 | Publish guard de la página del Signal no bloqueaba lentes `directional` (copia local débil del guard) | `apps/studio/src/app/signal/[outputId]/page.tsx` → delega a `validateEnginePublishReadiness` | test publish-guards + typecheck |
| 2 | SQL ambiguo `query_pack_id = "id"` (Drizzle no calificaba la columna en subquery correlacionada) — rompía la vista del engine | `apps/studio/src/lib/data/corpora.ts`, `api/corpora/[id]/engine-analysis/route.ts`, `.../selected/route.ts` (10 casos) | probado contra DB real |
| 3 | `statement_timeout` (2 min de rol) mataba el retrieve; ahora `SET LOCAL` con margen configurable | `services/workers/src/workers/engine-step-retrieve.ts` (+ env `ENGINE_RETRIEVE_STATEMENT_TIMEOUT_MS`, default 8 min) | corrida real Takis |
| 4 | Coding frágil: 1 batch malo (de ~112) tumbaba el lente entero | `services/workers/src/workers/engine-step-code.ts`: retry 1×, skip batch, umbral `ENGINE_CODING_MAX_FAILED_FRACTION` (0.35), falla solo si coded=0; `sanitizeForLlm` (surrogates/control chars → mataba "request body is not valid JSON") | corrida real: narrative fb=3, sentiment fb=5, ambos completaron |
| 5 | Parser de coding tiraba por 1 label malo / intensity fuera de rango | `packages/query-engine/src/engine-coding.ts`: skip label malo, clamp intensity [0,5] | tests 41/41 (contrato actualizado en engine-methodologies.test.ts) |
| 6 | Composer API 500: `ce.archived_at` no existe (la tabla usa `status`) → UI mostraba "No live signals" con 2,227 señales en DB | `api/signal/[outputId]/composer/route.ts:805` | typecheck; pendiente confirmación visual |
| 7 | Test de regresión: todo scope de lens pack ∈ vocabulario fan-out CSV {brand,competitors,category} | `packages/query-engine/src/lens-query-packs.test.ts` | 41/41 |

## 🪤 Trampas de dinero / UX (ABIERTAS — prioridad alta antes de prod)

- [ ] **"Run beta lens" re-corre lentes ya completos sin confirmar** (le costó un click accidental al usuario; se detuvo a $0). La ruta single-lens necesita el guard de reúso de `/selected` + diálogo de confirmación con costo estimado.
- [ ] **Selector de tamaño por lente en el panel** (como el Small/Medium/Large de T&B). Hoy hereda `target_mentions` del último T&B (Large=6,018 → ~$87 por 5 lentes sin avisar). El hardcode temporal de la sesión ya fue revertido.
- [ ] **Mostrar costo estimado antes de cualquier corrida engine** (el panel tiene cost ledger *después*; falta el *antes*).

## 🔜 Producto pendiente

- [ ] **Página de review para análisis engine**: `/studio/corpora/[id]/analysis/[analysisId]` solo renderiza T&B → 404 con IDs engine. Hoy el review es por Live Composer + digest manual.
- [ ] **Correr los 3 lentes faltantes de Takis** (VPM, trust-risk, JFM) cuando haya saldo. A 1,000/lente ≈ $10.50; a 2,006 ≈ $21 (paridad con los 2 completos).
- [ ] Depurar los findings sin cita (25 narrative + 8 sentiment) → gate `traceability` pasa a ✓ sin gastar Claude (solo DB + re-correr step quality_gates).
- [ ] **Decisión de política de gates**: (a) `traceability` exige 100% de citas — ¿bajar a 98%?; (b) `retrieval_budget_declared` marca *cualquier* corrida con cap como directional — definir la ruta "muestreo aprobado" para que un sample estratificado pueda ser client-ready.

## ⚙️ Ops / Runbook (lecciones de la sesión)

- [ ] **ANALYZE automático** tras ingests/backfills grandes: stats obsoletas en `mention_query_sources` (434k filas) hicieron que el planner estimara rows=1 vs 13k reales → plan pésimo → timeouts. Fix puntual ya aplicado a mano; falta automatizar (autovacuum tuning o ANALYZE post-ingest en el worker).
- [ ] **Detección de workers duplicados/zombie**: un worker huérfano con código viejo consumió jobs por 7h causando fallos "imposibles". Mitigación a evaluar: lock de instancia única (Redis), heartbeat visible en Studio, y patrón de kill correcto (`pkill -f preflight.cjs` — el hijo no matchea `cli.mjs`).
- [ ] **Redis local (docker-compose ya lo trae) para desarrollo**; Upstash free se satura con conexiones múltiples (~10k cmds/día). Dejar Upstash para staging/prod.
- [ ] Workers env: `services/workers/src/env/load.ts` carga `apps/studio/.env.local` + `services/workers/.env` (override) — documentado para no volver a sospechar de queue-name mismatch.
- [ ] **Composer API lento y frágil a conexiones muertas**: el GET tarda 26-48s (varias queries pesadas secuenciales sobre mention_query_sources 434k) y un pool pg viejo en dev tira "Connection terminated unexpectedly" → 500. Pendiente: paralelizar/cachear las queries de coverage, y resiliencia del pool (retry-on-dead-connection o keepAlive). Workaround dev: reiniciar el dev server.

## 💸 Contabilidad de la prueba Takis (referencia)

- Total engine: $29.73 · convertido en producto $17.11 · quemado en fallos $12.62.
- Producto entregado: narrative-ownership (1,136 findings) + sentiment-advocacy (1,071 findings), `needs_review`, Claude real, señales vivas en composer.
- Costo unitario observado: ~$0.0029/mención codificada (sonnet) — usar para presupuestar.

## Cómo usar este doc

1. Antes de tocar el Engine, leer "Trampas de dinero".
2. Cada fix nuevo: fila en "Arreglado" con archivo + validación.
3. Antes del merge a `main`: todas las casillas de Trampas + Ops resueltas o explícitamente aceptadas.
