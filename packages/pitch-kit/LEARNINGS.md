# LEARNINGS — reglas de campo para las press de Noisia

Aprendizajes de armar decks reales con el pitch-kit (feedback directo del equipo comercial).
Complementan `COPY_RULES.md` y `AGENTS.md`. **Léelo antes de armar un deck.**

## Copy y posicionamiento
- **Nunca "jugadas"** — no es natural en México. Usa **estrategias / decisiones / movimientos**.
- **Nunca nombres herramientas** en slides de cliente (SentiOne, scrapers, vendors). Al cliente no le interesa el stack.
- **No somos "social listening".** El foco es **Voice of the Consumer / la voz del público** (o del electorado). El monitoreo de redes es el medio, no el pitch.
- **Slides de proceso = cómo trabajamos CON el cliente**, no el método interno. Secuencia probada para política: **Paso 0 Workshop → Diagnóstico → Presentación → Reporteo continuo → Día de la elección (D-Day, acompañamiento en vivo)**.
- **Títulos en español claro** — nada que un mexicano no entienda o que no sea de la industria. Evita "lectura" como sustantivo → nombra el entregable por su familia: **este estudio, este reporte**. "Diagnóstico" también se corrigió a mano en revisión, así que tampoco.

## Terminología política (MX)
| ❌ | ✅ |
|---|---|
| rivales | **contrincantes** |
| prueba de mensajes | **sugerencias de mensaje** (tono de recomendación; nunca "cambiamos la opinión pública" — protección legal, solo sugerimos) |
| índice de apoyo digital | **índice de intención de voto** |
| escucha 24/7 | **escucha en vivo** |
| setup | **primer mes / arranque** (el cliente no entiende "setup") |
| el estratega "traduce" | el estratega **interpreta** |

En la slide de equipo: **datos primero, estratega al final** (Analista de datos → Account/PM → Estratega político-digital).

## Pricing político (modelo Noisia)
- Una sola oferta clara. **No** des "modalidades" ni 3 planes alternativos sin CTA.
- Estructura: **Primer mes / arranque** (incluye workshop, dashboard, definición de temas/KPIs, diagnóstico inicial) **+ mensualidad FIJA** el resto de la campaña.
- La **frecuencia de reporte sube por calendario**, pero el fee mensual **no cambia**: mensual (hasta 6 meses antes) → quincenal (3 meses) → semanal (2 meses) → **diario (último mes)**. Muéstralo como rampa.
- **Mensualidad por adelantado** (mitiga el riesgo real: si pierden, no pagan la última).
- **Incluye IVA (16%)** explícito. Las referencias de anclaje reales, por plaza y por duración de campaña, viven en la KB comercial en Drive. No se escriben aquí: el repo es público.
- ⚠️ Poner montos **rompe la regla "sin cifras" del kit a propósito** — válido solo en decks locales de `examples/_local/` cuando el cliente pide presupuesto. No subas cifras de cliente al repo.

## Cobertura y fuentes
- Lista autoritativa de fuentes VoC = `apps/website/src/components/marketing/SourcesConstellation.tsx` (18 fuentes + stats "150+ tipos de fuente", "12 familias de datos conectables").
- La slide de cobertura puede ser **grid de fuentes con iconos** o el **mapa mental** (data sources → noisia → use cases). Ambos válidos; el mapa va transparente sobre blanco.

## Iconografía y visual
- **Iconos en todo.** La librería semántica es **Iconoir**, no Feather: `ICONS.md` es el rulebook y manda. Esta línea decía Feather porque se escribió antes de esa decisión y queda aquí solo como registro. Marcas y plataformas con **Simple Icons**. Los glifos ya extraídos viven en `assets/icons.json`, así que no hace falta instalar nada ni volver a sacar paths a mano.
- **Badges de archivo**: rounded rects con texto — PDF (#e4462b), XLSX (#1d6f42).
- **Ilustraciones Noisia**: siluetas con aberración cromática cian/rojo. Usa **PNG con fondo transparente** (evita bordes); si el PNG trae fondo blanco, monta con `mix-blend-mode: multiply`.
- **Bug flexbox recurrente**: una imagen `flex:1` empuja caption/footer fuera del canvas → añade **`min-height:0`** al contenedor flex.
- **Sombras en PDF**: `--print-to-pdf` (build-pdf.mjs) **rasteriza `box-shadow` y `backdrop-filter` como cuadros grises** detrás de cada card. Ya hay un `@media print` en `engine/deck.css` que aplana `.glass` a superficie sólida con borde solo para impresión (pantalla intacta). Si haces cards custom fuera de `.glass`, aplánalas igual (fondo sólido + borde, sin sombra) o hazlas de color pleno (p. ej. negro con iconos blancos).
- **No toques el `position` de `deck-stage`.** Un bloque de estilos copiado de otro deck traía
  `deck-stage{position:relative}`, que pisa el `position:fixed` del componente y colapsa el lienzo.
  Copia componentes, no la hoja entera de otro caso.
- **El QA es `builders/qa-render.py`.** Para inspeccionar el PDF impreso cuando no hay `pdftoppm`,
  PyMuPDF (`import fitz`) rasteriza cada página y arma una hoja de contactos en pocas líneas.
- **El primer borrador se arma sobre el kit y contra un deck aprobado.** En un caso el primer
  intento llevaba CSS propio y copy genérico y se rechazó entero. Antes de escribir, se abre el
  deck aprobado más cercano de `examples/_local/` y se usa como vara.
- **Verifica el PDF real, no el screenshot de pantalla.** El artefacto de sombras solo aparece en el print. Renderiza la página impresa: `pypdf` (extrae la página) → `sips -s format png` para inspeccionarla.

## Caveats honestos (siempre)
- **Geo**: "La precisión de la geolocalización depende de la fuente de datos". El social listening mide **conversación digital, no presencia física** ni verdad de campo — verifica contra la agenda real antes de afirmar ausencia/silencio.
- Reacciones ≠ sentimiento: "haha" (burla) puede dominar aunque el modelo marque neutral. Revísalo.

## Propuesta con un ejemplo trabajado sobre datos del cliente
Caso: cruce de un NPS con la conversación, en una telco, con una categoría analizada completa como
ejemplo y el resto del deck explicando el servicio. Lo que se corrigió en dos rondas:

- **Dos bloques, dos voces.** El bloque del ejemplo se escribe como si el cliente lo presentara
  internamente: “el NPS”, nunca “tu NPS”, y sin Noisia explicándole nada. El bloque de método e
  implementación sí es Noisia hablándole al cliente. Ese bloque va diagramado: flujo con las cifras
  del embudo, tabla puente entre sus categorías y las nuestras, cadencia.
- **La portada lleva el hallazgo principal del ejemplo**, sobre el sujeto (la categoría), no una
  pregunta sobre el método. A la derecha, la versión simple del visual principal.
- **El índice se cambia por un resumen ejecutivo.** Un índice que explica el método no le sirve a
  nadie. Tres o cuatro tarjetas, cada una con su cifra y su hallazgo.
- **Rótulos llanos donde la idea es simple.** Una tabla que compara las dos fuentes se titula
  “NPS vs Social” y sus columnas dicen NPS y Social. Frases como “aquí, sin traducir” o
  “en dos idiomas” sobran.
- **La slide de interpretación se llama “el trasfondo”.** Es casi un insight sin serlo: por qué el
  hallazgo pesa como pesa. “Lectura” no se entiende y “análisis” promete más de lo que es.
- **Nombres acuñados para el método, aunque sean en inglés**, en el eyebrow de la sección: Voice
  Convergence, el lenguaje común. Una frase-eslogan en el título no reemplaza un nombre.
- **Las recomendaciones sobre la promesa de la marca se escriben como alineación**, no como
  ultimátum. “Sostén la promesa o deja de decirla” se leyó grosero; “alinear comunicación y
  experiencia” dice lo mismo.
- **No se afirma que el cliente no mide algo sin revisar toda su taxonomía.** Ver `DATA.md` §18.5.
- **El límite se dice en la slide.** Dónde la conversación no sirve y la encuesta es la referencia.
  Le dio más credibilidad al deck que cualquier hallazgo.
- **Nada del contexto que se le dio al agente llega a la slide.** Ni nombres de la contraparte, ni
  lo que pasó en la reunión anterior, ni datos de negocio que el cliente comentó de pasada. Si al
  cliente no le aporta, no va.

## Versiones y entrega
- **Una versión nunca pisa a la anterior.** El deck vigente se llama
  `<Cliente>_<tema>_V0X_<AAAA-MM-DD>.pdf`; al reemplazarlo, el PDF y su fuente pasan a `_archive/`
  con prefijo de fecha. Hubo un caso con nueve archivos de versiones sueltos en dos carpetas y
  costó encontrar el bueno.
- **`VERSIONS.md` en la carpeta del deck**: cuál es el vigente, cómo se reconstruye, y qué cambió
  entre versiones, con los números base de cada una.
- **Fuente y build separados.** La fuente editable lleva marcadores donde entran gráficos
  generados; el `index.html` se arma con un script y no se edita a mano.
- **Si el análisis cambia, el análisis es reproducible**: scripts de pipeline, métricas y gráficos
  en una carpeta del caso, y las correcciones de la revisión manual en un archivo `id · campo ·
  valor` que el pipeline aplica.
- **Con el deck va un guion por slide**: qué decir, la cifra que se dice en voz alta, el paso a la
  siguiente y las preguntas probables con su respuesta.
- **Si la audiencia ya vio una versión anterior**, el guion abre con una tabla de qué cambió y la
  frase que explica por qué cambiaron los números. El crédito a quien pidió el cambio se da de
  palabra, nunca en la slide.

## Estudio multimercado (octubre 2026)

Tres estudios de un mismo tema en tres países, con presentación en vivo y ronda de feedback. Lo
reutilizable ya vive en su rulebook: el embudo de corpus y la mecánica que no se muestra en
`CANON.md` §5.7 y `DATA.md` §25; queries, ruido y ETL de varios mercados en `DATA.md` §26;
codificación por agentes, lectura por muestra, día de la semana e intensidad en `METHODOLOGY.md`
§4.6; la anatomía del insight en `COPY_RULES.md` §2.8; recomendaciones, slides nuevas y galería en
`LAYOUTS.md`; sparklines y comparación de marcas en `CHARTS.md`; el PDF verificado en
`builders/build-pdf.mjs`.

De la forma de trabajo:

- **Avisar cuando un número no se puede vender, y proponer la salida honesta que sí se puede.** En el
  mercado chico la salida fue leer el corpus completo. El usuario prefiere eso a un deck vacío o a un
  número inventado.
- **"Dime si se puede" pide primero la respuesta**, después el plan, y al final el permiso si hay
  descargas.
- **Se lee el transcript completo de la reunión antes de actuar.** El pedido real no siempre es el
  que se recuerda: la pregunta de los viernes era sobre un ritual, no sobre el día con más menciones.
- **El transcript se guarda en la carpeta del caso** (`01-Brief/reuniones/`) cuando se comparte.
