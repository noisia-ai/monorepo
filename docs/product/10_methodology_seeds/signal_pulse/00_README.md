# Noisia Signal Pulse — Production Spec Pack

Fecha: 2026-06-12

Este paquete define el reporte táctico **Signal Pulse** como si tuviera que salir a producción usando únicamente estas especificaciones. No contiene código. Es un paquete de producto, UX, data story, arquitectura funcional, quality gates y handoff para que Claude, Codex o el equipo interno continúen la rama actual sin depender de decisiones implícitas.

## Qué es Signal Pulse

Signal Pulse es un dashboard táctico para equipos de Marketing, agencias y Data Intelligence. Convierte conversación, performance, contexto y evidencia en señales vivas que ayudan a decidir qué narrativa activar, qué contenido crear, qué pauta ajustar, qué claim testear, qué territorio evitar y qué presupuesto defender.

No es un reporte genérico de social listening. No es un output estratégico como Triggers & Barriers. No es una conversión de JSON de metodologías existentes. Es un proceso propio, conectado al corpus vivo, con cortes mensuales comparables y pantallas navegables específicas.

## Principios no negociables

1. **Marketing-first.** El usuario primario es Marketing, no CX, Producto, Retail Ops ni Investigación estratégica.
2. **Pipeline propio.** Signal Pulse no debe salir de convertir outputs de Triggers & Barriers ni de metodologías estratégicas.
3. **Corpus vivo, no foto.** El reporte guarda configuración, decisiones editoriales, referencias, chart specs y evidencia; los datos viven conectados a agregados del corpus.
4. **Mes a mes.** Un análisis de 12 meses produce 12 cortes comparables; uno de 6 produce 6; uno de 3 produce 3. Nunca se analiza solo como bolsa total.
5. **Charts con historia.** El Overview incluye charts familiares para marketers, reinventados por Noisia: Semantic Signal Galaxy, Emotional Density Map, Impact × Polarity Priority Map y Signal Momentum Stream.
6. **Copy humano y breve.** Las cards no son ensayos. Las conclusiones se escriben con estilo directo, sin prosa de IA ni consultoría inflada.
7. **Evidencia trazable.** Toda señal, movimiento y recomendación tiene evidencia, confidence, source provenance y limitaciones.
8. **Source Wizard futuro.** El sistema debe soportar nuevas fuentes sin rehacer la arquitectura.
9. **Pantallas reales.** Las secciones del dashboard son pantallas navegables; los componentes viven dentro de ellas. No convertir cada idea en una pestaña.
10. **Pausar expansión estratégica.** Para esta rama, enfocar energía en Signal Pulse y dejar las demás metodologías como infraestructura/soporte, no como objetivo de producto.

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

## ⚠️ Addendum de auditoría técnica (2026-06-12)

Este paquete fue auditado contra la rama real (`codex/live-intelligence-store`). Tres docs nuevos cierran los gaps de implementabilidad y **tienen precedencia** sobre cualquier ambigüedad del resto del paquete:

- `43_TECHNICAL_AUDIT_CLAUDE.md` — veredicto, 9 gaps críticos resueltos, decisiones cerradas.
- `44_DATA_CONTRACT_AND_SCHEMA_MAPPING.md` — tablas/columnas/APIs concretas contra el schema existente.
- `45_PRODUCTION_CUT_1.md` — alcance del primer corte que sale a prod y secuencia de PRs.
- `46_INSIGHTS_MANAGER_JOURNEY.md` — journey end-to-end validado contra el código; cierra brief, queries, fuentes y deck.

Codex: lee `34` → `43` → `44` → `45` → `46` antes que el resto.

## Cómo usar este paquete

Leer en este orden:

1. `01_EXECUTIVE_CONTEXT_DECISIONS.md`
2. `02_PRODUCT_PRINCIPLES_MARKETING_FIRST.md`
3. `03_NAVIGATION_MODEL_DASHBOARD_SECTIONS.md`
4. `04_LIVE_CORPUS_ARCHITECTURE.md`
5. `05_SOURCE_WIZARD_CONNECTORS.md`
6. `07_SIGNAL_PULSE_PIPELINE_OWN_PROCESS.md`
7. `08_MONTHLY_PERIODIZATION_LIFECYCLE.md`
8. Specs de pantallas: `11_` a `21_`
9. Charts: `22_` a `26_`
10. Producción: `31_`, `33_`, `35_`
11. Prompt final: `34_CLAUDE_CODEX_IMPLEMENTATION_PROMPT.md`

## Estructura del paquete

Cada pantalla está documentada con: propósito, preguntas de usuario, layout, componentes, charts, filtros, interacciones, drawers, conexión al corpus vivo, estados, quality rules, copy rules y criterios de aceptación.

Cada chart está documentado con: pregunta que responde, datos requeridos, agregación, interacción, tooltip, drill-down, estados y decisión de implementación visual: `shadcn/ui Chart` cuando encaja; componente custom cuando necesita semántica espacial o interacción avanzada.

## Referencias externas de diseño

- shadcn/ui Chart: `https://ui.shadcn.com/docs/components/radix/chart`
- Humanizer skill: `https://github.com/alexdcd/Mafia-Claude-Skills/tree/main/skills/humanizer`
- Taste skill: `https://github.com/Leonxlnx/taste-skill/tree/main`

## Definición de listo

Este paquete está listo para implementación cuando el equipo puede responder sin ambigüedad:

- Qué pantallas existen.
- Qué vive dentro de cada pantalla.
- Qué fuentes puede leer el sistema.
- Cómo se conecta al corpus vivo.
- Cómo se calculan periodos mensuales.
- Qué charts se renderizan.
- Qué filtros afectan cada vista.
- Qué escribe Claude y qué calcula SQL.
- Qué se guarda como corte editorial.
- Qué ve cliente vs interno Noisia.
- Qué bloquea publicación.
