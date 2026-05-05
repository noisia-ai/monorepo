# Run Decision Velocity — Playbook operativo

## Inputs requeridos

| Input                          | Mínimo viable                                              | Ideal                                                |
| ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------- |
| Corpus narrativo de decisión   | 1,000-2,000 expresiones de decisión narrada                | 3,000+ con threads largos completos                  |
| Cobertura de fases             | Pre-decisión + decisión + post-decisión visibles           | Reviews segmentadas a 7d / 30d / 90d post-acción     |
| Definición de journey          | Qué journey específico (compra primera vez, recompra, etc.) | + duración esperada vs. real                         |
| Pregunta de negocio            | Una frase                                                  | + decisión específica de funnel (qué CTA, dónde)     |
| Acceso a data interna (opcional) | —                                                        | Heatmaps, abandonment funnels, time-to-decision data |

## Pre-flight check

1. **¿El journey es ≥10 minutos de decisión?** Si no, no hay tela para mapear.
2. **¿El corpus narra el proceso de decisión, no solo el resultado?** "Lo compré, está bueno" no sirve. "Estuve 3 semanas eligiendo, primero pensé en X, después leí Y…" sí sirve.
3. **¿Las 3 fases (pre / durante / post) están todas representadas?** Si solo hay post-compra, no se puede mapear pre-decisión.
4. **¿Existe línea base de velocidad esperada?** ¿Es categoría de decisión rápida típica, lenta típica, o desconocida? Sin línea base, "lento" no significa nada.

**Si falla → abortar.**

## Protocolo

### Paso 1 — Reconstrucción narrativa del journey

**Acción:** Para cada pieza del corpus que narre proceso, extraer la línea de tiempo:
- ¿Cuándo empezó a considerar?
- ¿Qué consultó / leyó / preguntó?
- ¿A quién consultó?
- ¿Cuánto tardó en decidir?
- ¿Qué cerró la decisión?
- ¿Qué pasó post-compra (validación, recompra, abandono)?

**Criterio de éxito:** 30-60 narrativas reconstruidas (no se necesitan miles — la narrativa es densa).

### Paso 2 — Identificación de fases emergentes

Aunque el frame teórico es Pre / Durante / Post, las fases reales emergen del corpus. En categorías complejas pueden ser 5-7 fases.

Ejemplo en categoría tech consumer (cámara prosumer):
- Awareness ("vi a alguien con una y me enganchó")
- Investigación abierta ("empecé a leer reviews")
- Shortlist ("me quedé entre 3 modelos")
- Comparación profunda ("estuve 2 semanas comparando specs")
- Validación social ("le pregunté a mi amigo fotógrafo")
- Compra ("la pedí")
- Validación post-compra ("a las 2 semanas dudé si había elegido bien")

Reportar las fases tal como aparecen en el corpus.

### Paso 3 — Diagnóstico Sistema 1 / Sistema 2 por fase

Para cada fase, codificar qué sistema cognitivo dominó la decisión del consumidor:

**Marcadores de Sistema 1:**
- "me decidí cuando vi que…" (decisión por reconocimiento de patrón)
- "no sé por qué pero sentí que era esa"
- "me gustó al instante"
- "me la recomendó X y la pedí"
- "vi el rating y dije sí"
- Decisiones rápidas (<minutos para esa fase)

**Marcadores de Sistema 2:**
- "estuve comparando specs durante…"
- "armé un Excel con los pros y contras"
- "leí 50 reviews antes de decidirme"
- "calculé el costo por uso"
- Decisiones lentas (>horas/días para esa fase)

**Edge case importante:** la transición Sistema 2 → Sistema 1. El consumidor investiga exhaustivamente y al final decide por gut feeling. Capturar este patrón — es donde están las oportunidades de optimización (reducir el peso del Sistema 2 que no influye en la decisión final).

### Paso 4 — Identificación de blockers y accelerators

Por cada fase, identificar:

**Velocity Blockers:**
| Tipo                       | Marcador en corpus                                                       |
| -------------------------- | ------------------------------------------------------------------------ |
| Sobrecarga cognitiva       | "no sabía cuál elegir, había demasiadas opciones"                        |
| Ambigüedad                 | "no entendía qué diferenciaba a una de la otra"                          |
| Riesgo no-resuelto         | "tenía miedo de que no funcionara y no poder devolverla"                  |
| Reactancia                 | "me harté de que me persiguieran con anuncios, decidí no comprar"        |
| Falta de validación social | "no encontré a nadie que me dijera que sí valía la pena"                 |
| Decision fatigue           | "después de 3 semanas comparando ya no quería pensar más, abandoné"      |

**Velocity Accelerators:**
| Tipo                       | Marcador en corpus                                                       |
| -------------------------- | ------------------------------------------------------------------------ |
| Default inteligente        | "venía pre-seleccionado el plan medio y lo acepté"                        |
| Heurística simple          | "decidí por el precio más alto que me podía permitir, asumí que mejor"    |
| Validador confiable        | "lo recomendó X y eso bastó"                                             |
| Riesgo reducido            | "vi que tenía garantía de devolución y dije ok"                          |
| Anclaje útil               | "el primer producto que vi me marcó el rango y comparé contra eso"      |
| Urgencia legítima          | "se me iba a vencer la otra y necesitaba decidir esa semana"             |

### Paso 5 — Cuantificación de velocidad

Para cada fase, calcular:
- **Tiempo promedio reportado** (cuando el consumidor lo articula).
- **Distribución** (mediana, percentiles 25/75) — la velocidad es bimodal en muchas categorías.
- **% de abandonos por fase** (cuántas narrativas terminan sin decisión en esta fase).

### Paso 6 — Síntesis de Choice Architecture Brief

Con paso 3-5 completos, recomendar diseños específicos:

- **Si una fase es Sistema 2 dominante con sobrecarga cognitiva** → reducir opciones, agrupar en categorías, ofrecer comparador.
- **Si una fase es Sistema 1 dominante con baja validación social** → meter recomendaciones de pares, ratings prominentes, social proof contextual.
- **Si hay fase con reactancia** → bajar la presión de retargeting, dar espacio.
- **Si hay decision fatigue tardío** → diseñar default que permita "pasar" a la siguiente compra sin re-decidir todo.

## Criterios de codificación

### Diferenciar narrativa de decisión real vs. narrativa post-hoc

El consumidor reconstruye la decisión retroactivamente. Lo que dice "yo decidí por X" puede ser racionalización post-hoc.

Marcadores de narrativa más confiable:
- Detalles específicos (nombres de productos, fechas, fuentes consultadas).
- Mención de dudas previas que se descartaron (significa que la decisión tiene memoria del proceso).
- Coherencia entre fases (la lógica narrativa se sostiene).

Marcadores de narrativa post-hoc / racionalización:
- Frases tipo "obvio elegí X porque es el mejor" sin proceso narrado.
- Una sola razón monolítica ("la elegí por Y") sin más contexto.
- Inconsistencia con review actual (la review dice "está bien" pero la narrativa dice "fue una decisión muy difícil").

Las narrativas post-hoc entran al corpus pero pesan menos en la diagnosis.

### Tiempo reportado vs. real

El consumidor sub-reporta tiempo de decisión típicamente. "Me decidí en una semana" usualmente significa 2-3 semanas. Triangular con data interna (time-to-purchase, session counts) cuando exista.

## Formato de output

### Output 1 — Decision Velocity Diagnostic (1-2 páginas + JSON)

```json
{
  "categoria": "...",
  "journey_relevante": "compra primera vez",
  "fases_detectadas": [
    {
      "nombre": "investigación abierta",
      "tiempo_promedio_reportado": "5-10 días",
      "tiempo_mediana": "7 días",
      "sistema_dominante": "S2",
      "abandono_pct": 15,
      "blockers_principales": [...],
      "accelerators_presentes": [...]
    }
  ],
  "diagnostico_general": "...",
  "fase_critica": "...",
  "limitaciones": "..."
}
```

### Output 2 — Velocity Blockers Map

Para cada blocker priorizado:
- Fase donde aparece.
- Tipo (los 6 marcadores).
- Frecuencia + intensidad + capacidad de abortar decisión.
- Movilidad (ver clasificación de movilidad en JFM playbook).

### Output 3 — Velocity Accelerators Map

Para cada accelerator presente o ausente:
- Fase relevante.
- ¿Está presente en la marca cliente? ¿Lo está en el competidor?
- Hipótesis de implementación si está ausente.

### Output 4 — Choice Architecture Brief (narrativo, 1-3 páginas)

Recomendaciones específicas por fase. Cada recomendación lleva:
- Cuál sistema cognitivo está optimizando (S1 o S2).
- Cuál blocker remueve o cuál accelerator añade.
- Hipótesis de A/B test asociada (qué medir si se implementa).

## Quality gates

- [ ] Las 3 fases base están diagnosticadas.
- [ ] Cada fase tiene Sistema 1/Sistema 2 dominante asignado.
- [ ] Hay tiempos reportados o explícitamente "no reconstruible".
- [ ] Cada blocker/accelerator apunta a evidencia citable.
- [ ] Cada recomendación de Choice Architecture tiene hipótesis A/B asociada.
- [ ] Cero promesas de lift cuantitativo.
- [ ] Cero recomendaciones que confundan tipo de blocker (ej. tratar inercia con descuento).

## Failure modes conocidos

| Síntoma                                                  | Causa                                            | Cómo corregir                                                     |
| -------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| Las 3 fases salen idénticas en blockers.                 | El paso 2 no detectó fases reales.               | Re-leer narrativas y dejar emerger fases del corpus.              |
| Sistema 1 dominante en todas las fases.                  | Corpus pobre en narrativa de decisión, solo resultados. | Sumar fuentes con threads largos (Reddit, foros).                |
| Recomendaciones de Choice Architecture genéricas.        | Saltó la diagnosis fase × sistema.               | Re-correr paso 3 y atar cada recomendación a hallazgo específico. |
| El cliente dice "no podemos implementar nada de esto".   | Fricciones identificadas son estructurales (ej. plataforma de tercero). | Reportar como tales y pivotar a recomendaciones de comunicación / expectativa. |

## Versionado

| Fecha       | Cambio                                                                          | Razón                                                                |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-05-04  | Versión inicial con doble codificación (fases × Sistema 1/2).                   | Captura el cruce que aterriza Kahneman en operación de funnel.       |
