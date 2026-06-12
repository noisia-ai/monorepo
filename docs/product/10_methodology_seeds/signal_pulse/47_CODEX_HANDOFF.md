# 47 — Handoff para Codex (2026-06-12)

La pausa del engine multimétodo (Issue #2) se ejecutó y el rumbo quedó definido. **Este doc + `AGENTS.md` (raíz del repo) son tu punto de entrada.**

### Qué cambió desde que dejaste la rama

Tu trabajo NO se perdió: está commiteado y pusheado en `codex/live-intelligence-store` (commits `88989cb..708528c`), estabilizado tras una sesión de debugging real con Takis (fixes de timeout, coding resiliente, guards, SQL — detalle en `98_PROD_READINESS_TRACKER.md`). Dos lentes corrieron end-to-end con Claude real (2,207 findings). Después el negocio pivoteó: **los 16 lentes quedan pausados** (este issue) y la prioridad absoluta es **Signal Pulse**, un reporte táctico marketing-first.

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
