# Corpus Construction

> **El corpus se arma por pregunta, no por default.** Lo que entra al corpus y lo que se excluye define la calidad del output.
> Este archivo describe cómo se construye un corpus Noisia y qué controles aplican.

## Las 4 capas operativas (de `dataLayers` en site.ts)

### Capa 1 — Ingesta

- 150+ fuentes orquestadas como universo posible (no todas se activan en cada proyecto).
- 10,000+ scrapers especializados para fuentes que no tienen API.
- APIs nativas donde existen (X, Reddit, YouTube Data API, Spotify, App Store).
- Ingesta de podcasts (con transcripción), video (con transcripción), texto largo.

**La cobertura se arma por pregunta.** Si la pregunta es Cultural Codes en categoría food, se priorizan foros gastronómicos, podcasts de cocina, YouTube de cocineros, y se desprioriza X (donde la conversación es plana). Si la pregunta es Influence Architecture en gaming, se priorizan Discord, Twitch, X gaming, y Reddit gaming-específico.

### Capa 2 — Normalización

Antes de codificar, cada pieza pasa por:
- Esquema único: { id, source, author_id, timestamp, text, language, url, metadata }.
- Deduplicación cross-source (un post replicado en X, IG y Threads cuenta como una pieza, no tres).
- Atribución del autor cuando es posible (perfil, historial, comunidad).
- Metadatos comparables (engagement bruto se normaliza a percentil dentro de su plataforma — 1k de likes en X ≠ 1k en TikTok).
- Traducción cuando el corpus es multi-idioma y la metodología requiere análisis cruzado.

**Sin esta capa, comparar plataformas es comparar cosas distintas.** Es la diferencia entre Noisia y "exporto un CSV de Brandwatch".

### Capa 3 — Enriquecimiento

Cada pieza recibe tags de:
- Clasificación temática (qué temas toca dentro de la categoría).
- Entidades nombradas (marcas, productos, personas, lugares).
- Sentimiento multidimensional (no positivo/negativo plano — emociones específicas: frustración, deseo, ironía, etc.).
- Sarcasmo contextual (¿el "está buenísima" es literal o irónico? Detectar requiere context).
- Tensión narrativa (¿qué oposiciones simbólicas activa esta pieza?).

**El sentiment plano no resuelve preguntas reales.** Por eso esta capa es no-negociable.

### Capa 4 — Analítica

Las metodologías corren sobre el corpus normalizado y enriquecido. Cada output mantiene trazabilidad de vuelta a la fuente original. Ver `03-process/evidence-traceability.md`.

## Tipos de fuente

(De `sourceTypes` en `site.ts`.)

| Categoría                    | Cuándo entra                                                    | Limitaciones                                              |
| ---------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| Redes sociales abiertas      | Todas las metodologías. Casi siempre.                           | Sesgo a recencia, fragmentación, sentiment plano sin contexto. |
| Foros nicho                  | Cultural Codes, Influence Architecture, T&B en categorías técnicas. | Cobertura demográfica restringida, vocabulario hermético. |
| Reviews de e-commerce y apps | T&B, VPM, JFM. Casi siempre.                                    | Sesgo a polos extremos (5★/1★), incentivos por descuento. |
| News y editoriales           | Cultural Codes, Influence Architecture (en crisis y tendencias). | Filtro de gatekeepers, agenda editorial.                  |
| Blogs y newsletters          | Cultural Codes, IA. Categorías con discurso largo.              | Audiencia auto-selecta.                                   |
| Podcasts transcritos         | Cultural Codes (densidad cultural alta), IA (hubs especializados). | Costo de transcripción, calidad variable.                |
| Video transcrito             | Decision Velocity, IA, Cultural Codes (TikTok, YouTube).        | Mismo + latencia de procesamiento.                       |
| Q&A de marketplaces          | T&B (sobre todo barriers), JFM (fricciones articuladas).        | Sesgo a casos problema.                                  |
| Comunidades accesibles       | IA (Discord públicos, Slack públicos), Cultural Codes.          | Acceso variable; algunas requieren membresía.            |
| Marketplaces especializados  | T&B, VPM (categorías nicho).                                    | Volumen bajo pero alta densidad.                         |

## Criterios de inclusión / exclusión

### Lo que entra al corpus

- Conversación espontánea (el usuario escribió algo cuando nadie le estaba preguntando).
- Texto con suficiente densidad (>30 palabras para reviews, >50 para foros, >100 para discurso largo). Excepción: comentarios cortos en threads largos cuentan si hay context circundante.
- Conversación dentro del window temporal definido.
- Conversación atribuible a un autor identificable (handle, perfil) o a una comunidad delimitada.

### Lo que NO entra (o entra etiquetado como ruido)

- Content de marca (posts oficiales, anuncios, campañas, comunicados).
- Testimoniales incentivados explícitos ("me regalaron este producto", "PR package").
- Reseñas con timestamps sospechosos (>10 reviews del mismo perfil en una hora — bots o farms).
- Repeticiones literales de claims oficiales (señal de copy-paste, no de consumidor real).
- Posts con métricas de engagement compradas (ratio sospechoso de followers a interacción).
- Conversación de bots o cuentas con patrones automatizados detectables.
- Conversación que el usuario eliminó después (respeto a la decisión del autor).

### Lo que SE EVALÚA caso a caso

- **Reviews tras incentivo no declarado.** Si una marca da puntos por dejar reviews y los users reciben puntos sin que las reviews lo declaren, las reviews tienen sesgo aunque no sea declarado. En categorías con esta práctica generalizada, ajustar criterios o reportar limitación.
- **Translated content.** Posts traducidos automáticamente pueden perder vocabulario distintivo. Para Cultural Codes, mantener idioma original; para T&B, traducir solo si el equipo de codificación no habla el idioma original.
- **Threads truncados.** Si tenemos el reply pero no el post original, evaluar si el reply tiene context suficiente independiente.

## Tamaños de corpus por metodología (referencia)

| Metodología                | Mínimo viable | Ideal               |
| -------------------------- | ------------- | ------------------- |
| Triggers & Barriers        | 800-1,500     | 3,000-5,000+        |
| Value Perception Matrix    | 1,800 (600/marca × 3 marcas) | 4,500+ |
| Cultural Codes Decoding    | 1,200-2,000 (texto largo)    | 3,000+ |
| Decision Velocity          | 1,000-2,000 (narrativo)      | 3,000+ |
| Journey Friction Mapping   | 1,500-2,500   | 4,000+              |
| Influence Architecture     | 2,000-5,000 (con metadata)   | 10,000+ |

**Más no siempre es mejor.** Un corpus de 100,000 piezas mal-construido produce peor output que 2,000 piezas bien-curadas. El tamaño es un piso, no un objetivo.

## Window temporal — reglas operativas

- **Default:** 6-9 meses.
- **Categorías volátiles** (beauty, gaming, food trends): 3-6 meses para evitar mezclar conversaciones que ya cambiaron.
- **Categorías estables** (B2B industrial, finanzas tradicionales): 12-24 meses para tener volumen suficiente.
- **Anticipación de tendencias / Cultural Codes histórico:** 18-36 meses para detectar movimientos generacionales.
- **Crisis activa:** ventana específica desde el evento detonante hasta hoy + comparativa pre-evento.

## Balance entre fuentes

Si una sola fuente domina el corpus (>60%), la lectura está sesgada a esa fuente. Reglas:

- **Caso ideal:** ninguna fuente excede el 35-40% del corpus.
- **Caso aceptable:** una fuente puede dominar si la pregunta justifica (ej. T&B en categoría donde la conversación cualitativa más rica está en un subreddit específico). Reportar el sesgo en limitaciones.
- **Caso a corregir:** si el balance es accidental (no pudimos extraer de otras fuentes), re-balancear o reportar como limitación crítica.

## Curación humana

Aunque el pipeline es automatizado, hay puntos donde la curación humana es no-negociable:

1. **Validación de fuentes** al inicio del proyecto: ¿estas son realmente las fuentes que importan para la pregunta?
2. **Sampling de calidad** durante la ingesta: leer 50-100 piezas aleatorias y validar que la fuente no está sesgada por filtros que no detectamos.
3. **Validación de codificación** después del enriquecimiento: doble pase humano sobre 5-10% del corpus para validar que las clasificaciones automáticas son correctas.
4. **Cierre de corpus**: el lead del proyecto firma que el corpus está listo antes de que las metodologías corran.

Sin estos 4 puntos, hay riesgo de output que técnicamente sigue el protocolo pero opera sobre un corpus mal-construido.

## Propiedad y trazabilidad

- Todo corpus es del cliente al cierre del proyecto.
- Cada pieza mantiene su URL de fuente original (ver `evidence-traceability.md`).
- El cliente recibe el corpus completo + el corpus codificado (con tags y metodología aplicada).
- Noisia retiene una copia anonimizada para mejora continua de la práctica, según términos de NDA.

## Cuándo el corpus dice que la pregunta no se responde

A veces el corpus revela que la pregunta no es respondible con esa metodología en este momento. Casos:

1. **Volumen insuficiente** después de aplicar criterios de exclusión.
2. **Sesgo de fuente irreparable** (ej. solo hay reviews de Amazon y la categoría requiere conversación más cualitativa).
3. **Window temporal vacío** (la categoría no produjo conversación significativa en el período).
4. **Pregunta mal-formulada** (al construir el corpus se descubre que la pregunta operativa es otra).

En estos casos, **se reporta y se renegocia**. No se produce output forzado. El cliente paga lo ya hecho hasta el punto de descubrimiento, y se decide si rediseñar el alcance o cerrar.

## Referencias

- Sitio público: `/arquitectura-de-datos`.
- Trazabilidad: `03-process/evidence-traceability.md`.
- Principio operativo: `00-overview/principles.md` → P2, P5.
