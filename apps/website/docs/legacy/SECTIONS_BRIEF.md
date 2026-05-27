# Noisia — Brief de Secciones para Codex

Documento de instrucciones para construir las secciones internas del website. Cada sección debe sentirse como una pieza editorial autocontenida, no como una página de marketing. El objetivo: que un lector que llega a una metodología, un caso de uso o una field note se vaya con la sensación de que vio cómo Noisia piensa — no qué vende.

Mantener siempre `DESIGN_V2.md` como autoridad sobre tokens, colores, tipografía y elevación. Este brief añade **narrativa, componentes nuevos y comportamiento** sobre ese sistema.

---

## 1. Principios editoriales

Antes de los componentes, los principios. Si un diseño no satisface al menos cuatro de estos siete, no está listo.

**1.1 Cada página tiene una pregunta.** No un título. No un eyebrow. Una pregunta directa que el lector reconoce como suya. Esa pregunta es el hero. Lo demás es cómo Noisia la responde.

**1.2 La metodología no se explica, se ejecuta.** El lector debe ver el método trabajar antes de leer cómo funciona. Una matriz con quotes reales pesa más que tres párrafos describiendo la matriz.

**1.3 Cada bloque de prosa debe ganar su lugar contra una alternativa visual.** Si el contenido se puede mostrar como diagrama, mini-dashboard, evidencia codificada o storyboard, eso gana. La prosa es el último recurso, no el primero.

**1.4 Un dato real, una cita real, un autor real por bloque.** Cero placeholder. Cero "lorem ipsum estratégico". Si no tenemos el dato, no se publica el bloque.

**1.5 Mobile-first sin disculpa.** Cada componente debe funcionar en 375px primero. Desktop es el premio, no el punto de partida.

**1.6 La densidad cambia por intención.** Una página de metodología puede ser densa (es de referencia). Una field note debe respirar (es de lectura). Una página de casos puede ser scaneable (es de selección). No aplicar el mismo ritmo vertical a todo.

**1.7 Cero CTAs genéricos. Cada CTA es la próxima pregunta lógica.** "Iniciar diagnóstico" funciona. "Hablemos" no. "Conversemos" no. "Descubre más" no existe.

---

## 2. Biblioteca de componentes nuevos a construir

Componentes que múltiples secciones reutilizan. Construirlos una vez, usarlos bien.

### 2.1 The Matrix Component (`<NoisiaMatrix>`)

Visualización modular de matrices metodológicas: 2×4 (Triggers & Barriers), 4×3 (Value Perception), 5×4 (Influence Architecture), 4×4 (Decision Velocity), 4×3 (Cultural Codes), 5×4 (Journey Friction).

**Estructura:**
- Grid responsive con celdas tappables
- Cada celda contiene: un label corto (la dimensión), un score visual (intensidad de señal), un quote real anonimizado de 1-2 líneas
- Tap en una celda expande un drawer/sheet con: 3-5 quotes adicionales, el conteo de menciones que sustenta esa celda, la fuente de origen
- Headers y row-labels son sticky en mobile cuando se hace scroll horizontal

**Estados visuales:**
- Celda fría (baja señal): fondo `surface-01`, texto `neutral-10`
- Celda tibia (señal media): fondo `surface-02`, micro-acento `signal` en el border-left
- Celda caliente (alta señal): fondo `tension-soft` o `positive-soft` según polaridad, border `tension`/`positive`, número de menciones en grande

**Mobile:** scroll horizontal con primera columna sticky. Indicador visual de "hay más →" en el borde derecho.

**Desktop:** matriz completa visible. Hover muestra tooltip con conteo. Click abre drawer lateral.

### 2.2 The Sources Constellation (`<SourcesConstellation>`)

Visualización de las fuentes que alimentan una metodología o caso. Reemplaza la lista de chips actual por algo que muestra **proporción y rol**.

**Estructura:**
- Layout circular o de dispersión (no grid uniforme)
- Cada fuente es un círculo cuyo tamaño = peso relativo en el corpus de este análisis
- Color del círculo = tipo de fuente (reviews `signal`, foros `whisper`, redes `signal-dark`, news `neutral-09`, podcasts/video `tension-soft`)
- Hover/tap muestra: nombre exacto, count de señales aportadas, ejemplo de quote típica

**Variantes:**
- Modo "metodología" (en página Triggers & Barriers): muestra qué fuentes alimentan esta metodología típicamente
- Modo "caso" (en caso de uso): muestra el corpus exacto del caso
- Modo "arquitectura" (en página Arquitectura): muestra los 8-10 grandes tipos sin caso específico

**Mobile:** stacked, no circular. Lista visual con barra de proporción a la derecha.

### 2.3 The Mini Lab (`<MethodologyLab>`)

Widget interactivo de 3 pasos que muestra **cómo opera la metodología sobre data real**. Es la pieza estrella de cada página de metodología.

**Pasos:**
1. **Input:** una conversación pública anonimizada (3-5 quotes reales)
2. **Procesamiento:** muestra la codificación — cada quote se etiqueta con dimensión, polaridad, intensidad, fuente
3. **Output:** la quote aterriza en una celda de la matriz, contribuyendo al score

**Comportamiento:** el usuario presiona "ver método" y la animación corre 1 vez (3-4 segundos total). Al final, queda un estado donde puede tocar cada quote individualmente para ver su clasificación.

**Por qué importa:** es la única forma honesta de explicar metodología sin caer en boilerplate. El método se demuestra ejecutándose.

**Mobile:** secuencial vertical. Desktop: tres columnas o secuencia lateral.

### 2.4 The Vignette Storyboard (`<VignetteStoryboard>`)

Para casos de uso. Reemplaza el bloque de texto "Vignette anonimizada" por un mini-storyboard de 3-4 viñetas visuales.

**Estructura por viñeta:**
- Número de paso (01, 02, 03)
- Frase corta de máximo 12 palabras describiendo el momento
- Mini-visual: puede ser una matriz parcial, una quote destacada, un gráfico de barras de 2 columnas, un mapa de fricción

**Ejemplo (caso "campaña / territorio cultural"):**
- 01 — La marca llegó con tres territorios creativos. [visual: tres pills: 'Aspiracional', 'Cómplice', 'Funcional']
- 02 — La conversación pública testeó cuál tenía permiso. [visual: matriz 3×2 con scores]
- 03 — Solo uno sobrevivió: el que convertía frustración cotidiana en lenguaje accionable. [visual: pill ganadora con score destacado]
- 04 — La inversión se redirigió. El brief se reescribió en 5 días. [visual: número grande "5 días"]

### 2.5 The Output Preview (`<OutputPreview>`)

Cards que reemplazan la lista plana de outputs ("Triggers & Barriers Map", "Activation Playbook", etc.) por **previews reales mockeados** de cada deliverable.

**Estructura por card:**
- Título del output
- Frase de 1 línea explicando para qué sirve
- Preview visual de cómo se ve (puede ser un fragmento de la matriz, una hoja con bullets reales, un gráfico de prioridad)
- Tag de formato (PDF, Notion, Figjam, Sheet, Deck)
- Tag de duración estimada de lectura/uso

**Por qué importa:** el cliente entiende qué se lleva sin que tengamos que decirlo. El output se vuelve concreto.

### 2.6 The Process Trace (`<ProcessTrace>`)

Para arquitectura y servicios. Visualización de un flujo lineal con anotaciones.

**Estructura:** secuencia horizontal (desktop) o vertical (mobile) de 4-6 pasos. Cada paso tiene:
- Número
- Nombre del paso (1-2 palabras)
- Descripción de 2 líneas
- Métrica concreta cuando exista ("150+ scrapers", "10K+ fuentes normalizadas", "4-6 semanas")
- Conector animado entre pasos (línea con punto que viaja en loop sutil)

**Variantes:**
- "Pipeline de datos" (en arquitectura)
- "Pipeline de proyecto" (en servicios)
- "Pipeline de codificación" (en metodología — qué pasa entre raw quote y matriz)

### 2.7 The Decision Tree (`<DecisionTree>`)

Wizard de 2-3 preguntas que termina recomendando un tier de servicio o una metodología. Es el componente que convierte indecisión en clic.

**Para servicios:**
1. ¿Tienes una pregunta concreta o una preocupación recurrente?
2. ¿La decisión está cerca o quieres explorar?
3. ¿Es un proyecto puntual o necesitas capacidad continua?
→ Recomendación: Foundation / Intelligence / Strategy

**Para metodologías (versión corta):**
1. ¿Qué te quita el sueño hoy?
   - "No sé por qué la gente no compra" → Triggers & Barriers
   - "Mi competencia me come share" → Triggers & Barriers + Cultural Codes
   - "Mi journey está roto" → Journey Friction Mapping
   - "No sé qué territorio creativo defender" → Cultural Codes Decoding
   - "Mi comunicación rebota" → Influence Architecture
   - "El consumidor decide rápido… pero no a mí" → Decision Velocity

**Comportamiento:** las opciones son pills tappables grandes. Después de la última pregunta, fade a una recomendación con CTA "ver esta ruta".

### 2.8 The Evidence Strip (`<EvidenceStrip>`)

Tira horizontal con 4-6 quotes reales codificadas. Reemplaza el típico bloque de "testimonios" por **evidencia conversacional con metadata**.

**Cada item contiene:**
- Quote (1-3 líneas)
- Pill de plataforma (Reddit, Reviews, X, Foros, YouTube comments)
- Pill de dimensión (Cultural / Social / Personal / Psychological)
- Pill de polaridad (Trigger en `positive-soft`, Barrier en `tension-soft`)

**Mobile:** carrusel horizontal con snap. Desktop: grid de 2-3 columnas o slider sutil.

### 2.9 The Methodology Card v2 (`<MethodologyCardV2>`)

Reemplazo de las cards actuales en la página de metodologías. Cada una con identidad visual propia, no solo icono distinto.

**Estructura:**
- Header con número, nombre, pregunta-en-grande
- Mini-visual signature único de cada metodología (ver 4.1.1 abajo)
- 3 fundamentos científicos (autores)
- Pregunta-pill que responde
- "Estudiar metodología →"

**Identidad visual signature por metodología:**
- Triggers & Barriers: dos columnas opuestas con flechas convergiendo a un centro
- Value Perception: tres niveles apilados (Expected/Desired/Delightful) con shape de pirámide
- Cultural Codes: cuatro anillos concéntricos (Universal/Regional/Generational/Subcultural)
- Decision Velocity: línea de tiempo con aceleradores arriba y desaceleradores abajo
- Journey Friction: línea con quiebres visibles en cada etapa
- Influence Architecture: nodos conectados (red de influencia)

Cada signature es SVG simple, animable sutilmente, en `signal-dark` sobre fondo glass.

---

## 3. Sección: Metodologías (lista)

URL: `/metodologias`

**Estado actual:** 6 cards en grid de 2 columnas, cada una con texto plano y CTA "Estudiar metodología". Funcional pero plano. No hay drama, no hay diferenciación, no se siente como un catálogo de inteligencia.

**Lo que falta:**

### 3.1 Hero con pregunta-frame, no descripción

Reemplazar:
> "Seis lentes. Cada una construida para una pregunta distinta."

Por una construcción más editorial:

> Eyebrow: METODOLOGÍAS PROPIETARIAS  
> H1: Seis preguntas. Seis lentes.  
> Subhead: Cada metodología responde una sola cosa. La pregunta correcta antes que la herramienta correcta.

Debajo del subhead, una línea con las 6 preguntas como pills horizontales scrolleables (mobile) o como grid (desktop):

`¿Por qué no compran?` `¿Qué valor capitalizo?` `¿Qué código me deja entrar?` `¿Por qué deciden lento?` `¿Dónde se rompe el journey?` `¿Quién mueve la conversación?`

Cada pill es tappable y hace anchor scroll a la card correspondiente.

### 3.2 The Methodology Selector Wizard (componente 2.7)

Antes del grid de cards, insertar el wizard. Es un bloque glass con la pregunta:

> "¿Qué te quita el sueño hoy?"

Y 6 opciones en pills grandes. Al elegir, se hace scroll suave a la card recomendada y esa card se ilumina por 1.5s con un border `signal`.

Esto convierte una página de catálogo en una herramienta. El visitante deja de leer 6 cards en orden y entra por su problema real.

### 3.3 Grid de Methodology Cards v2

Reemplazar las cards actuales por la versión 2.9. Cada una con su signature SVG única.

Mantener el grid de 2 columnas en desktop, 1 en mobile. Espaciado entre cards más generoso (`spacing.xl` mínimo) para que cada una respire como artefacto independiente.

### 3.4 Footer-section: "No sabes cuál usar"

Antes del footer global, una sección estrecha con copy:

> "¿No sabes por dónde empezar? Las metodologías rara vez vienen solas. La mayoría de proyectos combinan dos o tres. El diagnóstico define cuáles, en qué orden y sobre qué corpus."

CTA: `Iniciar diagnóstico`

---

## 4. Sección: Metodología (detalle) — pieza maestra

URL: `/metodologias/triggers-barriers` (y 5 más)

**Esta es la sección que más cambia.** El estado actual es prosa-sobre-glass-card sin un solo elemento que demuestre el método. Debe convertirse en una pieza editorial densa, interactiva, donde el lector ve la metodología trabajar.

**Estructura propuesta (en orden de scroll):**

### 4.1 Hero refinado

Mantener la estructura actual (eyebrow + H1 + subhead + pregunta) pero agregar:

- **Mini-signature visual** debajo de la pregunta: el SVG signature de esta metodología (ver 2.9), pero en grande — ocupa 60% del ancho de contenido en desktop, full-width en mobile. Animable sutilmente con scroll-reveal.
- **Quick stats** en una tira horizontal debajo: 
  - "4-6 semanas hasta decisión"
  - "1,000-15,000 señales típicas"  
  - "3-4 fuentes orquestadas"
  - "Aplicada en 12+ industrias"

Estos stats son `metric` style chico. Dan textura y autoridad sin caer en ego.

### 4.2 The Mini Lab (componente 2.3) — INMEDIATAMENTE después del hero

Esta es la inversión clave. Antes de cualquier prosa, el lector ve cómo el método funciona en 30 segundos.

**Para Triggers & Barriers, ejemplo concreto:**

> Bloque: "Velo en 30 segundos"
> 
> Botón: "Ver el método"

Al hacer tap, animación de 3 fases:

**Fase 1 (0-1s):** aparecen 4 quotes reales:
- "Me da nervios meter mi tarjeta en una app que no conozco"
- "Mi mamá ya lo usa, así que ya bajé la app"
- "Si no acepto pago digital pierdo clientes y ya"
- "No tengo paciencia para aprender otra app más"

**Fase 2 (1-2.5s):** cada quote se etiqueta visualmente:
- Quote 1 → pill `Psychological` `Barrier`
- Quote 2 → pill `Social` `Trigger`
- Quote 3 → pill `Cultural` `Trigger`
- Quote 4 → pill `Personal` `Barrier`

**Fase 3 (2.5-4s):** cada quote viaja a su celda en una matriz 2×4 (Triggers/Barriers × Cultural/Social/Personal/Psychological). La matriz se llena. Aparece copy:

> "Eso es Triggers & Barriers. Lo demás es escala, rigor y precisión."

Estado final: el usuario puede tocar cualquier quote/celda para revisar.

### 4.3 The Matrix Component (componente 2.1) en grande

Después del Mini Lab, presentar la matriz completa con **datos reales** de un caso aplicado. Idealmente Cheaf u otro caso público. Cada celda con:
- Score (intensidad)
- Top 3 quotes
- Conteo de menciones

El bloque tiene un subtítulo:

> "Caso aplicado: [Industria], [Mercado], 2,400 señales públicas, [periodo]"

Pie: "Esta matriz se construyó en 5 semanas. La codificación se hizo sobre reviews de App Store, foros latinoamericanos y comentarios de YouTube. Sin paneles, sin encuestas, sin focus group."

### 4.4 Fundamentos científicos (rediseñado)

Lo actual es una lista plana de 4 autores. Convertirlo en una constelación visual:

**Layout:** un círculo central con el nombre de la metodología. Alrededor, 4-6 nodos con autores principales. Cada nodo es tappable y muestra:
- Foto (si tenemos) o silueta
- Autor + año del trabajo clave
- Frase de 1 línea sobre qué aporta
- Por qué Noisia lo usa

Para Triggers & Barriers:
- Kahneman / Sistema 1 vs Sistema 2 / "Define cuándo el barrier es razonado y cuándo es automático"
- Christensen / Jobs-to-be-Done / "Convierte lo que el consumidor quiere lograr en lente analítica"
- Deci & Ryan / Self-Determination / "Separa motivación intrínseca de extrínseca, evitando confundir compliance con adopción"
- Nordgren & Schonthal / Friction Theory / "Tipifica cuatro tipos de fricción: inercia, esfuerzo, emoción, reactancia"

Esto convierte una lista en un mapa de pensamiento. Da autoridad sin tono académico.

### 4.5 El problema que resuelve — narrativo, con contraste

Mantener el bloque pero añadir **contraste estructural**:

A la izquierda (o arriba en mobile): bloque rojo-tenso con título "Lo que hace un focus group" y 3 limitaciones reales.

A la derecha (o abajo en mobile): bloque blanco con título "Lo que hace Triggers & Barriers" y 3 capacidades.

Esto no es comparación injusta — es honesta. El focus group sigue siendo válido para ciertas cosas. La metodología hace otras.

### 4.6 Cómo opera Noisia esta metodología — Pipeline visual

Reemplazar el bullet list por **The Process Trace (componente 2.6)** específico de codificación:

01 — **Definir el jobs landscape** · 1 semana · Workshop con cliente, hipótesis iniciales, mapeo en cada dimensión.  
02 — **Queryficación** · 3-5 días · Convertir hipótesis en queries de escucha social. Combinación de intenciones + acciones + contexto de marca.  
03 — **Codificación** · 2 semanas · NLP + supervisión humana. Cada expresión etiquetada como trigger/barrier y subclasificada por dimensión.  
04 — **Cuantificación + Cualificación** · 1 semana · Frecuencia, intensidad lingüística, capacidad predictiva. La fuerza no es el conteo plano.  
05 — **Traducción a acción** · 1 semana · Cada fuerza relevante se convierte en una acción posible: comunicación, producto, experiencia.

### 4.7 Outputs (componente 2.5 — Output Preview)

Reemplazar la lista plana por 4 cards con previews reales:

1. **Triggers & Barriers Map** · PDF o Figjam editable · 12-20 págs · Preview: thumbnail de la matriz con anotaciones
2. **Activation Playbook** · Notion · 30+ módulos accionables · Preview: bullets categorizados por canal
3. **Friction Removal Plan** · Sheet · Lista priorizada por impacto × esfuerzo · Preview: scatter plot
4. **Comparative Brief** · Deck · Hasta 3 competidores · Preview: 3 columnas comparativas

### 4.8 Cuándo usarla / Cuándo no usarla

Convertir el bloque de "Limitaciones honestas" en algo más estructural y honesto. Dos columnas:

**Cuándo Triggers & Barriers responde tu pregunta:**
- Lanzamiento de producto en mercado donde la categoría existe
- Optimización de funnel cuando ya tienes tracción
- Comunicación que necesita activar comportamiento
- Defensa competitiva cuando estás perdiendo share
- Repositioning motivacional

**Cuándo otra cosa responde mejor:**
- Necesitas tamaño de mercado → encuesta cuanti
- Necesitas testear concepto específico → testing
- La categoría no existe en el mercado → market entry intelligence + cultural codes
- Quieres entender el journey, no la decisión → Journey Friction Mapping

Esta honestidad es diferenciador. Las agencias venden todo. Noisia recomienda lo que aplica.

### 4.9 Casos donde se aplicó esta metodología

Cross-link a 2-4 casos de uso reales que usaron Triggers & Barriers, en cards horizontales scrolleables:
- Caso de pricing en categoría madura
- Caso de defensa de share en CPG
- Caso de adopción digital en banca
- Caso de relanzamiento

Cada card es un mini-preview con: industria, pregunta, output principal, "Ver caso →".

### 4.10 Lectura recomendada (mantener pero rediseñar)

Como bloque cerrado, con cada autor en su propia mini-card:
- Portada del libro (si tenemos derechos para mostrar)
- Título + autor + año
- 1 línea: "Por qué importa"
- Sin ratings, sin links de Amazon, sin SEO. Es referencia honesta.

### 4.11 Sidebar persistente (desktop)

Mantener el sidebar derecho actual con:
- Las 6 metodologías como navegación cruzada
- "Conectar con un arquitecto" + CTA

Pero añadir:
- **Anchor TOC** del scroll actual (Hero, Lab, Matriz, Fundamentos, Pipeline, Outputs, Cuándo usarla, Casos, Lectura)
- Indicador de progreso de lectura (línea cyan que se llena con scroll)

En mobile, el sidebar desaparece y el TOC se vuelve un FAB inferior compacto que abre un sheet.

### 4.12 Variaciones por metodología

Cada una de las 6 páginas de detalle sigue la misma estructura, pero con:
- Su propio Mini Lab (data y dimensiones distintas)
- Su propia matriz (2×4, 4×3, 5×4, 4×4 según la metodología)
- Sus propios fundamentos científicos
- Sus propios outputs
- Sus propios "cuándo sí/cuándo no"
- Sus propios casos cross-link

Documento separado especificará data exacta para Value Perception, Cultural Codes, Decision Velocity, Journey Friction, Influence Architecture. Para este brief, Triggers & Barriers es el patrón.

---

## 5. Sección: Arquitectura

URL: `/arquitectura`

**Estado actual:** 4 pasos en stepper + un bloque "El problema con las plataformas únicas" + chips de fuentes + bloque "Lo que no hacemos". Funcional, pero no transmite la magnitud de lo que hay debajo. 150+ fuentes y 10,000+ scrapers se mencionan como dato, no se sienten.

**Lo que falta:** mostrar el data lake. Mostrar el flujo. Mostrar la diferencia con plataformas únicas en lugar de afirmarla.

### 5.1 Hero refinado

Mantener el copy actual pero añadir un mini-counter animado debajo del subhead:

```
150+        10,000+        45+         8+
fuentes     scrapers       mercados    categorías
```

Cada número se anima en scroll-reveal (count up de 0 al valor). Pequeños pero presentes.

### 5.2 The Big Pipeline — visual completo

Reemplazar el stepper actual por un **diagrama de flujo a pantalla completa**, con las 4 fases (Ingesta → Normalización → Enriquecimiento → Analítica) como columnas verticales conectadas por flechas animadas.

**En cada columna:**
- Header: número + nombre de fase
- Body: 2-3 sub-procesos visualizados como mini-cards apiladas
- Footer: una métrica clave

**Fase 1 — Ingesta:**
- APIs nativas
- Scrapers especializados (10K+)
- Ingesta de podcasts/video/texto largo
- Métrica: "150+ fuentes orquestadas"

**Fase 2 — Normalización:**
- Esquema único
- Deduplicación
- Atribución
- Traducción
- Métrica: "1 esquema, 12 idiomas"

**Fase 3 — Enriquecimiento:**
- Clasificación temática
- Entidades
- Sentimiento multidimensional
- Sarcasmo contextual
- Tensión narrativa
- Métrica: "Sentimiento plano descartado"

**Fase 4 — Analítica:**
- Operacionalización de las 6 metodologías
- Trazabilidad a la fuente original
- Métrica: "100% evidencia trazable"

**En desktop:** las 4 columnas son visibles simultáneamente. Una línea cyan recorre la pipeline en loop sutil (3-5s) mostrando el flujo de datos.

**En mobile:** stack vertical. Cada fase se revela en scroll. La línea de conexión es vertical.

### 5.3 The Sources Constellation (componente 2.2) en gran formato

Después del pipeline, una sección dedicada solo a las fuentes:

> Eyebrow: FUENTES  
> Pregunta: "¿Qué corpus puede sostener decisiones?"  
> Subhead: "El set final depende de la pregunta. Esto es lo que orquestamos sin pelearnos con plataformas cerradas."

Visualización de 8-10 grandes tipos de fuente en círculos proporcionales. Cada uno tappable expande:
- Reviews de ecommerce y apps (peso alto)
- Foros nicho (peso alto)  
- Redes sociales abiertas
- News y editoriales
- Blogs y newsletters
- Podcasts transcritos
- Video transcrito
- Q&A de marketplaces
- Comunidades accesibles
- Marketplaces especializados

**Lateral (desktop) o debajo (mobile):**
> "Ninguna plataforma cubre la conversación que decide una categoría. La señal aparece distribuida. Noisia no compite con plataformas — las orquesta cuando sirven, las complementa cuando faltan, y normaliza todo en un corpus que pueda sostener decisiones."

### 5.4 The Single Platform vs Noisia comparator

Bloque comparativo con dos columnas:

**Columna izquierda — Plataforma única:**
- Cobertura: limitada al stack del proveedor
- Ingesta: lo que el proveedor decida
- Normalización: a su esquema
- Enriquecimiento: sentimiento básico, sentimiento plano
- Análisis: dashboards genéricos
- Output: visualización
- Limitación: "Comparar plataformas es comparar cosas distintas"

**Columna derecha — Noisia:**
- Cobertura: definida por la pregunta
- Ingesta: best-of-breed por tipo de fuente
- Normalización: esquema único cross-fuente
- Enriquecimiento: sentimiento multidimensional, sarcasmo contextual, tensión narrativa
- Análisis: 6 metodologías propietarias
- Output: decisión trazable
- Diferencia: "El corpus se arma por pregunta, no por default"

Visualmente: la columna izquierda en `surface-02` con tipografía neutral. La derecha en glass blanco con acentos `signal-dark`.

### 5.5 The Query → Evidence Trace

Un mini-demo: muestra cómo una pregunta de negocio se convierte en evidencia trazable.

**Estructura visual horizontal de 5 pasos:**

01 — **Pregunta:** "¿Por qué los consumidores rechazan nuestro nuevo plan?"  
02 — **Queryficación:** intenciones de rechazo + objeciones + comparaciones competitivas  
03 — **Corpus:** 1,847 señales de 4 fuentes en 6 semanas  
04 — **Codificación:** Triggers & Barriers — 312 expresiones identificadas  
05 — **Evidencia:** quote + plataforma + autor anonimizado + fecha + contexto

Esto cierra la promesa de "trazable a la fuente original". El que llega aquí entiende que no inventamos nada.

### 5.6 Lo que no hacemos (rediseñado)

Mantener el bloque pero darle más peso visual. Es donde Noisia se diferencia éticamente.

> Eyebrow: PRINCIPIOS  
> H2: Lo que no hacemos.

Lista de 4 principios, cada uno como su propia card con icono cyan:
- No hackeamos plataformas cerradas
- No scrapeamos contra términos de servicio
- No comprometemos privacidad personal
- No operamos sobre datos identificables sin justificación legal

Pie: "La calidad de la inteligencia depende del corpus. La sostenibilidad depende del cómo. Ambos son no-negociables."

CTA: `Diseñar un protocolo`

---

## 6. Sección: Casos de Uso

URL: `/casos` (lista) y `/casos/[slug]` (detalle)

### 6.1 Casos (lista)

**Estado actual:** grid de 10 cards con preguntas. Funcional, está casi bien — pero falta jerarquía y filtrado.

**Mejoras:**

#### 6.1.1 Filtros tipo pill arriba del grid

Antes del grid, una fila de filtros:
- Por tipo de decisión: `Lanzamiento` `Crisis` `Reposicionamiento` `Entrada a mercado` `Optimización de medios`
- Por timeline: `2-4 sem` `4-6 sem` `6-10 sem`
- Por metodología: las 6 propietarias

Filtros multi-select. Aplicar filtra el grid en vivo (no recargar página).

#### 6.1.2 Card hierarchy

Las cards actuales son uniformes. Algunas decisiones son más críticas que otras. Permitir destacar 2-3 cards "ancla" en tamaño doble (span de 2 columnas en desktop). Estas son las preguntas más comunes — donde Noisia ve más demanda real.

Ejemplo de cards destacadas:
- "Tengo que lanzar una campaña..."
- "Estoy perdiendo share..."
- "Necesito reposicionar..."

#### 6.1.3 Hover/Tap state enriquecido

En la card actual, hover/tap muestra el texto y las metodologías. Añadir:
- Una línea con "Casos similares ya resueltos: 4" (cuando haya base)
- Pill de "Output principal": tension map, friction plan, etc.

### 6.2 Caso (detalle)

URL: `/casos/lanzamiento-campana-territorio-cultural`

**Estado actual:** texto plano en cards. La "vignette anonimizada" es el bloque más débil — describe en prosa lo que debería ser un mini-storyboard.

**Estructura propuesta:**

#### 6.2.1 Hero refinado

Mantener la pregunta como H1 enorme. Añadir abajo del subhead:
- Pills de metodologías aplicadas
- Pill de timeline
- Pill de industrias donde aplica

#### 6.2.2 The Vignette Storyboard (componente 2.4)

Reemplazar el bloque "Vignette anonimizada" por el storyboard de 3-4 viñetas. Es la pieza estrella del caso. Debe ocupar lugar generoso (full-width content).

#### 6.2.3 "Por qué importa estratégicamente" (mantener, pulir)

Bloque actual está bien escrito. Añadir un mini-visual: 3 iconos pequeños representando las 3 cosas que la conversación pública revela y un dashboard de volumen no:
- Motivaciones reales (no declaradas)
- Fricciones invisibles (no reportadas)
- Códigos culturales (no dichos)

#### 6.2.4 "Cómo Noisia la aborda" — convertir en pipeline visible

Reemplazar el párrafo plano por **The Process Trace (componente 2.6)** específico al caso:

01 — Mapeo de tensiones simbólicas activas en la categoría · 2 sem  
02 — Identificación de territorios con permiso real · 1 sem  
03 — Validación contra evidencia conversacional · 1 sem  
04 — Brief estratégico con angle defendible · 1 sem

#### 6.2.5 "Qué entrega" → Output Preview (componente 2.5)

Reemplazar lista plana ("Tension map", "Campaign angle brief", "Narrativa con fuentes") por 3 cards con preview real de cada deliverable.

#### 6.2.6 Caso real (anonimizado pero con datos)

Añadir una sección nueva debajo de "Qué entrega":

> Eyebrow: CASO APLICADO  
> H2: Cómo se ve esto en la realidad

Bloque editorial con:
- Industria + mercado + año (ej: "Bebidas no alcohólicas, México, 2025")
- Pregunta original del cliente
- Corpus reunido (números: ej: "3,200 señales, 5 fuentes, 4 semanas")
- 2-3 hallazgos clave en bullets densos
- Output principal entregado
- Outcome reportado por el cliente

Sin nombre de marca real. Sí con números concretos.

#### 6.2.7 Cross-link a metodologías

Al final, cards horizontales con las metodologías aplicadas, llevando a sus páginas detalle.

#### 6.2.8 Sidebar de contexto (desktop)

Mantener el sidebar actual con:
- Industrias
- Tiempo aproximado
- Metodologías
- "Diseñar este diagnóstico" + CTA

---

## 7. Sección: Servicios

URL: `/servicios`

**Estado actual:** 3 cards Foundation/Intelligence/Strategy con bullets. Esto es la página más cercana a "ya está bien". Pero hay oportunidades.

### 7.1 Hero (mantener mayormente)

El copy actual es fuerte:
> "Tres formas de trabajar juntos. Una sola lógica: la pregunta manda."

Subhead bueno. Mantener.

### 7.2 The Decision Tree (componente 2.7) — adición clave

Antes del grid de tiers, insertar el wizard de 3 preguntas que recomienda tier. Es lo que convierte una página descriptiva en una herramienta.

Después de la última pregunta, scroll suave al tier recomendado y se ilumina.

### 7.3 Grid de Tiers — pulir, no rehacer

Lo actual está bien. Mejoras menores:

- **Por cada tier:** añadir una línea pequeña al inicio que diga el "trigger" del cliente:
  - Foundation: "Tienes una hipótesis y necesitas evidencia"
  - Intelligence: "La decisión está cerca y el riesgo es real"
  - Strategy: "La inteligencia social es capacidad continua"

- **Por cada tier:** añadir una línea final pequeña con "Casos típicos":
  - Foundation: "Validación de tesis, decisión de entrar o no, sostenimiento de brief"
  - Intelligence: "Lanzamiento, reposicionamiento, defensa competitiva, entrada a mercado"
  - Strategy: "Portafolios complejos, mercados fragmentados, presencia multi-mercado"

### 7.4 The Tier Comparator — sección nueva

Después del grid, una matriz comparativa rica con todos los atributos en filas:

| Atributo | Foundation | Intelligence | Strategy |
|---|---|---|---|
| Pregunta de negocio | Una | Una principal + derivadas | Múltiples, recurrentes |
| Metodologías | 1-2 | 3-4 | Las 6 + custom |
| Timeline | 4-6 sem | 6-10 sem | Trimestral / anual |
| Output | Diagnóstico | Playbook accionable | Capacidad continua |
| Evidencia | Trazable | Trazable + actualizable | Trazable + alertas |
| Modalidad | Proyecto | Proyecto | Retainer |
| Equipo Noisia | 2 personas | 3-4 personas | 4-6 personas + lead |

### 7.5 Cómo se construye una propuesta (mantener)

Bloque actual está bien. Mejorar visualmente: convertir el párrafo en 4 pasos numerados con iconos sutiles:
1. Pregunta estratégica real
2. Metodologías aplicables
3. Fuentes a orquestar
4. Outputs y timeline → de ahí precio, equipo y alcance

### 7.6 Qué no incluimos (mantener pero rediseñar)

Lo actual está bien. Cambios:
- Cada item con icono `tension` chiquito
- Tipo "manifiesto", no "disclaimer"

### 7.7 FAQ ligero al final

Sección nueva. 5-7 preguntas frecuentes, cada una expansible:

- ¿Cuánto cuesta un proyecto?
- ¿En qué mercados pueden operar?
- ¿Necesitamos tener nuestras herramientas?
- ¿Pueden integrarse a nuestro equipo de research?
- ¿Es un retainer? ¿Es por proyecto?
- ¿Qué pasa con la evidencia después del proyecto?
- ¿Pueden firmar NDA estándar?

Las respuestas son cortas (2-4 líneas), honestas, sin marketing.

---

## 8. Sección: Field Notes

URL: `/field-notes` (lista) y `/field-notes/[slug]` (detalle)

**Estado actual:** lista funcional pero plana. Detalle de nota es solo prosa con un pull-quote al final.

**Concepto general:** las field notes son el "alma editorial" de Noisia. Son ensayos cortos, firmados (aunque la firma sea "Noisia"), con punto de vista. No son posts de blog optimizados para SEO. Son piezas de pensamiento que sostienen la autoridad de la marca.

### 8.1 Field Notes (lista)

#### 8.1.1 Hero refinado

Mantener el copy actual, pero rediseñar la presentación:

> Eyebrow: FIELD NOTES  
> H1: Notas de campo. Pocas piezas, más criterio.  
> Subhead: "Notas firmadas para discutir método, cultura, influencia y decisiones. Sin churn de SEO."

#### 8.1.2 Filtros sutiles por tema

Antes de la lista, una fila de pills de tema:
- `Método`
- `Cultura`
- `Influencia`
- `Decisiones`
- `Crítica de industria`

Filtrado en vivo.

#### 8.1.3 Card de field note v2

Reemplazar la lista plana actual por cards enriquecidas. Cada una con:
- Fecha + tiempo de lectura
- Tema (pill)
- Título grande
- Subtítulo / dek (1 línea)
- Mini-pull-quote del artículo (extracto de 1 frase impactante, en cyan-dark)
- "Leer →"

Layout: 2 columnas en desktop, 1 en mobile. Card destacada arriba (la más reciente o la editorialmente más importante) en formato "feature" — full-width, más alta, con un fragmento más largo.

#### 8.1.4 Sección "Por dónde empezar"

Si hay más de 6-8 field notes, añadir una sección curada al final:

> "Si nunca has leído Noisia, empieza aquí."

Con 3 notas seleccionadas y razón de por qué cada una es buena entrada.

### 8.2 Field Note (detalle)

#### 8.2.1 Hero — más editorial

Mantener estructura pero refinar tipografía:
- Eyebrow: FIELD NOTE
- H1: el título
- Subhead: el dek
- Línea de meta: fecha · tiempo de lectura · tema(s)

#### 8.2.2 Cuerpo del artículo — tipografía editorial

Layout:
- Ancho de columna: 65ch máximo (lectura cómoda)
- Tipografía: Google Sans body-lg en cuerpo
- Párrafos separados por espacio generoso
- Sin sidebar — el artículo es el protagonista

#### 8.2.3 Componentes inline ricos

Permitir que el artículo use componentes inline más allá de prosa:

**Pull-quote grande (componente reutilizable):**  
Una frase central del artículo, en headline-md, con fondo glass sutil y acento `signal` lateral.

**Data point inline:**  
Cuando el texto menciona una cifra, opción de mostrarla como pill destacado en `signal-dark`. Ej: "...el sentiment plano cubre apenas un **23% de la varianza decisional**..."

**Mini-matrix inline:**  
Si la nota habla de una metodología, embebir una mini-versión de su matriz como ilustración.

**Quote-card (estilo conversacional):**  
Para cuando el artículo cita una conversación social real, usar el quote-card con metadata.

**Footnote moderna:**  
Notas al margen tipo Tufte: aparecen al lado en desktop, debajo del párrafo en mobile, con un superíndice clickeable.

#### 8.2.4 Bloque CTA al cierre — pulir el actual

El bloque actual ("La pregunta correcta cambia el tipo de evidencia que vale la pena mirar") está bien. Pequeñas mejoras:
- El CTA "Traer una pregunta" → cambiar a "Iniciar diagnóstico" para consistencia con resto del sitio
- Añadir una segunda línea pequeña debajo del CTA: "Lectura promedio antes de iniciar diagnóstico: 2 field notes."

Esa línea pequeña convierte el CTA en una observación honesta sobre el funnel real, sin sonar a marketing.

#### 8.2.5 Notas relacionadas

Al final del artículo, antes del footer global, una tira con 2-3 notas relacionadas:

> "Sigue leyendo"

Cards horizontales scrolleables (mobile) o grid (desktop). Sin algoritmo — curaduría manual o por tema compartido.

#### 8.2.6 Si la nota habla de una metodología, link directo

Si la field note menciona una metodología o caso, al final añadir un mini-bloque:

> "Esta nota toca: **Cultural Codes Decoding**. Estudiar la metodología →"

Con su signature mini, en glass card pequeño.

---

## 9. Consideraciones transversales

### 9.1 Mobile-first non-negociable

Cada componente nuevo debe diseñarse en 375px primero. Probar en mobile Safari real (no en Chrome dev tools — Safari tiene cuirks que matan motion).

Reglas específicas:
- No 100vh en heroes
- Scroll horizontal solo cuando aporta (matrices grandes, carruseles de quotes, casos relacionados)
- Sticky headers cuando el contenido es largo (matrices, pipelines)
- Tap targets mínimo 44x44px
- Animaciones respetan `prefers-reduced-motion`

### 9.2 Atmosfera/fluid background

Mantener el fluid background del DESIGN_V2.md en todas las páginas — pero **opacidad ajustada por sección**:
- Páginas de metodología detalle: opacidad baja (0.45-0.55) — el contenido es denso, el fondo no debe competir
- Páginas de casos lista: opacidad media (0.55-0.65)
- Páginas de Field Notes: opacidad muy baja (0.35-0.45) — es lectura larga, el ojo necesita calma
- Hero de cualquier página: opacidad alta (0.65-0.75) — momento de impacto

### 9.3 Reutilización del "dashboardsito"

El dashboard component que ya existe del home (probablemente del case study Cheaf) debe reaparecer:
- En metodología detalle: como output preview (Triggers & Barriers Map mockeado en mini-dashboard)
- En arquitectura: como ejemplo de "evidencia trazable"
- En servicios: como muestra del nivel Intelligence

No construir variantes nuevas — pulir el existente y reusarlo con datasets mockeados distintos.

### 9.4 Performance

Cada página debe cargar bajo 2.5s en 3G. Esto significa:
- Imágenes en WebP/AVIF
- Componentes interactivos (Mini Lab, Matrix, etc.) lazy-loaded — solo cargan cuando entran al viewport
- SVG signatures inlineados (no imágenes)
- Atmosphere canvas: estático en mobile (DESIGN_V2.md ya lo dice), animado solo en desktop con `requestAnimationFrame`

### 9.5 Voz consistente — recordatorio para todo el copy

Las páginas internas deben mantener la voz definida en `NOISIA_CONTEXT_FROM_CHEAF.md`:
- Tú/te, no usted
- Presente analítico
- Sin "innovador", "disruptivo", "elevamos", "potenciamos"
- Datos con interpretación, no datos solos
- Honestidad sobre alcance ("esta metodología no responde X — para eso usamos Y")
- Diagnósticos, no observaciones

### 9.6 SEO sin sacrificar autoridad

Las field notes son la pieza con más vector SEO. Tres reglas:
- Una nota por pregunta real, no por keyword
- Estructura H1/H2/H3 clara, pero no formulaica
- Meta description manual, no auto-generada
- Open Graph card por nota con tipografía Noisia

No publicar más de 1-2 field notes por mes. Volumen no es la estrategia.

### 9.7 Accesibilidad

- Contraste mínimo AA en todo texto (`neutral-11` sobre `canvas` cumple)
- Focus states visibles en todos los interactivos
- Atributos ARIA en componentes complejos (matrices, lab, decision tree)
- Cada SVG signature con `<title>` descriptivo
- Captions en videos si llegan

### 9.8 Estados de error y vacío

Para componentes interactivos:
- Si una matriz no tiene data para una celda: mostrar la celda en `surface-01` con texto "sin señal suficiente" — no ocultar
- Si el wizard se interrumpe: estado de "elegir desde el principio"
- Si el Mini Lab falla la animación: mostrar versión estática con mismo contenido

---

## 10. Orden recomendado de construcción

Si Codex va a construir esto por bloques (recomendable):

**Bloque 1 — Componentes biblioteca (semana 1-2)**
- The Matrix Component
- The Sources Constellation
- The Process Trace
- The Output Preview
- Methodology Card v2 con sus 6 signatures SVG

**Bloque 2 — Metodología detalle (Triggers & Barriers como pieza ejemplar) (semana 2-3)**
- Página completa con todos los componentes nuevos
- Esta es la pieza maestra — si esta queda bien, las otras 5 metodologías son aplicación

**Bloque 3 — Metodologías lista + Arquitectura (semana 3)**
- Lista con wizard
- Arquitectura con pipeline grande

**Bloque 4 — Casos lista + detalle (semana 4)**
- Lista con filtros
- Detalle con Vignette Storyboard

**Bloque 5 — Servicios + Field Notes (semana 5)**
- Servicios con Decision Tree
- Field Notes lista + plantilla de detalle con componentes inline

**Bloque 6 — Las otras 5 metodologías (semana 6)**
- Aplicar el patrón de Triggers & Barriers a Value Perception, Cultural Codes, Decision Velocity, Journey Friction, Influence Architecture
- Cada una con su data específica

---

## 11. Qué NO debe hacerse

- No usar componentes de UI libraries genéricas (shadcn, MUI, Mantine) sin adaptarlos completamente al sistema
- No ceder a la tentación de "y agregamos un loader cute aquí" — los micro-interactions decorativos rompen la voz analítica
- No animar texto de body (solo headlines y elementos visuales pueden tener motion)
- No usar emojis decorativos en copy (los pills semánticos sí, los emojis no)
- No incluir "trust badges" tipo "as featured in", "clientes satisfechos", "5 estrellas"
- No usar imágenes stock — todo lo visual debe ser SVG, mockup propio o quote real
- No incluir formularios largos — el único formulario es el del diagnóstico
- No usar carouseles auto-rotating (solo manuales con snap)
- No usar parallax que rompa scroll natural
- No usar dark patterns: cookies forzadas, modales de salida, popups de email

---

## 12. Lo que falta y necesito saber

Para que Codex construya con precisión, hace falta:

**Data exacta para los componentes:**
- ¿Qué caso real podemos mostrar en la matriz Triggers & Barriers? (Cheaf parece la opción natural — confirmar)
- ¿Tenemos quotes anonimizados aprobados para el Mini Lab de cada metodología?
- ¿Qué números reales usar en los counters de Arquitectura? (los del documento maestro: 150+, 10K+, etc. — confirmar)
- ¿Outputs preview: tenemos ya mockups de Triggers & Barriers Map, Activation Playbook, Friction Removal Plan?

**Casos para detalle:**
- ¿Cuáles de los 10 casos tienen vignette real anonimizable para storyboard?
- ¿Cuáles tienen "caso aplicado" con números que podamos mostrar?

**Field Notes:**
- ¿Cuántas notas existen ya escritas? (vi 3 en la lista actual)
- ¿Quién las firma? ¿"Noisia" o por autor?

**Branding fino:**
- Los SVG signatures de las 6 metodologías: ¿se diseñan ahora o se usan placeholders y luego se reemplazan?
- ¿Hay versión animada del logo para hero moments?

Esto se puede ir resolviendo en paralelo a la construcción. Pero conviene tenerlo mapeado antes de que Codex empiece el bloque 2.

---

*Fin del brief. Cualquier sección puede iterarse en detalle si Codex pide especificidad mayor en alguna pieza puntual.*
