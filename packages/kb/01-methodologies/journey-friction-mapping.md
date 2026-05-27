# Journey Friction Mapping — `journey-friction-mapping`

## Pregunta que responde

> ¿Dónde se rompe el camino entre la intención y la acción — y qué tipo de fricción lo está rompiendo?

## Cuándo aplica

- Optimización de conversión cuando la analítica muestra "dónde" pero no "por qué".
- Rediseño de experiencias (e-commerce, apps, signup, onboarding).
- Evaluación post-lanzamiento cuando el producto es bueno pero no convierte.
- Defensa de share contra un competidor que parece "menos producto, más fluidez".
- Expansión a nuevos canales donde el journey existente no transfiere.

## Cuándo NO aplica

- **Cuando la fricción es invisible al lenguaje.** Friction Mapping captura fricciones articulables. Las que el consumidor no puede nombrar (problemas de UX visual, micro-frustraciones inconscientes) requieren métodos complementarios — usability testing observacional, eye-tracking.
- **Cuando no hay journey suficientemente largo.** Una compra impulsiva de 30 segundos no tiene puntos de fricción mapeable.
- **Cuando el problema es de propuesta de valor, no de fricción.** Si el consumidor no quiere el producto, no hay fricción que remover — hay producto que rediseñar.

## Estructura de análisis — los 4 tipos de fricción × las fases del journey

JFM cruza dos ejes que **siempre** se codifican simultáneamente.

### Eje 1 — Los 4 tipos de fricción (Nordgren & Schonthal)

Tipología no-negociable. Toda fricción se clasifica como uno (y solo uno) de estos tipos:

- **Inercia** — el consumidor sigue haciendo lo de siempre porque cambiar es más costoso que continuar. Default cognitivo.
- **Esfuerzo** — la acción requiere demasiado tiempo, demasiados pasos, demasiada carga cognitiva o física.
- **Emoción** — miedo, ansiedad, vergüenza, frustración. La acción está bloqueada por una respuesta afectiva.
- **Reactancia** — el consumidor percibe que está siendo empujado y se resiste. La presión genera el efecto contrario.

**Diagnóstico clínico para distinguir:**

| ¿Qué pregunta el consumidor implícitamente? | Tipo de fricción |
| ------------------------------------------- | ---------------- |
| "¿Por qué cambiar si lo de siempre funciona?" | Inercia |
| "¿Por qué esto cuesta tanto trabajo?" | Esfuerzo |
| "¿Y si me equivoco / me juzgan / no funciona?" | Emoción |
| "¿Por qué me están presionando? Yo decido." | Reactancia |

Los 4 tipos requieren intervenciones **completamente distintas**. Confundirlos es la causa principal de "remediation que no remedia": tratar un problema de inercia con descuento (que es solución de esfuerzo) no mueve nada.

### Eje 2 — Las fases del journey

Las fases se reconstruyen desde el corpus, no se imponen desde el workshop. Típicamente emergen 4-7 fases. Ejemplos en e-commerce:

- Awareness → Consideración → Comparación → Selección → Checkout → Confirmación → Post-compra (uso, validación, segunda compra).

En cada fase, codificar fricciones por tipo. La matriz resultante:

|              | Awareness | Consideración | Comparación | Selección | Checkout | Post-compra |
| ------------ | --------- | ------------- | ----------- | --------- | -------- | ----------- |
| Inercia      | ✓         |               |             |           |          | ✓           |
| Esfuerzo     |           | ✓             | ✓✓          | ✓         | ✓✓✓      |             |
| Emoción      |           |               | ✓           | ✓✓        | ✓        | ✓           |
| Reactancia   | ✓         |               |             |           | ✓        |             |

(Densidad de fricciones por celda, no presencia.)

### Break points

No toda fricción es un break point. Un break point es una fricción que **causa abandono** — el consumidor dice explícitamente "por eso no lo hice / no lo compré / lo cambié". 

Los break points se identifican por co-ocurrencia con marcadores de abandono en el corpus:
- "Decidí no…" / "Al final no…" / "Me arrepentí de…" / "Me cambié a…" / "Dejé de…"

**El protocolo prioriza break points sobre fricciones articuladas pero no decisivas.** Una fricción muy mencionada que no se asocia con abandono es ruido — el consumidor se queja pero compra igual.

### Movilidad de la fricción

Cada fricción se etiqueta con:
- **Movible directamente** — el cliente puede eliminarla con un cambio de producto, comunicación o experiencia.
- **Movible indirectamente** — requiere coordinación con un actor externo (proveedor logístico, plataforma).
- **Estructural** — fuera del control. Solo se puede comunicar mejor que existe (no eliminar).

## Fundamentos teóricos

| Teoría                  | Autor                         | Por qué entra al protocolo                                                |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Customer Journey Theory | Lemon & Verhoef (2016)        | Marco de touchpoints dinámicos como unidad de análisis.                   |
| Friction Theory         | Nordgren & Schonthal (2021)   | Provee la tipología de los 4 tipos — corazón de la metodología.           |
| Cognitive Load Theory   | Sweller (1988)                | Sustenta el tipo "Esfuerzo" — sobrecarga cognitiva como causa de abandono. |
| Peak-End Rule           | Kahneman (1993)               | La memoria de la experiencia la dominan pico emocional + último momento — informa qué fases priorizar. |

## Inputs típicos

**Mínimo viable:**
- 1,500-2,500 expresiones que narren experiencia de uso o intención fallida.
- Cobertura de fuentes que capturan abandono: foros de quejas, reviews 1-3★, comentarios de cancelación, replies en threads de "por qué dejé de…".
- Definición clara del journey relevante (qué journey específico — compra primera vez, recompra, suscripción, etc.).

**Ideal:**
- Acceso a data interna del cliente: heatmaps, recordings, abandonment funnels para triangular.
- Reviews segmentadas por tiempo post-acción (frescas vs. retroactivas — la fricción se recuerda diferente a 7 días vs. 90 días).
- Comparativo: corpus del competidor que sí logra que el consumidor complete el journey, para detectar fricciones diferenciales.

## Outputs típicos

- **Friction Map** — la matriz tipo × fase con densidad y movilidad por celda.
- **Break Points Brief** — los 3-5 puntos que más causan abandono, con evidencia y movilidad.
- **Friction Removal Roadmap** — secuencia priorizada de intervenciones, con costo estimado e impacto esperado.

## Limitaciones

- **Captura fricciones articuladas.** Si el consumidor no puede nombrar la fricción, no entra al corpus. Complementar con observacional cuando importe.
- **Sesgo de retroactividad.** El consumidor reconstruye narrativamente lo que falló — no siempre coincide con lo que objetivamente falló.
- **No predice impacto cuantitativo.** Da prioridades relativas, no lift esperado en %.
- **Sensible a categoría.** Lo que es fricción aceptable en B2B (formularios largos) es fatal en B2C consumer.

## Lecturas obligatorias

1. Nordgren & Schonthal. *The Human Element* (2021) — completo. Es el manual de fricción más limpio publicado.
2. Lemon, K. & Verhoef, P. *Understanding Customer Experience* (2016) — paper.
3. Sweller, J. *Cognitive Load During Problem Solving* (1988) — paper original.
4. Kahneman. Investigación sobre Peak-End rule — buscar paper de 1993 sobre experiencia recordada vs. vivida.

## Ver también

- Playbook: [`05-ai-playbooks/run-journey-friction-mapping.md`](../05-ai-playbooks/run-journey-friction-mapping.md)
- Casos donde JFM es lente principal: optimización de medios, defensa competitiva.
