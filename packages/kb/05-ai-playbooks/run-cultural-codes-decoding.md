# Run Cultural Codes Decoding — Playbook operativo

## Inputs requeridos

| Input                          | Mínimo viable                                                  | Ideal                                                           |
| ------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Corpus culturalmente denso     | 1,200-2,000 piezas con texto >150 palabras promedio            | 3,000+ piezas, mezcla generacional digital                      |
| Fuentes obligatorias           | Foros + comunidades + comentarios largos en YouTube/blogs      | + podcasts transcritos + ensayos en Substack/Medium + editorial |
| Mercado geográfico             | País específico                                                | País + comparativo de mercados adyacentes                       |
| Window temporal                | ≤12 meses                                                      | ≤24 meses con detección de cambio temporal                      |
| Pregunta de negocio            | Una frase                                                      | Frase + decisión específica (entrada a mercado, repositioning, etc.) |
| Idioma                         | Uniforme                                                       | Si hay code-switching, anotarlo como dato — es información cultural |

## Pre-flight check

1. **¿El corpus tiene densidad cultural suficiente?** Promedio de palabras por pieza ≥150. Si el corpus es 80% reviews cortas tipo "muy bueno, recomiendo", **abortar** o pedir corpus complementario.
2. **¿Hay fuentes culturalmente densas (no solo transaccionales)?** Mínimo: 1 foro + 1 comunidad + 1 fuente editorial o de discurso largo. Sin esto, el output cae en obviedades.
3. **¿El mercado geográfico está delimitado?** Cultural Codes no se hace "para LATAM" — se hace por país. Argentina y México no comparten el mismo sistema simbólico aunque hablen idiomas similares.
4. **¿La pregunta de negocio es sobre significado y no sobre comportamiento?** Si la pregunta es "¿cuántos compran X?", esta no es la metodología. Si es "¿qué significa comprar X?", sí.

**Si falla → abortar y reportar.**

## Protocolo

### Paso 1 — Inmersión con suspensión de juicio

**Acción:** Lectura completa del corpus sin codificar. Solo subrayar. Tomar notas etnográficas — qué llama la atención, qué se repite, qué se omite, qué se da por obvio.

**Criterio de éxito:** una libreta (literalmente — un .md aparte) con ~80-150 observaciones de "primer impacto". Sin estructura todavía.

**Por qué este paso:** Cultural Codes opera en tradición Geertz (`Thick Description`). Saltarse la inmersión y pasar directo a codificar produce output decoración — lugares comunes vestidos de marco teórico.

### Paso 2 — Identificación de palabras, metáforas y comparaciones recurrentes

Listas separadas:

- **Vocabulario distintivo** — palabras que aparecen mucho más que en discurso general (ej. "ritual", "dupe", "clean girl", "performativo").
- **Metáforas recurrentes** — comparaciones que estructuran cómo se habla de la categoría (ej. en skincare: "rutina como armadura", "piel como lienzo", "edad como enemigo").
- **Categorías nativas** — taxonomías que el consumidor usa que el cliente no usa (ej. "skincare flojo / serio / pro" — no es "casual / advanced").

Frecuencia + intensidad por término. Lo distintivo del corpus, no lo genérico.

### Paso 3 — Detección de oposiciones binarias operativas

Para cada vocabulario / metáfora distintiva, preguntarse: ¿qué se opone a esto en el corpus?

- Si "auténtico" es palabra distintiva → ¿qué es "no-auténtico"? Buscar en el corpus.
- Si "ritual" es metáfora → ¿qué se opone a "ritual"? ¿"Apuro"? ¿"Trámite"? ¿"Vanidad"?

Construir lista de 8-15 oposiciones binarias con polo legitimado vs. polo marcado **según el corpus**.

**Edge case:** una oposición puede tener polos invertidos por sub-comunidad. En r/SkincareAddictionES "minimalista" puede ser legitimado, en TikTok "aesthetic maximalista" puede ser legitimado. Reportar las dos lecturas — la diferencia es información estratégica.

### Paso 4 — Codificación de los 3 niveles (Barthes)

Para cada elemento dominante de la categoría (producto, marca, ritual, vocabulario), codificar simultáneamente:

- **Denotación** — significado literal funcional.
- **Connotación** — asociaciones inmediatas detectables en el corpus.
- **Mito** — qué función cultural cumple este elemento en la narrativa de mercado.

Si el corpus no permite llegar a nivel mito (los textos son muy transaccionales), **decirlo explícitamente**. No fabricar mitos donde no hay evidencia.

### Paso 5 — Mapeo de tensiones simbólicas activas

Las **tensiones** son donde dos códigos legitimados se contradicen. Son los espacios narrativos donde una marca puede operar productivamente. Ejemplos:

- "El cuidado es derecho propio" ↔ "El cuidado visible es vanidad".
- "Productos naturales son superiores" ↔ "Productos clínicos son los que funcionan".
- "Marca local = autenticidad" ↔ "Marca global = calidad asegurada".

Para cada tensión: qué la sostiene, qué marcas están de cada lado, qué espacio queda para una posición integradora.

### Paso 6 — Posicionamiento de marcas en el sistema

Tomar la lista de marcas relevantes (cliente + competidores + actores adyacentes). Por cada marca:
- ¿En qué polo de cada oposición se ubica?
- ¿Qué nivel del sistema ocupa (denotación / connotación / mito)?
- ¿Qué tensiones está navegando bien? ¿Cuáles está ignorando?

Output: el `Symbolic Map`.

### Paso 7 — Identificación de posiciones vacantes

Posiciones simbólicas legítimas (el corpus las legitima) pero no ocupadas por ninguna marca. Estas son las oportunidades estratégicas.

**No toda posición vacante es accesible.** Una marca cliente puede no tener permiso para ocuparla por su historia. Reportar viabilidad.

## Criterios de codificación

### Diferenciar denotación / connotación / mito

| Nivel        | Test                                                                                    | Ejemplo (skincare)                                                |
| ------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Denotación   | Significado literal, refutable empíricamente.                                            | "El retinol es un derivado de vitamina A".                        |
| Connotación  | Asociación que el consumidor tiene aunque no esté en el producto.                       | "Retinol = compromiso serio con la piel, anti-aging real".        |
| Mito         | Función ideológica más amplia. Estructura cómo se piensa la categoría completa.         | "El cuidado de la piel = capacidad de cuidarse a sí mismo = autoestima validada culturalmente". |

Test rápido: si lo dice el packaging, es denotación. Si lo asume el consumidor sin que el packaging lo diga, es connotación. Si funciona como narrativa cultural compartida más allá de la marca, es mito.

### Diferenciar oposición real vs. obviedad

- ❌ "Bueno ↔ Malo" — no es oposición operativa, es valoración trivial.
- ✅ "Self-care como derecho ↔ Self-care como performance" — es operativa porque distintos polos legitiman distintas estrategias.

Test: si los dos polos producen estrategias de marca distintas, es oposición operativa. Si solo uno tiene sentido comercial, es obviedad.

### Confianza por hallazgo

Cultural Codes es interpretativa. La confianza no es estadística, es de **densidad evidencial**:

- **Alta** — el código aparece en ≥4 fuentes distintas, con vocabulario consistente, replica entre sub-comunidades.
- **Media** — aparece en 2-3 fuentes, vocabulario reconocible.
- **Baja** — emergente, una sola fuente, vocabulario aún en formación.

Reportar confianza por código y por tensión.

## Formato de output

### Output 1 — Cultural Code Dossier (narrativo, 8-15 páginas)

Estructura:
1. **Categoría definida** — qué se considera dentro/fuera del scope.
2. **Vocabulario distintivo** — términos clave con definición situada.
3. **Sistema de oposiciones binarias** — 8-15 oposiciones con polo legitimado y polo marcado.
4. **Los 3 niveles** — para los 5-7 elementos dominantes de la categoría.
5. **Tensiones simbólicas activas** — los espacios narrativos disponibles, cada uno con evidencia.
6. **Confianza calibrada** por hallazgo.

### Output 2 — Symbolic Map (visualización + leyenda)

Mapa visual: ejes son las 2-3 oposiciones más estructurantes; las marcas se ubican como puntos. Leyenda explica cada eje.

### Output 3 — Code Strategy Brief (1-3 páginas)

Para la marca cliente:
- **Código que ocupa hoy** (con evidencia).
- **Código que podría ocupar** (posiciones vacantes accesibles).
- **Tensiones que conviene navegar / ignorar**.
- **Riesgos** — qué códigos están perdiendo legitimación, qué tabúes evitar.

## Quality gates

- [ ] Hay al menos 8 oposiciones binarias documentadas.
- [ ] Los 3 niveles (denotación/connotación/mito) están reportados — o la ausencia del nivel mito está justificada.
- [ ] Cada código importante apunta a evidencia citable.
- [ ] Hay sección de tensiones simbólicas (no solo descripción de polos).
- [ ] La marca cliente está ubicada explícitamente en el sistema.
- [ ] Hay confianza calibrada por hallazgo.
- [ ] Cero generalizaciones ("a los X les importa Y") sin evidencia local.

## Failure modes conocidos

| Síntoma                                                  | Causa                                                          | Cómo corregir                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| El output dice cosas como "la familia es central en LATAM". | El analista (o IA) saltó el paso 1 y reciclo lugares comunes.   | Reiniciar desde paso 1. La inmersión es no-negociable.           |
| Solo se llega a connotación, no a mito.                   | Corpus puramente transaccional.                                 | Sumar fuentes editoriales / comunitarias / discursivas.          |
| Las oposiciones son binarias triviales (bueno/malo).      | Falta paso 3 con preguntas operativas.                          | Re-codificar preguntando "¿qué se opone a esto en el corpus?".   |
| Una IA produce output con marcos foráneos sin anclar.     | No se respetó la tradición Geertz (leer desde adentro).         | Re-prompt: "el sistema simbólico es del corpus; los marcos teóricos sirven solo para nombrar lo que ya está en él". |

## Versionado

| Fecha       | Cambio                                                                                | Razón                                                                            |
| ----------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 2026-05-04  | Versión inicial con doble codificación (3 niveles Barthes + oposiciones binarias).    | Formaliza el cruce que evita output decorativo.                                  |
