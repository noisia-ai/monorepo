# Decision Velocity — `decision-velocity`

## Pregunta que responde

> ¿Por qué el consumidor decide rápido en una categoría y lento en la tuya — y qué arquitectura de elección altera esa velocidad?

## Cuándo aplica

- Optimización de funnel cuando el problema no es awareness ni consideración, sino **conversión**.
- UX de decisión: rediseño de configuradores, pricing pages, comparadores.
- E-commerce con assortment grande donde el consumidor abandona por sobrecarga.
- Categorías de "compra inusualmente lenta" (consumibles que se evalúan como durables) o "compra inusualmente rápida" (durables que se compran con urgencia).
- Lanzamientos en categorías donde la velocidad de decisión esperada y la real desencajan.

## Cuándo NO aplica

- **Cuando el problema es de awareness puro.** Si la mayoría no conoce la categoría, no hay decisión que medir.
- **Cuando se busca conversion lift cuantitativo predecible.** Decision Velocity diagnostica hipótesis fuertes; el lift se valida con A/B test.
- **Cuando la categoría es de compra impulsiva pura sin journey.** Categoría con decisión <30s no tiene suficiente tela para mapear.

## Estructura de análisis — 3 fases × 2 sistemas

Decision Velocity opera sobre dos ejes simultáneos. Toda evidencia se codifica con ambos.

### Eje 1 — Las 3 fases del journey de decisión

- **Pre-decisión (awareness + consideración)** — el consumidor sabe que la categoría existe, empieza a evaluar opciones.
- **Decisión (evaluación + comparación + selección)** — donde la elección efectivamente ocurre.
- **Post-decisión (validación + commitment)** — confirmación de que la elección fue correcta, justificación retroactiva.

La velocidad no es uniforme. Una categoría puede tener pre-decisión rápida (sé que necesito X) pero decisión lenta (no logro elegir entre opciones), o al revés. **Diagnosticar las 3 fases por separado.**

### Eje 2 — Sistema 1 vs. Sistema 2 (Kahneman)

Por cada fase del journey, identificar qué sistema cognitivo domina:

- **Sistema 1** — rápido, automático, intuitivo, asociativo. Decide por familiaridad, recomendación, default, heurística.
- **Sistema 2** — lento, deliberativo, analítico. Compara specs, lee reviews extensas, hace spreadsheets.

**Edge case crítico:** una categoría puede tener Sistema 2 dominante en pre-decisión (investigación exhaustiva) y Sistema 1 en decisión (al final eligió por gut feeling después de toda la investigación). Esa transición es donde está la oportunidad de optimización.

### Velocity blockers vs. velocity accelerators

Cada elemento del journey se clasifica como uno de:

**Blockers (frenan velocidad):**
- **Sobrecarga cognitiva** — demasiadas opciones, demasiada información, decisión fatigue.
- **Ambigüedad** — no entiende qué está comparando, criterios poco claros.
- **Riesgo no-resuelto** — funcional, social, financiero — el consumidor no encuentra señal que reduzca el riesgo.
- **Reactancia** — siente que la categoría/marca lo está empujando demasiado y se resiste.
- **Falta de validación social** — no encuentra quién le diga "yo también lo hice".

**Accelerators (aumentan velocidad):**
- **Default inteligente** — opción pre-seleccionada que el consumidor acepta.
- **Heurística simple** — un criterio que el consumidor adopta para cortar decisión ("el más barato con buena review").
- **Recomendación de fuente confiable** — figura validadora.
- **Reducción visible de riesgo** — garantía, free trial, devolución, transparencia operativa.
- **Anclaje** — un punto de referencia inicial que estructura el resto de la comparación.
- **Urgencia legítima** — un disparador real (no fake) que cierra ventana de evaluación.

### Por qué importa la doble codificación

- Solo fase → diagnóstico genérico de funnel.
- Solo Sistema 1/2 → análisis cognitivo sin journey.
- Ambos cruzados → identificas que en pre-decisión el cliente está en Sistema 2 (busca specs) pero en decisión cae en Sistema 1 (elige por familiaridad). Eso te dice exactamente qué arquitectura diseñar para cada fase.

## Fundamentos teóricos

| Teoría                  | Autor                         | Por qué entra al protocolo                                                |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Dual-Process Theory     | Kahneman (2011)               | Distinción Sistema 1 / Sistema 2 — el eje cognitivo de la metodología.    |
| Choice Architecture     | Thaler & Sunstein (2008)      | Cómo se presenta la elección altera qué se elige — el output accionable.  |
| Decision Fatigue        | Baumeister (1998)             | La capacidad de decidir se degrada con el uso — explica abandonos tardíos. |
| Information Foraging    | Pirolli & Card (1999)         | El consumidor optimiza valor obtenido por costo cognitivo de búsqueda.    |

## Inputs típicos

**Mínimo viable:**
- 1,000-2,000 expresiones donde el consumidor narra su proceso de decisión (no solo el resultado).
- Cobertura de las 3 fases — pre, durante, post.
- Categoría con journey identificable (>10 minutos de decisión, idealmente >1 hora).

**Ideal:**
- Threads largos en Reddit / foros donde se cuenta la decisión completa ("estuve 3 semanas eligiendo X y al final…").
- Reviews escritas a 30/90/180 días post-compra (capturan validación / arrepentimiento).
- Data interna del cliente: heatmaps, scroll depth, abandonment funnels — para triangular conversación con comportamiento.

## Outputs típicos

- **Decision Velocity Diagnostic** — diagnosis del estado actual: ¿es lenta? ¿es rápida? ¿en qué fase se desbalancea?
- **Velocity Blockers Map** — los frenos identificados y jerarquizados.
- **Velocity Accelerators Map** — los aceleradores presentes y los que faltan.
- **Choice Architecture Brief** — recomendaciones específicas para diseño de funnel: defaults, anchors, secuencias, número de opciones, momento del CTA.

## Limitaciones

- **No sustituye A/B test.** Identifica hipótesis fuertes. La validación cuantitativa es el siguiente paso.
- **Requiere conversación narrativa.** Si el corpus es solo reviews cortas, no captura el journey de decisión.
- **No diagnostica abandono pre-consideración.** Si la gente nunca llega al funnel, no hay decisión que mapear.
- **Categoría-dependiente.** La velocidad "normal" varía drásticamente. Una decisión de 2 semanas es lenta para snacks, rápida para auto.

## Lecturas obligatorias

1. Kahneman, D. *Thinking, Fast and Slow* (2011) — caps. 1-3 mínimo.
2. Thaler, R. & Sunstein, C. *Nudge* (2008) — caps. 1-5.
3. Iyengar, S. *The Art of Choosing* (2010) — capítulo sobre choice overload (jam study).
4. Pirolli & Card. *Information Foraging* (1999) — paper original (denso pero corto).

## Ver también

- Playbook: [`05-ai-playbooks/run-decision-velocity.md`](../05-ai-playbooks/run-decision-velocity.md)
- Casos donde DV es lente principal: optimización de medios, optimización de funnel.
