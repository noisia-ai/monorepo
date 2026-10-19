# 47 — Handoff para Codex (2026-06-12)

La pausa del engine multimétodo (Issue #2) se ejecutó y el rumbo quedó definido. **Este doc + `AGENTS.md` (raíz del repo) son tu punto de entrada.**

### La historia completa desde que dejaste la rama (léela: explica POR QUÉ existen las reglas de abajo)

**1. Lo que tú construiste** (lo dejaste en working tree; ya está commiteado en `88989cb..708528c`):
Live Intelligence Store (migraciones 0025-0033: canonical_signals, signal_observations, evidencia, cost ledger, run_mention_map), runtime multimétodo (workers preflight→retrieve→code→score→synthesize→quality_gates), query packs por lente con provenance y fan-out CSV, wizard multimétodo, Live Composer con edits persistentes y corpus explorer vivo. Foundation sólida — nada se tiró.

**2. Lo que pasó al probarlo con corpus real** (Takis, 13k menciones):
La primera corrida salió **genérica/vacía**: `retrieved_units=0` en los 5 lentes (corrieron antes de que existiera la provenance; el backfill llegó después). Al re-correr aparecieron 4 causas raíz más, ya corregidas:
- **Timeout en retrieve:** stats de Postgres obsoletas (434k filas en `mention_query_sources` sin ANALYZE → planner estimaba rows=1 → plan pésimo → >8 min → `statement timeout`). Fix: ANALYZE (la query bajó a 0.8s) + `SET LOCAL statement_timeout` en el worker.
- **Coding frágil:** 1 batch malo de ~112 tumbaba el lente entero y quemaba lo ya codificado (errores reales: JSON inválido por surrogates, intensity fuera de rango, timeouts de API). Fix: parser tolerante + batch retry→skip con umbral en `engine-step-code.ts` + sanitización del texto para el LLM.
- **Worker zombie:** un proceso huérfano con código viejo consumió jobs 7 horas produciendo errores "imposibles" (el hijo node no matchea `pkill cli.mjs`; solo `pkill -f preflight.cjs`). Costó ~$13 en corridas fallidas.
- **Bugs que bloqueaban UI:** SQL ambiguo de Drizzle (`${queryPacks.id}` → `"id"` sin calificar, 10 casos) tiraba la vista del engine; `ce.archived_at` inexistente tiraba el composer con 500.

**3. Lo que quedó validado:** narrative-ownership (1,136 findings) y sentiment-advocacy (1,071) completos end-to-end con Claude real — insights específicos de marca con evidencia citada y señales vivas en el composer. Costo medido: **~$0.003/mención codificada**; total del aprendizaje ~$30 ($17 a producto, $13 quemados). De ahí salen las reglas de presupuesto de abajo.

**4. El pivote (decisión de negocio, no técnica):** al revisar el output con ojos del comprador real (KAM de agencia, Brand Manager, Insights Manager de Marketing), los insights tipo "mejorar el PDP / falta acompañamiento" son de Producto/CX — **Marketing no puede accionarlos**. Marketing necesita qué contenido pautar, qué tendencia activar, qué claim testear, el wordcloud y el sentiment reinventados. Por eso: los 16 lentes se PAUSAN (capa estratégica, no se borran) y nace **Signal Pulse** como capa táctica con pipeline propio. T&B sigue vivo y funcional.

**5. Qué de lo tuyo reutiliza Signal Pulse vs qué queda dormido:**
- **Reutilizas:** cola/orquestador/steps, cost ledger, patrón de batch resilience, canonical_signals/observations/evidencia, run_mention_map, composer edits, corpus explorer, ingest CSV con provenance, publish guards.
- **Dormido (no tocar, no romper):** los 16 specs de lentes, sus prompts/scoring, el panel beta de metodologías, los 3 lentes de Takis sin correr.

Detalle exhaustivo: `engine_comparative/98_PROD_READINESS_TRACKER.md` e Issue #2.

### Tu nueva misión

Implementar **Signal Pulse** siguiendo el spec pack en `docs/product/10_methodology_seeds/signal_pulse/` (48 archivos, en la rama).

**Orden de lectura OBLIGATORIO:** `34_CLAUDE_CODEX_IMPLEMENTATION_PROMPT.md` → `43_TECHNICAL_AUDIT_CLAUDE.md` → `44_DATA_CONTRACT_AND_SCHEMA_MAPPING.md` → `45_PRODUCTION_CUT_1.md` → `46_INSIGHTS_MANAGER_JOURNEY.md` → resto como referencia.

Los docs 43-46 son la auditoría técnica contra TU rama: contienen el contrato de datos contra el schema real y **decisiones ya cerradas que no debes reabrir** (44 §5): señales SP en `canonical_signals` con `methodology_slug='signal-pulse'`; runs SP = `engine_analyses` reutilizando tu cola/ledger/locks/run_mention_map; detección cluster-first (embeddings + clustering en worker, Claude solo nombra/interpreta — NUNCA coding por mención como default); emoción v1 a nivel señal; `impact_v1` con fórmula fija; galaxy precomputada en worker; ruta `/pulse/[outputId]` con `published_outputs.kind='signal_pulse'`.

### Requisito duro del negocio (no negociable)

Un archivo de **performance de 12 meses de Social Media** (Meta/TikTok export, paid+organic) debe integrarse **estructurado** al corpus vía `performance_records` (doc 44 §2.6) — mapping configurable, validación, dedupe, periodización automática por fecha. JAMÁS como texto de contexto para Claude, JAMÁS como mentions. La pantalla Paid/Organic nace funcional por la vía de archivo (OAuth = Cut 2).

### Cómo empezar

1. `git fetch && git switch codex/live-intelligence-store && git pull`
2. Crear `codex/signal-pulse` DESDE esa rama (la infra que reutilizas vive ahí, NO en main).
3. Gap analysis breve contra doc 44 §1 (el mapa de reutilización ya está hecho; verifícalo).
4. Secuencia de PRs del doc 45: PR-1 (migración 0034 + brief SP + query template + steps de pipeline) → PR-1.5 (performance ingestion) → PR-2 (interpretación+gates) → PR-3 (UI núcleo `/pulse`) → PR-4 (moves/evidence/composer) → PR-5 (hardening+deck).

### Guardrails heredados (lecciones caras, ver Issue #2)

- Costo visible ANTES de cualquier corrida LLM; budget cap como param; cluster-first te da <$5/corrida.
- Batches resilientes SIEMPRE (un batch malo no tumba el run) — el patrón ya está en `engine-step-code.ts`.
- ANALYZE tras materializaciones grandes; SET LOCAL statement_timeout en queries pesadas.
- UNA instancia de worker (zombies con código viejo = bugs "imposibles"; verifica con `ps aux | grep preflight.cjs`).
- Los lentes pausados: NO construir UI nueva sobre ellos, NO romperlos. Viajan dormidos al merge.
