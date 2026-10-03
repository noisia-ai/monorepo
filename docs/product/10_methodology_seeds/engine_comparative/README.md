# Engine Comparativo Noisia — Familia de Metodologías

> Paquetes de **diseño** (no implementación) para la familia de metodologías comparativas reutilizables del engine Noisia. Todas consumen el mismo modelo base — `corpus + entities + baseline + findings + citations` — y sólo cambian cómo **agrupan, puntúan y visualizan**.
>
> Estos `.md` son specs de diseño hermanas de los YAML de `10_methodology_seeds/`. Los YAML cargan a la tabla `methodologies`; estos definen el qué/cómo antes de codificar.

## Cómo leer esto

1. **Empieza por [`00_FAMILY_FRAMEWORK.md`](00_FAMILY_FRAMEWORK.md)** — el contrato común: modelo base mapeado a tablas reales, el marco de 6 piezas (entity / unit / dimensions / scoring / evidence / output contract), el reparto Voyage (RAG) + Opus (detección) + SQL (scoring), las fuentes de datos (social listening **y** más), el sistema de charting interactivo y el output contract.
2. Luego cada metodología. Todas siguen el mismo template: **Resumen (formato cliente) → Marco técnico → Datos y qué necesita para un resultado real → Voyage+Opus → Diseño de charts (2–3 + conclusiones) → Output contract → Confianza/limitaciones**.

## Índice

| # | Archivo | Metodología | Prioridad |
|---|---|---|---|
| 00 | [`00_FAMILY_FRAMEWORK.md`](00_FAMILY_FRAMEWORK.md) | Marco técnico compartido | — |
| 01 | [`01_tb-comparative-dashboard.md`](01_tb-comparative-dashboard.md) | T&B Comparative Dashboard (existe v1) | Alta |
| 02 | [`02_competitive-wave.md`](02_competitive-wave.md) | Competitive / Market Wave | Alta |
| 03 | [`03_value-perception-matrix.md`](03_value-perception-matrix.md) | VPM Profundo | Alta |
| 04 | [`04_journey-friction-mapping.md`](04_journey-friction-mapping.md) | JFM Completo | Alta |
| 05 | [`05_cultural-codes.md`](05_cultural-codes.md) | Cultural Codes | Media |
| 06 | [`06_influence-architecture.md`](06_influence-architecture.md) | Influence Architecture | Media |
| 07 | [`07_decision-velocity.md`](07_decision-velocity.md) | Decision Velocity | Baja |
| 08 | [`08_sentiment-advocacy-proxy.md`](08_sentiment-advocacy-proxy.md) | Sentiment / NPS Proxy | Alta |
| 09 | [`09_brand-positioning-map.md`](09_brand-positioning-map.md) | Brand Positioning Map | Media |
| 10 | [`10_category-opportunity-map.md`](10_category-opportunity-map.md) | Category Opportunity Map | Media |
| 11 | [`11_competitive-tb-matrix.md`](11_competitive-tb-matrix.md) | Competitive T/B Matrix | Alta |
| 12 | [`12_narrative-ownership.md`](12_narrative-ownership.md) | Narrative Ownership | Alta |
| 13 | [`13_white-space-analysis.md`](13_white-space-analysis.md) | White Space Analysis | Media |
| 14 | [`14_audience-segment-lens.md`](14_audience-segment-lens.md) | Audience / Segment Lens | Media |
| 15 | [`15_trust-risk-benchmark.md`](15_trust-risk-benchmark.md) | Trust & Risk Benchmark | Media |
| 16 | [`16_evidence-confidence-layer.md`](16_evidence-confidence-layer.md) | Evidence Quality / Confidence (transversal) | Alta |
| 99 | [`99_BUILD_SPEC_FOR_CODEX.md`](99_BUILD_SPEC_FOR_CODEX.md) | **Spec de ingeniería build-ready** (DDL, tipos, pipeline, adapter, PRs) | — |

> Para **implementar la infraestructura**: `99_BUILD_SPEC_FOR_CODEX.md` (ya implementado por Codex como migración `0025` + pipeline `engine_*`).
> Para **el render en /signal + Composer + query packs**: **`97_SIGNAL_RENDER_AND_COMPOSER_SPEC.md`** — las 7 cosas por método (señales, query packs, clasificación, charts/módulos, Composer, qué se publica, pruebas), con el estado real del build y el close-the-gap. **Este es el doc activo de trabajo.**
> Los `.md` 01–16 son la referencia de diseño (marco de 6 piezas, charts, output contract) que ambos specs parametrizan.

## Principios de toda la familia

- **Reusable, no monolítico.** Una migración (`engine_findings` / `engine_codings` / `engine_finding_citations` con `dimensions jsonb` + `methodology_slug`) sirve a todas. T&B se mantiene como está y se adapta al mismo contrato.
- **Opus interpreta, SQL puntúa, Voyage recupera.** A Opus nunca se le pide contar; los números del dashboard son SQL reproducible.
- **Multi-fuente real.** Social listening + reviews + transcripts de soporte + encuestas + editorial + PDFs, vía `mentions` y `brand_knowledge_sources`. Cada metodología declara su `source_mix` mínimo.
- **Honestidad de evidencia.** Cada conclusión liga a citas; cada chart lleva su confianza; lo que falta se lista en `limitations[]`. La capa #16 es obligatoria antes de publicar.
- **Charts interactivos con drill-to-evidence.** Hover = cita, click = drawer de posts. 2–3 charts + bloques de conclusión por metodología.

## Siguientes pasos sugeridos (cuando se pase a build)

1. Validar prioridades y el orden de implementación con negocio.
2. Diseñar la migración `engine_*` y el adaptador que expone T&B en el contrato común.
3. Extender el banco de bloques de charting (`02_METHODOLOGIES_CATALOG.md` §4) con: `wave_plot`, `bubble_field`, `stacked_share`, `diverging_bar`, `confidence_badge`.
4. Definir prompts Opus por metodología (los seeds que hoy están `pending`).
</content>
</invoke>
