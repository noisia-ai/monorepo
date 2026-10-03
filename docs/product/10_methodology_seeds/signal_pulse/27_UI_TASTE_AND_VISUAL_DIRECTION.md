# 27 — UI direction: Noisia taste

## Propósito

Definir la dirección visual y de interacción de Signal Pulse para que se sienta como Noisia, no como dashboard SaaS genérico.

## Principio visual

Signal Pulse debe sentirse como una sala de inteligencia premium para Marketing: oscuro, preciso, visual, editorial, con charts vivos y cards muy contenidas.

No debe sentirse como:

- Excel con cards;
- dashboard de social listening de 2018;
- deck convertido a web;
- tabla infinita con badges;
- UI genérica de componentes shadcn sin dirección visual.

## Inspiración de Taste Skill

Tomar como guía la intención del Taste Skill: evitar layouts aburridos, densidad plana y UI sin criterio. Usar jerarquía visual, ritmo, contraste, detalle y microinteracciones con intención.

## Arquitectura visual

### Header del reporte

Debe mostrar:

- nombre del reporte;
- marca/tema;
- periodo;
- live/published/draft;
- source freshness;
- confidence;
- filtros principales;
- acciones: share/export/publish según rol.

### Sidebar

Agrupado por:

- SIGNAL PULSE;
- MARKETING INTELLIGENCE;
- EVIDENCE & CORPUS;
- PUBLISHING.

Cada item puede tener badges:

- warning;
- new;
- stale;
- internal;
- locked;
- needs data.

### Cards

Cards compactas, no ensayos.

Estructura ideal:

- badge de estado;
- title corto;
- 1 lectura;
- 1 métrica o sparkline;
- 1 acción;
- evidence/confidence footer.

### Charts

Charts con espacio para respirar, sin leyendas innecesarias, tooltips ricos y drill-down claro.

### Drawers

Drawers deben ser la profundidad. No saturar pantalla principal con todo.

Drawer estándar:

- título;
- contexto;
- chart mini;
- evidencia;
- actions;
- provenance;
- limitations.

## Densidad de información

| Nivel | Densidad |
|---|---|
| Overview | baja-media, muy visual |
| Signals | media-alta |
| Evidence | alta, exploratoria |
| Sources/Quality | alta, técnica interna |
| Composer | media, editorial |

## Motion

Usar movimiento sutil para:

- cambio de periodo;
- actualización live;
- expansión de clusters;
- filtros aplicados;
- publish success;
- warnings.

No usar motion decorativo. Debe explicar cambio o continuidad.

## Color

La UI debe usar el sistema visual actual de Noisia. Para charts:

- polaridad no depende solo de color;
- emoción puede usar paleta consistente;
- confidence puede usar borde/patrón;
- source puede usar icono/badge;
- estado de señal usa badges.

## Copy en UI

- Corto.
- Concreto.
- Sin jerga de IA.
- Sin “insights accionables” como muletilla.
- Sin párrafos largos en cards.
- Explicar warnings con honestidad.

## Layout de Overview recomendado

```text
Header
Executive Signal Read + KPI strip
Semantic Signal Galaxy | Impact × Polarity Map
Signal Momentum Stream
Top Signals / Marketing Moves compactos
Coverage + confidence footer
```

## Mobile / responsive

Aunque Studio probablemente se use en desktop, debe degradar bien:

- sidebar collapsible;
- charts apilados;
- drawers full-screen;
- tables convertidas a cards;
- filters en sheet;
- no depender de hover para información crítica.

## Regla final

Signal Pulse debe sentirse como producto de inteligencia, no como dashboard de métricas. Debe tener presencia visual suficiente para que Marketing quiera enseñarlo en una reunión.
