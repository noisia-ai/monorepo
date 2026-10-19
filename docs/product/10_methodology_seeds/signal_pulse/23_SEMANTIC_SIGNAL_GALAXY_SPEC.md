# 23 — Semantic Signal Galaxy

## Qué reemplaza

Reemplaza la wordcloud clásica.

La wordcloud tradicional muestra frecuencia de palabras. Semantic Signal Galaxy muestra territorios semánticos, polaridad, emoción, impacto, momentum y evidencia.

## Pregunta que responde

> ¿Qué territorios de conversación están vivos, cómo se sienten y cuáles merecen exploración de marketing?

## Dónde aparece

- Overview: visual principal.
- Signals: modo detalle.
- Evidence: como filtro visual opcional.

## Elementos visuales

| Elemento | Significado |
|---|---|
| Nodo | término, bigram, trigram, claim, pain, entidad, señal o frase |
| Tamaño | impacto ponderado, no frecuencia simple |
| Color | polaridad o emoción dominante |
| Intensidad | fuerza emocional |
| Proximidad | similitud semántica |
| Cluster | contexto o territorio de conversación |
| Línea/malla | relación semántica |
| Glow/ring/flecha | señal emergente o con momentum |
| Borde | confidence |
| Badge | new, rising, saturated, risk |

## Impacto ponderado

No usar frecuencia plana. El impacto debe combinar:

- volumen;
- engagement;
- recencia;
- consistencia temporal;
- diversidad de fuentes;
- marketing relevance;
- confidence.

La fórmula exacta puede evolucionar, pero el producto debe comunicar “impacto” y no “veces mencionada”.

## Clusters sugeridos

- Producto;
- precio;
- confianza;
- claims;
- contenido educativo;
- aspiración;
- quejas;
- comparaciones;
- competidores;
- creators;
- campañas;
- audiencias;
- formato;
- momento de consumo;
- fricciones;
- deseo;
- riesgo.

## Interacciones

| Interacción | Resultado |
|---|---|
| Hover nodo | Tooltip con impacto, emoción, delta, confidence |
| Click nodo | Drawer con evidencia, bigrams/trigrams, top authors, marketing move |
| Click cluster | Expande cluster y filtra charts relacionados |
| Drag/zoom | Explorar galaxia sin perder contexto |
| Toggle emotion | Recolorea por emoción |
| Toggle polarity | Recolorea por positivo/negativo |
| Toggle source | Muestra qué fuente sostiene nodos |
| Time scrubber | Cambia mes y anima movimiento |

## Drawer de nodo

Debe mostrar:

- nombre;
- tipo: term/signal/claim/entity;
- impacto actual;
- delta;
- lifecycle;
- emoción dominante;
- source mix;
- evidence preview;
- top phrases;
- top authors;
- signals relacionadas;
- marketing move sugerido;
- botón a Signals/Evidence/Corpus.

## Empty state

Si no hay data suficiente:

> Todavía no hay suficiente conversación comparable para construir la galaxia semántica. Conecta una fuente conversacional o amplía el periodo.

## Riesgos

- Convertirlo en decoración.
- Sobrecargar con nodos ilegibles.
- Usar colores aleatorios.
- Mostrar palabras sin evidencia.
- Confundir frecuencia con impacto.

## Regla final

La galaxia debe ser una puerta de entrada a evidencia y decisión, no una nube bonita.
