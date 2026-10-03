# 22 — Chart system and Noisia chart families

## Principio

Los charts de Signal Pulse deben dar a Marketing una sensación familiar de social listening, pero con inteligencia Noisia: contexto semántico, emoción, lifecycle, evidencia, confidence y acción.

No copiar charts genéricos. Reinterpretarlos.

```text
Social listening clásico → Noisia Signal Pulse
Wordcloud → Semantic Signal Galaxy
Sentiment chart → Emotional Density Map
Volume vs sentiment → Impact × Polarity Priority Map
Trend timeline → Signal Momentum Stream
```

## Uso de shadcn/ui Chart

Usar shadcn/ui Chart para charts cartesianos o de series donde Recharts encaja:

- line;
- area;
- bar;
- composed;
- scatter/bubble;
- radial si aporta;
- stacked bars;
- small multiples simples.

El componente de shadcn/ui Chart está construido sobre Recharts, usa composición y permite ChartContainer, ChartTooltip, ChartLegend y ChartConfig desacoplado de la data. Mantener esa filosofía: config separado, data vía refs, charts composables.

## Cuándo usar custom visualization

Usar componente custom SVG/Canvas/D3-like cuando el chart necesite:

- cluster semántico;
- relaciones espaciales;
- force layout;
- aura emocional;
- network graph;
- drill-down inmersivo;
- microinteracciones no cartesianas;
- galaxy map.

No forzar `Semantic Signal Galaxy` ni `Emotional Density Map` a Recharts si empobrece la experiencia.

## Chart data rule

Cada chart debe tener:

- `data_ref` o referencia equivalente;
- definición de filtros soportados;
- agregación responsable;
- periodo;
- last calculated;
- source coverage;
- confidence;
- empty state;
- stale state.

Claude no genera data del chart. Claude solo escribe lectura de chart usando métricas calculadas.

## Chart families

| Familia | Pantallas | Implementación visual |
|---|---|---|
| Semantic Signal Galaxy | Overview, Signals | Custom SVG/Canvas |
| Emotional Density Map | Overview, Signals | Custom overlay + filters |
| Impact × Polarity Priority Map | Overview, Marketing Moves | shadcn Chart + ScatterChart |
| Signal Momentum Stream | Overview, Signals | shadcn Chart line/area/composed o custom stream |
| Source Coverage Strip | Overview, Sources, Quality | shadcn bar/heat strip |
| Lifecycle Heatmap | Signals | shadcn/custom grid |
| Momentum × Actionability Matrix | Marketing Moves | shadcn scatter |
| Hook Opportunity Matrix | Content & Creative | shadcn scatter/quadrant |
| Paid/Organic Gap Matrix | Paid / Organic | shadcn scatter/bar/composed |
| Ownership/Whitespace Map | Competitive & Category | shadcn scatter/stacked bar |
| Evidence Coverage Chart | Evidence, Quality | shadcn bar/progress |

## Tooltip standard

Todo tooltip debe incluir:

- nombre;
- periodo;
- métrica principal;
- delta;
- source mix o fuente principal;
- confidence;
- click action.

Ejemplo:

```text
Beneficio concreto
Impacto: 78
Delta: +31% vs mes anterior
Emoción dominante: confianza
Fuente principal: TikTok comments
Confianza: media-alta
Click para ver evidencia
```

## Drawer behavior

Click en chart debe abrir detalle, no solo hover.

Drawer mínimo:

- chart context;
- signal list;
- evidence preview;
- period metrics;
- source mix;
- related marketing move;
- link a pantalla profunda.

## Chart accessibility

- Cada chart debe tener resumen textual.
- Color no debe ser único canal.
- Usar labels, badges, flechas, patrones, tamaño y forma.
- Tooltips deben funcionar con teclado cuando sea posible.
- Mantener tabla alternativa para data crítica.

## Chart states

| Estado | UI |
|---|---|
| Loading | skeleton con título y leyenda gris |
| Empty | explicación + CTA a Sources o filtros |
| Insufficient data | chart atenuado + confidence baja |
| Stale | badge `stale` + last updated |
| Partial | warnings de fuente/periodo |
| Error | fallback textual + retry interno |
| Non comparable | mostrar warning y no calcular delta |

## Visual direction

Charts deben sentirse Noisia:

- fondo oscuro o neutro premium si el sistema actual lo usa;
- brillo controlado, no carnaval;
- espacios amplios;
- labels mínimos;
- microcopy claro;
- interacción suave;
- foco en lectura de negocio;
- no sobrecargar con leyendas innecesarias.

## Regla final

Cada chart debe responder una pregunta de decisión. Si el chart no cambia lo que Marketing haría, no entra al Overview.
