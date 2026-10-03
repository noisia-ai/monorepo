# 45 — Production Cut 1: qué sale a prod primero

> Directiva del negocio: "esto ya se debe ir a prod, ya basta de dar vueltas". Este doc define el primer corte que se publica a un cliente real sin violar ningún principio del paquete: las pantallas sin fuente nacen **gated con `Needs data`** (patrón ya previsto en doc 03), no se eliminan de la visión.

## Alcance del Corte 1

**Fuentes de datos (revisado por directiva del negocio):**
1. **Conversation evidence** — el ingest CSV/SentiOne que YA funciona (con provenance y fan-out) + mapping configurable para CSVs no-SentiOne.
2. **Performance evidence vía archivo (REQUISITO DURO Cut 1)** — un export de 12 meses de Social Media (Meta/TikTok, paid+organic) entra **estructurado** a `performance_records` (doc 44 §2.6) por el Source Wizard: clasificación → mapping de columnas → validación → bulk insert periodizado. JAMÁS como texto de contexto para Claude, JAMÁS como mentions.

Lo único que queda para Cut 2 en fuentes: conectores OAuth/scheduled sync (Meta API, TikTok API, GA4). El camino por archivo es completo y profesional desde el Corte 1.

**Corpus de validación:** Takis (13k menciones, ~4 meses) — ya cargado, ya aprobado, costo cero de adquisición.

### Pantallas

| Pantalla | Corte 1 | Nota |
|---|---|---|
| Overview | ✅ completa | chart-first, los 4 charts en versión v1 |
| Signals | ✅ completa | library + lifecycle + momentum detail + drawers |
| Marketing Moves | ✅ completa | board + cards + aprobación en composer |
| Content & Creative | ✅ parcial | hooks/claims/tone derivan de señales (no requieren performance). Creators si hay author metadata. Sin "format performance" |
| Paid / Organic | ✅ funcional con archivo de performance | dual-axis conversation vs spend (alineación por periodo, sin mapping), campaign alignment table, organic-to-paid candidates, sugerencias semánticas campaña↔señal con confirmación en Composer. Gated solo si el cliente no sube performance |
| Competitive & Category | ✅ si el corpus trae scope competitivo | Takis lo trae (Doritos etc. vía fan-out) |
| Evidence | ✅ completa | packs + counter + authors + provenance |
| Corpus View | ✅ reusa | SignalCorpusExplorer existente, filtros por señal SP |
| Sources | ✅ básica | tabla de fuentes + health + wizard de clasificación sobre CSV ingest |
| Composer | ✅ completa | reusa signal_composer_edits; publish con gates |
| Quality / Settings | ✅ básica | gates table + readiness + override log |

### Charts (orden de implementación por costo/valor)

1. **Impact × Polarity Map** — shadcn/Recharts scatter; el más barato y el que prioriza. Primero.
2. **Signal Momentum Stream** — line/area por señal×mes desde `signal_period_metrics`. Segundo.
3. **Source Coverage Strip** — bar/heat simple. Tercero.
4. **Semantic Signal Galaxy v1** — SVG estático precomputado (layout en worker, zoom/pan, top 80-120 nodos, drawer al click). **Sin física**. Cuarto.
5. **Emotional Density Map v1** — NO es chart separado: es el modo de color "emoción" de la Galaxy (doc 43 G3). Quinto.

Versiones fancy (canvas, física, time-scrubber animado, density real per-mention) = Corte 2, con el producto ya en prod.

### Pipeline

Los 8 steps del doc 44 §3 completos, con: budget cap por corrida (param visible antes de correr), batches resilientes, cost ledger, ANALYZE post-materialización. Objetivo < $5/corrida en Takis.

## Qué NO entra al Corte 1 (explícito, para que nadie lo "adelante")

- Conectores OAuth (Meta/TikTok/Google) y scheduled sync — el camino por ARCHIVO sí entra completo.
- Campaign↔signal mapping 100% automático ("spend by narrative" sin humano) — las sugerencias semánticas + confirmación en Composer SÍ entran.
- Per-mention emotion classification.
- Exports (PDF/deck/briefs) — el deck infra existe, se conecta en Corte 2.
- Galaxy con física/canvas y time-scrubber animado.
- Roles finos Agency/Data Intelligence (v1: cliente vs interno + visibility_config).
- Crisis mode semanal.

## Definición de "en prod" para el Corte 1

1. Migración 0034+ aplicada (report_periods, signal_period_metrics, marketing_moves, chart_aggregates, kind/visibility en published_outputs).
2. Seed `signal-pulse` en methodologies.
3. Corrida completa sobre Takis: 4+ periodos, señales con lifecycle, moves con evidencia, < $5.
4. `/pulse/[outputId]` publicado pasando TODOS los gates (incluido cost_within_budget y no_invented_numbers).
5. Un usuario de Marketing real puede: ver Overview → click señal → leer evidencia → ver el move → entender la limitación. Sin explicación técnica.
6. Checklist de merge a prod del engine (Issue #2) aplicado: migraciones en prod DB, envs, worker redeploy.

## Secuencia de PRs sugerida (cada una shippeable)

1. **PR-1 Data foundation:** migración 0034 (incluye `performance_records` + `data_sources` + `source_sync_runs`, doc 44 §2.6-2.7) + seed + brief SP en wizard + query template `signal-pulse` + steps sp_readiness/sp_periods/sp_cluster/sp_name_signals/sp_metrics + tests de periodización e impact_v1.
1b. **PR-1.5 Performance ingestion:** Source Wizard con clasificación de tipo + mapping configurable de columnas + validación + bulk insert a `performance_records` + source health. Test: export Meta de 12 meses (daily, paid+organic) entra completo, deduplicado y periodizado.
2. **PR-2 Interpretación + gates:** sp_interpret + sp_moves + sp_charts + sp_gates + linter no_invented_numbers + cost cap.
3. **PR-3 UI núcleo:** `/pulse/[outputId]` shell + navegación agrupada + Overview (4 charts v1) + Signals + drawers.
4. **PR-4 Moves + Evidence + Composer:** boards, packs, aprobación, publish.
5. **PR-5 Hardening:** Sources básica, Quality screen, estados vacíos/error en todo, roles, accesibilidad, go-live checklist (doc 35).

## Branch

Crear `codex/signal-pulse` DESDE `codex/live-intelligence-store` (la infra que SP reutiliza vive ahí, no en main). El merge a main al final del Corte 1 lleva todo junto: infra + SP. Los lentes pausados viajan dormidos (sin UI nueva), como dicta el doc 33.
