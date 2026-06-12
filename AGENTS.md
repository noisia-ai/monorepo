# Noisia — contexto para agentes (Codex / Claude)

> Actualizado: 2026-06-12. Este archivo es el punto de entrada. Si contradice tu memoria de sesiones anteriores, gana este archivo.

## Prioridad actual: SIGNAL PULSE

La única prioridad de producto es implementar **Signal Pulse** (reporte táctico marketing-first, vivo, mensual-comparable). Los 16 lentes/metodologías del engine multimétodo están **PAUSADOS** — no construir UI nueva sobre ellos, no romperlos ([Issue #2](https://github.com/noisia-ai/website/issues/2)).

## Dónde está todo

- **Spec pack:** `docs/product/10_methodology_seeds/signal_pulse/` (48 archivos).
- **Orden de lectura obligatorio:** `34` → `43` → `44` → `45` → `46` → resto. Los docs 43-46 (auditoría técnica contra la rama real) tienen **precedencia** y contienen decisiones cerradas que no se reabren (44 §5).
- **Handoff completo para implementación:** `docs/product/10_methodology_seeds/signal_pulse/47_CODEX_HANDOFF.md`.
- **Estado del engine pausado + runbook:** Issue #2 y `docs/product/10_methodology_seeds/engine_comparative/98_PROD_READINESS_TRACKER.md`.

## Branches

- `main` = prod. No trabajar directo.
- `codex/live-intelligence-store` = la infra (live intelligence store, workers, composer, corpus vivo) + specs. **Congelada como base.**
- Trabajo nuevo de Signal Pulse: crear `codex/signal-pulse` **desde** `codex/live-intelligence-store` (la infra reutilizable vive ahí, NO en main).

## Reglas duras (lecciones caras ya pagadas)

1. **Costo LLM visible antes de correr** + budget cap como parámetro. Detección de señales = cluster-first (embeddings + clustering en worker; Claude solo nombra/interpreta). Coding por mención como default está prohibido (~$470/corpus vs <$5).
2. **Batches LLM resilientes**: un batch malo se reintenta y se salta; nunca tumba la corrida (patrón en `services/workers/src/workers/engine-step-code.ts`).
3. **SQL calcula, Claude interpreta.** Ningún número visible puede nacer de texto generado.
4. **Performance evidence es ciudadano de primera clase**: archivos de performance (Meta/TikTok 12 meses) entran estructurados a `performance_records` — jamás como mentions ni como "contexto en texto".
5. Tras materializaciones grandes: `ANALYZE`; en queries pesadas: `SET LOCAL statement_timeout`.
6. UNA instancia de worker local (`ps aux | grep preflight.cjs` para detectar zombies).
7. Validación mínima antes de commit: `pnpm --filter @noisia/query-engine test && pnpm --filter @noisia/workers test && pnpm --filter @noisia/studio test` + typechecks.

## Stack

Next.js 15 (apps/studio) + Drizzle/Postgres-Supabase (infrastructure/db) + BullMQ/Upstash workers (services/workers) + paquete query-engine. Workers locales: `pnpm --filter @noisia/workers dev`. Studio: `pnpm --filter @noisia/studio dev` (puerto 3001).
