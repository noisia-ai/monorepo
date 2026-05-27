# Noisia Home Content Handoff

Este documento reúne el contenido actual del Home de Noisia para poder pasárselo a Claude y pedirle una reescritura de copy.

La idea es que Claude tenga:

- el mapa completo del Home
- el copy actual exacto
- notas de contexto por sección
- indicación de qué vive dentro de tabs, cards, carruseles o footer
- diferencias importantes entre desktop y mobile cuando afectan el copy

## Cómo usar este archivo con Claude

Puedes pegarle algo como:

> Te paso el contenido completo actual del Home de Noisia. Quiero que reescribas todos los copys manteniendo la estructura de secciones y la lógica de producto. No quiero agency boilerplate ni promesas vacías. Quiero copy más preciso, más sólido y más propio de Noisia. Devuélvemelo respetando la misma arquitectura del documento: sección por sección, tabs incluidas, CTAs incluidas.

---

## 0. Estructura general del Home

Orden actual del Home:

1. Header / navegación
2. Hero
3. Producto en acción (tabs + dashboard carousel)
4. Lo que nos diferencia
5. Preguntas de negocio
6. Metodologías propietarias
7. Arquitectura del dato
8. Cobertura / fuentes
9. Servicios
10. Cierre / honestidad metodológica
11. Footer

---

## 1. Header / navegación

### 1.1 Brand lockup

- Logo: `Noisia`
- Descriptor visible junto al logo: `Social Intelligence Architects`

### 1.2 Navegación principal

- `Metodologías`
- `Arquitectura`
- `Casos`
- `Servicios`
- `Field Notes`

### 1.3 CTA principal del header

- `Iniciar diagnóstico`

### 1.4 Nota de UI

- En mobile esto se convierte en menú hamburguesa.
- El CTA `Iniciar diagnóstico` sigue siendo parte importante del shell.

---

## 2. Hero

### 2.1 Eyebrow

- `Social Intelligence Architects`

### 2.2 Headline principal

- `Convierte conversación en decisiones.`

### 2.3 Supporting paragraph

- `Noisia orquesta datos sociales y públicos para construir reportes narrativos, dashboards explorables, chat con evidencia y outputs listos para compartir.`

### 2.4 CTAs del hero

- Primario: `Iniciar diagnóstico`
- Secundario: `Ver metodologías`

### 2.5 Proof cards / métricas del hero

Card 1:

- Número: `150+`
- Texto: `fuentes normalizadas`

Card 2:

- Número: `6`
- Texto: `metodologías propietarias`

Card 3:

- Número: `1`
- Texto: `decisión trazable por reporte`

### 2.6 Nota de contexto

- El hero ya no lleva mini dashboard integrado.
- En mobile se dejó con más aire arriba y mayor respiración visual.

---

## 3. Producto en acción

### 3.1 Nota de estructura

Esta sección aparece justo debajo del hero.

Tiene:

- tabs horizontales
- autoswipe inicial
- dashboard/carousel de escenas
- cada tab cambia todo el contenido del dashboard

### 3.2 Tabs actuales

1. `Campaña`
2. `Fricción`
3. `Producto`
4. `Mercado`
5. `Defensa`

---

### 3.3 Tab 01 — Campaña

#### Tab label

- `Campaña`

#### Product label / chip

- `Report builder`

#### Título de la escena

- `Lectura de campaña · food rescue LATAM`

#### Créditos

- `1,842`

#### Metodologías visibles

- `Cultural Codes`
- `Triggers & Barriers`

#### Pregunta principal

- `¿Qué tensión cultural puede sostener una campaña de adquisición sin activar cinismo?`

#### Insight principal

- `La oportunidad no está en “ahorrar”. Está en quitar culpa de una compra inteligente.`

#### Summary

- `1,284 señales sugieren que el driver racional existe, pero la conversión aparece cuando la marca permite sentirse parte de una solución cotidiana.`

#### Métricas visibles

- `tensión dominante` → `47.2%`
- `fricción narrativa` → `31.8%`

#### Source drawer

Quote:

- `“Me gusta la idea, pero no quiero sentir que compro sobras. Si lo cuentan como rescate, cambia.”`

Metadata:

- `Plataforma` → `Review pública`
- `Mercado` → `Chile`
- `Tag` → `framing · culpa · valor`

#### Chat prompt inferior

- `Dame el ángulo para México sin sonar alarmista.`

#### Source count

- `3 fuentes`

---

### 3.4 Tab 02 — Fricción

#### Tab label

- `Fricción`

#### Product label / chip

- `Journey read`

#### Título de la escena

- `Diagnóstico de conversión · wallet fintech`

#### Créditos

- `2,116`

#### Metodologías visibles

- `Journey Friction Mapping`
- `Decision Velocity`

#### Pregunta principal

- `¿Dónde se rompe la decisión cuando el usuario ya entendió el beneficio?`

#### Insight principal

- `El abandono no ocurre por falta de interés. Ocurre cuando la prueba de seguridad llega tarde.`

#### Summary

- `El journey muestra intención alta, pero la velocidad cae en el paso donde el usuario necesita validar control, reversibilidad y soporte humano.`

#### Métricas visibles

- `bloqueo de velocidad` → `38.6%`
- `permiso a CTA` → `52.4%`

#### Source drawer

Quote:

- `“Sí lo usaría, pero antes quiero saber qué pasa si me equivoco o si algo no se refleja.”`

Metadata:

- `Plataforma` → `Foro financiero`
- `Mercado` → `México`
- `Tag` → `riesgo · reversibilidad · soporte`

#### Chat prompt inferior

- `Resume el cambio de UX que aceleraría el registro.`

#### Source count

- `7 fuentes`

---

### 3.5 Tab 03 — Producto

#### Tab label

- `Producto`

#### Product label / chip

- `Jobs read`

#### Título de la escena

- `Mapa de oportunidad · skincare sensible`

#### Créditos

- `2,604`

#### Metodologías visibles

- `Triggers & Barriers`
- `Value Perception Matrix`

#### Pregunta principal

- `¿Qué jobs no resueltos justifican una nueva línea sin competir solo por claims?`

#### Insight principal

- `La oportunidad no es prometer potencia. Es reducir ansiedad antes de probar.`

#### Summary

- `Reviews largos separan deseo de eficacia y miedo a irritación. El valor aparece cuando la marca convierte diagnóstico, prueba y rutina en una misma experiencia.`

#### Métricas visibles

- `unmet job visible` → `44.9%`
- `barrera de prueba` → `29.7%`

#### Source drawer

Quote:

- `“Quiero algo que funcione, pero ya me cansé de comprar productos que me dejan peor la piel.”`

Metadata:

- `Plataforma` → `Reviews e-commerce`
- `Mercado` → `Colombia`
- `Tag` → `riesgo · rutina · sensibilidad`

#### Chat prompt inferior

- `Dame tres rutas de concepto con menor riesgo percibido.`

#### Source count

- `5 fuentes`

---

### 3.6 Tab 04 — Mercado

#### Tab label

- `Mercado`

#### Product label / chip

- `Market entry`

#### Título de la escena

- `Entrada de mercado · proteína plant-based`

#### Créditos

- `3,028`

#### Metodologías visibles

- `Cultural Codes`
- `Influence Architecture`

#### Pregunta principal

- `¿Qué código local puede legitimar la categoría sin sonar importada?`

#### Insight principal

- `El permiso cultural no vive en bienestar aspiracional. Vive en rendimiento cotidiano.`

#### Summary

- `La conversación local rechaza superioridad moral, pero acepta soluciones prácticas cuando aparecen validadas por nodos técnicos y comunidades de entrenamiento.`

#### Métricas visibles

- `código legitimador` → `41.3%`
- `rechazo moral` → `26.2%`

#### Source drawer

Quote:

- `“No me interesa que me regañen por comer carne. Me interesa rendir y no sentirme pesado.”`

Metadata:

- `Plataforma` → `Comunidad fitness`
- `Mercado` → `Perú`
- `Tag` → `rendimiento · identidad · validadores`

#### Chat prompt inferior

- `¿Qué nodos conviene escuchar antes de pauta?`

#### Source count

- `8 fuentes`

---

### 3.7 Tab 05 — Defensa

#### Tab label

- `Defensa`

#### Product label / chip

- `Defense read`

#### Título de la escena

- `Defensa de valor · marketplace premium`

#### Créditos

- `2,337`

#### Metodologías visibles

- `Value Perception Matrix`
- `Decision Velocity`
- `Journey Friction Mapping`

#### Pregunta principal

- `¿Qué dimensión de valor sostiene margen cuando el competidor gana por precio?`

#### Insight principal

- `La defensa no es justificar precio. Es hacer visible el costo de equivocarse.`

#### Summary

- `El competidor captura comparación rápida, pero Noisia detecta que los compradores vuelven a valorar garantía, trazabilidad y resolución cuando el riesgo de compra sube.`

#### Métricas visibles

- `valor defendible` → `49.6%`
- `presión por precio` → `34.1%`

#### Source drawer

Quote:

- `“Lo barato sirve hasta que algo falla. Ahí prefiero pagar más si sé quién responde.”`

Metadata:

- `Plataforma` → `Q&A marketplace`
- `Mercado` → `Argentina`
- `Tag` → `garantía · riesgo · soporte`

#### Chat prompt inferior

- `Convierte esto en argumento para paid search.`

#### Source count

- `6 fuentes`

### 3.8 Nota de comportamiento

- En desktop: tabs centradas y dashboard centrado.
- En mobile: tabs con scroll horizontal y cards visibles parcialmente a los lados.

---

## 4. Lo que nos diferencia

### 4.1 Eyebrow

- `LO QUE NOS DIFERENCIA`

### 4.2 Título

- `La mayoría de las marcas tiene acceso a datos sociales. Muy pocas tienen inteligencia social.`

### 4.3 Lead

- `Acceso es una herramienta que cuenta menciones, mide sentiment y dibuja gráficas. Inteligencia es un sistema analítico que decodifica motivaciones, fricciones, códigos culturales y arquitectura de influencia para traducir todo eso en decisiones.`

### 4.4 Thesis panel

- `Noisia no vende acceso. Construye inteligencia. El sitio entero debe leerse como una muestra de ese criterio: método visible, evidencia cerca y producto insinuado sin esconderse detrás de copy abstracto.`

---

## 5. Preguntas de negocio

### 5.1 Eyebrow

- `PREGUNTAS DE NEGOCIO`

### 5.2 Título

- `No empezamos por dashboards. Empezamos por la pregunta que define la decisión.`

### 5.3 Lead

- `Elige una situación. El sistema ajusta protocolo, metodologías y output antes de consumir tiempo analítico.`

### 5.4 Nota de estructura

Esta sección usa el componente `UseCaseSelector`.

En desktop:

- lista de tabs/preguntas a la izquierda
- panel de detalle a la derecha

En mobile:

- carrusel horizontal
- header meta arriba
- el copy visible cambia ligeramente por layout, pero viene del mismo dataset

### 5.5 Copy estructural visible en desktop

- Eyebrow del panel: `Pregunta activa`
- Label de bloque inferior: `Output probable`

### 5.6 Copy estructural visible en mobile

- Meta superior: `Protocolo activo`
- Label de cada card: `Pregunta 01`, `Pregunta 02`, etc.
- Label de bloque inferior: `Output probable`

### 5.7 Casos / tabs disponibles

#### Caso 01

- Tab: `Lanzamiento de campaña`
- Título: `Tengo que lanzar una campaña. ¿Sobre qué tensión cultural debe construirse?`
- Approach: `Decodificamos tensiones simbólicas activas en la categoría y mapeamos sobre cuáles la marca tiene permiso real para hablar.`
- Metodologías:
  - `Cultural Codes`
  - `Triggers & Barriers`
- Output probable:
  - `Tension map`
  - `Campaign angle brief`
  - `Narrativa con fuentes`
- Timing visible en mobile: `4-6 semanas`

#### Caso 02

- Tab: `Optimización de medios`
- Título: `Mi plan de medios no rinde. ¿Dónde está la fricción real?`
- Approach: `Mapeamos el journey conversacional real e identificamos los puntos donde el mensaje pierde tracción antes de llegar a conversión.`
- Metodologías:
  - `Journey Friction Mapping`
  - `Decision Velocity`
- Output probable:
  - `Friction map`
  - `Velocity blockers`
  - `Message repair plan`
- Timing visible en mobile: `4-6 semanas`

#### Caso 03

- Tab: `Desarrollo de producto`
- Título: `Necesito desarrollar productos nuevos. ¿Qué jobs aún no están resueltos?`
- Approach: `Extraemos unmet jobs desde reviews, foros y discusiones reales para separar deseo expresado de oportunidad accionable.`
- Metodologías:
  - `Triggers & Barriers`
  - `Value Perception Matrix`
- Output probable:
  - `Jobs landscape`
  - `Whitespace report`
  - `Concept directions`
- Timing visible en mobile: `6-10 semanas`

#### Caso 04

- Tab: `Nuevo mercado`
- Título: `Vamos a entrar a un nuevo mercado. ¿Cómo se decodifica nuestra categoría aquí?`
- Approach: `Reconstruimos el sistema simbólico local: qué significa la categoría, quién la legitima y qué narrativas la rechazan.`
- Metodologías:
  - `Cultural Codes`
  - `Influence Architecture`
- Output probable:
  - `Local code dossier`
  - `Category influence map`
  - `Market entry brief`
- Timing visible en mobile: `6-10 semanas`

#### Caso 05

- Tab: `Reposicionamiento`
- Título: `Necesito reposicionar la marca. ¿Qué código simbólico ocupamos hoy y cuál podríamos ocupar?`
- Approach: `Mapeamos la posición simbólica actual de la marca y competidores dentro del sistema cultural de la categoría.`
- Metodologías:
  - `Cultural Codes`
  - `Value Perception Matrix`
- Output probable:
  - `Symbolic position map`
  - `Value gap analysis`
  - `Repositioning routes`
- Timing visible en mobile: `6-10 semanas`

#### Caso 06

- Tab: `Defensa competitiva`
- Título: `Estoy perdiendo share. ¿Por qué los consumidores migran al competidor?`
- Approach: `Analizamos narrativas de migración: cuándo se quiebra la lealtad, qué la dispara y qué capitaliza el competidor.`
- Metodologías:
  - `Triggers & Barriers`
  - `Journey Friction`
- Output probable:
  - `Migration narrative map`
  - `Retention barriers`
  - `Competitive defense brief`
- Timing visible en mobile: `4-8 semanas`

#### Caso 07

- Tab: `Validación de hipótesis`
- Título: `Tenemos una tesis estratégica. ¿Existe evidencia conversacional que la sostenga?`
- Approach: `Diseñamos un protocolo que busca señales confirmatorias y disconfirmatorias en data conversacional real.`
- Metodologías:
  - `Protocolo a medida`
- Output probable:
  - `Evidence brief`
  - `Counter-signal log`
  - `Decision recommendation`
- Timing visible en mobile: `4-6 semanas`

#### Caso 08

- Tab: `Anticipación de tendencias`
- Título: `¿Qué tendencias están emergiendo en mi categoría que aún no son visibles?`
- Approach: `Detectamos señales débiles: vocabularios, prácticas y actores nuevos que predicen movimientos de categoría.`
- Metodologías:
  - `Cultural Codes`
  - `Influence Architecture`
- Output probable:
  - `Weak signal radar`
  - `Emerging vocabulary`
  - `Early node dossier`
- Timing visible en mobile: `6-10 semanas`

#### Caso 09

- Tab: `Crisis`
- Título: `Estamos en una crisis. ¿Qué está realmente pasando en la conversación?`
- Approach: `Decodificamos la estructura narrativa de la crisis: quién la sostiene, qué la alimenta y qué necesita para desactivarse.`
- Metodologías:
  - `Influence Architecture`
  - `Cultural Codes`
- Output probable:
  - `Crisis narrative map`
  - `Node risk list`
  - `Response strategy`
- Timing visible en mobile: `2-4 semanas`

#### Caso 10

- Tab: `Influencia de categoria`
- Título: `¿Quiénes son los nodos que mueven la conversación de mi categoría?`
- Approach: `Mapeamos nodos centrales, conectores entre comunidades, voces emergentes y detractores estructurales.`
- Metodologías:
  - `Influence Architecture`
- Output probable:
  - `Influence map`
  - `Key nodes dossier`
  - `Activation strategy`
- Timing visible en mobile: `6-10 semanas`

---

## 6. Metodologías propietarias

### 6.1 Eyebrow

- `METODOLOGÍAS PROPIETARIAS`

### 6.2 Título

- `Seis lentes. Cada una construida para una pregunta distinta.`

### 6.3 Lead

- `No explicamos frameworks como brochure. Dejamos ver cómo trabajan: cada metodología tiene fundamentos, protocolo, outputs, usos y limitaciones honestas.`

### 6.4 Nota de estructura

Esta sección usa cards de preview.

Cada card muestra:

- eyebrow `Metodología 01`, `Metodología 02`, etc.
- nombre
- lead
- pregunta
- dos outputs visibles
- CTA final

CTA visible en todas:

- `Estudiar método →`

### 6.5 Card 01

- Eyebrow: `Metodología 01`
- Nombre: `Triggers & Barriers`
- Lead: `La decisión de compra, adopción o migración no es un acto racional puro. Es una negociación entre fuerzas motivacionales y fuerzas de fricción que operan en niveles conscientes e inconscientes.`
- Pregunta: `¿Qué motiva y qué frena la decisión de tu consumidor?`
- Outputs visibles:
  - `Triggers & Barriers Map`
  - `Activation Playbook`

### 6.6 Card 02

- Eyebrow: `Metodología 02`
- Nombre: `Value Perception Matrix`
- Lead: `Valor no es una variable. Es un sistema multidimensional: lo que el consumidor recibe menos lo que entrega en dinero, tiempo, esfuerzo y riesgo.`
- Pregunta: `¿Qué dimensión de valor capitaliza tu marca y cuál está abandonando?`
- Outputs visibles:
  - `Value Perception Matrix`
  - `Whitespace Report`

### 6.7 Card 03

- Eyebrow: `Metodología 03`
- Nombre: `Cultural Codes Decoding`
- Lead: `Toda categoría está envuelta en significados que el consumidor da por sentado. Esta metodología reconstruye reglas, tabú, códigos visuales y verbales para operar con, contra o reescribiendo el código.`
- Pregunta: `¿Qué significa tu categoría en el sistema simbólico de tu consumidor?`
- Outputs visibles:
  - `Cultural Code Dossier`
  - `Symbolic Map`

### 6.8 Card 04

- Eyebrow: `Metodología 04`
- Nombre: `Decision Velocity`
- Lead: `La velocidad de decisión no es una constante personal. Es una propiedad de la categoría, del momento y del contexto.`
- Pregunta: `¿Por qué tu consumidor decide rápido en una categoría y lento en la tuya?`
- Outputs visibles:
  - `Decision Velocity Diagnostic`
  - `Velocity Blockers Map`

### 6.9 Card 05

- Eyebrow: `Metodología 05`
- Nombre: `Journey Friction Mapping`
- Lead: `Los customer journeys modelados en workshops son hipótesis. El journey real es un campo de batalla con pérdidas en cada paso.`
- Pregunta: `¿Dónde se rompe el camino entre la intención y la acción?`
- Outputs visibles:
  - `Friction Map`
  - `Break Points Brief`

### 6.10 Card 06

- Eyebrow: `Metodología 06`
- Nombre: `Influence Architecture`
- Lead: `La influencia no es una métrica de seguidores. Es una propiedad estructural de redes: ciertos nodos mueven significado entre comunidades de manera desproporcionada.`
- Pregunta: `¿Quiénes diseñan, sin saberlo, el imaginario de tu categoría?`
- Outputs visibles:
  - `Influence Architecture Map`
  - `Key Nodes Dossier`

---

## 7. Arquitectura del dato

### 7.1 Eyebrow

- `EL MOAT TÉCNICO`

### 7.2 Título

- `La calidad de la inteligencia depende de la arquitectura del dato.`

### 7.3 Lead

- `Una metodología brillante operando sobre un corpus pobre produce conclusiones pobres. Por eso Noisia orquesta fuentes, normaliza evidencia y aplica método sobre el corpus correcto.`

### 7.4 CTA

- `Conocer arquitectura`

### 7.5 Nodos visibles

#### Nodo 01

- Número: `01`
- Nombre: `Ingesta`
- Detail: `150+ fuentes normalizadas, 10,000+ scrapers especializados, APIs nativas e ingesta de podcasts, video y texto largo.`

#### Nodo 02

- Número: `02`
- Nombre: `Normalización`
- Detail: `Esquema único, deduplicación, atribución, metadatos comparables y traducción cuando aplica.`

#### Nodo 03

- Número: `03`
- Nombre: `Enriquecimiento`
- Detail: `Clasificación temática, entidades, sentimiento multidimensional, sarcasmo contextual y tensión narrativa.`

#### Nodo 04

- Número: `04`
- Nombre: `Analítica`
- Detail: `Operacionalización de las seis metodologías sobre corpus normalizado y evidencia trazable.`

### 7.6 Chips de output visibles

- `Evidence graph`
- `Method engine`
- `Narrative layer`
- `Export-ready output`

---

## 8. Cobertura / fuentes

### 8.1 Eyebrow

- `COBERTURA`

### 8.2 Título

- `La conversación que importa rara vez vive en una sola plataforma.`

### 8.3 Lead

- `El corpus se arma por pregunta. Noisia combina fuentes sociales, reviews, foros, noticias, audio, video y marketplaces cuando la decisión lo exige.`

### 8.4 Chips de fuentes visibles

- `Redes sociales abiertas`
- `Foros nicho`
- `Reviews de ecommerce y apps`
- `News y editoriales`
- `Blogs y newsletters`
- `Podcasts transcritos`
- `Video transcrito`
- `Q&A de marketplaces`
- `Comunidades accesibles`
- `Marketplaces especializados`

---

## 9. Servicios

### 9.1 Eyebrow

- `SERVICIOS`

### 9.2 Título

- `Tres formas de trabajar juntos. Una sola lógica: la pregunta manda.`

### 9.3 Lead

- `Foundation, Intelligence y Strategy no son paquetes cerrados. Son niveles de profundidad para construir una respuesta proporcional al riesgo de la decisión.`

### 9.4 Nota de estructura

Esta sección tiene tres cards.

Cada card incluye:

- chip con nombre del tier
- descripción principal
- bullets de alcance
- párrafo de ideal use case
- CTA `Iniciar diagnóstico`

### 9.5 Card Foundation

- Chip: `Foundation`
- Descripción: `Para marcas que necesitan piso analitico antes de decidir.`
- Bullets:
  - `Diagnostico inicial`
  - `1-2 metodologias`
  - `4-6 semanas`
- Ideal use case: `Validar una hipotesis, entender una categoria nueva o preparar un brief estrategico.`
- CTA: `Iniciar diagnóstico`

### 9.6 Card Intelligence

- Chip: `Intelligence`
- Descripción: `Para marcas con preguntas de negocio activas y decision proxima.`
- Bullets:
  - `Protocolo a la medida`
  - `3-4 metodologias`
  - `6-10 semanas`
- Ideal use case: `Lanzamientos, reposicionamiento, defensa competitiva o entrada a mercado.`
- CTA: `Iniciar diagnóstico`

### 9.7 Card Strategy

- Chip: `Strategy`
- Descripción: `Para marcas que necesitan inteligencia social como capacidad continua.`
- Bullets:
  - `Protocolo evolutivo`
  - `6 metodologias + retainer`
  - `Trimestral o anual`
- Ideal use case: `Categorias de alta velocidad, alta fragmentacion cultural o decision recurrente.`
- CTA: `Iniciar diagnóstico`

---

## 10. Cierre / honestidad metodológica

### 10.1 Eyebrow

- `HONESTIDAD METODOLÓGICA`

### 10.2 Título

- `Tu pregunta no es “qué dicen sobre mi marca”. Es “qué hago con lo que dicen”.`

### 10.3 Supporting paragraph

- `No vendemos licencias de software. No entregamos dashboards genéricos. No reportamos volumen y sentiment como si fueran insights. Traducimos conversaciones en decisiones.`

### 10.4 CTAs

- `Iniciar diagnóstico`
- `Hablar con Noisia`

---

## 11. Footer

### 11.1 Brand block

- Logo: `Noisia`
- Paragraph:
  - `Arquitectura de inteligencia social para convertir conversaciones públicas en decisiones estratégicas trazables.`

### 11.2 Footer column — Website

- Título de columna: `Website`
- Links:
  - `Manifiesto`
  - `Nosotros`
  - `Field Notes`
  - `Contacto`

### 11.3 Footer column — Metodologías

- Título de columna: `Metodologías`
- Links visibles:
  - `Triggers & Barriers`
  - `Value Perception Matrix`
  - `Cultural Codes Decoding`
  - `Decision Velocity`

### 11.4 Footer column — Casos

- Título de columna: `Casos`
- Links visibles:
  - `Lanzamiento de campaña`
  - `Optimización de medios`
  - `Desarrollo de producto`
  - `Nuevo mercado`

### 11.5 Footer column — Contacto

- Título de columna: `Contacto`
- Links / textos:
  - `hola@noisia.ai`
  - `strategy@noisia.ai`
  - `Iniciar diagnóstico`
  - `SOCIAL INTELLIGENCE ARCHITECTS`

---

## 12. Microcopys y labels de sistema visibles en Home

Esto no siempre es “copy principal”, pero sí aparece en pantalla y puede convenir reescribirlo si Claude va a rehacer el Home completo.

### 12.1 Labels del dashboard

- `Créditos`
- `Narrative dashboard`
- `Source drawer`

### 12.2 Labels de interacción / export del dashboard

Estos hoy no tienen texto visible, pero sí intención:

- compartir link
- descargar PPT
- abrir reporte

### 12.3 Labels del selector de casos

- `Pregunta activa`
- `Output probable`
- `Protocolo activo`

### 12.4 CTA recurrente

El CTA más repetido del Home es:

- `Iniciar diagnóstico`

También aparecen:

- `Ver metodologías`
- `Conocer arquitectura`
- `Hablar con Noisia`
- `Estudiar método →`

---

## 13. Notas editoriales para quien rehaga el copy

Estas notas no son copy actual, pero sirven para orientar a Claude:

- Noisia no debe sonar a agencia genérica.
- No debe sonar a herramienta de social listening.
- No debe vender “dashboards” como fin, sino como parte de un sistema de decisión.
- El producto futuro ya asoma en el Home, así que el copy debe convivir con lógica de:
  - report builder
  - credits
  - narrative dashboard
  - source drawer
  - chat with data
  - export
- El tono debe sentirse más analítico, estratégico y exacto que aspiracional-publicitario.
- Conviene evitar frases demasiado abstractas o de “consultora creativa”.

---

## 14. Fuente de verdad

El Home actual se arma principalmente desde:

- `/Users/brandhon_o/Downloads/noisia-website/src/app/(marketing)/page.tsx`
- `/Users/brandhon_o/Downloads/noisia-website/src/content/site.ts`
- `/Users/brandhon_o/Downloads/noisia-website/src/components/product-scenes/ProductConsoleShowcase.tsx`
- `/Users/brandhon_o/Downloads/noisia-website/src/components/product-scenes/ProductConsole.tsx`
- `/Users/brandhon_o/Downloads/noisia-website/src/components/marketing/UseCaseSelector.tsx`
- `/Users/brandhon_o/Downloads/noisia-website/src/components/marketing/MethodologyPreviewGrid.tsx`
- `/Users/brandhon_o/Downloads/noisia-website/src/components/layout/SiteHeader.tsx`
- `/Users/brandhon_o/Downloads/noisia-website/src/components/layout/SiteFooter.tsx`

