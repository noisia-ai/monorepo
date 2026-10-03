# 24 — Emotional Density Map

## Qué reemplaza

Reemplaza el chart plano de sentimiento positivo/neutral/negativo.

## Pregunta que responde

> ¿Qué emoción domina cada territorio semántico y qué tan densa es esa emoción?

## Principio

El sentimiento no debe vivir como pastel separado. Debe inyectarse sobre los clusters de conversación.

## Emociones sugeridas

Adaptar etiquetas al idioma del corpus, pero mantener familias:

- confianza;
- deseo;
- anticipación;
- alegría;
- sorpresa;
- frustración;
- enojo;
- miedo;
- tristeza;
- rechazo;
- confusión;
- ambivalencia.

## Elementos visuales

| Elemento | Significado |
|---|---|
| Aura de cluster | emoción dominante |
| Densidad del aura | concentración emocional |
| Color | emoción |
| Intensidad | fuerza |
| Moteado/patrón | ambivalencia o mezcla |
| Vector/sparkline | dirección emocional en el tiempo |

## Modos

| Modo | Uso |
|---|---|
| Dominant emotion | ver emoción principal por cluster |
| Polarity | ver positivo/negativo/ambivalente |
| Emotional intensity | ver fuerza emocional |
| Risk emotion | ver enojo/frustración/miedo/rechazo |
| Trust/desire | ver oportunidades positivas |

## Interacciones

- Click en emoción filtra todos los charts del Overview.
- Hover en cluster muestra emoción principal + secundarias.
- Click cluster abre evidencia emocional.
- Toggle por periodo para ver cambio emocional mensual.
- Comparar emoción actual vs promedio ventana.

## Tooltip

Debe decir:

- cluster;
- emoción dominante;
- intensidad;
- delta emocional;
- evidencia;
- source mix;
- confidence.

## Ejemplo de lectura

> El cluster “precio” concentra frustración, pero no tiene el mayor volumen. El riesgo no está en cantidad, sino en intensidad emocional y crecimiento durante los últimos dos meses.

## Quality gates

- No etiquetar emoción si la evidencia textual es insuficiente.
- No reducir emoción a positivo/negativo en el copy principal.
- Mostrar ambivalencia cuando exista.
- No mezclar performance metrics con emoción si no hay evidencia textual.

## Regla final

La emoción debe explicar por qué una señal importa, no solo decorar la polaridad.
