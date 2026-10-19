# 97 · Signal Render & Composer — Contrato por método

> **Qué responde este doc.** Por cada metodología, las 7 cosas que pediste:
> 1) qué señales genera (con el corpus real de stage) · 2) qué query packs necesita · 3) cómo clasifica menciones · 4) qué charts/módulos produce · 5) cómo entra al Composer · 6) qué se publica en Signal · 7) qué pruebas debe pasar.
>
> **Por qué existe.** Codex ya construyó **toda la arquitectura** del engine (tablas `engine_*`, pipeline de 6 steps, 15 specs, scorers, lentes, cost ledger, quality gates). Lo que falta — y se siente como "no avanzó en cómo se renderiza en /signal" — es que **el contenido por método es genérico/placeholder**: el `synthesize` step sólo escribe un headline, y `build.ts` arma un `engine_block` con vistas genéricas (`pending_engine`). Este doc define el contenido real por método para reemplazar los placeholders.

---

## A. Estado real del build (verificado en la rama `codex/live-intelligence-store`)

| Capa | Estado | Evidencia |
|---|---|---|
| Tablas `engine_analyses/findings/codings/finding_citations/pipeline_steps` | ✅ hecho | `migrations/0025_engine_methodologies.sql` |
| `published_outputs.engine_analysis_id` + CHECK XOR con `tb_analysis_id` | ✅ hecho | `0025` |
| Pipeline workers `engine-step-{preflight,retrieve,code,score,synthesize,quality_gates}` | ✅ hecho | `services/workers/src/workers/engine-step-*.ts` |
| 15 specs `methodologies/<slug>.ts` + `registry.ts` | ✅ hecho | `packages/query-engine/src/methodologies/` |
| Scorers por método (`NarrativeOwnershipScore`, `SentimentAdvocacyScore`, `TrustRiskScore`, `ValuePerceptionScore`, `JourneyFrictionScore`…) | ✅ tipos+lógica | `engine-aggregation.ts` |
| Lentes seleccionables + `composer_modules` + `query_pack_required` | ✅ 6 lentes | `analysis-plan.ts` `STUDY_LENS_OPTIONS` |
| `study_corpora.analysis_plan` jsonb | ✅ hecho | `0031_study_analysis_plan.sql` |
| Composer UI + Live Composer + monthly cut | ✅ hecho | `SignalComposer.tsx`, `live-intelligence/monthly-cut.ts`, `0030_monthly_cut_and_composer.sql` |
| `EngineMethodologyBlock` / `EngineChart` / `EngineMethodologyView` en payload | ✅ tipos | `contracts.ts` |
| Render `EngineMethodologyPanel` + módulo `engine_methodology` en /signal | ✅ existe | `app/signal/[outputId]/page.tsx:206-223` |
| **Contenido por método (señales→charts) en synthesize** | 🔴 **stub** | `engine-step-synthesize.ts` sólo escribe headline+confidence_mix |
| **`engine_block` con charts method-specific** | 🟡 **placeholder genérico** | `build.ts` `engineViewSpecs` (`primaryDimension/secondaryDimension`), `value_axis:"pending_engine"` |
| Query packs por lente (captura/atribución requerida) | 🟡 declarado, no especificado | `lens_configs.query_pack_required:true` |

**Conclusión:** el cableado de extremo a extremo existe; falta el **contrato semántico por método** que convierte `engine_findings` en charts y conclusiones reales. Eso es lo que define §C.

---

## B. Definiciones compartidas (cómo funcionan hoy, con refs)

### B.1 Señales (`engine_findings`)
Una "señal" = una fila en `engine_findings` tras `engine-step-score`: `finding_key`, `entity_id`, `unit_kind`, `dimensions jsonb` (los ejes del método), `frequency`, `intensity`, `sentiment`, `share_pct`, `ownership`, `differentiation_index`, `confidence` (de `evidenceConfidence`). **Todos los números los pone SQL**, nunca Opus.

### B.2 Query packs
Un **query pack** = el conjunto de captura + atribución que el lente necesita para tener señal real. Hoy vive como `analysis_plan.lens_configs[slug].query_pack_required` y la atribución por entidad en `import_batches` (`entity_kind`, `corpus_entity_id`, `competitor_id`). Por método, este doc define **qué debe traer el pack** (entidades, fuentes, ventana, metadata). Sin el pack, el lente degrada a `directional`/`insufficient_evidence` (campo `readiness` de `EngineMethodologyView`).

### B.3 Clasificación de menciones
`engine-step-retrieve` (Voyage top-k por dimensión/entidad) → `engine-step-code` (1 call Opus por batch, modelo `ANTHROPIC_MODEL_ENGINE`/Opus) usando `spec.buildCodingPrompt` → filas en `engine_codings` con `labels.dimensions`, `intensity`, `span`. **Regla dura ya implementada**: si la unidad no tiene señal, `ambiguous=true` + `finding_key="insufficient_signal"` (`shared.ts`).

### B.4 Charts / módulos
`EngineChart.type` permitido (cerrado, `contracts.ts:14`): `matrix_2x2, wave_plot, heatmap, force_graph, radial, radar, scatter_effort_impact, bar_ranking, diverging_bar, gauge, timeline, waterfall, stacked_share, bubble_field, sankey_flow, evidence_list, tension_card, confidence_badge`. Cada `spec.charts` declara cuáles produce. El render genérico es `EngineMethodologyPanel`; **falta** un renderer por `type` (hoy se dibuja la `EngineMethodologyView` tabular, no los charts).

### B.5 Composer
Dos niveles: (a) **lens composer modules** (kebab, en `STUDY_LENS_OPTIONS[].composerModules`, p.ej. `narrative-ownership`, `competitive-intelligence`, `live-composer`); (b) **SignalModuleKey** (snake, en `manifest.ts`, p.ej. `engine_methodology`, `live_composer`, `competitive_tb_matrix`) que `SignalComposer.tsx` togglea y `/signal` renderiza. **Falta el mapeo explícito** lens-module→SignalModuleKey (§C lo fija por método).

### B.6 Publicación en Signal
`build.ts` → `buildEngineSignalPayload()` arma `SignalPayloadV2.engine_block` desde `engine_findings`; se guarda en `published_outputs.payload` con `engine_analysis_id` set (XOR con `tb_analysis_id`). `/signal/[outputId]` lee el manifest y renderiza `engine_methodology` si `viewModel.engineBlock` existe.

### B.7 Corpus de stage (para ejemplos reales)
Estudio **Telefonía Móvil México** (`study_corpus 7dea09ac…`), entidades atribuidas: **Telcel** (~33K), **Movistar** (~30K), **AT&T**, **OUI** (~6). ~160K menciones, multi-plataforma (`resolved_platform`/`content_type` materializados). Los ejemplos de "señal" abajo usan este corpus.

---

## C. Las 7 cosas, por método

> Orden: primero los **6 lentes activos** (full depth, son los que rinden ya), luego los **9 en shadow** (compactos: spec existe, falta lente+render).

### Convención de cada ficha
`Señales` = filas `engine_findings` (dims) · `Query pack` = captura/atribución mínima · `Clasificación` = qué codifica Opus · `Charts/módulos` · `Composer` (lens-module → SignalModuleKey) · `Publica` (forma en `engine_block`) · `Pruebas`.

---

### 1. Triggers & Barriers (`triggers-barriers`) — PRIMARIO, runtime `tb_pipeline`
- **Señales:** findings T&B (`tb_findings`): polarity×layer, `score_compuesto`, `movilidad`, ownership (marca/competencia/categoría). Ej: barrier "cobranza/cargos no reconocidos" estructural, ownership categoría; trigger "cobertura" owned por Telcel.
- **Query pack:** corpus 800–5000, ≥3 fuentes, window ≤9m, **atribución marca+competencia+industria** en `import_batches`. (Ya lo exige el wizard.)
- **Clasificación:** pipeline T&B existente (steps 1–6). No usa `engine_codings`.
- **Charts/módulos:** decision field (`tb_decision_field_nodes`), comparative dashboard, action studio. Módulos `tb_decision_field`, `tb_comparative_dashboard`, `competitive_tb_matrix`, `competitive_intelligence`.
- **Composer:** `overview, tb-decision-field, opportunities, evidence, quality-boundaries` → SignalModuleKeys homónimos. **Locked/required.**
- **Publica:** camino T&B actual (`tb_analysis_id` set, `engine_block:null`). **Sin cambios.**
- **Pruebas:** snapshot del payload T&B idéntico (no regresión); `build.test.ts`.

---

### 2. Narrative Ownership (`narrative-ownership`) — lente recomendado, default ON
- **Señales:** por (narrativa × entidad): `share_pct`, `ownership` (`owned/shared/insufficient_evidence`), `differentiation_index`, `valence`. Ej real: narrativa **"letra chica / cargos ocultos"** → owner **Telcel** share 0.49 valence negativa (activo tóxico); **"precio sin trucos"** → owner **AT&T**, positiva. `NarrativeOwnershipScore` ya calcula `dominant_share_pct`, `dominant_entity_id`, `ownership_decision`.
- **Query pack:** `requiresCompetitors:true`, `minMentionsPerEntity:150`. Necesita ≥2 entidades atribuidas + categoría. Fuentes: social + reviews + editorial (narrativas completas).
- **Clasificación:** Opus asigna `{narrative (texto emergente), valence ∈ positiva|negativa|neutra}` + intensity + span (`narrative-ownership.ts`). Narrativa **emerge del corpus**, no taxonomía impuesta (gate `narrative_emergent_not_imposed`).
- **Charts/módulos:** `stacked_share` (narrativa→entidades), `matrix_2x2` (ownership×valencia), `bar_ranking` (narrativas huérfanas). `engineViewSpecs` ya: primary `narrative`, secondary `valence`, risk=`negativa`, opportunity=`positiva`.
- **Composer:** `live-composer, narrative-ownership, competitive-intelligence` → `engine_methodology` + `competitive_intelligence` + `live_composer`.
- **Publica:** `engine_block.kind="narrative_ownership"`; `methodology_view.conclusions` con kinds `protect` (activo propio positivo), `dispute` (narrativa del competidor), `watch` (negativa propia). `owned_negative` ⇒ conclusion `watch` obligatoria (gate `owned_negative_flagged`).
- **Pruebas:** `engine-methodologies.test.ts` (dimensiones), `engine-scoring.test.ts` (ownership en bordes 0.55/35%), gate owned_negative dispara watch; view `readiness=insufficient_evidence` si <2 entidades.

---

### 3. Value Perception Matrix (`value-perception-matrix`) — lente beta
- **Señales:** por celda (beneficio × costo × entidad): `value_ownership_share`, `value_score`, `whitespace_candidate`, `declared_vs_perceived:"perceived"` (`ValuePerceptionScore`). Ej: Telcel posee beneficio **funcional** (cobertura), AT&T **económico**; whitespace candidate en **emocional** si nadie lo ocupa.
- **Query pack:** `requiresCompetitors:true`, ≥2 marcas con balance ≥30%, `minMentionsPerEntity` alto; verbatims de percepción (reviews/encuestas), no sólo social.
- **Clasificación:** Opus asigna `{value_benefit ∈ funcional|emocional|social|aspiracional|economico, value_cost ∈ monetario|tiempo|cognitivo|social}` + intensity. `minimumDistinctSignals:4`.
- **Charts/módulos:** `matrix` 4×N (firma), `radar` por marca, `whitespace_overlay` (usa `bubble_field`). 
- **Composer:** `live-composer, value-perception, opportunities` → `engine_methodology` + `opportunities`.
- **Publica:** `engine_block.kind="value_perception_matrix"`; whitespace sólo se afirma con `whitespace_status="candidate_requires_absence_evidence"` resuelto (gate de evidencia de ausencia).
- **Pruebas:** balance ≥30%/marca (si no, `readiness=directional`); cada celda con ≥1 cita; whitespace no se publica sin evidencia de ausencia.

---

### 4. Journey Friction Mapping (`journey-friction-mapping`) — lente beta
- **Señales:** por (fase × tipo de fricción × entidad): `choke_score = frequency·intensity`, `removability`, blocker/accelerator. Ej telecom: fase **portabilidad/cambio de compañía**, fricción **effort** (trámite NIP) = choke #1.
- **Query pack:** corpus de journey real (foros troubleshooting, soporte, Q&A); window 6–9m. `minimumDistinctSignals:4`. Soporta single-entity si no hay competencia.
- **Clasificación:** Opus `{journey_phase, friction_type ∈ inertia|effort|emotion|reactance, articulable}`. risk=`blocker/effort/trust/access/economic`, opportunity=`accelerator`.
- **Charts/módulos:** `heatmap` fase×tipo, `timeline` del journey, `scatter_effort_impact` (quick wins).
- **Composer:** `live-composer, journey-friction, action-studio` → `engine_methodology` + `action_studio`.
- **Publica:** `engine_block.kind="journey_friction_mapping"`; `conclusions` con `validate` para quick wins; impacto en conversión = **declarado**, etiquetado como tal.
- **Pruebas:** pre-flight de densidad de journey (si pobre → `insufficient_evidence`); cada fricción con fase+tipo; quick wins = effort bajo + impact alto.

---

### 5. Sentiment / Advocacy Proxy (`sentiment-advocacy-proxy`) — lente beta
- **Señales:** por (tema × entidad): `advocacy_proxy = %promoter − %detractor`, `pct_promoter/passive/detractor`, `avg_sentiment`, `driver_share_pct`, `is_survey_nps:false` (`SentimentAdvocacyScore`). Ej: AT&T advocacy +12 vs Telcel −4; complaint driver dominante "atención a cliente".
- **Query pack:** ≥200 menciones/entidad para estabilidad; `mentions.sentiment_score` (proveedor) o proxy Opus. Multi-fuente (reviews+social+soporte).
- **Clasificación:** Opus `{theme, advocacy_class ∈ promoter|passive|detractor, emotional_intensity}`; corrige sarcasmo donde el sentiment automático falla.
- **Charts/módulos:** `diverging_bar` advocacy por entidad, `bar_ranking` drivers, `timeline`/monthly pulse. `engineViewSpecs`: primary `theme`, secondary `advocacy_class`.
- **Composer:** `live-composer, advocacy-proxy, quality-boundaries` → `engine_methodology` + `quality_boundaries`.
- **Publica:** `engine_block.kind="sentiment_advocacy_proxy"` con `is_survey_nps:false` visible; alertas de caída como `watch`.
- **Pruebas:** etiqueta proxy siempre presente; `<200`/entidad ⇒ `directional`; drivers separan advocacy vs complaint.

---

### 6. Trust & Risk Benchmark (`trust-risk-benchmark`) — lente beta
- **Señales:** `trust_score`, `risk_score = severity·frequency·escalating`, `reputational_vulnerability`, `sensitive_risk_requires_evidence` (`TrustRiskScore`). Ej telecom (industria sensible): risk theme **"cargos no autorizados"** escalando, casi exclusivo de una marca = vulnerabilidad #1.
- **Query pack:** fuentes donde vive el riesgo (foros queja, reviews 1–2★, soporte, prensa); ventana temporal para tendencia. `requiresCompetitors` para benchmark.
- **Clasificación:** Opus `{trust_driver | risk_theme, severity ∈ low|high|critical, escalating}`. risk=`critical/high/fraude/abuso/falla/opacidad`, opportunity=`claridad/confiabilidad/resolucion/seguridad`.
- **Charts/módulos:** `matrix_2x2` severidad×frecuencia, `bar_ranking` trust por entidad, `timeline` de escalada.
- **Composer:** `live-composer, trust-risk, competitive-intelligence` → `engine_methodology` + `competitive_intelligence`.
- **Publica:** `engine_block.kind="trust_risk_benchmark"`; no se declara "crisis" sin patrón (gate `sensitive_risk_requires_evidence`).
- **Pruebas:** severidad ponderada (no sólo frecuencia); riesgo sensible exige ≥N citas; vulnerabilidad = riesgo con ownership exclusivo.

---

### 7–15. Metodologías en **shadow** (spec existe, falta exponer como lente + render method-specific)

Estas ya tienen `methodologies/<slug>.ts` + `engineViewSpecs` en `build.ts`, pero **no están en `STUDY_LENS_OPTIONS`** y su render es el genérico. Para activarlas: añadir a `STUDY_LENS_OPTIONS` (con `composerModules`), darles scorer en `engine-aggregation.ts` si no lo tienen, y un renderer de su chart firma.

| # | slug | señales (dims) | query pack | clasificación (Opus) | charts firma | publica kind |
|---|---|---|---|---|---|---|
| 7 | competitive-wave | ejes {resonance, cultural_ownership, sentiment, decision_velocity, differentiation} por entidad | ≥3 entidades atribuidas; consume otros lentes | `{axis, direction}` (`min 4`) | `wave_plot`, `radar` | `competitive_wave` |
| 8 | brand-positioning-map | `{attribute, axis_pole}` por marca; distancia perceptual | ≥2 marcas; ejes en `params` del estudio | `{attribute, axis_pole}` | `matrix_2x2`, `radar` | `brand_positioning_map` |
| 9 | category-opportunity-map | `{need, coverage}`, opportunity_score | baseline categoría (`base_corpus_id`) | `{need, coverage ∈ served|underserved|unserved}` | `bubble_field`, `bar_ranking` | `category_opportunity_map` |
| 10 | competitive-tb-matrix | finding×entidad share+ownership (lee `tb_*`) | T&B previo (coste IA ~0) | — (deriva de codings T&B) | `heatmap`, `diverging_bar` | `competitive_tb_matrix` (módulo ya existe) |
| 11 | white-space-analysis | `{demand, competitive_coverage}`, whitespace_score, brand_permission | demanda+cobertura; puede consumir VPM/narrative | `{demand, competitive_coverage}` | `bubble_field`, `tension_card` | `white_space_analysis` |
| 12 | audience-segment-lens | envuelve otro método partido por `segment`; `segment_skew` | señal de segmento (declarada / `authors` / Opus) | `{segment, metric}` | `heatmap`, `radar` | `audience_segment_lens` |
| 13 | cultural-codes-decoding | `{binary_opposition, code_level, maturity}`, tension_score | texto largo (editorial/foros), window 6–18m | `{binary_opposition, code_level}` | `waterfall`, `tension_card` | `cultural_codes_decoding` |
| 14 | influence-architecture | nodos/comunidades, `{community, node_role, tie_type}`, influence_score, centralidad | `authors` con metadata + `engagement` | `{community, node_role}` | `force_graph`, `sankey_flow` | `influence_architecture` |
| 15 | decision-velocity | `{decision_phase, polarity}`, velocity_index | narrativa de decisión; ideal funnel del cliente | `{decision_phase, cognitive_system, factor}` | `gauge`, `diverging_bar` | `decision_velocity` |
| (16) | evidence-confidence-layer | transversal: `{volume, source_diversity, consistency, recency, citation_quality}` por finding | ninguno (corre sobre findings de otros) | no codifica (deriva de `evidenceConfidence`) | `confidence_badge`, `bar_ranking` | embebido en cada bloque |

---

## D. Lo que falta construir para "renderizar de verdad" (close-the-gap)

Prioridad para Codex, en orden:

1. **`engine-step-synthesize` real (no stub).** Hoy escribe sólo headline+confidence_mix. Debe, por `methodology_slug`, leer `engine_findings` + sus scorers (`engine-aggregation.ts`) y persistir en `engine_analyses.meta_json.engine_block` el **`EngineMethodologyBlock` completo** (charts con `type` real + `data` + `evidence_ids`, `methodology_view`, `conclusions`, `limitations`). `build.ts` debería **leer ese block** en vez de re-derivar vistas genéricas.
2. **Renderer de charts por `type`** en el lado Signal: un componente por cada `EngineChart.type` que `EngineMethodologyPanel` despacha (hoy sólo dibuja la vista tabular). Empezar por los 3 de Narrative Ownership (`stacked_share`, `matrix_2x2`, `bar_ranking`) como referencia.
3. **Mapeo lens-module → SignalModuleKey** explícito (tabla en cada ficha §C arriba) + alta de las keys faltantes en `manifest.ts`/`signalModuleMeta` (p.ej. `narrative_ownership`, `value_perception`, `journey_friction`, `advocacy_proxy`, `trust_risk`) para que `SignalComposer` las togglee y `/signal` las pinte.
4. **Query pack por lente** materializado: que el wizard de estudio, al seleccionar un lente, exija/valide su pack (entidades, fuentes, ventana, metadata de autores para influence). Hoy `query_pack_required:true` es flag; falta la validación.
5. **Exponer los 9 shadow** como `STUDY_LENS_OPTIONS` cuando su scorer+chart estén listos (no antes — evita lentes vacíos).
6. **Quality gate de publicación:** `engine-step-quality-gates` debe bloquear `engine_block` con findings sin cita o sin confidence (gates universales) y registrar `readiness` en la view.

---

## E. Pruebas que debe pasar el conjunto (resumen accionable)

- **Unit** (`engine-scoring.test.ts`, `engine-methodologies.test.ts`): scorers en bordes; cada spec produce dimensiones válidas; `insufficient_signal` se respeta.
- **Aggregation:** dado un set de `engine_codings` fixture, `engine-aggregation` produce el `EngineMethodologyBlock` esperado por método (charts con `type` correcto, conclusions con kinds correctos).
- **Build/payload** (`build.test.ts`): `engine_block` se serializa; T&B sigue con `engine_block:null` (no regresión); `evidence_ids` resuelven a menciones reales.
- **Plan** (`analysis-plan.test.ts`): selección de lentes → `composer_modules` correctos; primario T&B siempre presente y locked.
- **Pipeline e2e** (stage corpus Telefonía MX): `narrative-ownership` corre `preflight→quality_gates`, deja `needs_review`, publica un `engine_block` con ≥3 narrativas, cada una con cita; sin competencia ⇒ `readiness=insufficient_evidence` + limitations.
- **Cost** (`engine-cost.test.ts`): el code-step respeta batch size y registra en `engine_cost_ledger` (`0029`).
- **Render**: `EngineMethodologyPanel` pinta los charts del block sin romperse ante data parcial (`{}`).

---

## F. Para Codex — orden de trabajo

1. Implementar **§D.1** (synthesize real) + **§D.2** (renderer de charts) usando **Narrative Ownership** como vertical de referencia, con el corpus de stage Telefonía MX.
2. Cerrar **§D.3** (módulos Composer) para que el lente se vea en /signal.
3. Repetir para los otros 5 lentes activos (sentiment, trust-risk, VPM, JFM).
4. Luego §D.4 (query packs) y §D.5 (exponer shadow).
5. Verde en §E antes de publicar a Signal.

Referencias de diseño por método: archivos `01`–`16` de esta carpeta (marco de 6 piezas, charts, output contract). Este doc (`97`) es el contrato de **render/Composer/publish**; el `99_BUILD_SPEC_FOR_CODEX.md` es el de **infraestructura** (ya implementado).
</content>
</invoke>
