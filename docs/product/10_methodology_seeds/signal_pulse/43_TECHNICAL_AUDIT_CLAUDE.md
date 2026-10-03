# 43 — Technical audit (Claude, contra la rama real)

> Auditor: Claude (sesión 2026-06-09/12), con conocimiento directo del código de la rama `codex/live-intelligence-store` — incluyendo el schema real (migraciones 0025-0033), los workers, los guards de publicación, el ledger de costos y las fallas de producción ya vividas (Issue #2).
> El audit de GPT (`42_AUDIT_REPORT.md`) valida visión y cobertura conceptual. Este audit valida **implementabilidad**. Son complementarios; este es el que manda para Codex.

## Veredicto

**La visión de producto es excelente y está lista. La capa de implementación NO está lista tal cual: tiene 9 gaps que harían que Codex improvise justo en las partes caras o frágiles.** Los gaps se cierran con los docs `44_DATA_CONTRACT_AND_SCHEMA_MAPPING.md` (contrato de datos contra el schema real) y `45_PRODUCTION_CUT_1.md` (alcance de salida a prod). Con esos dos, el paquete es implementable de verdad.

Lo que el paquete hace muy bien (no tocar):
- Marketing-first con taxonomía de moves y regla de accionabilidad 1-4 semanas (doc 02) — es la mejor parte del paquete.
- "SQL calcula, Claude interpreta" (docs 07/40) — coincide exactamente con la lección más cara que ya pagamos en el engine.
- No-snapshot/corpus vivo (04/09) — coincide con la arquitectura ya construida.
- Los 4 charts reinventados (23-26) tienen pregunta de decisión, interacciones y gates. Bien.
- Decision register con decisiones abiertas explícitas (36). Honesto.

## Gaps críticos y su resolución

### G1 — No existe contrato de datos (bloqueante #1)
El paquete dice "period metrics", "data_ref", "chart spec", "evidence pack" pero **nunca define una tabla, un campo o un endpoint**. Codex tendría que inventar ~6 tablas y 10 APIs adivinando nombres. Además el paquete admite no conocer la rama; ya está commiteada y pusheada, así que eso se cierra ahora.
**Resolución:** `44_DATA_CONTRACT_AND_SCHEMA_MAPPING.md` define qué tablas existentes se reutilizan (son más de las que el paquete cree) y las 5 nuevas con columnas concretas. **Verificado contra el repo: los period buckets NO existen** (0030 solo crea `signal_composer_edits`); son migración nueva.

### G2 — Detección de señales sin algoritmo (bloqueante #2, y el más caro si se improvisa)
El doc 07 dice QUÉ tiene una señal candidata pero no CÓMO se detecta. Hay dos caminos con costos radicalmente distintos:
- **Coding por mención con Claude** (como el engine): ~$0.003/mención → 13k menciones × 12 meses ≈ **$470/corpus**. Inviable como default.
- **Cluster-first**: embeddings (ya existen en el stack, `lib/rag/semantic`) → clustering por ventana en worker → **Claude solo nombra e interpreta clusters** (~50-120 llamadas por corpus) ≈ **<$3/corpus**.
**Resolución:** v1 es **cluster-first obligatorio** (detalle en doc 44 §Pipeline). Per-mention coding queda como refinamiento opcional fase 2 con cap explícito.

### G3 — Emoción sin fuente definida (bloqueante para el Emotional Density Map)
12 familias de emociones por mención = clasificación LLM de todo el corpus (mismo problema de costo que G2). SentiOne trae sentiment, no emociones.
**Resolución:** v1 = **emoción a nivel señal/cluster** (Claude la asigna al interpretar el cluster desde la muestra de evidencia; costo marginal cero). El Density Map v1 colorea clusters por emoción de señal, no por densidad de menciones individuales. Per-mention emotion = fase 2 con clasificador barato si el negocio lo pide.

### G4 — Impact score "abierto" pero Codex necesita un v1
O04 lo deja abierto. Correcto versionarlo, pero sin v1 cada chart queda bloqueado.
**Resolución (impact_v1, versionado en columna):**
```
impact_v1 = 100 × (0.35·volumen_norm + 0.25·engagement_norm + 0.15·recencia
                   + 0.15·diversidad_fuentes + 0.10·consistencia_temporal)
```
Normalización por percentiles dentro de la ventana (no valores absolutos). El multiplicador de confidence NO entra al score (la confianza se muestra aparte, como borde/badge — mezclar ambas oculta información).

### G5 — Semantic Signal Galaxy sin realidad técnica
El doc 23 define semántica visual pero no: dónde se calculan posiciones 2D (UMAP/proyección de embeddings), estabilidad entre meses (los nodos no deben teletransportarse al cambiar de periodo), presupuesto de nodos, ni dónde se persisten los layouts.
**Resolución:** layout **precomputado en worker** (no en el browser), persistido en `chart_aggregates` (doc 44), top 80-120 nodos, posiciones ancladas entre periodos (mismo seed/init por término; solo cambian tamaño/color/presencia). v1 = SVG estático con zoom/pan; física/canvas = fase 2.

### G6 — Paid/Organic y campaign↔signal mapping: sin fuente y sin algoritmo
No existen conectores Meta/TikTok/GA4 hoy. Y "spend by narrative" (mapear pauta a señales) es el problema de datos más difícil del paquete, despachado en una línea.
**Resolución:** Paid/Organic nace **gated** con badge `Needs data` (el patrón ya está en el doc 03 ✓). El mapping campaign↔signal queda spec'd como fase 2: similitud de embeddings entre creative_text y señales + confirmación humana en Composer. No bloquear el go-live por esto.

### G7 — Cero modelo de costos y resiliencia LLM (el paquete fue escrito sin el trauma del Issue #2)
Ninguna mención a: presupuesto por corrida, costo visible ANTES de correr, batches resilientes (un batch malo no puede tumbar el run), ledger de costos, ANALYZE post-ingest, timeouts de statement. Todo eso ya nos costó ~$13 en fallos en el engine.
**Resolución:** el pipeline SP **hereda obligatoriamente** del runtime engine existente: cola BullMQ + orquestador + `engine_cost_events` + patrón de batch retry/skip + `SET LOCAL statement_timeout` + ANALYZE post-materialización. Detalle en doc 44 §Runtime. Gate nuevo de publicación: `cost_within_budget`.

### G8 — Namespace de señales y modelado del run (decisión arquitectónica que el paquete no toma)
`canonical_signals`/`signal_observations` existen pero hoy llevan `methodology_slug` de lentes ('narrative-ownership'...) y `signal_observations.engine_analysis_id`. ¿Las señales SP conviven o se separan? Si Codex no lo decide bien, el dedup cruzará señales SP con señales de lentes pausados.
**Resolución (recomendación firme):** **reutilizar el sustrato**: seed de metodología `signal-pulse` (status beta) + las corridas SP son `engine_analyses` con `methodology_slug='signal-pulse'` y steps propios en la misma cola. Gana gratis: orquestación, estado, cost ledger, locks, `engine_run_mention_map` (drill-down corpus ya resuelto), y los publish guards. El dedup de señales filtra por `methodology_slug='signal-pulse'`. Detalle en doc 44.

### G9 — Sin recorte de salida a prod
El roadmap (33) rechaza la palabra MVP y secuencia A→H completo. Con la directiva del negocio ("esto ya se debe ir a prod, ya basta de dar vueltas"), implementar las 11 pantallas + 4 charts custom + Source Wizard completo antes de publicar = meses.
**Resolución:** `45_PRODUCTION_CUT_1.md` define el corte 1 que sí sale a prod: 8 de 11 pantallas funcionales con fuentes conversacionales existentes, 2 gated con `Needs data`, charts en orden de costo/valor. Sin violar ningún principio del paquete (el doc 03 ya contempla pantallas desactivadas con explicación).

## Gaps menores (resolver durante implementación, no bloquean arranque)

- **M1 Roles:** "Agency" y "Data Intelligence" no existen en el modelo de auth actual (Kinde + primaryRole). v1: mapear a roles existentes (cliente = portal user, interno = admin/manage) + `visibility_config` jsonb en el output para paid/competitive. Migración de roles finos = fase 2.
- **M2 Routing/naming:** "Signal" ya es el producto actual (`/signal/[outputId]`). SP debe vivir como **nuevo kind de output** dentro del shell existente (`published_outputs.kind='signal_pulse'`) con ruta `/pulse/[outputId]`. Reusa auth, share, deck e infraestructura de publicación.
- **M3 Specs de pantalla = template:** las 11 pantallas comparten boilerplate idéntico; lo único específico son listas de nombres de componentes. El contrato por componente vive en doc 44 §APIs para las 3 pantallas críticas (Overview/Signals/Moves); el resto se deriva del patrón.
- **M4 NLP español:** stopwords/lemmatización para términos de la galaxia y etiquetas de emoción en español. Definir lista de stopwords es-MX en el worker de clustering; no usar tokenización inglesa.
- **M5 "no_invented_numbers" sin mecanismo:** enforcement concreto = output estructurado donde campos numéricos solo pueden ser refs a métricas del input + linter de copy que detecta dígitos no presentes en el input (test unitario, mismo patrón que los publish-guard tests existentes).
- **M6 Export (PDF/deck/briefs):** mencionado sin spec. Fase 2 — reusar la infra del Signal Press Deck que ya existe.
- **M7 Plan de tests:** los gates del doc 31 son perfectamente testeables (lista de palabras prohibidas, períodos no comparables, moves sin evidencia). Exigir unit tests para: periodización, impact_v1, dedup, gates, linter humanizer.
- **M8 Edge cases ops:** el doc 41 no incluye los que ya nos pegaron: stats obsoletas de Postgres (ANALYZE), workers zombie, timeouts, pool muerto, límites Upstash. Referencia obligatoria: Issue #2 + `98_PROD_READINESS_TRACKER.md` del engine.

## Correcciones de hechos al paquete

1. **Doc 33** dice "este paquete no puede verificar la rama porque está en local". Ya no: la rama está commiteada y pusheada (`codex/live-intelligence-store`, commits 88989cb..708528c). El gap analysis de la Secuencia A se hace contra `44_DATA_CONTRACT_AND_SCHEMA_MAPPING.md`, que ya lo resuelve en gran parte.
2. **Los period buckets NO existen** en el schema (verificado): la migración 0030 solo crea `signal_composer_edits`. La API `monthly-analysis` existente calcula al vuelo. La tabla de periodos es migración nueva (doc 44).
3. **Lo que SÍ existe y el paquete subestima:** canonical_signals + signal_observations + signal_observation_evidence + dedup + Live Composer con edits persistentes + corpus explorer con facets + publish guards + cost ledger + workers con steps + CSV ingest con provenance. El punto de partida real está más adelante de lo que el paquete asume.

## Orden de lectura corregido para Codex

1. `34_CLAUDE_CODEX_IMPLEMENTATION_PROMPT.md` (visión y no-negociables)
2. **`43_TECHNICAL_AUDIT_CLAUDE.md` (este doc — qué decisiones ya están tomadas)**
3. **`44_DATA_CONTRACT_AND_SCHEMA_MAPPING.md` (el contrato contra el schema real)**
4. **`45_PRODUCTION_CUT_1.md` (qué se construye primero y qué se gatea)**
5. El resto del paquete como referencia por pantalla/chart.
