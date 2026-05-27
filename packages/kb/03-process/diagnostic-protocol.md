# Diagnostic Protocol

> **El diagnóstico previo es siempre el primer paso. Es gratuito, dura 8-10 minutos del cliente, y lo lee un arquitecto Noisia.**
> Sin diagnóstico, no hay propuesta. La integridad de Noisia depende de este filtro.

## Para qué existe el diagnóstico

1. **Definir la pregunta.** Si la pregunta no es nítida, el problema todavía no está listo para inteligencia social — está en fase de exploración interna del cliente.
2. **Estimar metodología(s) aplicable(s).** No por preferencia — por fit con la pregunta.
3. **Estimar fuentes a orquestar.** Más nicho = más caro (ver pricing-logic.md).
4. **Estimar alcance, equipo y modalidad.** El tier sale del diagnóstico, no se decide por presupuesto del cliente.
5. **Filtrar mismatch.** Si Noisia no es la firma correcta para esta pregunta, decirlo y no proponer.

## Estructura del diagnóstico (lado del cliente)

Lo que el cliente completa en `/diagnostico`. 5 pasos, 8-10 minutos.

### Paso 1 — Situación

Una de las 7 opciones (6 situaciones canónicas + "otra"):

- No sé por qué la gente no compra.
- Mi competencia me come share.
- Mi journey está roto y no sé dónde.
- No sé qué territorio creativo defender.
- Mi comunicación no llega a los nodos correctos.
- El consumidor decide lento en mi categoría.
- Otra pregunta estratégica (texto libre).

### Paso 2 — Caso de uso

Selección de uno de los 6 casos canónicos (o múltiples si aplica):

- Lanzamiento de campaña.
- Optimización de medios.
- Desarrollo de producto.
- Nuevo mercado.
- Defensa competitiva.
- Anticipación de tendencias.

### Paso 3 — Evidencia disponible

Multi-select: Research de mercado / Data propia / Social listening / Análisis competitivo / Focus groups / Data CRM-ventas / Nada todavía.

### Paso 4 — Categoría y mercado

Industry (de un set de ~10) + países donde opera la decisión.

### Paso 5 — Contacto

Nombre + email + teléfono opcional.

## Lo que pasa internamente con el diagnóstico

### Recepción y triage (24-48hrs)

1. El form llega a `fer@noisia.ai` (vía Resend API; ver `src/app/api/diagnostico/route.ts`).
2. Triage rápido: ¿el caso es Noisia? ¿Hay mismatch obvio?
3. Si es mismatch claro: respuesta honesta al cliente sugiriendo otras alternativas. **No se intenta vender.**
4. Si es fit: asignación a un arquitecto.

### Lectura por arquitecto

El arquitecto asignado:
1. Lee el diagnóstico completo.
2. Pre-investiga la categoría y los competidores mencionados (15-30 min de lectura).
3. Identifica:
   - Pregunta de negocio formulable a partir de la situación + caso.
   - Metodología(s) aplicable(s) con justificación.
   - Fuentes que probablemente importarán.
   - Tier estimado (Foundation / Intelligence / Strategy).
4. Prepara 3-5 preguntas para profundizar antes de proponer.

### Llamada de discovery (30 min)

- No es pitch. Es lectura mutua.
- El arquitecto presenta: "esto es lo que entendí, ¿qué falta?".
- El cliente clarifica la pregunta.
- Se valida si el tier estimado se sostiene.
- Se acuerda enviar propuesta o cerrar amablemente.

### Propuesta

La propuesta sale **después** de la llamada, no antes. Incluye:
- Pregunta de negocio reformulada para validación.
- Metodologías aplicables y por qué.
- Fuentes a orquestar.
- Equipo, timeline, modalidad.
- Pricing (con desglose conceptual, no de horas).
- Limitaciones explícitas — qué la propuesta no responderá.

## Cuándo se cierra amablemente sin proponer

Mismatch típicos donde Noisia decide no avanzar:

1. **No hay decisión enfrente.** El cliente quiere "panorama de la categoría" sin pregunta. Recomendación: regresar cuando haya decisión específica.
2. **El cliente quiere herramienta, no inteligencia.** Si lo que necesita es un dashboard configurable, recomendar tools (Brandwatch, Sprinklr, Talkwalker).
3. **El cliente quiere certeza cuantitativa.** Si pide elasticidad de precio o forecasting, recomendar firms cuantitativas.
4. **El cliente quiere validar con NDA antes de cualquier conversación.** Es válido y normal — Noisia firma NDA estándar antes de avanzar. Si el cliente no quiere firmar el NDA estándar y quiere uno propio con términos restrictivos (ej. exclusividad amplia, IP transfer), evaluar caso por caso.
5. **El cliente está en categoría con conflictos de intereses activos** (Noisia ya opera para un competidor directo en mercado solapado). Declinar transparentemente.

## La pregunta detrás del paso 1 del diagnóstico

Las 6 situaciones canónicas no son aleatorias. Cada una mapea a una metodología prioritaria:

| Situación                                                       | Metodología(s) primaria(s)                              |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| No sé por qué la gente no compra                                | Triggers & Barriers                                     |
| Mi competencia me come share                                    | Triggers & Barriers + Value Perception Matrix          |
| Mi journey está roto y no sé dónde                              | Journey Friction Mapping                                |
| No sé qué territorio creativo defender                          | Cultural Codes Decoding                                 |
| Mi comunicación no llega a los nodos correctos                  | Influence Architecture                                  |
| El consumidor decide lento en mi categoría                      | Decision Velocity                                       |

Esto le permite al `MethodologyWizard` del sitio público (en `/metodologias`) llevar al usuario directo al protocolo correcto. La lógica está duplicada **a propósito** — el wizard del sitio guía discovery; este KB documenta la lógica para Noisia.

## Cómo el diagnóstico alimenta el wizard del sitio

Si el usuario llegó al `/diagnostico` desde el `MethodologyWizard` o desde un caso de uso (`/casos-de-uso/<slug>`), su selección queda en `localStorage` (`noisia-diag-ctx`, TTL 48h). El wizard de diagnóstico la pre-llena. Eso reduce fricción y mejora calidad de input.

Detalle técnico en: `src/lib/diagContext.ts` y `src/components/forms/DiagnosticWizard.tsx`.

## Métricas operativas del diagnóstico (interno)

Para auditoría trimestral del proceso:
- # diagnósticos recibidos / # diagnósticos calificados / # propuestas enviadas / # propuestas firmadas.
- Tiempo promedio entre diagnóstico recibido → propuesta enviada (target: ≤7 días hábiles).
- Tasa de mismatch declarado (target: 20-35% es saludable; <10% sugiere que se está vendiendo mal-fits).

## Lo que el diagnóstico NO es

- ❌ Cuestionario de venta. No incluye preguntas tipo "¿cuál es tu presupuesto?".
- ❌ Brief de RFP. El cliente no necesita haber hecho su tarea — la conversación de discovery la completa.
- ❌ Compromiso. El cliente no firma nada al completarlo.
- ❌ Auto-respuesta. No hay propuesta automatizada — un humano lee cada diagnóstico.

## Referencias

- Form: `src/components/forms/DiagnosticWizard.tsx`.
- API: `src/app/api/diagnostico/route.ts`.
- Context: `src/lib/diagContext.ts`.
- Sitio público: `/diagnostico` y `/metodologias` (con wizard).
