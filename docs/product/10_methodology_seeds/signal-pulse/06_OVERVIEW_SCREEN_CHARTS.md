# 06 — Overview screen y charts Noisia de social listening

## Propósito del Overview

El Overview es la pantalla de entrada. No sustituye el resto del reporte. Resume qué está pasando, qué señales importan, qué datos lo prueban, qué movimientos de Marketing salen de eso y qué tan confiable es el corte.

## Componentes del Overview

1. Executive Signal Read.
2. Live Corpus / Source / Confidence strip.
3. Semantic Signal Galaxy.
4. Emotional Density Map.
5. Impact × Polarity Priority Map.
6. Signal Momentum Stream.
7. Top Signals / Top Opportunities compactas.
8. Marketing Moves resumen.
9. Coverage / confidence / source quality warnings.

## Estructura visual sugerida

```text
┌──────────────────────────────────────────────────────────────┐
│ Executive Signal Read                                        │
│ “La conversación se movió de aspiración a prueba concreta.”  │
│ Periodo · fuentes · confidence · live/published              │
└──────────────────────────────────────────────────────────────┘

┌───────────────────────────────┬──────────────────────────────┐
│ Semantic Signal Galaxy         │ Impact × Polarity Map        │
│ + Emotional Density layer      │ Prioridades visuales         │
└───────────────────────────────┴──────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Signal Momentum Stream                                       │
│ nacimiento, persistencia, pico, decay, reactivación          │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Top Opportunities / Marketing Moves                          │
└──────────────────────────────────────────────────────────────┘
```

## Social listening clásico → Noisia

| Chart clásico | Versión Noisia |
|---|---|
| Wordcloud | Semantic Signal Galaxy |
| Sentiment chart | Emotional Density Map |
| Volume vs sentiment | Impact × Polarity Priority Map |
| Trend timeline | Signal Momentum Stream |

## 1. Semantic Signal Galaxy

Reemplazo de wordcloud.

### Objetivo

Mostrar de un vistazo territorios semánticos activos, polaridad, volumen de impacto, momentum y clusters relacionados.

### Qué muestra

- Nodos = términos, bigrams, trigrams, claims, pains, señales, entidades conversacionales.
- Tamaño del nodo = impacto ponderado, no frecuencia plana.
- Color = polaridad/sentimiento.
- Intensidad = fuerza emocional.
- Proximidad = similitud semántica.
- Racimos = contextos: producto, quejas, competidores, campañas, audiencias, formatos, claims, creators.
- Indicadores de tendencia = flecha, glow, ring o badge si está emergiendo.

### Interacciones

- Click en racimo: expande cluster.
- Hover en nodo: tooltip con volumen, emoción dominante, momentum, fuente principal y confidence.
- Click en nodo: drawer con frases exactas, bigrams/trigrams, top authors, comentarios originales, marketing move sugerido y señales relacionadas.
- Filtros: fuente, periodo, emoción, status, audience, competitor/entity.

### Implementación visual

Probablemente custom SVG/Canvas/D3-like. No forzar a Recharts si empobrece la experiencia.

## 2. Emotional Density Map

Reemplazo de sentimiento plano.

### Objetivo

Mostrar cómo se distribuye la emoción sobre territorios semánticos. No reducir todo a positivo/neutral/negativo.

### Qué muestra

- Emociones: confianza, deseo, alegría, anticipación, sorpresa, frustración, enojo, miedo, tristeza, rechazo, confusión.
- Cada cluster recibe aura/heatmap emocional.
- Color del aura = emoción dominante.
- Densidad/intensidad = concentración de evidencia emocional.
- Al filtrar una emoción, el Galaxy se ilumina con clusters relevantes.

### Interacciones

- Click en emoción filtra todos los charts del Overview.
- Hover en cluster muestra emoción dominante + secundarias.
- Click abre evidencia emocional con frases exactas.
- Toggle: emoción dominante / polaridad / intensidad / riesgo.

### Implementación visual

Custom overlay sobre Semantic Signal Galaxy. Puede usar componentes del sistema para tooltip/drawer.

## 3. Impact × Polarity Priority Map

Reemplazo de volumen/sentimiento.

### Objetivo

Priorizar señales con lectura de negocio: impacto, polaridad, urgencia y accionabilidad.

### Qué muestra

- Eje X = polaridad de -100 a +100.
- Eje Y = impacto o volumen ponderado.
- Tamaño = engagement o evidencia ponderada.
- Color = tipo de señal o emoción dominante.
- Borde = confianza.
- Flecha interna = dirección vs periodo anterior.

### Cuadrantes

| Cuadrante | Decisión |
|---|---|
| Alto impacto + negativo | riesgo, crisis, territorio a evitar/contener |
| Alto impacto + positivo | narrativa para amplificar |
| Bajo impacto + positivo | oportunidad emergente / test barato |
| Bajo impacto + negativo | monitorear, no sobrerreaccionar |

### Implementación visual

Usar `shadcn/ui Chart` + Recharts ScatterChart/Bubble chart.

## 4. Signal Momentum Stream

Reemplazo de timeline genérico.

### Objetivo

Mostrar historia temporal: nacimiento, aceleración, persistencia, pico, caída y reactivación.

### Qué muestra

- Meses comparables en eje X.
- Señales principales como líneas, bandas o streams.
- Grosor = impacto mensual.
- Color = polaridad o categoría.
- Markers = birth, peak, decay, reactivation, saturation.
- Sparkline por señal en cards relacionadas.

### Interacciones

- Click en mes filtra Overview.
- Click en señal abre lifecycle y evidencia mes a mes.
- Toggle: top signals / promoted / risks / opportunities.
- Comparación: mes actual vs anterior vs promedio.

### Implementación visual

Puede usar `shadcn/ui Chart` con LineChart/AreaChart/ComposedChart o custom stream si se busca mayor impacto visual.

## Regla de charts

Cada chart debe responder una pregunta de decisión. Si no cambia qué haría Marketing, no entra al Overview.
