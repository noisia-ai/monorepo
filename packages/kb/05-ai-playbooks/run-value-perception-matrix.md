# Run Value Perception Matrix — Playbook operativo

## Inputs requeridos

| Input                          | Mínimo viable                                            | Ideal                                                |
| ------------------------------ | -------------------------------------------------------- | ---------------------------------------------------- |
| Marca cliente + competidores   | Cliente + 2 competidores directos                        | Cliente + 4-6 competidores incluyendo low-cost y premium |
| Corpus por marca               | 600-1,200 expresiones                                    | 1,500-3,000 por marca                                |
| Window temporal uniforme       | Misma window para todas las marcas, ≤9 meses             | ≥12 meses cubriendo al menos un ciclo de pricing     |
| Frame competitivo definido     | Lista explícita de competidores con criterio de inclusión | Lista validada con cliente + 1-2 competidores "indirectos" para detección de re-categorización |
| Pregunta de negocio            | Una frase                                                | Frase + decisión específica (pricing, posicionamiento, defense) |

## Pre-flight check

1. **¿Hay simetría de fuentes entre marcas?** Si para la marca cliente tenemos reviews + foros + social, para cada competidor también. Si la marca cliente tiene 5x más fuentes que el competidor, la matriz está inflada artificialmente.
2. **¿La window temporal es la misma para todos?** Si para una marca tenemos 12 meses y para otra 6, las celdas no son comparables.
3. **¿Hay al menos 600 expresiones por marca?** Si no, la marca con poca data no se puede mapear con confianza — reportar como "no comparable" en lugar de incluirla con baja base.
4. **¿La definición de categoría es estable?** Si los competidores no compiten realmente entre sí (operan en sub-segmentos distintos), la matriz cruza cosas distintas. Validar antes.

**Si falla cualquiera → abortar o reportar limitación explícita en el output final.**

## Protocolo

### Paso 1 — Reconstrucción del frame competitivo desde el corpus

**Acción:** Extraer del corpus de la marca cliente menciones de comparación. Frases tipo "X vs. Y", "antes usaba…", "me cambié de… a…", "pensaba comprar… pero al final…".

**Criterio de éxito:** una lista de competidores **mencionados orgánicamente** por el consumidor, con frecuencia de mención. Comparar esta lista con la lista del cliente — si difiere significativamente, ahí ya hay un hallazgo (el cliente cree que compite contra X pero el consumidor lo compara con Y).

**Si falla:** corpus muy positivo / muy poco comparativo. Aumentar fuentes con foros y comparadores.

### Paso 2 — Extracción de dimensiones de evaluación emergentes

**Acción:** Pase abierto sobre el corpus. ¿Qué criterios usa el consumidor para evaluar? Lista emergente sin tipología fija.

**Criterio de éxito:** 15-30 dimensiones emergentes ("dura más", "huele mejor", "no me deja la piel grasa", "es más cara pero rinde más", "marca más confiable").

### Paso 3 — Mapeo de dimensiones emergentes a la matriz 4×3

Para cada dimensión emergente, asignar:
- **Eje costo** (Monetario / Tiempo / Esfuerzo / Riesgo).
- **Eje beneficio** (Funcional / Emocional / Simbólico).

Tabla guía:

| Dimensión emergente típica                 | Eje costo  | Eje beneficio |
| ------------------------------------------ | ---------- | ------------- |
| "es cara pero rinde más"                   | Monetario  | Funcional     |
| "vale lo que cuesta porque me da paz"      | Monetario  | Emocional     |
| "pago más por el packaging"                | Monetario  | Simbólico     |
| "se aplica en 30 segundos"                 | Tiempo     | Funcional     |
| "es relajante el ritual"                   | Tiempo     | Emocional     |
| "no tengo que pensar, viene en kit"        | Esfuerzo   | Funcional     |
| "se siente cuidarme, no obligación"        | Esfuerzo   | Emocional     |
| "me da seguridad que sea de farmacia"      | Riesgo     | Funcional     |
| "no me dio miedo probarla"                 | Riesgo     | Emocional     |
| "me hace sentir parte de la comunidad X"   | (cualquiera) | Simbólico    |

Edge case: una dimensión puede caer en dos celdas (ej. "rinde más por el precio" — Monetario × Funcional, pero también Riesgo × Funcional si el subtexto es "no me arriesgo a que se acabe rápido"). Asignar la celda dominante; anotar la secundaria.

### Paso 4 — Codificación por marca

Para cada marca (cliente + competidores), por cada celda de la matriz:

- ¿Cuántas menciones positivas tiene?
- ¿Cuántas menciones negativas?
- ¿Cuál es el **score relativo** vs. el promedio de la categoría en esa celda?

Score relativo: si la categoría tiene 60% de menciones positivas en (Monetario × Funcional), una marca con 75% capitaliza esa celda; una con 45% la está abandonando.

### Paso 5 — Identificación de los 4 hallazgos clave

- **Capitalización** → celdas donde la marca cliente está significativamente arriba del promedio.
- **Abandono** → celdas donde la marca cliente está abajo y al menos un competidor está arriba.
- **Whitespace** → celdas donde nadie está significativamente arriba del promedio (oportunidad).
- **Brand tax** → celdas donde la marca cliente está abajo del promedio Y cobra un premium en la categoría. Insostenible.

### Paso 6 — Hipótesis de re-categorización

Si la matriz revela que el cliente capitaliza fuerte en celdas que sus competidores asumidos no priorizan, puede ser señal de que la marca compite en una categoría diferente a la que asume. Reportar como hipótesis para validar.

## Criterios de codificación

### Mención positiva vs. negativa

- **Positiva** — el consumidor expresa la dimensión como ventaja: "es lo que me hace volver", "lo único que vale la pena".
- **Negativa** — la expresa como falla: "lo único que no me gusta", "si no fuera por X la dejaba".
- **Neutral** — descripción funcional sin valoración. No entra al cálculo.

### Diferenciar valor percibido de claim de marca

Excluir o etiquetar como ruido:
- Citas que reproducen literalmente packaging o copy oficial.
- Reviews que mencionan haber recibido el producto gratis.
- Frases genéricas sin sustento ("es la mejor crema del mundo" sin razón).

Lo que entra: la frase específica donde el consumidor articula **por qué** una dimensión es valiosa para él.

### Score relativo vs. absoluto

VPM nunca reporta scores absolutos ("la marca X es 78% positiva en monetario × funcional"). Reporta scores **relativos al promedio de la categoría** ("la marca X está 15 puntos arriba del promedio de la categoría en esa celda"). Eso es lo que protege contra falsa precisión y mantiene el carácter comparativo de la metodología.

## Formato de output

### Output 1 — Value Perception Matrix (JSON)

```json
{
  "categoria": "skincare premium",
  "frame_competitivo": {
    "marca_cliente": "...",
    "competidores": ["...", "...", "..."],
    "frame_validado_por": "consumidor (paso 1) + cliente"
  },
  "matriz": {
    "monetario_funcional": {
      "score_promedio_categoria": 0.62,
      "marca_cliente":  { "score": 0.74, "delta": 0.12, "estado": "capitaliza" },
      "competidor_a":   { "score": 0.55, "delta": -0.07, "estado": "abandona" }
    },
    "monetario_emocional":   { ... },
    "monetario_simbolico":   { ... },
    "tiempo_funcional":      { ... },
    "tiempo_emocional":      { ... },
    "tiempo_simbolico":      { ... },
    "esfuerzo_funcional":    { ... },
    "esfuerzo_emocional":    { ... },
    "esfuerzo_simbolico":    { ... },
    "riesgo_funcional":      { ... },
    "riesgo_emocional":      { ... },
    "riesgo_simbolico":      { ... }
  },
  "hallazgos_principales": {
    "celdas_capitalizadas": [...],
    "celdas_abandonadas": [...],
    "whitespaces": [...],
    "brand_tax_detectado": [...]
  },
  "limitaciones_de_esta_corrida": "..."
}
```

### Output 2 — Whitespace Report (narrativo)

Para cada celda whitespace identificada:
- Por qué está vacante (qué nadie está diciendo bien).
- Hipótesis de qué marca podría ocuparla.
- Costo estimado de ocupación (qué tendría que cambiar comunicación / producto / pricing).
- Riesgo de ocuparla (¿realmente importa al consumidor o está vacante porque no hay demanda?).

### Output 3 — Defense Brief (narrativo)

Para cada celda donde la marca pierde:
- Quién está ganando esa celda y con qué argumento.
- Hipótesis de por qué la marca cliente no la captura.
- Plan de defensa: comunicar mejor lo que ya hace, cambiar lo que hace, o salirse de la celda.

### Output 4 — Recategorization Hypothesis (si aplica)

Cuando los hallazgos sugieren competencia en categoría distinta. 1 página máximo, con evidencia.

## Quality gates

- [ ] Las 12 celdas tienen al menos un score reportado (aunque sea "datos insuficientes para esta celda").
- [ ] Cada hallazgo apunta a evidencia citable del corpus.
- [ ] Los scores son **relativos al promedio**, nunca absolutos.
- [ ] El frame competitivo está validado contra el corpus (paso 1) — no solo contra la lista del cliente.
- [ ] Hay sección "Limitaciones de esta corrida" con cobertura de fuentes y window temporal.
- [ ] Cero proyección de elasticidad de precio o lift esperado.

## Failure modes conocidos

| Síntoma                                              | Causa                                                           | Cómo corregir                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Toda la matriz se concentra en (Monetario × Funcional). | Corpus dominado por reviews de e-commerce.                      | Sumar fuentes con conversación cualitativa (foros, video, podcasts). |
| Las celdas simbólicas están todas vacías.            | El corpus no captura discurso de identidad / marca.             | Sumar fuentes editoriales y comunitarias.                           |
| El competidor sale "ganando todo".                   | Corpus de la marca cliente sesgado a quejas.                    | Re-balancear con reviews positivas o reportar el sesgo como hallazgo.  |
| El cliente dice "esto ya lo sabíamos".               | El protocolo confirmó intuiciones, valor menor.                 | Si la matriz revela la magnitud relativa o detecta brand tax oculto, eso ya es nuevo. Si solo confirma rankings, VPM no era la metodología correcta. |

## Versionado

| Fecha       | Cambio                                                                  | Razón                                                          |
| ----------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| 2026-05-04  | Versión inicial con matriz 4×3 (4 dimensiones costo × 3 tipos beneficio). | Captura formalmente la doble codificación que se usaba implícitamente. |
