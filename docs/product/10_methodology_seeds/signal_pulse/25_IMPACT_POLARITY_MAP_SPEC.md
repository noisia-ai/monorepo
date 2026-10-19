# 25 — Impact × Polarity Priority Map

## Qué reemplaza

Reemplaza gráficos clásicos de volumen vs sentimiento y priorización manual.

## Pregunta que responde

> ¿Qué señales son prioridad por impacto y polaridad?

## Ejes

| Eje | Significado |
|---|---|
| X | polaridad de -100 a +100 |
| Y | impacto ponderado |
| Tamaño burbuja | engagement o evidencia ponderada |
| Color | emoción dominante o categoría |
| Borde | confidence |
| Flecha | dirección vs periodo anterior |

## Cuadrantes

| Cuadrante | Lectura | Decisión |
|---|---|---|
| Alto impacto + negativo | riesgo o crisis | evitar, contener, explicar, revisar claim |
| Alto impacto + positivo | narrativa fuerte | amplificar, pautar, briefear |
| Bajo impacto + positivo | oportunidad emergente | test barato |
| Bajo impacto + negativo | ruido o alerta temprana | monitorear |

## Implementación visual

Usar shadcn/ui Chart + Recharts ScatterChart/Bubble Chart si el diseño lo permite. Mantener ChartTooltip y ChartConfig. Si se requiere cuadrante visual más editorial, usar capa custom encima del scatter.

## Interacciones

- Click burbuja → Signal drawer.
- Brush por cuadrante → filtrar Signals/Marketing Moves.
- Toggle impacto: volumen, engagement, weighted impact, marketing relevance.
- Toggle color: emoción, source, lifecycle, category.
- Mostrar top 5 priority list al lado.

## Tooltip

Debe incluir:

- señal;
- impacto;
- polaridad;
- delta;
- emoción;
- lifecycle;
- evidence count;
- confidence;
- recommended move.

## Empty state

> No hay suficientes señales con impacto y polaridad comparables. Revisa fuentes conversacionales o amplía periodo.

## Quality gates

- No ubicar burbuja sin confidence mínima.
- No comparar impacto si fuentes no son comparables.
- No usar sentimiento de proveedor sin disclaimer si no fue normalizado.
- No permitir que el chart sea solo “bonito”; debe alimentar priorities.

## Regla final

Este chart es la lista visual de prioridades. Debe ayudar a decidir qué atacar, amplificar, testear o monitorear.
