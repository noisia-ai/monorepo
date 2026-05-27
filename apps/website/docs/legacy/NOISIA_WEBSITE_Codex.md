# Noisia Website — Brief Maestro de Construcción

> **Documento para:** Codex (agente de implementación)
> **Cliente:** Noisia — Social Intelligence Architects
> **Idioma del sitio:** Español (Latinoamérica). Inglés como capa secundaria opcional (i18n preparado pero no obligatorio en MVP).
> **Estado:** Especificación de implementación. Cada sección contiene contexto, copy final, requerimientos técnicos y criterios de aceptación.

---

## 0. Cómo leer este documento

Este brief está estructurado para que un agente de codificación pueda:

1. **Configurar el proyecto** con el stack recomendado (sección 4).
2. **Construir el sistema de diseño** desde tokens (sección 3).
3. **Implementar páginas en orden de prioridad** (sección 6 + sección 12).
4. **Reutilizar componentes** definidos en sección 7.
5. **Validar cada página** contra sus criterios de aceptación.

Cuando una sección dice "copy final", ese texto va literal al sitio. Cuando dice "intent", es una guía de tono a redactar contextualmente.

**Convenciones del documento:**
- `código en monospace` = clases, variables, archivos, identificadores técnicos.
- *Italics* = términos del vocabulario Noisia que deben preservarse.
- **Bold** = decisiones no negociables.
- Bloques `> Nota` = decisiones de producto a respetar.

---

## 1. Identidad de marca y posicionamiento

### 1.1 Quién es Noisia

Noisia es una **agencia de Inteligencia Social**. No es una plataforma SaaS, no es una herramienta de social listening, no vende dashboards. Noisia se posiciona como **Social Intelligence Architects**: arquitectos que diseñan sistemas analíticos a la medida del problema estratégico del cliente, orquestando datos conversacionales de múltiples fuentes para producir decisiones — no reportes.

### 1.2 La distinción crítica

El sitio entero debe sostener esta tensión narrativa:

| Social Listening tradicional | Noisia — Inteligencia Social |
|---|---|
| Vende acceso a una herramienta | Vende capacidad analítica + orquestación de datos |
| Mide volumen, sentiment, share of voice | Decodifica motivaciones, fricciones, códigos culturales |
| Output: dashboard | Output: decisión estratégica |
| Una fuente de datos (la que la plataforma indexa) | 150+ fuentes normalizadas, 10,000+ scrapers |
| Genérico, replicable | Metodología propietaria por problema |
| El cliente interpreta | Noisia traduce a estrategia |

> **Nota de tono:** El sitio NO debe explicar esta tabla literalmente como confrontación. Debe **encarnarla**: el lenguaje, los ejemplos, las visualizaciones y la arquitectura del sitio son la diferencia. Si un visitante termina pensando "esto no es lo que esperaba de social listening", el sitio cumplió.

### 1.3 Promesa central

> **"Convertimos conversaciones en decisiones."**

Variantes admitidas:
- "De la conversación a la decisión."
- "Inteligencia social aplicada a decisiones de negocio."
- "Arquitectos de inteligencia social."

### 1.4 Voz y tono

**Voz:** consultiva, segura, intelectualmente densa pero clara. Como un estratega senior que respeta la inteligencia del lector.

**Tono por contexto:**
- *Hero/landing:* aspiracional, declarativo, breve.
- *Metodologías:* riguroso, casi académico, con referencias a fundamentos científicos.
- *Casos de uso:* concreto, operativo, orientado a resultados.
- *Servicios:* consultivo, no transaccional. No "compra ahora", sí "iniciemos un diagnóstico".
- *Field Notes (blog):* ensayo corto, voz autoral, no SEO churn.

**Anti-tono (qué evitar):**
- Lenguaje de SaaS: "plataforma", "dashboard", "tracking en tiempo real", "alertas".
- Jerga de marketing genérica: "supercharge", "next-level", "data-driven".
- Buzzwords vacíos: "AI-powered" sin sustancia, "transformación digital".
- Promesas cuantitativas no respaldadas: "10x ROI", "+300% engagement".
- Tono motivacional: nada de "¡Lleva tu marca al siguiente nivel!".

**Vocabulario propietario** (consistente en todo el sitio):
- *Inteligencia Social* (no "social listening" salvo cuando se contraste).
- *Arquitectura de datos* (no "stack tecnológico").
- *Orquestación* (no "integración").
- *Codificación cultural* (no "análisis de tendencias").
- *Decisión velocidad* (no "tiempo de decisión").
- *Fricción* (no "obstáculo" o "barrera del usuario").
- *Playbook estratégico* (no "reporte" o "informe").

---

## 2. Audiencias y casos de uso

### 2.1 Audiencias primarias

**A1 — Líderes de marca (CMO, Brand Director, Head of Insights)**
Buscan: respuestas que su agencia o su herramienta no les da. Llegan al sitio con una pregunta de negocio específica.

**A2 — Agencias estratégicas (planners, directores estratégicos)**
Buscan: un partner analítico que les dé municiones para sus pitches o planes. Quieren rigor metodológico que puedan defender frente a su cliente.

**A3 — Investigadores de mercado / consultoras**
Buscan: capacidad de orquestación de datos que ellos no tienen internamente. Compran capacidad, no insights.

### 2.2 Las preguntas de negocio que el sitio debe responder

Cada visitante llega con una pregunta. El sitio debe hacerle sentir que Noisia entiende esa pregunta antes de explicarle nada.

Las 10 preguntas que el home debe reflejar como casos de uso:

1. **Lanzamiento de campaña:** ¿Sobre qué tensión cultural debería construirse esta campaña?
2. **Plan de medios:** ¿Por qué nuestro mensaje no está aterrizando? ¿Dónde está la fricción?
3. **Desarrollo de producto:** ¿Qué jobs-to-be-done aún no están resueltos en esta categoría?
4. **Entrada a nuevo mercado:** ¿Cómo se decodifica esta categoría en este país/segmento?
5. **Reposicionamiento de marca:** ¿Qué código cultural ocupa nuestra marca y cuál podría ocupar?
6. **Defensa competitiva:** ¿Por qué los consumidores están migrando al competidor?
7. **Validación de hipótesis estratégica:** ¿Existe evidencia conversacional de la tesis que tenemos?
8. **Anticipación de tendencia:** ¿Qué señales débiles están emergiendo en nuestra categoría?
9. **Decodificación de crisis:** ¿Qué está realmente pasando en la conversación sobre nuestra marca?
10. **Identificación de influencia:** ¿Quiénes son los nodos que mueven la conversación de esta categoría?

> **Decisión de IA del sitio:** El home debe permitir al visitante encontrar **su pregunta** rápido. Esto guía el diseño del componente "use case selector" (sección 6.1).

---

## 3. Sistema visual y de diseño

> **Fuente única de verdad:** `DESIGN_V2.md` (archivo separado en el repositorio) define todos los tokens (color, tipografía, spacing, radius), componentes visuales (fluid-background, glass-card, chart-surface, etc.), modos de experiencia y reglas de lenguaje. **Esta sección no duplica esos tokens; solo integra al brief lo que afecta decisiones de arquitectura, contenido y producto.** En cualquier conflicto entre el brief y `DESIGN_V2.md` sobre detalle visual, prevalece `DESIGN_V2.md`.

### 3.1 Filosofía visual (síntesis)

Cuatro principios del sistema:

- **Canvas blanco primero.** Página respirable, editorial, precisa.
- **Atmósfera debajo.** Color fluido difuso (blob backgrounds) como sustrato vivo, nunca protagonista.
- **Vidrio sobre señal.** Cards y charts en superficies translúcidas (glass), no cajas opacas.
- **Datos con pulso humano.** Métricas grandes y directas; quotes que aterrizan el análisis.

Noisia no debe parecer un dashboard SaaS, una landing genérica de agencia, ni un PDF corporativo. Debe parecer un **artefacto privado de inteligencia**: lo suficientemente personal para enviarse por DM, lo suficientemente riguroso para iniciar una conversación de directorio.

### 3.2 Modos de experiencia

`DESIGN_V2.md` define cinco modos de UI. **Antes de aplicar reglas de layout a una página, hay que elegir su modo.** Esta es una decisión de arquitectura — no decorativa — y por eso vive en el brief y no solo en el design system.

| Modo | Posture | Uso en este sitio |
|---|---|---|
| **Marketing** | brand-forward, expressive, spacious | Home, `/metodologias` (index + detalles), `/arquitectura-de-datos`, `/casos-de-uso` (index + detalles), `/servicios`, `/manifiesto`, `/nosotros`, `/contacto` |
| **Private report** | mobile-first, editorial, executive | `/field-notes/[slug]` (lectura larga, prosa autoral) |
| **App workspace** | desktop-first, dense, tool-like | `/diagnostico` (formulario serio, denso, no expresivo) |
| **Narrative dashboard** | story + controls, exploración | Fuera de scope MVP — preparado para Fase 3 |
| **Data chat** | conversación anclada a evidencia | Fuera de scope MVP — preparado para Fase 3 |

> **Implicación clave para MVP:** todas las páginas marketing comparten densidad y rhythmo (ver `marketing-section-mobile: 72px` / `marketing-section-desktop: 112px` en `DESIGN_V2.md`). El wizard de diagnóstico **no** sigue rhythmo de marketing — usa densidad de workspace (más tight, más tool-like). Field Notes individuales **no** siguen rhythmo de marketing — siguen `report-section` spacing (88/120) y `max-width` de lectura cercano a 720px.

### 3.3 Tokens y componentes (consumir desde DESIGN_V2.md)

Todo lo siguiente vive en `DESIGN_V2.md` y debe consumirse desde ahí en build, sin re-tipear valores:

- **Paleta:** canvas blanco como base; `signal` cyan para descubrimiento; `tension` red para contradicción; `positive` green para validación de usuario; `whisper` lavender solo para data secundaria; blobs (`blob-red`, `blob-cyan`, `blob-dark`, `blob-charcoal`) **solo** dentro del fondo fluido — nunca en texto, botones, iconos.
- **Tipografía:** **Google Sans / Product Sans únicamente.** Sin Inter, sin Roboto, sin serif, sin display novelty. Tracking siempre `0`. Sentence case o lowercase en headings; sin Title Case.
- **Spacing:** escala con tokens específicos por modo (`marketing-section-*`, `report-section-*`, `workspace-gutter`, `dashboard-gap`, etc.). Ver YAML del design system.
- **Radius:** 8 / 12 / 16 / 20 / 24 / 32 / pill.
- **Componentes definidos:** `fluid-background`, `glass-card`, `chart-surface`, `primary-button` (negro, pill), `toggle-button`, `section-eyebrow`, `quote-critical`, `quote-defender`, `footer-panel`, `app-shell`, `source-drawer`, `data-chat`, `credit-wallet`, `export-bar`.

> **Regla de implementación para Codex:** parsear el frontmatter YAML de `DESIGN_V2.md` y exponerlo como CSS variables + tokens de Tailwind. No hardcodear hex, sizes, ni radii en componentes. Cualquier valor visual proviene de un token.

### 3.4 Reglas de lenguaje (extraídas de DESIGN_V2.md, críticas para el copy del sitio)

Estas reglas afectan directamente el copy ya redactado en secciones 6.x del brief. **Si hay conflicto, prevalecen estas reglas.**

- **Sentence case o lowercase** en headings visibles. Sin Title Case salvo nombres de producto formales o etiquetas de fuente.
- **Español LATAM con `tú/te`**, no `usted` (salvo que el contexto exija distancia).
- **Voz prohibida** (banned patterns): "innovador", "disruptivo", "en un mundo cada vez más", "elevamos", "potenciamos", "soluciones integrales", afirmaciones vagas sin evidencia.
- **CTAs concretos:** "agendar 20 minutos" gana a "conversemos"; "iniciar diagnóstico" gana a "contáctanos"; "crear reporte" gana a "empezar".
- **Tono general:** "como un analista experto hablándole a una persona específica". Sin voz de agencia, sin marketing speak, sin promesas placeholder.

### 3.5 Imaginería y motion (notas que complementan DESIGN_V2.md)

`DESIGN_V2.md` cubre fondo fluido, glass surfaces, scroll reveal y motion atmosférico. Sumando solo lo que el brief necesita y el design system no detalla:

- **Imaginería editorial permitida:** visualizaciones de datos custom (no decorativas), diagramas conceptuales propios, fotografía documental sobria (B/N o desaturada).
- **Imaginería prohibida:** stock corporativo (gente sonriendo en oficinas), 3D genéricos (esferas, gradientes morados), ilustraciones flat isométricas, mockups de dashboards (contradicen el posicionamiento).
- **Iconografía:** una sola librería en todo el producto, un solo stroke weight. **Phosphor** o **Lucide** son aceptables; elegir una y mantenerla.
- **Glifos de las 6 metodologías:** SVG custom inline (ver sección 6.2). No son iconos de librería.

---

## 4. Stack técnico

### 4.1 Stack recomendado

```yaml
framework: Next.js 14+ (App Router)
language: TypeScript (strict mode)
styling: Tailwind CSS + CSS variables para tokens
ui_primitives: Radix UI (para componentes accesibles base)
motion: Framer Motion
content: MDX (para Field Notes y contenido largo)
forms: React Hook Form + Zod (validación)
email: Resend
analytics: Plausible (privacidad-first) o Vercel Analytics
hosting: Vercel
cms_optional: Sanity o Tina (Phase 2)
i18n_ready: next-intl (estructura preparada, ES único en MVP)
```

### 4.2 Estructura de carpetas

```
noisia-site/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx                    # Home
│   │   ├── metodologias/
│   │   │   ├── page.tsx                # Index
│   │   │   └── [slug]/page.tsx         # Detalle por metodología
│   │   ├── arquitectura-de-datos/
│   │   │   └── page.tsx
│   │   ├── casos-de-uso/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/page.tsx
│   │   ├── servicios/
│   │   │   └── page.tsx
│   │   ├── manifiesto/
│   │   │   └── page.tsx
│   │   ├── field-notes/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/page.tsx
│   │   ├── nosotros/
│   │   │   └── page.tsx
│   │   ├── diagnostico/
│   │   │   └── page.tsx                # Cuestionario discovery
│   │   └── contacto/
│   │       └── page.tsx
│   ├── api/
│   │   ├── contact/route.ts
│   │   └── diagnostic/route.ts
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                             # Primitivas (button, input, etc.)
│   ├── marketing/                      # Componentes de marketing site
│   ├── methodology/                    # Componentes específicos metodologías
│   └── layout/                         # Header, footer, nav
├── content/
│   ├── methodologies/                  # MDX por metodología
│   ├── use-cases/                      # MDX por caso de uso
│   └── field-notes/                    # MDX para blog
├── lib/
│   ├── tokens.ts                       # Design tokens
│   ├── seo.ts                          # Helpers SEO
│   └── utils.ts
├── public/
│   ├── fonts/
│   ├── images/
│   └── og/                             # Open graph imgs por página
├── styles/
│   └── tokens.css
├── tailwind.config.ts
├── next.config.mjs
└── package.json
```

### 4.3 Decisiones técnicas no negociables

- **Server Components por defecto.** Client components solo donde haya interactividad.
- **Imágenes:** `next/image` siempre. Formato `avif` con fallback `webp`.
- **Fuentes:** Google Sans / Product Sans (única familia del sistema, ver `DESIGN_V2.md`). Cargar vía `next/font/google` o self-hosted según licencia disponible. Cero CLS.
- **Tokens de diseño:** parsear el frontmatter YAML de `DESIGN_V2.md` y exponer como CSS variables (en `styles/tokens.css`) y tokens de Tailwind (en `tailwind.config.ts`). No hardcodear hex, sizes, ni radii en componentes.
- **CLS objetivo:** < 0.05.
- **LCP objetivo:** < 1.8s en 4G simulado.
- **Bundle JS inicial objetivo:** < 120kb gzip.
- **Accesibilidad:** WCAG 2.1 AA mínimo. Test con axe-core en CI.
- **No third-party scripts** salvo analytics aprobado y Resend (server-side).

---

## 5. Arquitectura de información (sitemap)

```
/                                       Home
├── /metodologias                       Index — las 6 metodologías
│   ├── /metodologias/triggers-y-barriers
│   ├── /metodologias/value-perception-matrix
│   ├── /metodologias/cultural-codes-decoding
│   ├── /metodologias/decision-velocity
│   ├── /metodologias/journey-friction-mapping
│   └── /metodologias/influence-architecture
├── /arquitectura-de-datos              El moat: 150+ fuentes, orquestación
├── /casos-de-uso                       Index — 10 preguntas de negocio
│   └── /casos-de-uso/[slug]            Detalle por caso
├── /servicios                          Foundation / Intelligence / Strategy
├── /manifiesto                         Filosofía Noisia (carta abierta)
├── /field-notes                        Blog/ensayos
│   └── /field-notes/[slug]
├── /nosotros                           Equipo, principios, historia
├── /diagnostico                        Cuestionario de discovery
└── /contacto                           Formulario de contacto directo
```

**Navegación principal (header):**
`Metodologías · Arquitectura de Datos · Casos de Uso · Servicios · Field Notes · [CTA: Iniciar Diagnóstico]`

**Footer:**
- Col 1: Manifiesto, Nosotros, Field Notes, Contacto
- Col 2: Las 6 metodologías
- Col 3: Casos de uso destacados
- Col 4: Brevísimo statement + datos legales

---

## 6. Especificación por página

### 6.1 Home (`/`)

**Objetivo de la página:** que un visitante en menos de 60 segundos entienda (a) qué es Noisia, (b) qué problema resuelve, (c) si su pregunta de negocio cabe aquí, (d) cómo iniciar.

#### 6.1.1 Sección — Hero

**Layout:** full-bleed, fondo `--color-ink`, altura `min-h-[85vh]`. Eyebrow + título display-xl + lead + dos CTAs.

**Copy final:**

```
[eyebrow:] SOCIAL INTELLIGENCE ARCHITECTS

[título:]
Convertimos conversaciones
en decisiones.

[lead:]
Noisia es una agencia de inteligencia social. Orquestamos datos
conversacionales de más de 150 fuentes para responder las preguntas
estratégicas que tu marca aún no sabe formular.

[CTA primario:] Iniciar un diagnóstico
[CTA secundario:] Ver metodologías
```

**Comportamiento visual:** detrás del hero, una visualización ambiente sutil — partículas o una gráfica de líneas tipo "respiración" que sugiera flujo conversacional. Render canvas o SVG animado, **muy** sutil, no debe competir con la tipografía. Frame rate bajo (10-15fps) para eficiencia. Respeta `prefers-reduced-motion` (en ese caso se vuelve estática).

#### 6.1.2 Sección — La pregunta fundamental

**Layout:** modo claro (`--color-bone`), centrado, una sola columna, max-width `820px`, padding generoso.

**Copy final:**

```
[eyebrow:] LO QUE NOS DIFERENCIA

[título display-lg:]
La mayoría de las marcas tiene acceso a datos sociales.
Muy pocas tienen inteligencia social.

[párrafo body-lg:]
Acceso es una herramienta que cuenta menciones, mide sentiment y dibuja
gráficas. Inteligencia es un sistema analítico que decodifica
motivaciones, identifica fricciones, mapea códigos culturales y
traduce todo eso en decisiones de negocio.

Noisia no vende acceso. Noisia construye inteligencia.
```

#### 6.1.3 Sección — ¿Qué puedes hacer con Noisia?

**Layout:** sección modo oscuro o `--color-graphite`. Componente `<UseCaseSelector />`. Tabs verticales a la izquierda con las 10 preguntas, panel derecho con detalle dinámico. En mobile: acordeón apilado.

**Estructura del componente:**

Cada uso de caso tiene:
- Pregunta de negocio (el "trigger" del visitante).
- Una frase de cómo Noisia lo aborda.
- 1-2 metodologías aplicables (chips clickeables hacia `/metodologias/[slug]`).
- Un mini-output (qué entrega Noisia para ese caso).
- Link a `/casos-de-uso/[slug]` para detalle completo.

**Las 10 entradas (copy final corto, expandido en sección 6.4):**

| # | Pregunta de negocio | Cómo lo aborda Noisia | Metodologías |
|---|---|---|---|
| 1 | Voy a lanzar una campaña. ¿Sobre qué tensión cultural debería construirse? | Decodificamos las tensiones simbólicas activas en tu categoría y mapeamos sobre cuáles tu marca tiene permiso para hablar. | Cultural Codes, Triggers & Barriers |
| 2 | Mi plan de medios no está rindiendo. ¿Dónde está la fricción? | Mapeamos el journey conversacional real (no el modelado en workshop) e identificamos los puntos donde el mensaje pierde tracción. | Journey Friction Mapping, Decision Velocity |
| 3 | Necesito desarrollar productos nuevos. ¿Qué jobs-to-be-done no están resueltos? | Extraemos los *unmet jobs* directamente de la conversación de consumidores reales en reviews, foros y redes. | Triggers & Barriers, Value Perception Matrix |
| 4 | Vamos a entrar a un nuevo mercado. ¿Cómo se decodifica nuestra categoría aquí? | Reconstruimos el sistema simbólico local de la categoría: qué significa, quién la consume, qué la legitima, qué la rechaza. | Cultural Codes, Influence Architecture |
| 5 | Necesito reposicionar la marca. ¿Qué código ocupamos hoy? ¿Cuál podríamos ocupar? | Mapeamos la posición simbólica actual de tu marca y de tus competidores en el sistema cultural de la categoría. | Cultural Codes, Value Perception Matrix |
| 6 | Estamos perdiendo share. ¿Por qué los consumidores migran al competidor? | Analizamos las narrativas de migración: cuándo se quiebra la lealtad, qué la dispara, qué del competidor capitaliza. | Triggers & Barriers, Journey Friction |
| 7 | Tenemos una hipótesis estratégica. ¿Existe evidencia conversacional que la sostenga? | Diseñamos un protocolo de validación que busca señales confirmatorias y disconfirmatorias en data conversacional real. | Cualquiera de las 6, según hipótesis |
| 8 | ¿Qué tendencias están emergiendo en mi categoría que aún no son visibles? | Detectamos señales débiles: vocabularios, prácticas y actores nuevos que predicen movimientos de categoría. | Cultural Codes, Influence Architecture |
| 9 | Estamos en una crisis de marca. ¿Qué está realmente pasando? | Decodificamos la estructura narrativa de la crisis: quién la sostiene, qué la alimenta, qué necesita para desactivarse. | Influence Architecture, Cultural Codes |
| 10 | ¿Quiénes son las personas que mueven la conversación de mi categoría? | Mapeamos la arquitectura de influencia: nodos centrales, conectores entre comunidades, voces emergentes. | Influence Architecture |

#### 6.1.4 Sección — Las 6 metodologías (preview)

**Layout:** grid 3×2 desktop, stack mobile. Cada celda es una `<MethodologyCard />` con: glifo, nombre, pregunta estratégica que responde, link a detalle.

**Copy final por card** (formato compacto):

```
[glifo]
TRIGGERS & BARRIERS
"¿Qué motiva y qué frena la decisión de tu consumidor?"
Ver metodología →

[glifo]
VALUE PERCEPTION MATRIX
"¿Qué dimensión de valor capitaliza tu marca y cuál abandona?"
Ver metodología →

[glifo]
CULTURAL CODES DECODING
"¿Qué significa tu categoría en el sistema simbólico de tu consumidor?"
Ver metodología →

[glifo]
DECISION VELOCITY
"¿Por qué tu consumidor decide rápido en una categoría y lento en la tuya?"
Ver metodología →

[glifo]
JOURNEY FRICTION MAPPING
"¿Dónde se rompe el camino entre intención y acción?"
Ver metodología →

[glifo]
INFLUENCE ARCHITECTURE
"¿Quiénes diseñan, sin saberlo, el imaginario de tu categoría?"
Ver metodología →
```

#### 6.1.5 Sección — Arquitectura de datos (preview)

**Layout:** modo oscuro, contenido a izquierda, visualización a derecha (en mobile: viz arriba, texto abajo).

**Copy final:**

```
[eyebrow:] EL MOAT TÉCNICO

[título:]
Mientras otros consultan una herramienta,
nosotros orquestamos un sistema.

[párrafo:]
La inteligencia social que entregamos depende del rango y calidad de
datos a los que accedemos. Por eso construimos una arquitectura propia
de orquestación: 150+ fuentes normalizadas, 10,000+ scrapers
especializados, capacidad de ingesta multi-formato (texto, audio,
video, foros cerrados, reviews, news).

No competimos con plataformas. Las orquestamos.

[CTA:] Conocer la arquitectura →
```

**Visualización lateral:** diagrama animado tipo "constellation" con nodos representando categorías de fuente (redes, reviews, foros, news, podcasts, video, e-commerce, etc.) convergiendo hacia un núcleo "Noisia". Líneas con flujo lento. Etiquetas legibles.

#### 6.1.6 Sección — Anti-positioning ("Lo que no hacemos")

**Layout:** modo claro, una sola columna, max-width contenido, ritmo de declaraciones.

**Copy final:**

```
[eyebrow:] HONESTIDAD METODOLÓGICA

[título display-md:]
Lo que no hacemos.

No vendemos licencias de software.
No entregamos dashboards genéricos.
No reportamos volumen y sentiment como si fueran insights.
No prometemos "tiempo real" cuando lo que necesitas es profundidad.
No reemplazamos a tu agencia de research, la complementamos.
No confundimos cantidad de datos con calidad de inteligencia.

Hacemos una sola cosa: traducir conversaciones en decisiones.
Y eso requiere método, no plataforma.
```

#### 6.1.7 Sección — Cómo trabajamos

**Layout:** 3 columnas (desktop) o stack (mobile). Cada paso numerado con un párrafo breve.

**Copy final:**

```
[eyebrow:] PROCESO

[título display-md:]
Tres movimientos.
Una sola lógica: la pregunta manda.

[01]
Diagnóstico
Definimos juntos la pregunta estratégica real. No hay metodología
correcta sin pregunta correcta. Esta fase no se factura: es donde
decidimos si tiene sentido trabajar.

[02]
Arquitectura analítica
Diseñamos el protocolo: qué metodologías aplican, qué fuentes se
orquestan, qué outputs producirán decisión. Aquí se define alcance,
tiempo y precio.

[03]
Inteligencia entregable
Ejecutamos. Lo que recibes no es un reporte: es un *playbook*
estratégico con la decisión recomendada, su sustento conversacional
y los siguientes pasos operativos.
```

#### 6.1.8 Sección — Niveles de servicio (preview)

**Layout:** 3 columnas con tarjetas tier. Sin precios visibles (los precios se manejan en propuesta personalizada). Solo el alcance y "ideal para".

**Copy final por tier:**

```
FOUNDATION
Para marcas que necesitan piso analítico antes de decidir.
Diagnóstico inicial · 1-2 metodologías · 4-6 semanas
Ideal para: validar una hipótesis, entender una categoría nueva,
preparar un brief estratégico.
[Iniciar diagnóstico →]

INTELLIGENCE
Para marcas con preguntas de negocio activas y decisión próxima.
Protocolo a la medida · 3-4 metodologías · 6-10 semanas
Ideal para: lanzamientos, reposicionamiento, defensa competitiva,
entrada a mercado.
[Iniciar diagnóstico →]

STRATEGY
Para marcas que necesitan inteligencia social como capacidad continua.
Protocolo evolutivo · 6 metodologías + retainer · trimestral o anual
Ideal para: marcas líderes en categorías de alta velocidad o alta
fragmentación cultural.
[Iniciar diagnóstico →]
```

#### 6.1.9 Sección — Cierre / CTA final

**Layout:** modo oscuro, full-bleed, centrado.

**Copy final:**

```
[título display-lg:]
Tu pregunta no es "¿qué dicen sobre mi marca?"
Es "¿qué hago con lo que dicen?"

Nosotros construimos el puente.

[CTA grande:] Iniciar un diagnóstico
[Link secundario:] Conversar con un arquitecto →
```

#### 6.1.10 Criterios de aceptación — Home

- [ ] LCP < 1.8s en simulación 4G.
- [ ] Hero renderiza sin layout shift.
- [ ] `<UseCaseSelector />` cambia de pregunta sin recargar página y mantiene URL state (query param `?caso=N`).
- [ ] Visualización ambiente del hero respeta `prefers-reduced-motion`.
- [ ] Todos los CTAs llevan a destinos válidos.
- [ ] Mobile: scroll fluido, sin overflow horizontal.
- [ ] Accesibilidad: nav por teclado completa, focus rings visibles, aria-labels en componentes interactivos.

---

### 6.2 Metodologías (`/metodologias`)

#### 6.2.1 Página índice

**Layout:** hero corto + grid de 6 metodologías. Cada tarjeta muestra glifo, nombre, pregunta estratégica, fundamentos académicos breves (3-4 disciplinas), y CTA "Estudiar metodología →".

**Copy hero:**

```
[eyebrow:] METODOLOGÍAS PROPIETARIAS

[título display-lg:]
Seis lentes.
Cada una construida para una pregunta distinta.

[lead:]
Las metodologías de Noisia no son frameworks de marketing reciclados.
Cada una se construye sobre fundamentos de psicología cognitiva,
antropología, semiótica, economía conductual y teoría de redes —
adaptados para operar sobre datos conversacionales reales.

A continuación, las seis. Cada una se documenta a profundidad.
```

#### 6.2.2 Plantilla de detalle por metodología (`/metodologias/[slug]`)

Cada página de metodología sigue la **misma estructura editorial**, garantizando rigor y comparabilidad.

**Estructura fija:**

1. **Hero** — eyebrow ("METODOLOGÍA 0X"), nombre, pregunta estratégica que responde, lead descriptivo.
2. **Fundamentos científicos** — secciones académicas (psicología, antropología, etc.) con autores y obras de referencia.
3. **El problema que resuelve** — descripción del problema de negocio en términos concretos.
4. **Cómo opera Noisia esta metodología** — protocolo paso a paso (sin revelar IP sensible, pero suficientemente concreto para generar confianza).
5. **Outputs** — qué entrega exactamente Noisia (formato, deliverable).
6. **Cuándo usarla** — triggers de uso, casos típicos.
7. **Limitaciones honestas** — qué no resuelve esta metodología (sección clave para diferenciación: marcas inteligentes valoran esta honestidad).
8. **Lectura recomendada** — bibliografía real para quien quiera profundizar.
9. **Conectar con un arquitecto** — CTA final.

A continuación, **el contenido completo** de las 6 metodologías.

---

#### 6.2.3 Metodología 01 — Triggers & Barriers

**Pregunta estratégica:**
> ¿Qué motiva y qué frena la decisión de tu consumidor?

**Lead:**
La decisión de compra (o de adopción, o de migración) no es un acto racional puro. Es una negociación entre fuerzas motivacionales (*triggers*) y fuerzas de fricción (*barriers*) que operan en niveles conscientes e inconscientes. Triggers & Barriers identifica, jerarquiza y tipifica esas fuerzas a partir de la conversación real de tu consumidor.

**Fundamentos científicos:**

- **Economía conductual.** Daniel Kahneman, *Thinking, Fast and Slow* (2011): la decisión opera en dos sistemas (rápido/intuitivo y lento/deliberativo). Triggers & Barriers diagnostica en cuál sistema opera cada palanca.
- **Jobs-to-be-Done.** Clayton Christensen, *Competing Against Luck* (2016): los consumidores "contratan" productos para hacer un trabajo. Identificamos los *jobs* funcionales, emocionales y sociales activos.
- **Teoría de la motivación.** Edward Deci & Richard Ryan, *Self-Determination Theory*: motivaciones intrínsecas vs extrínsecas. Diferenciamos triggers de raíz interna (autoexpresión, dominio) vs externa (presión social, estatus).
- **Psicología de la fricción.** Loran Nordgren & David Schonthal, *The Human Element* (2021): cuatro fricciones — inercia, esfuerzo, emoción, reactancia. Cada barrier se tipifica según esta taxonomía.

**El problema que resuelve:**
Las marcas suelen creer que conocen los motivos de compra de su consumidor — los conocen *como ellos los formulan en focus groups*. Triggers & Barriers desmonta esa formulación reportada para revelar las motivaciones y fricciones que el consumidor expresa cuando no está siendo entrevistado: en sus reviews, sus comentarios espontáneos, sus discusiones en foros, sus quejas en redes.

**Cómo opera Noisia esta metodología:**

1. **Definición del *jobs landscape*.** Identificamos los trabajos que el consumidor está intentando resolver al considerar la categoría — no solo el funcional, también el emocional y el social.
2. **Extracción conversacional.** Orquestamos fuentes donde el consumidor habla sin filtro: reviews extensos, foros de nicho, hilos de Reddit, comentarios en YouTube, discusiones en X.
3. **Codificación dual.** Cada expresión se codifica como *trigger* (impulso hacia la decisión) o *barrier* (freno), y se subclasifica por tipo (funcional, emocional, social, simbólico).
4. **Jerarquización por fuerza.** No todo trigger pesa igual. Calibramos el peso de cada uno por (a) frecuencia, (b) intensidad lingüística, (c) capacidad predictiva sobre la decisión final reportada en la misma conversación.
5. **Mapeo de tipología.** Aplicamos la taxonomía de Nordgren-Schonthal a los barriers y la teoría de motivación a los triggers para entregar no solo *qué* sino *cómo* operar sobre cada uno.

**Outputs:**

- *Triggers & Barriers Map*: visualización jerarquizada de las palancas y fricciones activas en la categoría/marca.
- *Activation Playbook*: por cada trigger principal, recomendaciones concretas de cómo activarlo en comunicación.
- *Friction Removal Plan*: por cada barrier principal, recomendaciones de cómo neutralizarlo en producto, comunicación o experiencia.
- *Comparative Brief* (opcional): contraste entre tu marca y hasta 3 competidores en la jerarquía de triggers/barriers.

**Cuándo usarla:**
Lanzamiento de producto, optimización de funnel, comunicación que busca activar un comportamiento específico, defensa competitiva, repositioning con base motivacional.

**Limitaciones honestas:**
Triggers & Barriers no predice tamaños de mercado ni cuotas. Tampoco sustituye un test cuantitativo de concepto. Su valor es direccional y motivacional, no transaccional.

**Lectura recomendada:**
- Kahneman, D. (2011). *Thinking, Fast and Slow*. Farrar, Straus and Giroux.
- Christensen, C., et al. (2016). *Competing Against Luck*. HarperBusiness.
- Nordgren, L. & Schonthal, D. (2021). *The Human Element*. Wiley.
- Deci, E. & Ryan, R. (2000). "The 'What' and 'Why' of Goal Pursuits: Human Needs and the Self-Determination of Behavior". *Psychological Inquiry*.

---

#### 6.2.4 Metodología 02 — Value Perception Matrix

**Pregunta estratégica:**
> ¿Qué dimensión de valor capitaliza tu marca y cuál está abandonando?

**Lead:**
"Valor" no es una variable. Es un sistema multidimensional: lo que el consumidor recibe (utilidad, experiencia, identidad, pertenencia) menos lo que entrega (dinero, tiempo, esfuerzo, riesgo). Value Perception Matrix descompone ese sistema y revela en qué dimensiones tu marca es percibida como excepcional, suficiente o ausente — comparada con las alternativas reales en la mente del consumidor.

**Fundamentos científicos:**

- **Teoría del valor percibido.** Valarie Zeithaml (1988), "Consumer Perceptions of Price, Quality, and Value": el valor es la evaluación subjetiva de la utilidad del producto basada en lo que se recibe vs lo que se da.
- **Prospect Theory.** Kahneman & Tversky (1979): las pérdidas pesan más que las ganancias equivalentes. Las dimensiones de "lo que se da" (riesgo, esfuerzo, dinero) tienen más peso emocional del que las marcas suelen asumir.
- **Teoría de los beneficios funcionales/emocionales/simbólicos.** Park, Jaworski & MacInnis (1986): tres tipos de necesidades de marca; las marcas exitosas se especializan en una pero no abandonan las otras.
- **Customer-Based Brand Equity.** Kevin Lane Keller (1993): la marca como red asociativa en memoria. La matriz mapea esa red.

**El problema que resuelve:**
Las marcas tienden a asumir que su valor está en lo que ellas comunican que ofrecen. Pero el valor es lo que el consumidor *percibe* recibir, no lo que la marca *afirma* dar. Y esa percepción es comparativa: se construye contra las alternativas, no en abstracto. Esta metodología revela el mapa real de valor en la mente del consumidor.

**Cómo opera Noisia esta metodología:**

1. **Definición del *frame competitivo* real.** El primer hallazgo suele ser que las alternativas mentales del consumidor no son las que la marca cree. Reconstruimos el set de comparación real desde la conversación.
2. **Extracción de dimensiones de valor.** Identificamos qué dimensiones está usando el consumidor para evaluar (no las que asumimos). En productos para el hogar, por ejemplo, la dimensión "durabilidad" puede pesar 5x más que "diseño", o lo contrario, dependiendo del segmento.
3. **Codificación de menciones por dimensión.** Cada expresión se asocia a una dimensión y se polariza (positivo/neutro/negativo).
4. **Matriz comparativa.** Construimos una matriz N×M (marcas × dimensiones) con la percepción agregada normalizada.
5. **Identificación de *gaps* y *whitespaces*.** Detectamos: (a) dimensiones donde la marca es percibida como inferior y debería defenderse, (b) dimensiones donde la marca tiene permiso pero no ocupa, (c) dimensiones que ningún competidor capitaliza.

**Outputs:**

- *Value Perception Matrix*: visualización N×M con polarización por dimensión.
- *Whitespace Report*: dimensiones de valor desatendidas en la categoría.
- *Defense Brief*: dimensiones donde la marca está perdiendo terreno.
- *Recategorization Hypothesis* (opcional): cuando la marca podría redefinir el set comparativo.

**Cuándo usarla:**
Reposicionamiento, definición de propuesta de valor, pricing strategy, defensa de margen, evaluación post-lanzamiento.

**Limitaciones honestas:**
La matriz es comparativa, no absoluta. No mide elasticidad de precio ni intención de compra cuantitativa. Si necesitas validar willingness-to-pay, la matriz informa pero no sustituye un test conjoint.

**Lectura recomendada:**
- Zeithaml, V. (1988). "Consumer Perceptions of Price, Quality, and Value". *Journal of Marketing*.
- Kahneman, D. & Tversky, A. (1979). "Prospect Theory". *Econometrica*.
- Keller, K. L. (1993). "Conceptualizing, Measuring, and Managing Customer-Based Brand Equity". *Journal of Marketing*.
- Park, C. W., Jaworski, B. & MacInnis, D. (1986). "Strategic Brand Concept-Image Management". *Journal of Marketing*.

---

#### 6.2.5 Metodología 03 — Cultural Codes Decoding

**Pregunta estratégica:**
> ¿Qué significa tu categoría en el sistema simbólico de tu consumidor?

**Lead:**
Toda categoría de consumo está envuelta en un sistema de significados que el consumidor da por sentado. "Café" no significa lo mismo en Bogotá que en Milán. "Auto" no significa lo mismo para un comprador de SUV familiar que para un comprador de hatchback urbano. Cultural Codes Decoding reconstruye ese sistema simbólico — sus reglas, sus tabúes, sus códigos visuales y verbales — para que la estrategia de marca opere *con* el código, *contra* el código o *reescribiendo* el código, pero nunca ignorándolo.

**Fundamentos científicos:**

- **Semiótica estructural.** Ferdinand de Saussure (1916), *Cours de linguistique générale*: los signos se definen por oposición y diferencia, no en aislamiento. Cada código se decodifica en relación a sus opuestos en el sistema.
- **Mitologías.** Roland Barthes (1957), *Mythologies*: los objetos de consumo cargan significados de "segundo orden" (mitos) que naturalizan ideología. Cada categoría tiene su mitología.
- **Antropología interpretativa.** Clifford Geertz (1973), *The Interpretation of Cultures*: la "thick description" — el método etnográfico de capturar no solo el acto sino su densidad simbólica.
- **Cultural Codes.** Clotaire Rapaille, *The Culture Code* (2006): cada cultura tiene un código inconsciente para cada objeto/categoría; ese código es el "elevator" más rápido al inconsciente colectivo del consumidor.
- **Antropología del consumo.** Mary Douglas & Baron Isherwood, *The World of Goods* (1979): los bienes son sistemas de comunicación; el consumo es un acto cultural antes que económico.

**El problema que resuelve:**
Las marcas globales aplican fórmulas globales en mercados locales y se preguntan por qué no funcionan. Las marcas locales asumen que conocen su mercado por proximidad, pero rara vez lo decodifican estructuralmente. Ambas pierden por la misma razón: no traducen el sistema simbólico de la categoría en su contexto. Esta metodología reconstruye ese sistema.

**Cómo opera Noisia esta metodología:**

1. **Etnografía digital extendida.** Orquestamos fuentes culturalmente densas — foros nicho, comentarios largos, comunidades de práctica, contenido vernáculo — donde el consumidor habla en su propio código.
2. **Análisis lexical y metafórico.** Identificamos las palabras, metáforas y comparaciones recurrentes que estructuran la categoría. La metáfora es el atajo cognitivo del código.
3. **Mapeo de oposiciones.** Toda categoría se organiza por oposiciones binarias (caro/barato, auténtico/imitación, sano/indulgente, masculino/femenino, tradicional/moderno). Identificamos las que están operativas.
4. **Reconstrucción del *code system***. Producimos un mapa estructural: qué significa pertenecer a la categoría, qué la legitima, qué la rechaza, qué la transgrede.
5. **Posicionamiento de marca dentro del código.** Mapeamos dónde está cada marca competidora en este sistema, y qué posiciones están vacantes.

**Outputs:**

- *Cultural Code Dossier*: documento etnográfico denso (Geertzian) sobre la categoría en el contexto cultural específico.
- *Symbolic Map*: visualización estructural de oposiciones y posiciones de marca.
- *Code Strategy Brief*: tres opciones estratégicas — operar con el código, contra el código, o reescribir el código — con sus implicaciones.

**Cuándo usarla:**
Entrada a nuevo mercado, repositioning profundo, lanzamiento de marca, evaluación de transferibilidad de campañas globales, identificación de oportunidades de disruption cultural.

**Limitaciones honestas:**
Cultural Codes Decoding es interpretativo por naturaleza. No produce certezas estadísticas, produce comprensiones estructurales. Su valor se realiza cuando la marca está dispuesta a tomar decisiones basadas en interpretación rigurosa, no solo en correlaciones cuantitativas.

**Lectura recomendada:**
- Barthes, R. (1957). *Mythologies*. Seuil.
- Geertz, C. (1973). *The Interpretation of Cultures*. Basic Books.
- Douglas, M. & Isherwood, B. (1979). *The World of Goods*. Basic Books.
- Rapaille, C. (2006). *The Culture Code*. Broadway Books.
- Mick, D. G. (1986). "Consumer Research and Semiotics". *Journal of Consumer Research*.

---

#### 6.2.6 Metodología 04 — Decision Velocity Framework

**Pregunta estratégica:**
> ¿Por qué tu consumidor decide rápido en una categoría y lento en la tuya?

**Lead:**
La velocidad con la que un consumidor decide no es una constante personal — es una propiedad de la categoría, del momento y del contexto. Decision Velocity diagnostica los factores que aceleran o ralentizan la decisión en tu categoría, permitiendo intervenir donde la fricción cognitiva está costándote conversión, o donde la velocidad excesiva está costándote consideración.

**Fundamentos científicos:**

- **Dual-Process Theory.** Daniel Kahneman, basándose en Stanovich & West: Sistema 1 (rápido, automático, heurístico) vs Sistema 2 (lento, deliberativo, esforzado). Cada categoría activa predominantemente uno; intervenir requiere saber cuál.
- **Choice Architecture.** Richard Thaler & Cass Sunstein, *Nudge* (2008): cómo se presentan las opciones determina cómo se decide entre ellas, independientemente de la calidad de las opciones.
- **Decision Fatigue.** Roy Baumeister: la capacidad de decidir es un recurso que se agota. Las categorías que entran tarde en el journey enfrentan consumidores cognitivamente exhaustos.
- **Information Foraging Theory.** Pirolli & Card (1999): los humanos buscan información con la lógica de un depredador — maximizar valor / costo de búsqueda. La velocidad de decisión refleja la eficiencia percibida del foraging.

**El problema que resuelve:**
Las marcas optimizan mensaje, formato y canal — pero rara vez diagnostican la **velocidad cognitiva** que su categoría exige al consumidor. Una categoría de bajo involucramiento que se está intentando vender con mensajes de alto involucramiento fracasará. Una categoría de alto involucramiento que se está banalizando con CTAs rápidos fracasará igual. Decision Velocity diagnostica el desajuste.

**Cómo opera Noisia esta metodología:**

1. **Reconstrucción de la decisión real.** Identificamos en la conversación las narrativas de decisión: "estuve viendo X durante un mes", "lo compré ese mismo día", "lo dudé mucho porque...".
2. **Codificación de tiempos y disparadores.** Cada narrativa se codifica por (a) duración percibida del proceso, (b) número de actores consultados, (c) cantidad de información buscada, (d) momento de "click" final.
3. **Diagnóstico de sistema dominante.** Determinamos si la categoría opera en Sistema 1 (heurístico) o Sistema 2 (deliberativo) para tu segmento.
4. **Identificación de *velocity blockers* y *velocity accelerators*.** Qué factores aceleran genuinamente la decisión sin manipulación, y qué factores la ralentizan innecesariamente.
5. **Recomendación de arquitectura de elección.** Cómo debe estructurarse la presentación de opciones, mensajes y CTAs según la velocidad endémica de tu categoría.

**Outputs:**

- *Decision Velocity Diagnostic*: clasificación de tu categoría/segmento en el espectro Sistema 1 ↔ Sistema 2.
- *Velocity Blockers Map*: factores que están ralentizando la decisión.
- *Velocity Accelerators Map*: factores que la aceleran genuinamente.
- *Choice Architecture Brief*: recomendaciones específicas para el diseño de la presentación de opciones (UI, copy, secuencia, CTAs).

**Cuándo usarla:**
Optimización de funnel, diseño de UX de decisión (e-commerce, configuradores, pricing pages), comunicación de productos high-consideration vs low-consideration, lanzamientos en categorías con dinámicas de velocidad inusuales.

**Limitaciones honestas:**
Decision Velocity no sustituye un A/B test. Identifica hipótesis fuertes sobre por qué algo está rindiendo o no, pero la validación cuantitativa de cada intervención requiere experimentación.

**Lectura recomendada:**
- Kahneman, D. (2011). *Thinking, Fast and Slow*.
- Thaler, R. & Sunstein, C. (2008). *Nudge*. Yale University Press.
- Iyengar, S. (2010). *The Art of Choosing*. Twelve.
- Pirolli, P. & Card, S. (1999). "Information Foraging". *Psychological Review*.

---

#### 6.2.7 Metodología 05 — Journey Friction Mapping

**Pregunta estratégica:**
> ¿Dónde se rompe el camino entre la intención y la acción?

**Lead:**
Los customer journeys que las marcas modelan en workshops son hipótesis. El journey real es un campo de batalla con pérdidas en cada paso — pérdidas que rara vez son visibles en los embudos analíticos porque no son clicks perdidos, son intenciones abandonadas. Journey Friction Mapping reconstruye el journey **desde la conversación real** del consumidor y localiza, con precisión, los puntos donde la fricción está costando conversión.

**Fundamentos científicos:**

- **Customer Journey Theory.** Lemon & Verhoef (2016), "Understanding Customer Experience Throughout the Customer Journey", *Journal of Marketing*: el journey como sistema dinámico de touchpoints, no lineal.
- **Friction Theory.** Loran Nordgren (Kellogg), *The Human Element* (2021): la inacción rara vez se debe a falta de motivación; se debe a fricciones. Tipología: inercia, esfuerzo, emoción, reactancia.
- **Cognitive Load Theory.** John Sweller (1988): cada paso adicional consume capacidad cognitiva limitada. Los journeys con alta carga generan abandono incluso con alta intención.
- **Peak-End Rule.** Daniel Kahneman: la memoria de una experiencia se ancla en su pico emocional y su final. Las fricciones en esos momentos pesan desproporcionadamente.

**El problema que resuelve:**
Las herramientas de analítica web muestran *dónde* la gente abandona, no *por qué*. El qualitative research muestra el *por qué* en muestras pequeñas y declarativas. Journey Friction Mapping cruza ambos: usa la conversación real, espontánea y masiva de consumidores para mapear las fricciones específicas que generan abandono — antes y después del touchpoint digital.

**Cómo opera Noisia esta metodología:**

1. **Reconstrucción del journey real.** A partir de narrativas conversacionales (reviews, hilos, threads largos), reconstruimos las etapas del journey tal como el consumidor las vive — no como la marca las modela.
2. **Codificación de fricciones por etapa.** Cada mención de fricción se asocia a una etapa y se tipifica (inercia, esfuerzo, emoción, reactancia, información, confianza).
3. **Detección de *break points*.** Identificamos las etapas donde la fricción es más densa o más decisiva.
4. **Cruce con touchpoints de marca.** Mapeamos qué fricciones están bajo control de la marca (eliminables o reducibles) vs cuáles son estructurales de la categoría.
5. **Priorización por impacto.** No toda fricción merece intervención. Priorizamos por (a) frecuencia, (b) capacidad de la fricción para abortar la decisión, (c) costo relativo de eliminación.

**Outputs:**

- *Friction Map*: visualización del journey con densidad y tipo de fricción por etapa.
- *Break Points Brief*: las 3-5 fricciones de mayor impacto, con análisis cualitativo de cada una.
- *Friction Removal Roadmap*: recomendaciones priorizadas, distinguiendo intervenciones de comunicación, producto, experiencia y servicio.

**Cuándo usarla:**
Optimización de conversión, rediseño de experiencias, evaluación post-lanzamiento, defensa de share frente a competidores con UX superior, expansión a nuevos canales.

**Limitaciones honestas:**
Journey Friction Mapping captura las fricciones que el consumidor articula. Existen fricciones invisibles — las que el consumidor no menciona porque ni siquiera las nota — que requieren métodos complementarios (ej: usability testing observacional).

**Lectura recomendada:**
- Lemon, K. & Verhoef, P. (2016). "Understanding Customer Experience Throughout the Customer Journey". *Journal of Marketing*.
- Nordgren, L. & Schonthal, D. (2021). *The Human Element*.
- Sweller, J. (1988). "Cognitive Load During Problem Solving". *Cognitive Science*.
- Kahneman, D., Fredrickson, B., et al. (1993). "When More Pain is Preferred to Less". *Psychological Science*.

---

#### 6.2.8 Metodología 06 — Influence Architecture

**Pregunta estratégica:**
> ¿Quiénes diseñan, sin saberlo, el imaginario de tu categoría?

**Lead:**
La influencia no es una métrica de seguidores. Es una propiedad estructural de redes: ciertos nodos, por su posición topológica, mueven significado a través de comunidades de manera desproporcionada. Influence Architecture mapea la red real de influencia en tu categoría — no los influencers obvios, sino los nodos de conexión, los traductores entre comunidades, los emisores tempranos, los validadores y los detractores estructurales.

**Fundamentos científicos:**

- **The Strength of Weak Ties.** Mark Granovetter (1973), *American Journal of Sociology*: los lazos débiles transmiten información nueva entre comunidades; los lazos fuertes la refuerzan dentro. Los nodos con muchos lazos débiles son los que mueven categorías.
- **Diffusion of Innovations.** Everett Rogers (1962): la adopción se propaga a través de roles diferenciados — innovadores, adoptantes tempranos, mayoría temprana, mayoría tardía, rezagados. Cada categoría tiene su distribución específica.
- **Two-Step Flow of Communication.** Elihu Katz & Paul Lazarsfeld (1955), *Personal Influence*: la información raramente fluye de medios a audiencia directamente; pasa por *opinion leaders* que la median.
- **Parasocial Relationships.** Horton & Wohl (1956): el vínculo unidireccional con figuras públicas opera con la fuerza de relaciones reales para fines de decisión.
- **Network Topology.** Albert-László Barabási, *Linked* (2002): las redes reales son scale-free; pocos nodos concentran muchas conexiones (hubs). Identificarlos es identificar dónde intervenir.

**El problema que resuelve:**
Las marcas hacen *influencer marketing* basado en métricas de superficie (followers, engagement rate). Pero la influencia que mueve categorías rara vez vive en cuentas de millones de seguidores — vive en nodos especializados con autoridad temática, en conectores entre comunidades, en validadores invisibles. Influence Architecture identifica esa estructura real.

**Cómo opera Noisia esta metodología:**

1. **Mapeo de comunidades temáticas.** Identificamos las comunidades de conversación activas alrededor de la categoría (no solo en una plataforma — en el ecosistema completo: foros, Reddit, YouTube, Discord, X, blogs, podcasts).
2. **Análisis de centralidad.** Por comunidad, identificamos los nodos con mayor centralidad — no solo de grado (cuántas conexiones), sino de *betweenness* (cuántas veces son puente entre subcomunidades) y de *eigenvector* (cuán conectados están los que los conectan).
3. **Tipificación de influencia.** Clasificamos cada nodo relevante en una taxonomía: *innovator, early adopter, validator, connector, dissenter, gatekeeper*.
4. **Análisis de propagación.** Reconstruimos cómo se han propagado narrativas reales (un lanzamiento competidor, una controversia, una tendencia) a través de la red, identificando los nodos que aceleraron y los que bloquearon.
5. **Priorización estratégica.** No todos los nodos relevantes son accionables. Distinguimos: (a) nodos a activar (aliados potenciales), (b) nodos a monitorear (amenazas), (c) nodos a investigar (señales emergentes).

**Outputs:**

- *Influence Architecture Map*: visualización de la red completa de la categoría con nodos tipificados.
- *Key Nodes Dossier*: análisis cualitativo profundo de los 10-20 nodos más relevantes.
- *Activation Strategy*: recomendaciones diferenciadas para cada tipo de nodo (un *connector* no se activa como un *validator*).
- *Early Warning System* (opcional, modo recurring): monitoreo de nodos *innovator* para detección temprana de tendencias.

**Cuándo usarla:**
Diseño de estrategias de influencia, lanzamientos en categorías con alta especialización (tech, beauty, gaming, finanzas personales), defensa reputacional en crisis, identificación de tendencias emergentes, planificación de comunidades de marca.

**Limitaciones honestas:**
Influence Architecture identifica la estructura. La activación de cada nodo es un proceso que excede a la metodología — requiere relationship building, contenido relevante y respeto por la dinámica de cada comunidad. No es un directorio de "influencers a contratar".

**Lectura recomendada:**
- Granovetter, M. (1973). "The Strength of Weak Ties". *American Journal of Sociology*.
- Rogers, E. (1962). *Diffusion of Innovations*. Free Press.
- Katz, E. & Lazarsfeld, P. (1955). *Personal Influence*. Free Press.
- Barabási, A.-L. (2002). *Linked: The New Science of Networks*. Perseus.
- Watts, D. (2003). *Six Degrees: The Science of a Connected Age*. Norton.

---

### 6.3 Arquitectura de datos (`/arquitectura-de-datos`)

**Objetivo:** demostrar que el moat de Noisia es técnico-operativo, no solo metodológico. Justificar precios premium con evidencia de capacidad.

**Estructura:**

1. **Hero** — la tesis: las metodologías valen lo que vale el dato sobre el que operan.
2. **El problema con las plataformas únicas** — limitaciones intrínsecas (cobertura, formato, profundidad histórica, idiomas, plataformas cerradas).
3. **Nuestra arquitectura de orquestación** — diagrama del sistema con capas.
4. **Capacidades por capa:**
   - *Capa de ingesta:* 150+ fuentes normalizadas (Datashake), 10,000+ scrapers especializados (Apify), APIs nativas, ingesta de podcasts/video transcrito.
   - *Capa de normalización:* esquema único, deduplicación, atribución, traducción cuando aplica.
   - *Capa de enriquecimiento:* clasificación temática, detección de entidades, sentiment multidimensional (no binario), detección de sarcasmo/ironía contextual.
   - *Capa analítica:* operacionalización de las 6 metodologías sobre el corpus normalizado.
5. **Tipos de fuente cubiertas** — listado categorizado: redes sociales abiertas, foros nicho, reviews (Amazon, Mercado Libre, Google, Trustpilot, App Store, etc.), news y editoriales, blogs y newsletters, podcasts (transcritos), video (transcrito), e-commerce (Q&A, reviews), comunidades cerradas accesibles, marketplaces especializados.
6. **Lo que NO hacemos** — no hackeamos plataformas cerradas, no scrapeamos contra términos de servicio, no comprometemos privacidad personal, no operamos sobre datos personales identificables sin justificación legal.
7. **Casos en los que la arquitectura cambió la conclusión** — 2-3 vignettes anonimizadas donde "haber tenido más fuentes cambió el insight estratégico".

**Copy del hero:**

```
[eyebrow:] EL MOAT TÉCNICO

[título display-lg:]
La calidad de la inteligencia
depende de la arquitectura del dato.

[lead:]
Una metodología brillante operando sobre un corpus pobre produce
conclusiones pobres. Por eso construimos lo que la mayoría de
agencias subcontrata: una arquitectura de orquestación de datos
diseñada para que cada metodología opere sobre el corpus correcto,
no sobre el corpus disponible.
```

**Visualización principal:** diagrama interactivo de capas (ingesta → normalización → enriquecimiento → analítica). Cada capa expandible con detalle.

---

### 6.4 Casos de uso (`/casos-de-uso`)

**Estructura del index:**

Hero corto + grid de las 10 preguntas de negocio (sección 2.2). Cada celda es una `<UseCaseCard />` con:
- Pregunta (en formato directo, no abstracto).
- Industria(s) donde aplica más.
- Metodologías típicas.
- "Tiempo aproximado": 4-6 sem / 6-10 sem / 10+ sem.
- Link a detalle.

**Estructura de cada `/casos-de-uso/[slug]`:**

1. La pregunta de negocio.
2. Por qué importa estratégicamente.
3. Cómo Noisia la aborda (qué metodologías, en qué orden, qué fuentes).
4. Qué entrega.
5. Vignette anonimizada (un ejemplo plausible y respetuoso).
6. CTA: iniciar diagnóstico para esta pregunta.

**Las 10 entradas (slugs y títulos):**

```
/casos-de-uso/lanzamiento-de-campana
"Tengo que lanzar una campaña. ¿Sobre qué tensión cultural debe construirse?"

/casos-de-uso/optimizacion-de-medios
"Mi plan de medios no rinde. ¿Dónde está la fricción real?"

/casos-de-uso/desarrollo-de-producto
"Necesito desarrollar productos nuevos. ¿Qué jobs aún no están resueltos?"

/casos-de-uso/entrada-a-nuevo-mercado
"Vamos a entrar a un nuevo mercado. ¿Cómo se decodifica nuestra categoría aquí?"

/casos-de-uso/reposicionamiento
"Necesito reposicionar la marca. ¿Qué código simbólico ocupamos hoy y cuál podríamos ocupar?"

/casos-de-uso/defensa-competitiva
"Estoy perdiendo share. ¿Por qué los consumidores migran al competidor?"

/casos-de-uso/validacion-de-hipotesis
"Tenemos una tesis estratégica. ¿Existe evidencia conversacional que la sostenga?"

/casos-de-uso/anticipacion-de-tendencias
"¿Qué tendencias están emergiendo en mi categoría que aún no son visibles?"

/casos-de-uso/decodificacion-de-crisis
"Estamos en una crisis. ¿Qué está realmente pasando en la conversación?"

/casos-de-uso/influencia-de-categoria
"¿Quiénes son los nodos que mueven la conversación de mi categoría?"
```

---

### 6.5 Servicios (`/servicios`)

**Objetivo:** clarificar las tres formas de contratar a Noisia sin convertir el sitio en un pricing page transaccional.

**Estructura:**

1. **Hero** — "Tres formas de trabajar juntos. Una sola lógica: la pregunta manda."
2. **Tabla comparativa de tiers** (ver sección 6.1.8 para copy base, expandida con más detalle).
3. **Cómo se construye una propuesta** — el proceso de pricing es consultivo, no listado.
4. **Qué incluye una propuesta tipo** — alcance, metodologías, fuentes, timeline, deliverables, equipo asignado.
5. **Lo que NO incluimos** — software licenses, dashboards permanentes, retainers genéricos, "horas de consultoría sueltas".
6. **CTA:** iniciar diagnóstico → cuestionario.

**Tono:** consultivo. Cero "compra ahora", cero pricing visible. La propuesta se construye después del diagnóstico.

---

### 6.6 Manifiesto (`/manifiesto`)

**Objetivo:** página-ensayo que articula la filosofía de Noisia. Es la pieza que un CMO inteligente comparte con su equipo.

**Estructura:** un solo flujo de lectura, max-width `680px`, tipografía editorial generosa, sin sidebars ni distracciones.

**Copy completo:**

```
[título display-xl:]
Manifiesto

[subtítulo:]
Por qué construimos una agencia de inteligencia social
en una industria saturada de plataformas.

[cuerpo:]

I.

La industria del social listening creció ofreciendo a las marcas algo
que parecía valioso: acceso. Acceso a millones de menciones, a métricas
en tiempo real, a dashboards configurables. Y durante una década, ese
acceso fue suficiente — porque la pregunta era nueva y el dato era
escaso.

Hoy la pregunta es vieja y el dato es abundante. Y las marcas se dan
cuenta — algunas más rápido que otras — de que tener acceso a los datos
no es lo mismo que tener inteligencia sobre ellos.

II.

Una métrica no es un insight. Un dashboard no es una estrategia. Un
sentiment score no es una decisión. Y, sin embargo, durante años la
industria operó como si esas equivalencias fueran ciertas. El resultado
fue un ecosistema donde marcas pagan miles de dólares al mes por
herramientas cuyos outputs nunca llegan a una decisión real.

Esa brecha — entre el dato y la decisión — es el espacio donde existe
Noisia.

III.

Construir inteligencia social no es construir una mejor herramienta.
Es construir un sistema analítico distinto. Eso requiere tres cosas
que las plataformas no entregan:

Primero: **arquitectura de datos plural**. Ninguna plataforma cubre la
conversación que importa. La conversación que decide el destino de una
marca está distribuida en foros nicho, reviews extensos, comentarios
largos, comunidades cerradas accesibles, podcasts transcritos. Acceder
a esa conversación requiere orquestar fuentes, no licenciar una.

Segundo: **metodologías propietarias por pregunta**. La inteligencia
no es una operación genérica que se aplica igual a cualquier categoría.
Cada pregunta de negocio requiere un protocolo distinto: motivacional,
semiótico, topológico, narrativo. Las plataformas no pueden
metodologizar — solo pueden parametrizar.

Tercero: **traducción a decisión**. Ningún dashboard, por bien diseñado
que esté, hace el último kilómetro: traducir la evidencia en una
recomendación que un CMO pueda presentar al CEO el lunes por la mañana.
Ese kilómetro lo hace una persona con criterio. Lo hace un arquitecto.

IV.

Noisia es una agencia. No una plataforma. No una consultora genérica.
Una agencia de inteligencia social: un equipo de arquitectos que
diseñan sistemas analíticos a la medida del problema estratégico del
cliente.

Cobramos por la inteligencia, no por el acceso. Entregamos decisiones,
no dashboards. Operamos con metodología, no con plantillas.

V.

Si esto te resuena, probablemente tienes una pregunta de negocio que
las herramientas no te están respondiendo. Esa pregunta es nuestro
punto de partida.

Iniciemos un diagnóstico.
```

---

### 6.7 Field Notes (`/field-notes`)

**Objetivo:** establecer autoridad intelectual a través de ensayos cortos firmados, no SEO churn.

**Estructura del index:**

- Hero corto.
- Lista cronológica de ensayos. Sin grid de cards genérico — formato editorial: título grande, dek, autor, fecha, tiempo de lectura. Estilo: New Yorker / Aeon.
- Filtros opcionales por tema (Metodologías, Sectores, Crítica de industria, Casos).

**Estructura de cada `/field-notes/[slug]`:**

- Layout editorial puro: título display-lg, autor, fecha, tiempo de lectura.
- Cuerpo en MDX, max-width `680px`.
- Sidebar mínimo: nota al pie, bibliografía, "ensayos relacionados".
- Final: CTA suave para iniciar diagnóstico, sin agresividad.

**Inventario inicial de ensayos sugeridos** (pueden escribirse progresivamente):

1. *El sentiment score murió hace una década (y nadie lo enterró)*.
2. *Por qué tu categoría no se entiende sin antropología*.
3. *La diferencia entre influencia real e influencia métrica*.
4. *El moat técnico de la inteligencia social: 150 fuentes vs 1*.
5. *Lo que las marcas globales no entienden sobre los códigos locales*.
6. *Triggers, barriers y la ilusión del consumidor racional*.
7. *El customer journey que tu marca modela vs el que tu consumidor vive*.

---

### 6.8 Nosotros (`/nosotros`)

**Objetivo:** humanizar sin caer en la página "team grid" genérica.

**Estructura:**

1. **Hero** — quiénes somos en una sola frase + el porqué.
2. **Principios** — 4-5 principios operativos que guían cómo trabajamos. Ejemplos:
   - *La pregunta antes que el método.*
   - *Honestidad metodológica antes que promesa comercial.*
   - *Profundidad antes que velocidad.*
   - *Decisiones antes que dashboards.*
   - *Plural en datos, único en interpretación.*
3. **Equipo** — formato editorial: cada persona con foto B/N, nombre, rol, bio breve (2-3 líneas que digan algo real, no LinkedIn-speak), un link a su pieza más representativa (ensayo, charla, paper).
4. **Cómo nacimos** — párrafo corto, opcional. Solo si la historia añade valor.
5. **Trabajamos desde** — geografías donde operamos.
6. **CTA:** contacto / diagnóstico.

---

### 6.9 Diagnóstico (`/diagnostico`)

**Objetivo:** convertir un visitante interesado en un brief inicial. Es el reemplazo del formulario de contacto genérico.

**Estructura — wizard multi-paso:**

**Paso 0 — Contexto**
*"Antes de empezar: este cuestionario toma 8-10 minutos. Sus respuestas serán leídas por uno de nuestros arquitectos antes de cualquier llamada. Si tiene un brief o documento, también puede enviarlo a [email] sin completar este flujo."*

[Botón: Empezar] [Link: Prefiero enviar un email]

**Paso 1 — Tu organización**
- Nombre y rol (texto)
- Empresa (texto)
- Tipo de organización (radio): Marca / Agencia / Consultora / Otro
- País de operación (select con países LATAM + ES + opción "Otro")
- Sitio web (opcional)

**Paso 2 — Tu pregunta de negocio**
*Esta es la parte más importante. Mientras más concreta sea la pregunta, mejor será nuestro diagnóstico.*

- ¿Cuál es la pregunta de negocio que te trae aquí? (textarea, mínimo 100 chars)
- ¿Cuál de estas situaciones describe mejor tu momento? (single-select):
  - Estoy preparando un lanzamiento.
  - Necesito optimizar algo que ya está corriendo.
  - Estoy explorando si tenemos un problema/oportunidad.
  - Tengo una hipótesis estratégica que quiero validar.
  - Estoy en una situación de crisis o pérdida de share.
  - Estamos planificando entrada a un nuevo mercado/segmento.
  - Otro: [campo libre]

**Paso 3 — Lo que ya tienes**
- ¿Qué research o data ya tienes sobre esta pregunta? (multi-select):
  - Estudios cualitativos previos.
  - Cuantitativo de marca o tracking.
  - Acceso a herramientas de social listening.
  - Data de CRM/ventas.
  - Nada formal — es una intuición.
- ¿Trabajaste antes con una agencia de inteligencia/research? (radio): Sí / No / No estoy seguro
- Si sí, ¿qué te faltó? (textarea, opcional)

**Paso 4 — Alcance y tiempo**
- ¿Cuándo necesitarías tener resultados accionables? (select):
  - En menos de 4 semanas (urgencia alta).
  - 4-8 semanas.
  - 8-12 semanas.
  - 3+ meses, queremos hacerlo bien.
  - No tengo deadline, estoy explorando.
- ¿Tienes presupuesto definido para este proyecto? (select):
  - Sí, tengo rango definido.
  - Tengo idea aproximada.
  - No, necesito que me orienten.
  - No aplica todavía.
- *Si tiene rango:* (rango libre opcional)

**Paso 5 — Categoría y mercado**
- ¿En qué categoría/industria opera tu marca? (texto)
- ¿Qué mercado(s) son relevantes para esta pregunta? (texto)
- ¿Qué competidores deberíamos tener en el radar? (texto, opcional)

**Paso 6 — Cómo prefieres avanzar**
- Cuando recibamos esto, ¿cómo prefieres que te respondamos? (radio):
  - Email con preguntas de seguimiento antes de llamar.
  - Llamada de 30 min para discutirlo.
  - Solo me responden si creen que tiene sentido — sin presión.
- Email de contacto (texto)
- Teléfono (opcional)

**Paso 7 — Confirmación**
- Resumen de lo enviado.
- *"Recibirás una respuesta en 2 días hábiles. Si no, escríbenos directo a [email]."*
- [Botón: Enviar diagnóstico]

**Detalles UX:**
- Progress bar arriba (1/7, 2/7, etc.).
- Botón "Atrás" en cada paso (excepto 1).
- Auto-save en localStorage por si el usuario cierra y vuelve.
- Validación inline.
- En mobile, cada paso es un screen completo.
- Al enviar: email a Noisia (con todos los datos formateados), email de confirmación al usuario, registro en sistema interno (DB o Notion vía API, según preferencia).

**Crítico:** este formulario reemplaza el cuestionario que Brandhon ya estaba refinando. Debe ser editable a futuro (CMS o config file), porque las preguntas evolucionan.

---

### 6.10 Contacto (`/contacto`)

**Objetivo:** salida directa para quien no quiere hacer el wizard.

**Estructura simple:**
- Email general.
- Email comercial.
- Email para prensa/colaboraciones.
- Formulario corto: nombre, email, asunto, mensaje.
- LinkedIn de Noisia.
- Geografías.

---

## 7. Componentes reutilizables

Lista de componentes a construir como librería interna en `components/`. Cada uno con su API en TypeScript.

> **Herencia visual:** los componentes a continuación son la **lista lógica de composición del sitio** (qué construir, con qué API, dónde se usa). Sus especificaciones visuales — backgrounds, blur, glass, sombras, paddings, radius, color tokens — se heredan de los componentes definidos en `DESIGN_V2.md` (`fluid-background`, `glass-card`, `chart-surface`, `primary-button`, `toggle-button`, `section-eyebrow`, `quote-critical`, `quote-defender`, `footer-panel`, etc.). Cuando un componente del brief se mapea a uno del design system, **se usa el del design system como base de implementación**. Mapping principal:
>
> - `<PageHero variant="dark">` → glass-card sobre fluid-background con blob colors apropiados.
> - `<TierCard>` → glass-card.
> - `<MethodologyCard>` → glass-card con glifo + content.
> - `<DataArchitectureViz>` → chart-surface.
> - Botones primarios (todos los CTAs) → primary-button (negro, pill).
> - Eyebrows → section-eyebrow.
> - Pull quotes en metodologías y field notes → quote-critical / quote-defender según contexto.
> - Footer del sitio → footer-panel.

### 7.1 Layout

```tsx
<SiteHeader />          // Sticky, transparente al hero, sólido al scroll
<SiteFooter />          // 4 columnas + legal
<PageHero
  eyebrow?: string
  title: string
  lead?: string
  ctas?: CTA[]
  variant: "dark" | "light"
/>
<Section
  variant: "dark" | "light" | "graphite"
  spacing: "default" | "compact" | "spacious"
  maxWidth: "narrow" | "default" | "wide" | "full"
/>
```

### 7.2 Marketing

```tsx
<UseCaseSelector cases: UseCase[] />
<MethodologyCard
  number: string
  glyph: ReactNode
  name: string
  question: string
  href: string
/>
<TierCard
  name: "Foundation" | "Intelligence" | "Strategy"
  description: string
  scope: string[]
  idealFor: string
  ctaHref: string
/>
<DataArchitectureViz interactive: boolean />
<AntiPositioningList items: string[] />
<ProcessSteps steps: ProcessStep[] />
```

### 7.3 Methodology page

```tsx
<MethodologyHero
  number: string
  name: string
  question: string
  lead: string
/>
<FoundationsList foundations: Foundation[] />
<MethodologyProtocol steps: ProtocolStep[] />
<OutputsList outputs: Output[] />
<UseCasesGrid cases: string[] />
<HonestLimitations limitations: string[] />
<RecommendedReading references: Reference[] />
```

### 7.4 Field Notes

```tsx
<EssayCard
  title: string
  dek: string
  author: string
  date: string
  readingTime: number
  href: string
/>
<EssayBody mdx content />
<EssayMeta />
```

### 7.5 Forms

```tsx
<DiagnosticWizard />            // El de la sección 6.9
<ContactForm />
<FieldText />
<FieldTextarea />
<FieldSelect />
<FieldRadio />
<FieldCheckbox />
<WizardProgress current: number total: number />
```

### 7.6 UI primitives

```tsx
<Button variant: "primary" | "secondary" | "ghost" />
<Link variant: "default" | "underline-on-hover" | "inline" />
<Eyebrow />
<Tag />
<Glyph name: MethodologyName />
<Quote attribution: string />
<Pullquote />
<Footnote ref: string />
```

---

## 8. Microinteracciones y motion

> **Reglas globales del sistema:** `DESIGN_V2.md` (sección "Scroll Reveal" y "Fluid Background") define las reglas maestras: animar solo `transform` y `opacity`, stagger entre hijos de `60ms-80ms`, motion lento y sutil, fluid background estático en touch devices, respetar `prefers-reduced-motion`. **Esas reglas prevalecen sobre cualquier especificación del brief.** Esta sección añade microinteracciones específicas del sitio que el design system no detalla.

### 8.1 Inventario de microinteracciones del sitio

| Elemento | Interacción | Duración |
|---|---|---|
| Link inline | Underline draw left→right en hover | 200ms |
| Primary button (pill negro) | Active scale `0.98` (definido en design system) | — |
| Glass card | Subtle elevation en hover (sombra + 2px translateY), nunca tilt 3D | 250ms |
| Section reveal on scroll | Opacidad 0→1 + translateY 16px→0, stagger 60-80ms en hijos | 500-700ms |
| Glyph methodology | Slow breathing idle (2-4s loop), opacidad/scale sutil | — |
| Fluid background (hero) | Lento, desktop only, **estático en touch** | — |
| Wizard step transition | Cross-fade + slight horizontal slide (sólo desktop) | 400ms |
| Tab switch (UseCaseSelector) | Fade content sin slide | 200ms |
| Source drawer / modal open | Backdrop fade + content scale 0.96→1.0 | 300ms |

### 8.2 Reglas globales (refuerzo)

- `prefers-reduced-motion: reduce` → animaciones se reducen a fade simple.
- **Nunca parallax**, ni en desktop ni mobile.
- **Cursor custom prohibido.**
- **Scroll snapping prohibido.**
- **Loading states:** pulsos lentos o barras de progreso. Sin spinners.
- **Fluid background:** desktop only en movimiento, estático en `pointer: coarse` para evitar jump de viewport en iOS Safari y consumo de batería.

---

## 9. SEO y metadata

### 9.1 Estrategia general

Noisia no compite por keywords genéricas (no quiere rankear "social listening México"). Compite por **autoridad temática** y **brand search**. SEO es derivado de la calidad del contenido, no objetivo en sí.

### 9.2 Metadata por página

Cada página debe tener:

```ts
{
  title: string,                    // <60 chars
  description: string,              // <160 chars
  ogImage: string,                  // /public/og/[page-slug].png
  ogImageAlt: string,
  twitterCard: "summary_large_image",
  canonical: absoluteUrl,
  robots: "index, follow",          // o "noindex" para drafts
}
```

### 9.3 Open Graph templates

Diseñar 3 plantillas OG (1200×630 px):

1. **Genérica de página:** título + eyebrow + glifo Noisia.
2. **Metodología:** nombre metodología + pregunta estratégica + glifo de la metodología.
3. **Field Note:** título del ensayo + autor + fecha.

Generación opcional con `@vercel/og` para automatización.

### 9.4 Schema.org

Implementar:
- `Organization` en root.
- `Article` en cada Field Note.
- `Service` en /servicios.
- `FAQPage` opcional en /casos-de-uso (con las preguntas de negocio).

### 9.5 Sitemap y robots

- `sitemap.xml` autogenerado.
- `robots.txt` permitiendo crawling, bloqueando `/api/`.

---

## 10. Performance, accesibilidad e i18n

### 10.1 Performance budget

| Métrica | Objetivo | Crítico |
|---|---|---|
| LCP | < 1.8s | < 2.5s |
| CLS | < 0.05 | < 0.1 |
| FID/INP | < 100ms | < 200ms |
| TTI | < 3s | < 4s |
| JS bundle (initial) | < 120kb gz | < 180kb gz |
| Imágenes formato | avif + webp fallback | — |

### 10.2 Accesibilidad

- WCAG 2.1 AA mínimo.
- Test con axe-core en CI.
- Test manual con teclado en cada página.
- Contraste mínimo 4.5:1 para texto, 3:1 para UI grande.
- `prefers-reduced-motion` respetado.
- Focus rings visibles y de marca (no `outline: none`).
- Alt text descriptivo en toda imagen significativa, vacío en decorativas.
- Aria-labels en componentes interactivos custom.
- Semántica HTML correcta (h1 único por página, headings jerárquicos, `<nav>`, `<main>`, `<article>`, etc.).

### 10.3 i18n

Estructura preparada con `next-intl`:
- `app/[locale]/...` con default `es`.
- Diccionarios en `messages/es.json` y opcionalmente `messages/en.json`.
- En MVP: solo ES.
- Fase 2: EN para audiencia global.

---

## 11. Plan de fases

### 11.1 MVP (Fase 1) — 4-6 semanas de build

**Páginas:**
- Home completo.
- Las 6 metodologías (index + 6 detalles).
- Servicios.
- Manifiesto.
- Diagnóstico (wizard funcional).
- Contacto.
- Nosotros (versión inicial).

**Funcionalidades:**
- Sistema de diseño completo.
- Componentes core.
- Forms funcionales (Resend integrado).
- SEO baseline.
- Analytics.
- Deploy en Vercel con dominio definitivo.

**Fuera de scope MVP:**
- Field Notes (estructura preparada, sin contenido).
- Casos de uso individuales (página index sí, detalles no).
- Arquitectura de Datos (versión simplificada en home, página detalle no).
- CMS.
- i18n EN.

### 11.2 Fase 2 — 4-6 semanas adicionales

- Field Notes con primeros 3-5 ensayos.
- 5 casos de uso con detalle completo.
- Página completa de Arquitectura de Datos.
- CMS opcional (Sanity o Tina).
- OG image generator dinámico.
- Test cases en CI.

### 11.3 Fase 3 — continuo

- Más Field Notes (ritmo: 1-2 por mes).
- Resto de casos de uso.
- i18n EN.
- A/B tests en hero y CTAs.
- Funcionalidades adicionales según learnings.

---

## 12. Backlog técnico priorizado

### 12.1 Setup (Sprint 0, 3-5 días)

1. Inicializar repo Next.js 14 + TS + Tailwind.
2. Configurar tokens de diseño (CSS vars + Tailwind config).
3. Setup `next/font` con familias definidas.
4. Configurar ESLint, Prettier, Husky pre-commit.
5. Configurar Resend, variables de entorno.
6. Pipeline CI básico (Vercel preview deploys + axe-core check).
7. Estructura de carpetas según sección 4.2.

### 12.2 Sistema (Sprint 1, 5-7 días)

1. Layout: SiteHeader, SiteFooter, navegación responsive.
2. Componentes UI primitivos (Button, Link, Eyebrow, Tag, etc.).
3. Componente `<Section>` con variantes.
4. Componente `<PageHero>` con variantes.
5. Componente `<Glyph>` con los 6 glifos de metodologías (SVG inline).
6. Página plantilla blank con sistema funcionando.

### 12.3 Home (Sprint 2, 5-7 días)

1. Hero + ambient viz.
2. Sección "La pregunta fundamental".
3. `<UseCaseSelector />`.
4. Grid de metodologías (preview).
5. Sección Arquitectura de datos (preview con viz).
6. Sección Anti-positioning.
7. Sección Proceso.
8. Sección Tiers (preview).
9. Sección cierre.
10. QA de accesibilidad y performance.

### 12.4 Metodologías (Sprint 3, 7-10 días)

1. Página index `/metodologias`.
2. Plantilla `/metodologias/[slug]`.
3. Contenido MDX de las 6 metodologías.
4. Componentes específicos: FoundationsList, MethodologyProtocol, etc.
5. Glifos animados.
6. Cross-linking entre metodologías y casos de uso.

### 12.5 Discovery + Servicios + Manifiesto (Sprint 4, 5-7 días)

1. `/diagnostico` — wizard completo con auto-save.
2. API route para envío de diagnóstico (Resend + storage opcional).
3. `/servicios` con tabla comparativa de tiers.
4. `/manifiesto` (página editorial pura).
5. `/contacto`.
6. `/nosotros` (versión inicial).

### 12.6 Polish y launch (Sprint 5, 3-5 días)

1. SEO completo: titles, descriptions, OG images, schema.
2. Sitemap, robots.txt.
3. Analytics integrado.
4. Performance audit final (Lighthouse, WebPageTest).
5. Accesibilidad audit final.
6. QA cross-browser (Chrome, Safari, Firefox; iOS y Android).
7. Migración de dominio.
8. Launch.

---

## Apéndice A — Glosario propietario

- **Inteligencia social** — Capacidad analítica para convertir conversación digital en decisión estratégica. Distinta de social listening (que es el acceso a la conversación).
- **Arquitectura de datos** — Sistema de orquestación de fuentes plurales que alimenta los protocolos analíticos de Noisia.
- **Orquestación** — Acto técnico de coordinar 150+ fuentes con normalización, deduplicación y enriquecimiento. No es "integración" (que sugiere conectar APIs).
- **Protocolo analítico** — La secuencia metodológica diseñada para responder una pregunta de negocio específica. Único por proyecto.
- **Playbook estratégico** — Output principal de Noisia. Documento que combina diagnóstico, evidencia y recomendación accionable. Reemplaza al "reporte" tradicional.
- **Triggers** — Fuerzas motivacionales que impulsan la decisión.
- **Barriers** — Fuerzas de fricción que la frenan.
- **Cultural codes** — Sistema simbólico inconsciente que organiza el significado de una categoría en un contexto cultural.
- **Decision velocity** — Propiedad de la categoría que determina la velocidad cognitiva con la que un consumidor decide.
- **Friction** — Resistencia (de cualquier tipo: cognitiva, emocional, operativa) que ralentiza o aborta la decisión.
- **Influence architecture** — Estructura topológica real de la influencia en una red conversacional, distinguiendo nodos por su función estructural.
- **Arquitecto** — Cómo Noisia llama a sus consultores senior. Nunca "consultor", "analista" o "account".

---

## Apéndice B — Anti-patterns (qué NO hacer)

- ❌ "Pricing pages" con tarjetas de planes mensuales.
- ❌ Botones "Empieza gratis" o "Prueba ya".
- ❌ Mockups de dashboards en el hero.
- ❌ Frases tipo "powered by AI", "data-driven decisions", "real-time insights".
- ❌ Logos de clientes sin caso real detrás (logo soup).
- ❌ Testimonios genéricos ("Excelente servicio").
- ❌ Iconografía corporativa stock (handshakes, lightbulbs).
- ❌ Stock photography de gente sonriendo en oficinas.
- ❌ Cookie banner agresivo. Mínimo, técnico, no manipulador.
- ❌ Newsletter popup intrusivo.
- ❌ Live chat genérico con "Hi! How can I help?".
- ❌ Carruseles automáticos.
- ❌ Animaciones que no respeten `prefers-reduced-motion`.
- ❌ Métricas de vanity ("+10x ROI").
- ❌ Llamar al consumidor "consumer" o "user". Es "el consumidor", "la persona", "el cliente final" según contexto.

---

## Apéndice C — Decisiones que requieren input del cliente antes del build

Estos puntos **deben** clarificarse con Brandhon antes de empezar. (Los ítems originalmente sobre paleta y tipografía quedaron resueltos por `DESIGN_V2.md`.)

1. **Logo y wordmark Noisia** — versión definitiva en SVG, incluyendo variante con aberración cromática mencionada en el design system.
2. **Dominio de producción** — `noisia.com`, `noisia.io`, `noisia.agency`, otro.
3. **Emails de contacto** — qué direcciones publicar y cuál es el destino interno de cada formulario (general, comercial, prensa).
4. **Equipo a publicar en `/nosotros`** — fotos B/N, nombres, roles, bios cortas.
5. **Propiedad legal/regulatoria** — aviso de privacidad, términos, jurisdicción.
6. **Geografías a listar** — qué países publicar como mercados activos.
7. **Política de Field Notes** — quiénes firman ensayos, cadencia esperada.
8. **Glifos de las 6 metodologías** — ¿diseño SVG custom encargado o aproximación tipográfica abstracta? El design system los espera como SVG inline.
9. **Casos anonimizados publicables** — ¿hay vignettes reales que se puedan publicar (con anonimización) para enriquecer páginas de casos de uso?
10. **Licencia de Google Sans / Product Sans** — confirmar fuente de licencia (Google Fonts API, self-hosted con licencia comercial). El design system las exige como única familia tipográfica del sistema.

---

## Apéndice D — Referencias y benchmarks

**Para inspiración estética y editorial (no para copiar):**

- linear.app — sistema de diseño y motion sutil.
- stripe.com — densidad informativa con respiración.
- vercel.com — tipografía + layouts editoriales.
- aeon.co — formato editorial puro.
- mit.edu (technologyreview) — autoridad intelectual sin pomposidad.
- pewresearch.org — visualización editorial de datos.
- ideo.com (versiones recientes) — agencia con autoridad metodológica.
- wisecut.video o paradox.studio — agencias con identidad visual fuerte.

**Para casos de "anti-referencia" (NO imitar):**

- Sitios de SaaS con hero genérico tipo "The all-in-one platform for...".
- Sitios de agencias creativas con cursores custom y cargas pesadas.
- Sitios de consultoras Big 4 (demasiado corporativos, sin personalidad).

---

## Apéndice E — Sistema de archivos del proyecto

El proyecto Noisia se gobierna por dos documentos canónicos. Codex y cualquier humano que entre al repo deben tenerlos ambos en contexto:

| Archivo | Rol | Contenido |
|---|---|---|
| `NOISIA_WEBSITE_BRIEF.md` (este documento) | Brief estratégico de producto | Identidad de marca, audiencias, IA del sitio, copy final por página, plan de fases, decisiones pendientes. |
| `DESIGN_V2.md` | Design system canónico | Tokens (color, tipo, spacing, radius), componentes visuales, modos de experiencia, fluid background, glass surfaces, motion, reglas de lenguaje. |

**Reglas de convivencia entre ambos:**

- Si el brief y el design system **describen el mismo aspecto visual con detalles distintos**, prevalece `DESIGN_V2.md`.
- Si el brief **especifica copy, IA o lógica de producto** y el design system no lo contradice, prevalece el brief.
- Cualquier nuevo componente de producto (Fase 2/3) que aparezca en el design system y no esté en el brief, debe ser añadido al brief antes de implementarse.
- Tokens nunca se hardcodean en el código. Se consumen del frontmatter YAML de `DESIGN_V2.md` vía un build step (script de generación de CSS variables y Tailwind tokens al inicializar el repo).

---

## Cierre

Este brief es la versión 1.1 del documento maestro de construcción del sitio Noisia (1.0 + integración de `DESIGN_V2.md`). Está diseñado para:

1. Ser leído por un agente de codificación (Codex) como instrucciones implementables, junto con `DESIGN_V2.md`.
2. Ser leído por un humano como documento estratégico que refleja el posicionamiento.
3. Iterar: las secciones de copy son refinables, la arquitectura es estable.

**Próximos pasos sugeridos:**

1. Resolver los 10 puntos del Apéndice C.
2. Ejecutar Sprint 0 (setup técnico) — incluyendo el script que parsea `DESIGN_V2.md` y genera tokens de Tailwind/CSS.
3. Iterar el copy a la par del build, no antes.

---

*Documento preparado como brief de construcción del sitio Noisia. Versión 1.1 (integración de `DESIGN_V2.md`).*
