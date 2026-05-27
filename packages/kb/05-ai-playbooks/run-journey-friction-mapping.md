# Run Journey Friction Mapping — Playbook operativo

## Inputs requeridos

| Input                          | Mínimo viable                                                | Ideal                                                |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| Corpus narrativo de fricción   | 1,500-2,500 expresiones que narran experiencia o intento fallido | 4,000+ con segmentación por momento post-acción      |
| Fuentes de abandono            | Foros de quejas, reviews 1-3★, comentarios de cancelación    | + threads de "por qué dejé de…", grupos de soporte   |
| Definición de journey          | Qué journey específico (compra, suscripción, recompra, churn) | + variantes por segmento de usuario                  |
| Pregunta de negocio            | Una frase                                                    | + decisión específica de optimización                |
| Data interna (opcional)        | —                                                            | Heatmaps, session recordings, abandonment funnels   |
| Corpus competitivo (opcional)  | —                                                            | Mismo journey en competidor que sí convierte mejor   |

## Pre-flight check

1. **¿El corpus captura experiencia narrada, no solo evaluación final?** "1 estrella, no funciona" no sirve. "Me llegó tarde, después no funcionaba el SKU, cuando llamé soporte estuve 40 minutos en línea" sí sirve.
2. **¿Hay marcadores de abandono en el corpus?** Sin "decidí no…", "al final no…", "me arrepentí de…", "me cambié a…", no hay break points para identificar.
3. **¿El journey está delimitado?** Compra primera vez ≠ recompra ≠ cambio de plan. Definir cuál se está mapeando.
4. **¿Hay equilibrio entre experiencias completadas y abandonadas?** Si solo hay quejas, se mapea solo fricción percibida — no fricción decisiva. Si solo hay completadas, no hay break points. Idealmente 40-60% abandonadas.

**Si falla → abortar o reportar.**

## Protocolo

### Paso 1 — Reconstrucción de fases del journey desde el corpus

**Acción:** Leer 30-50 narrativas representativas. ¿Qué fases aparecen orgánicamente? No imponer el funnel del workshop.

**Criterio de éxito:** 4-7 fases con definición operativa (qué empieza la fase, qué la termina).

Ejemplo en e-commerce primera compra:
1. Descubrimiento ("la vi en…")
2. Consideración ("empecé a investigar")
3. Comparación ("la puse en wishlist y comparé")
4. Selección ("decidí cuál pedir")
5. Checkout ("intenté pagar")
6. Espera ("desde que pagué hasta que me llegó")
7. Primer uso ("la abrí y…")
8. Validación tardía ("a los 30 días…")

### Paso 2 — Codificación de fricciones por tipo (Nordgren)

Para cada fricción mencionada en el corpus, codificar como uno (y solo uno) de los 4 tipos:

**Inercia:**
- "estaba bien con lo que tenía"
- "no veía razón para cambiar"
- "lo dejé para después y nunca volví"
- "ya tengo mi rutina, no quería romper"

**Esfuerzo:**
- "tenía que llenar 12 campos"
- "no entendía la página"
- "se trababa la app"
- "tuve que crear una cuenta nueva"
- "no me dejaban pagar con la tarjeta que quería"

**Emoción:**
- "tenía miedo de que no funcionara"
- "me daba vergüenza preguntar"
- "me dio ansiedad ver tantas opciones"
- "me sentí ridículo cuando la usé en público"
- "me frustraba que no contestaran"

**Reactancia:**
- "me empezaron a perseguir con anuncios y me harté"
- "me apretaron mucho con el descuento que se acababa"
- "sentía que me querían vender más de lo que necesitaba"
- "el vendedor insistía y eso me hizo desconfiar"

**Edge case:** una mención puede tener componentes de varios tipos (ej. "tenía miedo + me dio mucho trabajo entender = miedo + esfuerzo"). Asignar el tipo dominante (el que más explicaría el abandono); anotar secundario.

### Paso 3 — Codificación por fase

Cada fricción codificada se ubica también en la fase del journey donde ocurrió. Resultado: matriz tipo × fase.

```
              | Descub | Consid | Compar | Selec | Checkout | Espera | Uso | Validación |
Inercia       |   ✓    |        |        |       |          |        |     |     ✓✓     |
Esfuerzo      |        |   ✓    |   ✓✓   |  ✓    |   ✓✓✓    |        |  ✓  |            |
Emoción       |        |        |   ✓    |  ✓✓   |    ✓     |   ✓    |  ✓  |     ✓      |
Reactancia    |   ✓    |        |        |       |    ✓     |        |     |            |
```

### Paso 4 — Identificación de break points

Un break point es una fricción que **causa abandono**, no solo molestia. Test:
- La fricción aparece en el mismo texto que un marcador de abandono ("decidí no…", "me cambié a…", "dejé de…", "no volví a…").
- El abandono se atribuye explícitamente a esa fricción.

**Solo las fricciones con co-ocurrencia explícita con marcadores de abandono se consideran break points.** Una fricción muy mencionada que no se asocia con abandono es ruido decorativo — el consumidor se queja pero compra igual.

Reportar break points jerarquizados por:
- Frecuencia de co-ocurrencia.
- Capacidad explicativa (cuánto del abandono total atribuye el corpus a esta fricción).
- Movilidad (¿se puede eliminar?).

### Paso 5 — Clasificación de movilidad

Cada fricción marcada con:

- **Movible directamente** — la marca puede eliminarla con cambio de producto, comunicación o experiencia bajo su control.
- **Movible indirectamente** — requiere coordinación con actor externo (logística, plataforma de pago, partner).
- **Estructural** — fuera del control. Solo se puede comunicar mejor que existe (ej. "el envío toma 7-10 días" — se puede comunicar mejor pero no eliminar).

### Paso 6 — Comparativo (si aplica)

Si hay corpus competitivo, comparar fricciones:
- ¿Qué fricciones tiene el competidor que la marca cliente no?
- ¿Qué fricciones tiene la marca cliente que el competidor no?
- ¿Cuáles son universales de categoría (ambos)?

Las fricciones diferenciales son las accionables más urgentes.

### Paso 7 — Síntesis del Friction Removal Roadmap

Priorizar intervenciones por:
1. Es break point (no solo fricción declarada).
2. Es movible directamente.
3. Tiene alto volumen + alta intensidad.
4. Costo de intervención manejable.

Roadmap secuencial, no lista paralela. Eliminar la fricción A puede afectar la fricción B — el orden importa.

## Criterios de codificación

### Diferenciar fricción articulada de break point

| Indicador                                                                       | ¿Es break point? |
| ------------------------------------------------------------------------------- | ---------------- |
| "Me molestó el formulario largo, pero terminé comprando"                        | NO               |
| "El formulario era larguísimo, abandoné y me fui a otro sitio"                  | SÍ               |
| "Me dio susto que no llegara a tiempo, pero llegó bien"                         | NO               |
| "Me dio susto que no llegara a tiempo, cancelé el pedido"                       | SÍ               |

Solo el segundo en cada par cuenta para break points.

### Confianza por fricción

- **Alta** — break point con ≥30 menciones, replicado en ≥3 fuentes.
- **Media** — break point con 10-30 menciones, en 2 fuentes.
- **Baja / direccional** — emergente, <10 menciones, 1 fuente.

### Excluir ruido

- Quejas que mencionan haber recibido un producto defectuoso individual (es defecto QC, no fricción de journey).
- Reviews de un solo issue muy específico que no se replica.
- Quejas sobre el competidor en review de la marca cliente (mal targeting de fuente).

## Formato de output

### Output 1 — Friction Map (matriz + JSON)

```json
{
  "journey": "compra primera vez",
  "fases_detectadas": ["...", "...", "..."],
  "matriz_friccion": {
    "checkout": {
      "inercia": { "menciones": 12, "intensidad_avg": 2.1, "movilidad": "directa", "es_breakpoint": false },
      "esfuerzo": { "menciones": 87, "intensidad_avg": 4.2, "movilidad": "directa", "es_breakpoint": true },
      "emocion": { "menciones": 23, "intensidad_avg": 3.4, "movilidad": "directa", "es_breakpoint": false },
      "reactancia": { "menciones": 34, "intensidad_avg": 3.8, "movilidad": "directa", "es_breakpoint": true }
    }
  },
  "limitaciones": "..."
}
```

### Output 2 — Break Points Brief (1-2 páginas)

Para cada break point (típicamente 3-5):
- Fase donde ocurre.
- Tipo de fricción.
- Frecuencia + intensidad + capacidad explicativa.
- Cita representativa.
- Movilidad.
- Hipótesis de remoción.

### Output 3 — Friction Removal Roadmap (narrativo, 2-4 páginas)

Secuencia priorizada de intervenciones. Por cada una:
- Fricción que ataca.
- Intervención específica.
- Costo estimado (alto / medio / bajo).
- Tiempo estimado.
- Indicador de éxito (cómo medir si funcionó).
- Riesgo de la intervención (qué podría empeorar).

## Quality gates

- [ ] Cada fase del journey tiene matriz completa de los 4 tipos de fricción.
- [ ] Break points están diferenciados de fricciones articuladas pero no decisivas.
- [ ] Cada fricción tiene movilidad asignada.
- [ ] El roadmap es secuencial, no lista paralela.
- [ ] Cada intervención lleva indicador de éxito.
- [ ] Cero recomendaciones sobre fricciones estructurales (solo comunicación, no eliminación).
- [ ] Confianza calibrada por hallazgo.

## Failure modes conocidos

| Síntoma                                                  | Causa                                                       | Cómo corregir                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Todas las fricciones se codifican como "Esfuerzo".       | Tipología no diferenciada en pase 2.                        | Re-leer con los 4 tipos lado a lado para forzar distinción.    |
| Hay 50 fricciones reportadas y ningún break point.       | Saltó el paso 4 — confunde fricción con break point.        | Reiniciar paso 4 buscando solo co-ocurrencia con abandono.    |
| El roadmap recomienda "mejorar UX" sin especificar.      | Falta paso 7 con intervenciones concretas.                  | Cada intervención debe ser implementable por una persona el lunes. |
| Tratar reactancia con descuentos.                        | Confusión de tipos. Reactancia se trata bajando presión, no agregando incentivo (que aumenta presión). | Revisar tipo de cada break point antes de recomendar intervención. |

## Versionado

| Fecha       | Cambio                                                                              | Razón                                                                |
| ----------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-05-04  | Versión inicial con tipología 4 tipos × fases emergentes + break points.            | Formaliza la distinción crítica entre fricción articulada y decisiva. |
