# Run Triggers & Barriers — Playbook operativo

> Protocolo ejecutable. Si tienes que recitar teoría, lo hiciste mal — eso vive en `01-methodologies/triggers-barriers.md`.
> Aquí solo se ejecuta.

## Inputs requeridos

| Input                          | Mínimo viable                                        | Ideal                                                       |
| ------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| Corpus de expresiones          | 800-1,500 piezas de texto                            | 3,000-5,000+                                                |
| Cobertura de fuentes           | ≥3 fuentes (1 review + 1 foro + 1 social)            | 5-7 fuentes incluyendo audio/video                          |
| Pregunta de negocio            | Una frase explícita                                  | Frase + contexto del cliente + decisión que se va a tomar   |
| Definición de categoría        | Ámbito, productos incluidos, competencia relevante   | Mismo + segmentos demográficos prioritarios                 |
| Window temporal del corpus     | ≤9 meses                                             | ≤6 meses, idealmente cubriendo un ciclo de compra completo  |
| **Opcional pero alto valor**   |                                                      |                                                             |
| Data de fricción transaccional | —                                                    | Tasas de abandono, motivos de cancelación de CRM            |
| Comparativo competitivo        | —                                                    | Mismo corpus para 1-3 competidores directos                 |

## Pre-flight check

Antes de ejecutar el protocolo, validar:

1. **¿Existe la pregunta de negocio?** Si no — abortar y solicitar. No producir output sin pregunta clara.
2. **¿El corpus cubre ≥3 fuentes distintas?** Si solo hay reviews de Amazon (por ejemplo), el output va a estar sesgado a una conversación específica de compra. Reportar limitación o pedir corpus adicional.
3. **¿La window temporal es ≤9 meses?** Si el corpus es más viejo, advertir explícitamente que el output describe un sistema motivacional que pudo haber cambiado.
4. **¿Hay balance mínimo entre triggers y barriers visibles en una primera ojeada?** Si el corpus es 95% reviews positivas (5★), está sesgado a triggers. Necesitas evidencia de fricción/abandono — pedir corpus adicional o ajustar fuentes.
5. **¿Idioma del corpus es uniforme?** Si mezcla español y portugués (por ejemplo), los criterios de codificación lingüística no aplican igual. Separar por idioma o reportar.

**Si cualquiera de los 5 falla → abortar, reportar el fallo, NO producir output parcial.**

## Protocolo

### Paso 1 — Pase abierto (clasificación emergente)

**Acción:** Lee el corpus completo sin tipología fija. Etiqueta cada pieza con 1-3 tags emergentes en lenguaje del corpus mismo (ej. "miedo a empeorar la piel", "no me cabe en la rutina", "todas mis amigas la usan").

**Criterio de éxito:** Al final del paso 1 hay entre 40-90 tags emergentes. Si hay <40, el pase fue superficial. Si hay >90, faltó agrupación intermedia.

**Si falla:** repetir con muestreo aleatorio de 200 piezas para calibrar antes de procesar el corpus completo.

### Paso 2 — Codificación contra protocolo (los 4 layers)

**Acción:** Toma cada tag emergente del paso 1 y aplícale **dos clasificaciones simultáneas**:

- **Eje 1 — Trigger / Barrier**: ¿esta expresión empuja hacia la decisión o la frena?
- **Eje 2 — Layer**: ¿psicológico / personal / social / cultural?

Para asignar el layer, usar los diagnósticos clínicos del archivo de metodología:

| Pregunta diagnóstica                                                                                              | Si sí → Layer  |
| ----------------------------------------------------------------------------------------------------------------- | -------------- |
| ¿Pasaría aunque el consumidor estuviera solo, sin presupuesto, sin contexto social ni cultural?                   | Psicológico    |
| ¿Cambia si tiene más dinero / más tiempo / hábito distinto / autoidentidad distinta?                              | Personal       |
| ¿Cambia si nadie va a enterarse jamás que lo usa?                                                                 | Social         |
| ¿Sería cierto incluso sin amigos ni redes, solo por lo que la categoría significa culturalmente en este mercado?  | Cultural       |

**Edge case — overlap entre layers:** una misma expresión puede tener componentes de varios layers. En ese caso, asignar el layer **dominante** (el que si lo quitas, la fuerza desaparece) y anotar el secundario en metadata.

**Criterio de éxito:** Al final del paso 2, cada pieza del corpus tiene exactamente una clasificación T/B y un layer dominante. <5% del corpus puede quedar como "ambiguo" — si más, el protocolo del paso 1 fue débil, regresar.

### Paso 3 — Jerarquización tridimensional

Para cada combinación (Trigger/Barrier × Layer), calcular:

- **Frecuencia** — número de piezas que caen en esa combinación.
- **Intensidad lingüística** — promedio de intensidad de las expresiones (escala 1-5; ver criterios en sección "Criterios de codificación" más abajo).
- **Capacidad predictiva** — % de las expresiones de esa combinación que coocurren con una decisión declarada (compra, abandono, recomendación, cambio de marca).

**No reportar solo frecuencia.** Una combinación con frecuencia 12 + intensidad 4.6 + predictiva 78% pesa más que una con frecuencia 200 + intensidad 2.1 + predictiva 11%.

### Paso 4 — Identificación de actionable vs. estructural

Para cada barrier y trigger jerarquizado, marcar:

- **Movible por la marca** — la marca puede activar/disolver con producto, comunicación, formato o precio.
- **Influenciable parcialmente** — la marca puede mover el dial pero no controlar (típicamente layer social).
- **Estructural** — fuera del control de la marca (típicamente layer cultural). Solo se puede elegir alinearse o salirse.

Esta distinción alimenta directamente el Activation Playbook y el Friction Removal Plan.

### Paso 5 — Comparativo (si aplica)

Si hay corpus competitivo, repetir pasos 1-4 para cada competidor. Construir tabla comparativa:

- Qué triggers comparten todos vs. cuáles son diferenciales.
- Qué barriers son universales de categoría vs. específicos de marca.

### Paso 6 — Síntesis para output

Con paso 4 completo, redactar los 3 entregables (ver sección "Formato de output").

## Criterios de codificación

### Intensidad lingüística (escala 1-5)

| Score | Descripción                                                     | Ejemplo (categoría skincare)                               |
| ----- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | Mención neutra, descriptiva                                     | "lo uso por las mañanas"                                   |
| 2     | Preferencia leve                                                | "me gusta más que la otra que probé"                       |
| 3     | Preferencia clara con razón                                     | "esto sí funciona, las demás me daban granitos"            |
| 4     | Afirmación intensa, lenguaje afectivo                           | "amo este producto, no puedo vivir sin él"                 |
| 5     | Lenguaje extremo, identitario o catártico                       | "esto literalmente cambió mi piel y mi autoestima"         |

**Aplica también a barriers** con intensidad negativa equivalente (1: "no me convence" → 5: "es lo peor que he probado, me dejó la cara destruida").

### Diferenciar triggers reales de testimoniales incentivados

Excluir o etiquetar como ruido:

- Reviews que mencionan haber recibido el producto gratis ("me lo regaló la marca", "PR package").
- Comentarios que repiten claims literales del packaging o del marketing oficial.
- Reseñas con timestamps sospechosos (>10 reviews del mismo perfil en una hora).

### Codificar capacidad predictiva

Una pieza tiene capacidad predictiva alta si en el mismo texto aparece una decisión declarada. Marcadores típicos:

- Compra: "lo compré", "lo voy a pedir", "ya lo tengo en el carrito".
- Abandono: "ya no lo uso", "lo cambié por X", "no lo vuelvo a pedir".
- Recomendación: "se lo recomendé a", "todas mis amigas tienen que probarlo".

Estos marcadores son lo que hacen una expresión accionable vs. expresiva.

## Formato de output

### Output 1 — Triggers & Barriers Map (matriz central)

Estructura JSON:

```json
{
  "categoria": "skincare premium",
  "pregunta_negocio": "...",
  "window_temporal": "ene-2026 a abr-2026",
  "tamaño_corpus": 4218,
  "fuentes": ["amazon_mx", "reddit_r_skincareaddiction_es", "tiktok_comments", "youtube_comments"],
  "matriz": {
    "psicologico": {
      "triggers": [
        {
          "id": "T-PSI-01",
          "nombre": "alivio sensorial inmediato",
          "frecuencia": 312,
          "intensidad_promedio": 3.8,
          "capacidad_predictiva": 0.62,
          "movilidad": "movible_por_marca",
          "cita_representativa": "...",
          "fuentes": ["amazon_mx", "reddit"]
        }
      ],
      "barriers": [...]
    },
    "personal": { "triggers": [...], "barriers": [...] },
    "social":   { "triggers": [...], "barriers": [...] },
    "cultural": { "triggers": [...], "barriers": [...] }
  },
  "limitaciones_de_esta_corrida": "..."
}
```

### Output 2 — Activation Playbook (narrativo, 1-2 páginas)

Estructura:

1. **Top 3 triggers movibles** (con layer de origen, evidencia y acción derivable).
2. **Por cada trigger:** medio recomendado, tono recomendado, riesgo de saturación.
3. **Triggers a evitar** (los que están "agotados" en la categoría — todos los competidores los usan, ya no diferencian).

### Output 3 — Friction Removal Plan (narrativo, 1-2 páginas)

Estructura:

1. **Top 3 barriers movibles** (con layer, evidencia, hipótesis de remoción).
2. **Por cada barrier:** intervención sugerida (producto / comunicación / formato / precio), nivel de inversión estimado, indicador de éxito.
3. **Barriers estructurales** (los que no se mueven). Recomendación: ignorar o salirse.

### Output 4 — Comparative Brief (si aplica)

Tabla cruzada por competidor con: triggers compartidos, triggers diferenciales, barriers compartidos, barriers diferenciales. + Lectura estratégica de 1 página.

## Quality gates

Un output T&B no se entrega sin pasar:

- [ ] Cada hallazgo en los 3 entregables apunta de vuelta al corpus (cita o ID de pieza).
- [ ] Los 4 layers están representados — si un layer está vacío, está justificado en "limitaciones de esta corrida".
- [ ] Cada trigger/barrier tiene los 3 ejes (frecuencia, intensidad, predictiva), no solo frecuencia.
- [ ] La sección "movible / estructural" está completa — no se entregan recomendaciones sobre lo estructural.
- [ ] Hay sección explícita de "Lo que esta corrida no respondió".
- [ ] Confianza calibrada por hallazgo (alta / media / baja según P7 de principios).
- [ ] Cero proyecciones futuras sin evidencia presente (P8).

Si falla cualquier gate → no entregar. Volver al protocolo.

## Failure modes conocidos

| Síntoma                                                                | Causa probable                                          | Cómo corregir                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| El layer cultural sale vacío.                                          | Corpus puramente transaccional (solo reviews).          | Sumar fuentes editoriales/foros/podcast donde se discute la categoría como tema. |
| Todo se está codificando como "psicológico — emocional".               | El paso 1 (pase abierto) fue superficial.               | Repetir paso 1 con tags más finos antes del paso 2.                            |
| Muchos triggers, pocos barriers.                                       | Corpus sesgado a reviews positivas.                     | Sumar fuentes de fricción: foros de queja, reviews 1-3★, comentarios de abandono. |
| Frecuencia inflada por una sola fuente.                                | Una plataforma domina el corpus (>60%).                 | Re-balancear muestreo o reportar como limitación explícita.                    |
| El cliente dice "no encontramos nada nuevo".                           | El protocolo confirmó hipótesis previas — éxito parcial. | Si los hallazgos jerarquizan diferente lo que el cliente ya intuía, eso ya es valor accionable. Si no, T&B no era la metodología correcta — probablemente se necesitaba Cultural Codes Decoding. |
| La IA está recitando teoría de Kahneman en el output.                  | Confundió playbook con archivo de metodología.          | Re-prompt: "ejecuta protocolo, no expliques teoría — el cliente lee output, no manual". |

## Versionado

| Fecha       | Cambio                                                                              | Razón                                                                                  |
| ----------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 2026-05-04  | Versión inicial del playbook con estratificación 4 layers (psi/per/soc/cul).        | Captura por primera vez la lógica de layers que se usaba implícitamente sin documentar. |
