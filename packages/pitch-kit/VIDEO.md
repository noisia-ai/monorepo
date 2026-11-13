# Video · la familia de motion de Noisia

> Todo lo que se mueve: clips de /insights y TikTok, piezas para redes y LinkedIn, el video de un
> estudio y las animaciones dentro de un deck. Salió de tres fuentes que se hicieron por separado y se
> unificaron en noviembre de 2026: las historias de noisia.ai/insights, nueve animaciones de un deck de
> partnership con una plataforma de listening, y el video de un estudio pagado de cerveza y fútbol.
>
> **Esta guía delimita la marca, no restringe el estilo.** Lo que está en §2 no se negocia porque es
> Noisia. Lo de §4 son opciones, cada una con su propósito: se elige la que sirve a la historia. Lo
> que sí se pide es saber por qué se eligió.

## 1. Los cuatro formatos

| Formato | Para qué | Duración | Audio | Lienzo | Base |
|---|---|---|---|---|---|
| **Clip** | noisia.ai/insights y TikTok: un insight con su evidencia | ~21 s, 5 escenas | Sin voz | 1080 × 1920 | El motor y el esquema del website (§5.1) |
| **Social** | LinkedIn, Reels, TikTok: una pieza para publicar que cuenta un hallazgo | 15 a 30 s | Subtítulos siempre; voz opcional | 1080 × 1920 | `packages/motion` (§5.2) |
| **Estudio** | La puerta del estudio para quien no va a abrir 40 slides | 90 a 150 s | Narrador y voces de ElevenLabs, música, efectos | 1080 × 1920 | `packages/motion`, desde el video del estudio pagado (§5.3) |
| **Motion de deck** | Un diagrama vivo dentro de una slide | Loops de 10 a 16 s | Mudo | El tamaño de su caja en la slide | `packages/motion`, desde las animaciones del deck de partnership (§5.4) |

**Todo se construye con el builder** (`packages/motion`, §8): una pieza JSON entra y el video sale.

**Todo video es vertical 9:16**, también en LinkedIn. El motion de deck es la excepción porque vive
dentro de una slide 16:9.

## 2. Lo que es Noisia y no cambia

- **Google Sans**, local en woff2 o TTF, en 400 y 500 (700 solo para números héroe o una palabra). Un
  render que baja la fuente por red sale con `system-ui` sin avisar cuando no hay red.
- **Tokens del engine** (`engine/noisia-tokens.css`, el mismo `theme.ts` del website):

  | Token | Valor | Uso |
  |---|---|---|
  | ink | `#0a0a0a` | Texto principal |
  | fg | `#2b2b2b` | Texto secundario fuerte |
  | muted | `#6d6d6d` | Contexto y metadatos |
  | line / track | `#e6e6e6` / `#f1f1f1` | Divisores y fondo de barras |
  | bubble | `#eeeeee` | Burbuja de cita |
  | teal / tealSoft | `#008a8a` / `#e6f7f7` | La cifra protagonista, lo que empuja |
  | coral / coralSoft | `#e2543c` / `#fdece8` | Lo que frena |
  | cyan / red | `#00eeee` / `#ee0b00` | El logo y los fondos bloom; un acento puntual con propósito |

- **El logo real** de Noisia en el cierre de cada pieza, nunca escrito en texto (`assets/logo`,
  `public/brand/noisia.svg` en el website).
- **Cada plataforma con su logo**, nunca el nombre solo (`assets/icons.json`, Simple Icons en el
  website). Nada de caracteres Unicode como `𝕏` o `▶` en lugar del logo.
- **Las cifras salen de datos**, con su cálculo anotado (`notes` en el clip, `data.json` en el estudio).
  Ninguna se teclea en el video.
- **Toda cifra dice sobre qué está parada.** Un video no puede dejar más dudas de las que resuelve:
  - **La base se dice una vez, y en el estudio al abrir.** La apertura del estudio dice la tesis y la
    base: el narrador dice cuánto analizamos, en qué periodo y para qué, con el título, el total, el
    periodo y los canales en pantalla. Ya dicha, los capítulos pueden ir sin nota: repetirla en cada
    escena se sintió aburrido. Sin esa apertura, la nota es obligatoria en cada gráfica.
  - **Una nota va debajo de la cifra** cuando hace falta: cuántas menciones la sostienen, en qué periodo
    y, cuando se sabe, en qué canales ("35,385 menciones en mayo (13,079 en enero) · ene–may 2026" y los
    logos). En una pieza social es obligatoria en cada cifra. `note.mentions` es **un conteo exacto**
    (menciones distintas del tópico en el periodo), nunca una estimación ponderada como "voces
    pertinentes". Una cifra oficial (un censo, un cómputo electoral) no tiene menciones: su nota lleva
    `source`.
  - **Con menos de 5,000 menciones analizadas, la cifra va en porcentaje** o en "de cada 100", y la nota
    dice el universo del que salió (en una muestra al azar, el universo muestreado). "126 menciones"
    bajo un 65% se leyó como estudio superficial aunque el corpus fuera de 332 mil. El conteo leído no
    desaparece: queda en el método del deck. El builder rechaza una nota por debajo de 5,000.
  - **Cada pieza lleva una escena de base.** En una pieza social: el total de menciones analizadas, el
    periodo, el mercado y los canales, rankeados con barras si hay desglose y con sus logos si no. Va
    antes del cierre o justo después del gancho, nunca antes: el gancho abre. En el estudio, como el
    total ya se dijo al abrir, la base **no lo repite: cuenta los canales** (`head` y `channelTopics`):
    el reparto de todos y, en los dos o tres que nombra la voz, de qué se habla ahí. El total queda en
    una línea chica al pie. El builder rechaza una pieza sin escena de base.
- **El verbo es "analizamos" o "procesamos", nunca "escuchamos".** "Escuchamos" es lenguaje de social
  listening y Noisia trabaja después de la escucha: tiene que sentirse que las vimos todas. El total se
  llama "menciones analizadas", no "leídas", porque no se leyeron a mano. El builder rechaza "escuch"
  en la voz, los títulos y el Spark (`COPY_RULES.md` §0.5).
- **En video un sustantivo necesita su apellido.** "Quien no vota culpa a la oferta" no se entendió; dice
  "la oferta política". En el deck la slide da contexto; en 140 s no. Se revisa con el guion.
- **Las citas son literales y verificadas:** `assert fragmento in texto_verificado` antes de entrar, con
  plataforma y mes. Si se dramatiza, la etiqueta en pantalla lo dice: "verified post, voiced", "real fan
  posts, as a group chat".
- **La evidencia es real.** Una imagen generada o de atmósfera nunca se presenta como lo que dijo
  alguien (§4.3).
- **Las reglas de copy del kit** (`COPY_RULES.md`): sin em dash, sin "no es X, es Y", sin dos puntos de
  revelación, nada que suene a IA. Bilingüe es-MX y en-US cuando aplica. En la voz, los dos puntos de
  revelación ("La base:", "La apuesta:") se cuelan fácil: el builder los rechaza en `vo` y `vo2`.
- **Ningún dato de cliente en una pieza pública** y ningún proyecto de caso en el repo.

## 3. El guion: Human Signals

El guion se piensa antes de animar nada, con las etapas 01 a 07 de `HUMAN_SIGNALS.md`. Se escriben en
el chat y se aprueban antes de construir, igual que las tres frases de un estudio:

1. **La pregunta de negocio** y su reformulación humana.
2. **El hallazgo**, con su cifra y su fuente en el corpus.
3. **El insight:** la verdad humana en una o dos frases.
4. **La tensión:** las dos fuerzas que conviven (lo que quieren y lo que los frena, pertenencia y
   desconexión).
5. **La intención emocional** en tres niveles: lo que se siente al primer contacto, lo que se siente
   al seguir mirando y la idea que queda.
6. **El momento humano:** el instante cotidiano en que el insight se ve. De ahí sale el gancho.

Cómo cae en las escenas:

| Etapa | Clip y social | Estudio |
|---|---|---|
| Momento humano | `hook`: la frase tal como la diría la gente, en primera persona | Cold open con la voz de una persona real |
| Hallazgo | `stat`, `compare`, `split` | La prueba de cada capítulo: el dato y una voz real |
| Tensión | `tension` | El clímax: el hallazgo de espacio vacío |
| Evidencia | `quote` en burbuja | Tarjeta de post real |
| Insight | `takeaway` | Creative Spark: la línea de copy que el creativo puede usar |
| La base | `base`: menciones, canales y periodo | `base` antes del cierre, y el corpus con sus canales en la apertura |

**La intención emocional decide el ritmo y el sonido:** curiosidad pide un gancho que deje algo sin
explicar; complicidad, una cita con voz; extrañamiento, un silencio. En el estudio, el clímax corta la
música justo en el hallazgo de espacio vacío.

## 4. Estilo: las opciones y su propósito

### 4.1 Fondos

| Fondo | Cuándo | Cómo |
|---|---|---|
| **Bloom de Noisia** (el favorito) | Gancho, apertura, cierre, cualquier escena que tenga que sentirse Noisia | El campo de color con grano y blur de `commercial/builder/make_shapes.py`: las cuatro composiciones verticales `v-top`, `v-bottom`, `v-corner` y `v-soft` (`make_shapes.py --vertical`, ya en `packages/motion/public/backgrounds`). El color nace en un borde o una esquina y deja limpia la zona de lectura. Tiene que ser **estático**, o muy lento y moviendo la imagen entera: el grano que cambia en cada cuadro infló un video de 14.7 MB a 415 MB |
| **Blanco con lavado teal** | Escenas de lectura: cifra, comparación, cita. Lo usan las historias de /insights | `linear-gradient(180deg, #fff 0%, #fff 55%, #f1f9f9 100%)` |
| **Blanco liso** | Obligatorio en el motion de deck (§5.4) | `#ffffff` exacto |
| **Imagen de atmósfera** | Apertura, entrada de capítulo, cierre | Una imagen con el lenguaje Kinetic Cinema de `HUMAN_SIGNALS.md` (§4.3), con el texto encima en una zona que la imagen deja limpia |

Los halos radiales con grano que usó el primer video de estudio quedaron atrás: el bloom los
reemplaza. En noisia.ai/insights, cada historia ajusta su fondo al insight y se renderiza en HTML.

### 4.2 Tarjetas y énfasis

- **Teal suave** (`tealSoft`, radio 48, padding 64 × 60): la caja del takeaway, la opción por defecto.
- **Tarjeta negra** (`ink`, radio 30): vale cuando tiene un propósito, por ejemplo aislar la única línea
  que el equipo creativo se va a llevar (el Creative Spark). Una por escena y con aire alrededor; si
  todo es negro, nada destaca.
- **Coral** marca lo que frena. **Teal** marca lo que empuja y la cifra protagonista.

### 4.3 Imágenes

- **La evidencia** son posts, videos o anuncios reales, con su pie, por el Quality Gate y el Size Gate
  de `LAYOUTS.md`.
- **La atmósfera** puede fotografiarse o generarse con el método y el prompt de `HUMAN_SIGNALS.md`
  (§VI, en 9:16 para video). Pasa su control de calidad (§VIII, sobre todo la integridad anatómica) y
  nunca lleva texto, logos ni datos dentro.
- Una imagen de atmósfera nunca va junto a una cita como si la ilustrara: la cita es de una persona real
  y la imagen no lo es.

### 4.4 Movimiento

Los dos motores ya coinciden en lo básico, y esto es lo común (a 30 fps, un cuadro = 33.3 ms):

| Movimiento | Valor |
|---|---|
| Entrada de un elemento (`rise`) | Resorte `damping 18, mass 0.7, stiffness 120`: desvanece y sube 40 px, llega en ~20 cuadros (670 ms) sin rebote |
| Curva de entrada | `cubic-bezier(0.22, 1, 0.36, 1)`: rápida y con asentamiento largo |
| Curva de trayecto (morph, viaje por una curva, fade de cierre) | `cubic-bezier(0.65, 0, 0.35, 1)` |
| Palabras | Una por una, 3 cuadros entre palabras (2 en el takeaway), subiendo el 40% de su tamaño |
| Cifras | De 0 a su valor en 26 a 34 cuadros con `1-(1-t)^3`, tabular-nums y formato del idioma |
| Barras | El mismo resorte (damping 22), escalonadas 8 a 9 cuadros |
| Entre escenas | Entrada en 12 cuadros (opacidad y 36 a 40 px desde abajo), salida en los últimos 10 hacia arriba. El blur de 8 px es opcional. Sin cortes duros ni barridos |
| Pops con rebote | `damping 11 a 16, mass 0.6 a 0.8`. Solo para un énfasis puntual: el 0 del clímax, una burbuja que llega |
| Líneas que se dibujan | 26 a 70 cuadros con `strokeDashoffset` |

- **Barra de progreso arriba**, un segmento por escena (alto 6 a 8, radio 3 a 4, gap 8 a 10). En el
  clip son iguales; en el estudio, proporcionales a la duración de cada escena.
- **Cierre:** el logo real entra con fundido y escala de 0.92 a 1, y se sostiene de 1.8 s (clip) a
  3.3 s (estudio).

### 4.5 Tipografía y zonas seguras en 1080 × 1920

| Elemento | Tamaño (px) |
|---|---|
| Gancho | 104 a 128 |
| Titular de capítulo | 82 a 100 |
| Cifra héroe | 150 a 300 (el 0 de un clímax, 360) |
| Etiqueta de dato | 38 a 70 |
| Cita | 62 a 84 según su largo |
| Takeaway | 86 |
| Subtítulos | 46, peso 700 |
| Mínimo legible | 40 |

**Zonas seguras:** 150 px arriba (barra y etiqueta), 84 px a los lados y **160 px a la derecha** para los
botones de TikTok y Reels. Abajo, 360 px en el clip y **384 px (el 20%) en todo lo que se publica**, con
los subtítulos por encima. El contenido importante vive entre y = 220 y y = 1500.

## 5. Cada formato

### 5.1 Clip · /insights y TikTok

**Es el formato más cerrado, porque ya está construido.** Vive en `apps/website-next` del monorepo y
cada historia nueva es un JSON, sin código.

| Pieza | Ruta en `apps/website-next` |
|---|---|
| Motor: reloj de cuadros, `Stage`, `Sequence`, `AbsoluteFill`, `interpolate`, `spring`, `Easing` | `src/motion/runtime.tsx` |
| Ayudas: `enter`, `rise`, `countUp`, `formatNumber` | `src/motion/util.ts` |
| Tokens, lienzo, zonas seguras y duraciones | `src/motion/theme.ts` |
| La composición de una historia | `src/motion/StoryComposition.tsx` |
| Las 8 plantillas de escena | `src/motion/scenes.tsx` |
| El esquema (zod) y sus pruebas | `src/content/stories/schema.ts`, `schema.test.ts` |
| Historias publicadas | `src/content/stories/public/*.json` |
| Exportador a MP4 | `scripts/export-story.mjs` |

- **Escenas y cuadros:** hook 84, stat 108, compare 138, journey 156, split 120, tension 126, quote 156,
  takeaway 108 y el cierre con logo 54. De 2 a 7 escenas; el patrón probado es
  `hook → stat → (tension | split | segundo stat) → quote → takeaway`, unos 21 s.
- **Límites de texto** (los aplica el esquema): hook 90 caracteres, etiqueta de stat 110, contexto 140,
  cada lado de tension 90, quote 260, takeaway 140, título 90.
- **La base cierra el clip:** antes del logo, una tarjeta con los canales, el periodo y el mercado de la
  historia (`sources`, `period`, `market`). Las historias del website no traen el conteo de menciones;
  cuando lo traigan, entra.
- **Sin llamada a la acción dentro del video.** En el feed, "Leer el reporte" va fuera del lienzo.
- **Dos modos:** `feed` (el título va fuera del lienzo, como HTML indexable) y `video` (el título va
  dibujado a 56 px).
- **MP4 con el builder** (el camino por omisión), desde `packages/motion`:
  `node builders/build-video.mjs --format clip --in <archivo de historias> --story <id> --locale es`. Usa
  las mismas 8 plantillas, portadas con sus tiempos y tamaños.
- **MP4 desde el website** (el exportador original): con el sitio levantado
  (`pnpm --filter @noisia/website-next dev`), desde `apps/website-next`: `pnpm export:story <id> --locale es`. Captura cada cuadro con puppeteer y codifica con ffmpeg
  (`libx264`, `crf 18`, `yuv420p`, `+faststart`). Una historia de 21 s pesa ~3.2 MB y tarda unos 2
  minutos. `/render/<id>?frame=-1` da la hoja de contactos.

### 5.2 Social · LinkedIn, Reels y TikTok

El builder lo arma (`--format social`, ejemplos en `packages/motion/examples/social*.json`): las 8
plantillas del clip más voz opcional, subtítulos y un fondo por escena. La estructura es la que propuso el
video de estudio y se valida con la primera pieza publicada.

| Tiempo | Qué |
|---|---|
| 0 a 3 s | El gancho: la voz o la frase de una persona, en grande. Tiene que estar antes de 1.5 s |
| 3 a 12 s | Un insight: una cifra con su gráfica y una frase |
| 12 a 20 s | La tensión o el hallazgo de espacio vacío: lo más compartible |
| 20 a 24 s | La línea para llevarse, a 72 px o más si no hay narrador |
| 24 a 28 s | La base: menciones, canales y periodo (o justo después del gancho) |
| 28 a 30 s | El logo |

- **Se entiende sin sonido.** LinkedIn y los feeds arrancan mudos: los subtítulos o el texto en pantalla
  cuentan todo.
- **Una cifra por pantalla y como máximo una cita con voz.** Las demás citas pueden ir en un chat sin
  voz.
- Música más alta que en el estudio (~0.35 libre) y el narrador opcional.

### 5.3 Estudio

**El contrato con el deck:**
1. Las cifras salen del builder del deck, que escribe un `data.json` (`build_deck.py --video-data`), y
   el video solo lee de ahí. Si el corpus cambia, cambian los dos.
2. Las citas llevan su assert literal, igual que en el deck.
3. La narración interpola `data.json`; nada se teclea.

**La estructura que funcionó** (130.3 s, 10 escenas, 28 slides de deck detrás):
- **Cold open** (~15 s), con la tesis primero: el narrador dice la base y la pregunta mientras entran el
  título, el total, el periodo y los canales; después la lluvia del vocabulario, y al final la voz de una
  persona real. Abrir con la cita sin decir qué íbamos a ver no funcionó.
- **Un capítulo por pregunta o tema** (10.5 a 16 s cada uno), todos con los mismos tres tiempos: el
  insight, la prueba (el dato y una voz real) y el Creative Spark. Ninguno se queda solo descriptivo: el
  feedback fue que "no todas las slides tienen la misma densidad".
- **El clímax con el mejor hallazgo de espacio vacío** (~15 s): un contador baja a 0, la música cae y
  aparece un chat de grupo con posts reales y el hueco de la marca escribiendo.
- **La base por canales** (~8 a 12 s): el reparto de todos los canales y, en los que nombra la voz, de qué
  se habla ahí; cada tarjeta entra cuando la voz dice su canal. `vs` pone en pantalla la comparación que
  dice la voz ("pesa el doble" se ve como 24% con "12% en Facebook" debajo).
- **El cierre** (~11 s): la apuesta en tres tiempos, el asset de portada y el logo.

La apertura dice el corpus una vez, con los logos de sus canales; después los capítulos van sin nota o
con la nota que una cifra en particular necesite (§2).

**La seña del insight.** En pantalla el Spark se distingue, pero al oído entraba como una frase más del
narrador. Cada Spark entra con la misma seña corta (dos notas de campana, 0.55 s, `builders/cue.py`,
`public/sfx/insight.wav`) y la voz espera a que termine. A la segunda ya no hace falta explicarla. Es el
default del estudio (`"sfx": {"insight": "kit"}`); `"sfx": {}` la quita.

La duración la marca el contenido. Se planearon unos 90 s, el primer pase de audio dio 141 y se
recortó a 120; el usuario pidió no cortarlo "si tiene sentido", y quedó en 130.3 s.

**Timing desde el audio real.** Cambiar de voz cambia la duración (72 a 77 s al pasar a otra voz), así
que ningún tiempo va fijo en la composición. `packages/motion/builders/audio.py` genera las voces, mide
cada palabra y escribe `pieza.timing.json` con los marcadores en cuadros: `quote_at`, `spark_at`,
`zero_at`, `chat_at`, `logo_at`. Sin key, `--estimate` da el mismo timing estimado para un borrador mudo. Las reglas de
un capítulo: la voz entra en el cuadro 6, la cita 6 cuadros después de que termina la voz, `spark_at` 8
después, la voz del Spark en `spark_at + 6` (`+ 16` con la seña) y la escena cierra 20 cuadros después.
Las fases van en fila: cada una sale completa antes de que entre la siguiente (título, palabras, cita,
Spark), porque en el mismo lugar 10 cuadros cruzados se ven como "textos empalmados". Las animaciones se
anclan a una palabra: el número arranca cuando el narrador la dice.

**Audio:**
- **Las voces del sistema no sirven para entregar** ("se escuchan súper feas"); sirven de borrador sin
  key.
- **ElevenLabs por API**, endpoint `/v1/text-to-speech/{voice}/with-timestamps`:
  - narrador: **una voz profesional de la biblioteca compartida, poco usada, elegida con muestras;
    nunca una premade.** Una premade popular se rechazó como "la voz que anda circulando en todos los
    videos de internet". Se busca en `/v1/shared-voices` con `category=professional`, el idioma y el
    género, un uso anual moderado (entre unos 300 mil y 6 millones de caracteres) y una descripción de
    narración o documental; se generan tres muestras con una línea del guion y elige el usuario. Las
    voces compartidas funcionan por `voice_id` sin agregarlas a la cuenta. Modelo por defecto
    `eleven_multilingual_v2` con `stability 0.42`, `similarity_boost 0.8`, `style 0.35`,
    `use_speaker_boost`; la pieza los cambia con `voices.model`, `voices.quoteModel` y
    `voices.settings` (Eleven v4 solo acepta `stability` y `similarity_boost`);
  - la voz de la apertura se elige también **por ritmo**: la cita del cold open no debería pasar de unos
    10 s. Una de 13 s fue "muy lenta"; la misma cita con otras voces duró de 9.3 a 11.9 s;
  - voces del público: `eleven_v3` con `language_code` del mercado, voces nativas de la biblioteca
    compartida, y un tag de emoción al inicio de cada cita (`[laughing]`, `[mocking]`, `[excited]`…).
    Los tags llegan en la alineación como palabras y se filtran. Si la cita trae ortografía de la calle
    ("eh votado", "asen"), su `say` dice lo que lee la voz y la tarjeta sigue mostrando el texto literal.
    Una cita en otro idioma lleva su `translation`, en la tarjeta y en el chat del clímax, y **la
    traducción se revisa contra el fragmento citado, no contra el post completo**: dos lecturas del deck
    agregaban una frase o una palabra que el fragmento no dice;
  - voces diseñadas (Voice Design): el API solo acepta `eleven_multilingual_ttv_v2` y `eleven_ttv_v3`
    para diseñar (`eleven_ttv_v4` da 422), y la voz se usa después con el modelo que se quiera. El plan
    de pago por uso permite 3 voces propias y un clon ocupa una: revisar el cupo antes de diseñar y
    guardar cada id en cuanto se crea.
- **Subtítulos palabra por palabra** desde los timestamps: solo la voz del narrador, una línea de hasta
  30 caracteres a la vez, la palabra dicha en ink y la que viene en `#c3c5c8`. La cita tiene su propia
  tarjeta y no se subtitula. El mapeo cita ↔ timestamps se hace por texto normalizado, no por índice:
  por índice se desfasa con comillas anidadas o emojis.
- **Música** con `/v1/music` (`force_instrumental`) y **efectos** con `/v1/sound-generation`. La pista
  se pide redondeada hacia arriba a 5 s, para que un cambio chico de guion reuse la caché. Una pista
  aprobada se bloquea con `"musicLock": true` y se reusa mientras dure lo que el video; ningún audio se
  sobrescribe sin guardar el anterior como `_prev_<fecha>`. **La licencia
  de uso comercial se confirma en el plan de ElevenLabs antes de publicar fuera de una presentación
  privada.**
- **Mezcla:** narrador 0.95, citas 1.0, whoosh 0.45, pop 0.5, tick 0.22, hit 0.3 a 0.85. Música 0.26
  libre, 0.09 bajo la voz y 0.02 en el clímax, **con rampas de 6 a 8 cuadros**, no escalones, y la
  mezcla a -14 LUFS integrado (`ffmpeg -af ebur128` para medir).
- **Caché por hash del spec** (texto, voz, modelo, ajustes): volver a correr solo regenera lo que cambió.

**La key y el costo:**
- La key cuesta dinero. Vive en el `.env.local` de la raíz del repo, con las demás llaves de
  herramientas, y `audio.py` la lee de ahí: no se le pide al usuario. Nunca pasa por el chat ni por el
  repo.
- El lector limpia comillas y espacios (`strip().strip('"\'').strip()`; una key pegada con comillas dio
  401), revisa que empiece con `sk_` (64 caracteres hex son el ID de la key, no la key) y la valida
  contra `/v1/user/subscription` antes de generar.
- **Antes de generar se dice el presupuesto en caracteres:** el video terminado usa ~750 por minuto, y
  con tres pases de narración más las citas y pruebas se gastaron ~5,000. Música y efectos se cobran
  aparte.

**QA:** stills de cada marca (fin de la voz, fin de la cita, Spark completo) y de cada transición (el
arranque de la escena y el cuadro justo antes de cada marca): los encimados que vio el usuario estaban en
las transiciones. **Un encimado bloquea la entrega**, y lo detecta el builder, no una persona: con
`--qa`, cada bloque marcado con `data-qa` se mide en cada still y la QA truena si dos se cruzan o uno se
sale del cuadro, con el nombre de los dos y el cuadro (`src/common/LayoutGuard.tsx`). También truena
si un bloque baja a la franja de los subtítulos (60 px sobre ella), aunque en ese cuadro nadie hable, y
mide la caja ya animada, no el contenedor: una tarjeta que entraba subiendo desde 80 px pisaba los
subtítulos y la primera versión de la guardia no lo vio. La tarjeta de la
cita y el Spark van debajo de la gráfica y su nota, en la misma columna, así que una gráfica alta los
empuja hacia abajo en lugar de quedar debajo de ellos. El audio solo lo puede aprobar una persona
escuchándolo; se le pide al usuario.

**El `data.json` del caso.** El builder del deck de cada caso escribe `video/data.json` con las mismas
variables de sus slides, cada bloque con su `_calc`, y un `make_piece.py` del caso arma la pieza desde
ahí: números en palabras para la voz, el assert literal de cada cita contra el corpus y un assert por
cada afirmación de la voz ("pesa el doble" se valida entre 1.8 y 2.2; "los dos temas principales" valida
el orden). Las reglas de copy y de base ya las valida el esquema.

### 5.4 Motion de deck

- **La composición mide exactamente su caja en la slide**, en px de la retícula de 1920 × 1080, y se
  coloca con el mismo `x, y, w, h` sin escalar.
- **Loops mudos de 10 a 16 s** que se ven mientras se habla: "puede ser un gif", para que no obligue a
  la sala a callarse. Termina con un fundido al estado inicial (`loopFade`, los últimos 18 a 22 cuadros)
  para que el loop no corte.
- **El diagrama va en el GIF; título, explicación y pie van nativos en la slide**, editables. Las
  etiquetas dentro del GIF son cortas y sin cifras, salvo un contador con su fuente.
- **El GIF arranca en su cuadro completo** (la línea de tiempo rotada), porque el PDF que exporta Slides
  solo muestra el primer cuadro. Ese cuadro se revisa como still: es lo que sale en el PDF.
- **La slide que lleva un GIF va en blanco liso**: sobre el grano del bloom, un GIF blanco se ve como una
  caja.
- **Tipografía:** de 16 a 25 px en la caja; menos de 15 no se lee proyectado.
- **Presupuesto:** 4 a 5 MB de GIF en un deck de ~9 MB.
- La receta del GIF (secuencia PNG, paleta fija de 64 colores, mapeo exacto en numpy y gifsicle) está en
  `commercial/COMMERCIAL.md` §9.

**Los patrones** son componentes con props (`--format deck`, `pattern` en la pieza). El builder hace el
GIF arrancando en el cuadro completo, con paleta fija, blanco exacto y gifsicle:

| Patrón | Qué muestra | En el builder |
|---|---|---|
| Contador encadenado | Un número que se transforma en otro y cambia de etiqueta (recolectadas, únicas, analizadas) | `counter` |
| Stepper | Pasos con barra de progreso y paso activo | `stepper` |
| Hub de fuentes | Nodos en anillo con partículas hacia el centro | `hub` |
| Ciclo | Etapas en un círculo con un indicador que lo recorre | `cycle` |
| Campo de partículas que se depura | El corpus llega, el ruido cae, los duplicados se fusionan y el núcleo se agrupa en temas | Pendiente |
| Traza a la evidencia | Una curva une la respuesta con una mención concreta | Pendiente |
| Morph entre vistas | El mismo corpus en grilla, temas, barras y taxonomía, con un segmented control | Pendiente |
| Ventana de entregable | Wireframe con la etiqueta "Illustrative layout" | Pendiente |

## 6. Motores, versiones y licencias

**Dos motores, con la misma interfaz** (`Sequence`, `AbsoluteFill`, `interpolate`, `spring`, `Easing`):
- **El motor del website**, `apps/website-next/src/motion/runtime.tsx`: corre en vivo en el sitio y
  exporta MP4 por captura de cuadros. Sin licencia y sin audio.
- **Remotion 4.0.529**, con React 18.3.1, TypeScript 5.9.3 y Node 20.20.2: el estudio y el motion de deck.
  Trae audio y render.

Los componentes se escriben una sola vez contra esa interfaz, para que corran en los dos.

**Licencia de Remotion:** Noisia tiene licencia de empresa desde el 10 de noviembre de 2026. La key
secreta y la pública viven en el `.env.local` de la raíz del repo (ignorado por git, plantilla en `packages/motion/.env.example`), nunca
en el repo ni en el chat. `build-video.mjs` pasa la secreta a cada render; el Studio usa la pública y sus
renders no se cobran. Cada render automático cuenta ($0.01 por render en el plan de automatización): se
itera con `--qa` y el Studio, y el MP4 completo se hace al final.

**Render:**
- Chrome: el `chrome-headless-shell` de Playwright, en `CHROME_EXECUTABLE` del `.env.local` de la raíz, para que
  Remotion no baje el suyo.
- ffmpeg: el que trae Remotion (`npx remotion ffmpeg`, n7.1) es mínimo. No trae `fps`, `setpts`,
  `palettegen` ni `paletteuse`, y su `select` falla con muchos `eq(n,…)`. Para extraer stills se usa
  `-ss` cuadro por cuadro.
- MP4 final: h264 con `crf 22` para el estudio, 16 para el motion de deck y 18 para clip y social (el
  builder ya los aplica); `--scale 0.5` para un borrador rápido.

## 7. Trampas

- **Grano animado:** 415 MB contra 14.7 MB del mismo video con el grano estático.
- **Fuente por red:** sin red, sale con la fuente del sistema y no avisa. Siempre local, y el render espera
  `document.fonts.ready` o su `delayRender`.
- **El blanco del GIF:** `quantize` de Pillow manda `#ffffff` a `(252, 252, 252)` y en la slide se ve una
  caja gris. Mapeo exacto en numpy (`COMMERCIAL.md` §9).
- **El codec GIF de Remotion** pesa 4 a 5 veces más que una secuencia PNG con paleta fija.
- **Slides y el video:** un GIF anima en el editor y al presentar; un MP4 embebido llega como ícono de
  audio y Slides lo quita; un video insertado desde Drive sí queda, pero a mano.
- **Hooks dentro de `map`:** si un JSON cambia el número de nodos, cada nodo va en su propio componente.
- **Comillas dobles:** si la cita ya trae comillas y la tarjeta agrega otras, sale `””`. Se quitan las
  externas cuando la cita ya cierra con una.
- **En el website:** un `container-type` no puede medirse a sí mismo (`cqw` deforma el marco); `Stage`
  mide con `clientWidth`, no con `getBoundingClientRect`, o se escala dos veces; las duraciones viven en
  `src/motion/sizes.ts` porque una constante importada de un módulo `"use client"` llega como referencia a
  una página de servidor; toda animación de más de 5 s lleva botón de pausa (WCAG 2.2.2) y un póster fijo
  con movimiento reducido.
- **zsh** no parte `"Process 400"` en `$1 $2` dentro de un `for`: los scripts de render van con
  `#!/bin/bash`.
- **Una copia del kit con `public/` enlazado** escribía el audio de la pieza dentro del repo. El builder
  copia `public/` resolviendo enlaces.
- **La música se regeneraba** cuando el total cruzaba un tramo de 5 s, y una pista aprobada se perdió.
  Ahora se guarda la anterior y se puede bloquear (`musicLock`).

## 8. El builder

`packages/motion` (README con todos los comandos). Una pieza JSON entra, validada con zod; el video sale.

| Pieza | Dónde |
|---|---|
| Los cuatro formatos | `src/clip`, `src/social`, `src/study`, `src/deck`, registrados en `src/Root.tsx` |
| El esquema de cada pieza | `src/schema.ts`: textos con límite, citas con `verified: true`, fondos, gráficas, Spark |
| Marca | `src/brand`: tokens de §2, el canon de §4.4, Google Sans local, logo real, logos de plataforma e íconos del kit |
| Piezas comunes | `src/common`: fondo, barra de progreso, subtítulos, cierre con logo, la mezcla de §5.3 |
| Gráficas animadas | `src/charts`: anillo, barras, número héroe con cuadrícula de puntos, paneles enfrentados |
| CLI | `builders/build-video.mjs --format clip\|social\|study\|deck --in pieza.json --out pieza.mp4`, `--gif`, `--qa`, `--scale` |
| Audio y timing | `builders/audio.py` (`--budget`, `--estimate`, o ElevenLabs) |
| QA | `--qa` con la guardia de layout (`src/common/LayoutGuard.tsx`, hoy en el estudio) y `builders/qa.py`: hoja de contactos de los stills y chequeo de tamaño, duración y audio |
| Seña del insight | `builders/cue.py` reescribe `public/sfx/insight.wav`, sin API e idéntica cada vez |
| GIF | `builders/mkgif.py`: la receta de §5.4 |

**Los dos motores:** los componentes importan solo de `src/engine.ts`, que hoy apunta a Remotion. El
website expone los mismos nombres en su runtime, así que el paso que falta es que `apps/website-next`
importe las escenas de este paquete en lugar de tener su copia. Toca el sitio en producción y se hace
coordinado con quien lleva el website.

**Al hacer un video no se edita el kit, y eso nunca baja la calidad.** Si el kit produce un defecto
(un encimado, un orden fijo, un validador que no deja hacer lo correcto), la sesión del caso lo resuelve
con una copia parchada de `packages/motion` en su carpeta (`public/` copiado, nunca enlazado), entrega
bien, y deja el parche con su explicación para integrarlo. Así llegó todo lo de la apertura con tesis,
las fases en fila, la base por canales y la seña.

**Pendiente:**
- La guardia de layout en la pieza social y en el clip (hoy solo marca bloques el estudio).
- Un `builders/voices.py` que diseñe voces revisando el cupo y guarde cada id al crearlo, y un
  `make_piece.py` de ejemplo con los asserts genéricos del `data.json`.
- Que el website use las escenas de `packages/motion` (hoy son una copia portada, con los mismos tiempos).
- Los efectos de sonido (whoosh, pop, tick, hit) en la mezcla: el estudio pagado los usó; el builder solo
  trae la seña del insight.
- Cuatro patrones de deck (§5.4) y tres gráficas: curva con barras de días, tarjetas de marca, uno contra
  muchos.
- La primera pieza real de cada formato con voces de ElevenLabs, escuchada por una persona.
- Un `builders/voices.py` que liste voces profesionales por idioma y género, genere muestras y revise
  el cupo antes de diseñar.
- `--estimate` mide todo a 15 caracteres por segundo y puede inflar las citas en otro alfabeto; el
  audio real lo corrige.
- La loudness: el ffmpeg que trae Remotion no tiene `ebur128`; la medición a -14 LUFS necesita uno
  completo.
