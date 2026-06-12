# Signal Pulse — paquete de definición product/design

Este folder define **Signal Pulse**, un reporte táctico de marketing para Noisia. Está escrito como contexto product/design para Claude, Codex o el equipo interno antes de tocar implementación.

Signal Pulse no es una metodología estratégica más. Es una capa táctica viva que convierte conversación, performance, contexto y evidencia en señales accionables para Marketing: contenido, pauta, narrativa, claims, creators, competencia, presupuesto y riesgo.

## Qué problema resuelve

Noisia ya puede generar análisis estratégicos profundos, pero esos reportes pueden ser difíciles para equipos de Marketing que necesitan decidir rápido qué hacer con una señal viva. Signal Pulse baja la inteligencia del corpus a decisiones mensuales, visuales y accionables.

El usuario principal no es CX, Producto ni Retail Ops. El usuario principal es Marketing, agencias y Data Intelligence orientado a marketing.

## Principios no negociables

1. **Marketing-first.** Las recomendaciones deben ser movibles por Marketing: amplificar narrativa, testear claim, briefear creators, ajustar pauta, crear contenido, evitar territorio, defender presupuesto o monitorear.
2. **Pipeline propio.** Signal Pulse no se genera transformando JSON de Triggers & Barriers ni adaptando outputs estratégicos. Reutiliza infraestructura, no outputs.
3. **Corpus vivo.** El reporte no guarda una foto estática de toda la data. Guarda configuración, cortes editoriales, referencias a señales, chart specs, evidence refs y decisiones curadas conectadas a agregados vivos.
4. **Mes a mes.** Un setup de 12 meses se analiza como 12 cortes comparables; uno de 6 como 6; uno de 3 como 3. El sistema detecta nacimiento, longevidad, picos, persistencia, saturación, caída y reactivación de señales.
5. **Charts con historia.** El Overview incluye visualizaciones familiares de social listening reinventadas por Noisia: Semantic Signal Galaxy, Emotional Density Map, Impact × Polarity Priority Map y Signal Momentum Stream.
6. **Pocas pantallas, no mil módulos.** Las secciones del dashboard son pantallas navegables. Cada pantalla agrupa componentes relacionados. No cada idea se convierte en tab.
7. **Copy humano.** Cards cortas, sin lenguaje inflado de IA, sin consultoría vacía, sin párrafos largos.
8. **Evidencia trazable.** Toda señal y movimiento debe abrir evidencia, confidence, provenance y limitaciones.
9. **Source Wizard futuro.** El sistema debe quedar listo para integrar nuevas fuentes: listening exports, Apify, Meta, Birdeye, Google Reviews, archivos de entidades, briefs y otros proveedores.
10. **Producción responsable.** Claude interpreta; SQL/agregados calculan; el renderer grafica; humanos curan y publican.

## Navegación final

```text
SIGNAL PULSE
  Overview
  Signals
  Marketing Moves

MARKETING INTELLIGENCE
  Content & Creative
  Paid / Organic
  Competitive & Category

EVIDENCE & CORPUS
  Evidence
  Corpus View
  Sources

PUBLISHING
  Composer
  Quality / Settings
```

## Archivos del paquete

- `01_CONTEXT_AND_DECISIONS.md`: cómo llegamos a esta decisión y qué queda en pausa.
- `02_NAVIGATION_AND_SCREENS.md`: pantallas reales del dashboard y componentes dentro de cada una.
- `03_LIVE_CORPUS_AND_PERIODIZATION.md`: conexión viva al corpus, cortes mensuales y lifecycle de señales.
- `04_SOURCE_WIZARD_AND_EVIDENCE.md`: fuentes, conectores, evidence types, mappings y provenance.
- `05_PIPELINE_AND_OUTPUT_CONTRACT.md`: pipeline propio, contrato de output y reglas para Claude/SQL/renderer.
- `06_OVERVIEW_SCREEN_CHARTS.md`: Overview y charts social listening reinventados por Noisia.
- `07_SCREEN_SPECS.md`: definición detallada de todas las pantallas navegables.
- `08_FILTERS_INTERACTIONS_STATES.md`: filtros globales, drawers, live/published/compare, states y permisos.
- `09_COPY_UI_CHARTS_QUALITY.md`: reglas de copy, UI, charts, accessibility y quality gates.
- `10_IMPLEMENTATION_HANDOFF.md`: plan de desarrollo, continuidad de rama y prompt para Claude/Codex.
- `manifest.json`: índice estructurado del paquete.

## Definición de listo

Este paquete está listo para implementación cuando el equipo puede responder sin ambigüedad:

- qué pantallas existen;
- qué vive dentro de cada pantalla;
- qué fuentes puede leer el sistema;
- cómo se conecta al corpus vivo;
- cómo se calculan periodos mensuales;
- qué charts se renderizan;
- qué filtros afectan cada vista;
- qué escribe Claude y qué calcula SQL;
- qué se guarda como corte editorial;
- qué ve cliente vs interno Noisia;
- qué bloquea publicación.
