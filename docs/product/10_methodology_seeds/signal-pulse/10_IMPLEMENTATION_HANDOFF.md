# 10 — Handoff para implementación y continuidad de rama

## Objetivo

Implementar Signal Pulse como reporte táctico propio, conectado al corpus vivo, con periodización mensual, Source Wizard, charts Noisia y pantallas navegables reales.

## Trabajo recomendado

### 1. Auditar rama local

Antes de construir, revisar qué existe realmente en working tree:

- migraciones 0025+;
- `canonical_signals`;
- `signal_observations`;
- evidence store;
- `signal_composer_edits`;
- APIs overview/history/monthly-analysis;
- corpus explorer;
- query packs/provenance;
- workers multimétodo;
- wizard multimétodo;
- UI actual de Signal;
- componentes reutilizables;
- routes existentes;
- contracts existentes.

No crear tablas nuevas si la rama local ya tiene equivalentes.

### 2. Congelar enfoque de producto

Pausar expansión de metodologías estratégicas visibles. Mantener infraestructura si aporta, pero reorientar la rama a Signal Pulse.

### 3. Mapear data model

Mapear estos conceptos a tablas existentes o nuevas:

- source connections;
- source datasets;
- source mappings;
- source runs;
- evidence items;
- canonical signals;
- signal observations;
- signal period metrics;
- signal lifecycle;
- chart specs/data refs;
- composer edits;
- published cuts.

### 4. Construir pipeline Signal Pulse

Pipeline:

```text
source ingestion
→ normalization
→ evidence/provenance
→ period aggregation
→ signal detection/canonicalization
→ signal period metrics
→ chart data refs
→ evidence retrieval
→ Claude interpretation
→ quality gates
→ composer
→ published report
```

### 5. Construir navegación

Implementar pantallas:

- Overview;
- Signals;
- Marketing Moves;
- Content & Creative;
- Paid / Organic;
- Competitive & Category;
- Evidence;
- Corpus View;
- Sources;
- Composer;
- Quality / Settings.

No heredar pantallas de T&B.

### 6. Construir Overview primero

Overview debe incluir:

- Executive Signal Read;
- Live/Published state;
- Source/Confidence strip;
- Semantic Signal Galaxy;
- Emotional Density Map;
- Impact × Polarity Priority Map;
- Signal Momentum Stream;
- Top Signals;
- Marketing Moves resumen.

### 7. Implementar pantallas profundas

Después de Overview:

1. Signals.
2. Evidence.
3. Marketing Moves.
4. Composer.
5. Sources.
6. Content & Creative.
7. Paid / Organic.
8. Competitive & Category.
9. Corpus View.
10. Quality / Settings.

El orden puede cambiar según dependencias, pero Evidence y Composer deben llegar temprano para que el reporte no sea solo IA.

## Prompt para Claude/Codex

```text
Estás trabajando en el repo noisia-ai/website. Implementa Signal Pulse usando la spec en docs/product/10_methodology_seeds/signal-pulse/.

Prioridad: construir un reporte táctico de marketing, no una metodología estratégica. No derives el output desde Triggers & Barriers. Reutiliza infraestructura común cuando exista: corpus, canonical_signals, signal_observations, evidence, query provenance, composer, workers, aggregates, charts y published outputs. Si ya existen migraciones locales equivalentes, mapea contra ellas antes de crear nuevas.

El dashboard debe tener estas pantallas reales:
SIGNAL PULSE: Overview, Signals, Marketing Moves.
MARKETING INTELLIGENCE: Content & Creative, Paid / Organic, Competitive & Category.
EVIDENCE & CORPUS: Evidence, Corpus View, Sources.
PUBLISHING: Composer, Quality / Settings.

Construye primero Overview con charts tipo social listening reinventados por Noisia: Semantic Signal Galaxy, Emotional Density Map, Impact × Polarity Priority Map y Signal Momentum Stream. Usa shadcn/ui Chart/Recharts para charts cartesianos y custom SVG/Canvas para Galaxy/Density si es necesario.

El reporte debe conectarse al corpus vivo. No generes snapshot de todo el corpus. Usa periodos mensuales comparables para 3, 6 o 12 meses. SQL/agregados calculan métricas; Claude interpreta; renderer grafica; Composer publica.

Las cards deben ser cortas y humanizadas. No uses lenguaje de consultor. No inventes cifras. No publiques señal sin evidencia, confidence y provenance. Si una recomendación es de CX/Ops/Producto, tradúcela para Marketing como riesgo, no-go o restricción de claim.

Entrega cambios pequeños y verificables. Añade states, permisos, empty states, loading states, error states y quality gates.
```

## Checklist de salida a producción

- navegación final implementada;
- Overview funciona con live data;
- charts tienen data refs;
- signals tienen period metrics;
- lifecycle visible;
- evidence drawer funciona;
- Composer publica corte mensual;
- live vs published diff visible;
- quality gates bloquean publicación cuando corresponde;
- Source Wizard clasifica fuentes;
- paid/organic oculto si no hay data/permisos;
- copy pasa humanizer rules;
- roles respetados;
- tests de API y UI críticos;
- performance aceptable con corpus grande;
- no hay dependencia de T&B output.
