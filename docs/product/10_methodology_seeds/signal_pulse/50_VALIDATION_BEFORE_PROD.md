# 50 — Qué falta validar antes de prod

> Estado: implementación COMPLETA y auditada (ver `49_FINAL_REVIEW_CODEX.md` + audit de Claude).
> Tests verificados de forma independiente: query-engine 45/45 · workers 41/41 · studio 149/149 · build OK.
> Contrato (decisiones doc 44 §5) verificado contra código: migración exacta, cluster-first sin LLM, performance estructurada, guards de ruta, budget pre-enqueue, impact_v1, auth override bien gateado.
>
> Lo que queda NO es construcción: es validación con realidad. Este doc es el checklist de cierre.

## 1. 🔴 Corrida con datos reales (la única validación dura que falta)

El smoke usa datos sintéticos. Antes de prod, UNA corrida real:

- [ ] Corpus: **Takis** (13k menciones, ya cargado y aprobado — costo de adquisición $0).
- [ ] Subir un **export real de performance de 12 meses** (Meta/TikTok, paid+organic) por el Source Wizard → verificar mapping, validación, dedupe y periodización en `performance_records`.
- [ ] Correr el pipeline SP completo con budget cap visible.

**Criterios de aceptación:**
- [ ] Costo total de la corrida **< $5** (verificar en cost ledger; el forecast `provider='system'` no cuenta como gasto).
- [ ] `sp_metrics` termina en **< 5 minutos** ⚠️ *riesgo conocido: hace 1 query por señal×periodo (N+1). Con 100+ señales × 12 meses pueden ser >1,200 queries secuenciales — el mismo patrón que causó los timeouts del engine. Si excede, batchear esa query ANTES de prod.*
- [ ] Los 9 steps completan sin gates fallidos inesperados.
- [ ] **El test del Brand Manager:** abrir `/pulse/[outputId]` y responder con el reporte real: ¿qué señal merece campaña?, ¿qué claim testear?, ¿qué evitar?, ¿qué evidencia defiende presupuesto? Si las respuestas se sienten genéricas, NO pasa — revisar prompts de `sp_name_signals`/`sp_interpret` antes de seguir.
- [ ] Paid/Organic muestra el cruce conversación×spend por periodo con números que cuadran contra el archivo fuente (muestrear 2-3 meses a mano).

## 2. 🟡 QA visual humano (Codex lo hizo con browser embebido; falta ojo humano)

- [ ] Dashboard `/pulse/[outputId]` desktop y móvil: overflow, textos truncados, charts legibles, copy humanizado (sin "ecosistema conversacional" ni números sueltos sin fuente).
- [ ] Deck `/pulse/[outputId]/deck`: las 6 slides con datos reales (no smoke).
- [ ] **Signal legacy `/signal/5475c314-...`**: 1 minuto — el cambio de CSS del topbar (wrap) tocó también el Signal viejo; verificar que no rompió nada visual.
- [ ] Vistas por rol: cliente NO ve costos, paid data sin permiso, composer, sources ni quality internals (probar con un usuario no-admin real, no solo el override local).

## 3. 🟡 Decisiones de producto pendientes

- [ ] **¿Deck PDF como archivo en Cut 1?** El visual existe; el export a archivo PDF no. Decidir: se entrega por link (`/deck`) o hace falta el PDF descargable ya.
- [ ] Revisar la heurística `engagementNorm = engagement/(volumen×100)` con datos reales — si infla/aplana el impact, ajustar pesos de `impact_v1` (está versionado, es seguro cambiar).

## 4. 🔒 Pre-merge a main

- [ ] Abrir PR `codex/signal-pulse` → `main` (lleva TODO: infra engine + SP).
- [ ] Correr `/code-review` (Claude) sobre el PR.
- [ ] Resolver/aceptar los hallazgos.
- [ ] Borrar los 6 scratch `services/workers/*.mjs` (untracked, debugging viejo) o moverlos a un dir ignorado.

## 5. 🚀 Checklist de deploy (de Issue #2, actualizado)

- [ ] Aplicar migraciones **0025–0034** a la DB de prod (en orden; 0034 es la de SP).
- [ ] Seeds: metodología `signal-pulse` (y los 16 lentes como dormidos).
- [ ] Envs de prod: `ANTHROPIC_API_KEY`, `NOISIA_ENGINE_RUNTIME_ENABLED`, `NOISIA_ENGINE_LLM_ENABLED`, modelo, `ENGINE_RETRIEVE_STATEMENT_TIMEOUT_MS`, budget caps SP.
- [ ] **Verificar que `NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE` y `NOISIA_LOCAL_AUTH_EMAIL` NO existen en ningún env de prod/preview** (el código las bloquea en production, pero defensa en profundidad).
- [ ] Redeploy del worker (Railway) con el código nuevo; verificar UNA instancia y cola de prod (`noisia-engine-analysis`, sin sufijo local).
- [ ] `ANALYZE` post-migración en tablas grandes.
- [ ] Plan de Upstash: confirmar que el tier aguanta la cadencia de corridas de prod (el free se satura).

## 6. ✅ Post-deploy

- [ ] Corrida de humo EN PROD con corpus pequeño y budget cap bajo ($2) antes de abrir a cliente.
- [ ] Publicar el primer corte real y compartir el link `/pulse` con un usuario cliente de prueba.
- [ ] Confirmar analytics/feedback loop registrando (doc 32).

---

**Regla de cierre:** prod se abre cuando §1 y §2 estén ✓ y el PR esté mergeado. §3 puede resolverse en paralelo. Nada de esto requiere construir features nuevas.
