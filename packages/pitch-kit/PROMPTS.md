# Prompts · cómo arranca una corrida

> Un solo prompt parametrizado, en lugar de un handoff nuevo por cada caso. Rellena los campos
> entre `<< >>`, borra el bloque de la familia que no uses, y pégalo en el chat nuevo. Todo lo que
> el prompt necesita explicar ya vive en los rulebooks: el prompt apunta, no repite.

## Cómo se usa

1. Copia el prompt maestro. No hace falta rellenar nada: el prompt pregunta.
2. Si ya sabes la familia y quieres ahorrarte la ronda, pega debajo el bloque que corresponda y
   las respuestas que ya tengas.
3. Si hay un caso anterior del mismo terreno, pasa su `PROVENANCE_AND_CHANGELOG.md` **solo como
   registro**, para heredar decisiones de alcance y caveats. Nunca para reusar su contenido.

## Prompt maestro

Agnóstico al método y a la familia: el prompt pregunta lo que necesita saber antes de decidir
nada. Copia el bloque completo, no le quites las preguntas.

```text
Vamos a construir un entregable de Noisia. Antes de proponer nada, lee el kit y pregúntame.

EL KIT ESTÁ EN: packages/pitch-kit/, dentro del repo de Noisia. Si no sabes dónde está el repo en
esta máquina, pregúntame. Trabaja sobre main actualizado (git pull), y si no encuentras
packages/pitch-kit/CANON.md estás en una versión vieja del kit: detente y avísame.

LEE PRIMERO, en este orden. Es la fuente de verdad, no inventes estructura ni método:
- CANON.md        el contrato: las tres autoridades, las familias, las reglas transversales
- LAYOUTS.md      secuencias, portada, presupuesto de altura, glosarios como contrato de alcance
- COPY_RULES.md   cada palabra, y la regla de títulos
- CHARTS.md       barras, líneas, ejes, color por plataforma
- ICONS.md        iconos y assets. Los glifos ya están en assets/icons.json
- METHODOLOGY.md  qué se puede afirmar y con qué fuerza
- DATA.md         el pipeline, sus gates y sus contratos de salida
- LEARNINGS.md    reglas de campo, incluida la terminología por terreno
- slides/catalog.json   qué slides existen y qué cabe en cada una
Y antes de escribir, abre examples/_local/INDEX.md y mira renderizado el deck aprobado más cercano
a esta familia, y también el contraejemplo que lista: es la vara de calidad. Si es un estudio
pagado, abre todos los pagados del índice, no uno, y lee su PROVENANCE_AND_CHANGELOG.md: la vara es
el rastro de feedback de la v1 a la final, no solo el PDF. Si el índice no existe o trabajas en una
copia del kit, pídeme la ruta. Un primer borrador con CSS propio y copy genérico
ya se rechazó entero una vez.
Y si el entregable toca lo comercial, la KB manda sobre el contenido:
packages/kb/00-overview/positioning.md y packages/kb/02-services/product-model.md

SI LO QUE VOY A PEDIR ES UNA PRESENTACIÓN INTERNA para el equipo, un status, cómo operamos o el
estado del producto, detente aquí: no es un entregable de cliente y este cuestionario no aplica.
Lee packages/pitch-kit/INTERNAL.md y sigue el prompt de decks internos de PROMPTS.md.

SI LO QUE VOY A PEDIR SON SOLO DATOS (una muestra en el formato que el sistema del cliente ingiere,
un paquete de datos, un feed o un conector para un socio), detente aquí también: no hay deck. Sigue
el prompt de entregas de datos de PROMPTS.md.

PREGÚNTAME ESTO ANTES DE EMPEZAR, y no asumas ninguna. Lo que se puede contestar investigando
(contra qué se compara, qué tiene ya armado el cliente, el portafolio) no me lo preguntes en
blanco: investiga y propónme la respuesta para que solo la confirme.
1. ¿Reporte, estudio, o los dos? Si es estudio, ¿es pagado o freebie? Cambia el tamaño y la
   densidad (LAYOUTS.md, "Paid or freebie").
2. ¿En qué idiomas? Si son dos, se construyen juntos desde una sola fuente de contenido.
3. ¿Qué método uso? Se nombra en inglés en la slide del marco. Si el deck va en español, ¿qué
   par de verbos acompaña a los términos? Por ejemplo Motiva / Desmotiva, o Empuja / Detiene si
   la pregunta es por qué compran o no.
4. La pregunta de investigación en una frase, si es estudio. Un reporte no lleva.
5. Sujeto, mercado y periodo, y qué fecha está completamente cerrada.
6. Contra qué se compara: competidores, categoría, o nada.
7. Quién recibe el deck, para calibrar vocabulario, y si puede recibir recomendaciones. Si no
   (un servicio de gobierno fue un caso), va la variante descriptiva de LAYOUTS.md.
8. ¿Ya hay exportaciones, o arrancamos por las queries?
9. ¿Qué va a decidir el cliente con esto, y qué tiene ya armado que el deck pueda usar: una
   métrica propia (un NPS, un tracking), sus unidades de negocio, sus competidores, su calendario?
   El mejor deck que ha salido del kit habló con la métrica y el organigrama del cliente.

Si el brief viene en un Google Doc, sus casillas no se leen por el conector (trae todas las
opciones sin decir cuál está marcada): confírmamelas aquí.

SI ARRANCAMOS POR LAS QUERIES:
Entrégamelas listas para copiar y pegar, una por bloque, con su nombre corto arriba y la
configuración de interfaz al lado: idioma, país, ventana y fuentes. Nunca en piezas para que yo
las combine. Cada query en dos versiones: sin rawText: para el volumen total (lo que el cliente ve
en el embudo) y con rawText: sobre el ancla para el análisis, cada una con sus palabras de TikTok
debajo. El razonamiento de cada query va en un archivo aparte. Recuerda que los acentos no
están documentados en LQL, así que cada término acentuado va también sin acento, y si la variante
sin acento es palabra de otro idioma (portugués y español), ese export se filtra por idioma en el ETL.

FLUJO:
advisor para cerrar el alcance
  → desk research con fuente por afirmación: portafolio y precios, homónimos, vocabulario local,
    bibliotecas de anuncios, calendario (DATA.md §2). Si es pagado, también el plan de search y
    pauta (METHODOLOGY.md §4.7)
  → UNA sola aprobación del plan completo (queries, exportaciones, capas, construcción), con la
    lista de todas las descargas que vas a necesitar (fuentes, dominios, tamaños) para que las
    apruebe de una vez y no una por una a media sesión
  → queries generadas con script y validadas con builders/check-queries.py, listas para pegar
  → ETL en streaming, nunca licuadora. La zona horaria de cada exportación se comprueba, no se
    asume (DATA.md §5), y el perfil de idioma y país del primer archivo se revisa antes de bajar
    los demás
  → los gates de DATA.md antes de cualquier conclusión, y me dices cuáles fallan
  → un lote piloto codificado y recodificado a ciegas, con kappa por eje, antes de lanzar los
    demás lotes. Codebook sin capa por defecto: evidencia literal y "unclear" permitido
  → codificación en dos ejes, con su cobertura y su guard de sesgo. Al terminar, compara los ejes
    por codificador en los temas frontera: si la diferencia pasa de unos 15 puntos, escribe la regla
    de esos casos y recodifícalos a ciegas (METHODOLOGY.md §4.6)
  → mapa de hallazgos con verbatims reales ligados
  → LAS TRES FRASES, escritas completas en el chat, y esperas mi sí: las tres cosas que el cliente va a repetir en su siguiente
    junta, cada una con su cifra; la prueba de lo obvio para cada una (¿la pudo escribir antes
    del estudio?); y lo que esta base no da. Ver LAYOUTS.md, "Before the sequence"
  → si es pagado, la tabla de densidad: qué lleva cada slide de cada deck pagado de referencia
    (serie, canal, imágenes, logos, citas, implicación), y el primer corte se mide contra ella
  → slides sobre el engine, con los fragmentos de slides/ y un fondo propio por slide
    con builders/gen-backgrounds.py. Si falta Pillow, instálalo; no portes los builders
  → render slide por slide con builders/qa-render.py, y los miras. Si es pagado, pon cada render
    junto a la referencia y cuenta paneles de datos por slide, no solo slides
  → PDF, y lo revisas página por página
  → PROVENANCE_AND_CHANGELOG.md y GUION_POR_SLIDE.md desde templates/
  → el PDF vigente a Drive, en Leads/<Cliente>, preguntándome si hay duda de carpeta

EL MÉTODO, sea cual sea:
El patrón es el mismo en las seis metodologías. Cada expresión se clasifica en DOS EJES
independientes, los ejes no se suman entre sí, y se etiqueta después de ingerir, nunca dentro del
query. Lo que se cuenta son menciones que llevan la señal, no motivos: "187 triggers" está
prohibido, "187 menciones con señal de trigger" es lo correcto. El marco se explica en su propia
slide, en humano, antes de que cualquier otra lo use. Y el glosario del estudio tiene ranuras
fijas que tu método llena: el motivo, la unidad contada, los dos ejes, dónde vive y qué se puede
mover.

NO NEGOCIABLES:
- Cero em dash en todo el HTML, incluido el title. Se verifica con grep antes de entregar.
- Footer izquierdo: noisia · social intelligence architects
- Se enlazan los cuatro archivos del engine y se usan sus clases. Si una clase tuya ya existe en
  el engine, bórrala. El style del deck es solo para lo específico de ese deck.
- La portada y cualquier slide con fondo o ilustración a sangre llevan class="atmos plain".
- Sin gradientes en nada que codifique un valor. Las líneas van curvadas, nunca en segmentos.
- El título dice el hallazgo, nunca describe la slide, y no afirma ni más ni menos que su cifra.
- Ninguna cifra se teclea: se calcula de la tabla codificada al construir.
- La marca tiene que aparecer en el texto propio, no en el contexto heredado.
- Un conteo sin validación se llama direccional, con esa palabra.
- assets/tb-map.png se usa tal cual, con su anillo interior en inglés, en cualquier idioma.
- Nada de mask-image, filter ni box-shadow en lo que se imprime. Se resuelve en el asset.
- Los assets se entregan al tamaño del canvas, 1920 x 1080, salvo los fondos de
  gen-backgrounds.py, que van a 480 x 270 a propósito.
- Lo obvio es contexto, no titular. Lo no obvio abre el deck, justo después del marco. Si la
  respuesta es "casi nada", esa es la respuesta y el deck se construye alrededor de eso.
  COPY_RULES.md §2.9.
- En un estudio pagado, cada hallazgo lleva su bloque completo: la cifra (cuántas, serie en el
  tiempo, canal), de qué está hecho, cómo se ve en la vida real (imágenes de posts, videos o
  anuncios) y en sus palabras (citas). Cada marca nombrada lleva su logo. Y cierra con el bloque
  "para pauta". Un pagado escueto se rechazó entero. LAYOUTS.md, "What a paid study carries".
- La marca cliente va en el acento y las demás en gris; el rojo es solo freno o alerta. CHARTS.md §11.
- Cada título con un cuantificador ("ninguna", "la mitad", "casi nunca") lleva su assert en el build,
  y otro assert falla si un título trae dos puntos a media frase.
- El vocabulario de proceso (codificado, ponderado, base, muestra) vive solo en la slide de método.
  Donde un conteo necesita su límite, va en el pie, en palabras llanas.
- En un pagado, la slide 4 son las menciones en el tiempo por canal, con el embudo como tira de
  cifras arriba, y ninguna slide es solo texto fuera de portada, subportadas y respuesta.
- En un tema sensible (violencia, salud, seguridad), las slides oscuras van sin rojo.
- La respuesta cabe en una frase que el cliente pueda repetir. Las salvedades van una vez, en la
  slide de método.
- Sin eyebrow en las slides del cuerpo, salvo para un nombre acuñado. La nota de insight en un
  tercio de las slides como máximo, el pie solo donde una cifra necesita su base, y nunca tres
  slides seguidas con el mismo layout. LAYOUTS.md, "Rhythm".
- Verbatims reales, con liga, plataforma y fecha, y sin la liga pegada dentro del texto.
- Ningún dato de cliente entra al repo. El deck vive en una carpeta local.

Avísame en cuanto una decisión cambie el universo o la interpretación, y si los datos no dan para
lo que pedí, dímelo antes de construir, no después. Al final dime qué puede afirmarse, qué solo es
direccional y qué no permite concluir esta base.

AL TERMINAR, no edites el kit ni hagas commits en el repo desde esta sesión. Escribe lo que
aprendimos en CAMBIOS_PROPUESTOS_AL_PITCH_KIT.md, en la carpeta del caso, desde
packages/pitch-kit/templates/, y marca cuáles de nuestras decisiones fueron excepción de este caso
y no deben volverse regla.
```

## Prompt para entregas de datos

Para cuando el producto es el archivo: una muestra en el esquema del cliente, el paquete de datos
de un estudio, o un feed continuo hacia la plataforma de un socio. **No uses el prompt maestro**: su
cuestionario es de deck.

```text
Vamos a hacer una ENTREGA DE DATOS de Noisia. No hay deck: el producto es el archivo, o un feed.
Antes de proponer nada, lee el kit y pregúntame.

EL KIT ESTÁ EN: packages/pitch-kit/, dentro del repo de Noisia. Si no sabes dónde está el repo en
esta máquina, pregúntame. Trabaja sobre main actualizado (git pull), y si no encuentras
packages/pitch-kit/DATA_DELIVERY.md estás en una versión vieja del kit: detente y avísame.

LEE PRIMERO:
- DATA_DELIVERY.md   manda sobre esta entrega: el contrato del archivo, el mapeo, el formato, lo que
                     nunca sale, los gates H a M y el mail técnico. Completo.
- CONNECTORS.md      si es un feed continuo: aislamiento, reglas del ciclo, gates, "en producción" y
                     el runbook. Completo.
- DATA.md            cómo se procesa el corpus: streaming, texto propio, pertinencia, gates A a G.
- METHODOLOGY.md §1  queries, rawText, TikTok, acentos, anclas.
- CANON.md           solo las familias y las reglas transversales.

PREGÚNTAME ESTO ANTES DE EMPEZAR, una cosa a la vez. Lo que se pueda contestar investigando o
leyendo los archivos que te pase, no me lo preguntes en blanco: propónme la respuesta.
1. ¿Qué forma es? Muestra o entrega en el esquema del cliente, paquete de datos de un estudio, o
   feed continuo (conector).
2. ¿Quién o qué lo consume? Si es un sistema, necesito su archivo actual o su template de
   importación: ese archivo es el contrato.
3. Redes, mercados, periodo, y el set completo de términos por mercado (marcas, productos,
   genéricos, errores ortográficos). ¿Su herramienta actual aplica algún filtro?
4. ¿Qué columnas alimentan algo en su sistema (un ranking de autores, alertas, transcripción)?
5. Canal y cadencia: archivo, SFTP, bucket o API; cada cuánto; métricas al recolectar o refrescadas;
   ¿comentarios o solo posts?
6. ¿Cuánto histórico, y para cuándo lo necesitan?
7. ¿De qué cuenta y con qué llave se extrae? Nunca la de otro cliente.
8. ¿Ya hay exportaciones, o arrancamos por las queries?

ANTES DE EXTRAER, entrégame en texto y espera mi sí:
- el contrato del archivo: formato, columnas, zona horaria, idioma, quién lo lee y cada cuánto;
- la auditoría de la recolección, por red: ¿reglas propias en el proyecto?, ¿recolecta hacia atrás
  o solo hacia adelante?, cupos de la cuenta, permisos de la llave, plan;
- si el contrato con la fuente permite redistribuir a este destinatario, o que no lo sabes;
- el volumen estimado con su definición (texto propio, redes, con o sin comentarios). La vista
  previa de la interfaz es un piso para estimar, nunca una cifra para prometer;
- la lista de todas las descargas que vas a necesitar, para aprobarlas de una vez.

FLUJO:
contrato del archivo y auditoría de la recolección, aprobados
  → queries generadas con script y validadas con builders/check-queries.py
  → exportaciones a 00_insumos/, intactas, con hashes
  → ETL en streaming en tres capas (adaptador de origen, núcleo, adaptador de destino)
  → baldes con nombre que cuadran contra lo leído; RAW y LIMPO si aplica
  → el mapeo columna por columna con su estado y su llenado medido por red, tipo y mes
  → builders/check-delivery.py con --ref, --forbid, la serie mensual y el llenado; lees la serie
    antes de mandar y me explicas cada salto
  → LEEME y MAIL desde templates/LEEME_DATOS.md y templates/MAIL_TECNICO_DATOS.md; el LEEME se
    genera con los nombres reales
  → manifiesto con filas y sha256
  → PROVENANCE_AND_CHANGELOG.md desde templates/

SI ES UN FEED CONTINUO, además:
- vive en un repo privado propio y un proyecto de infraestructura aislado; nada de eso entra al
  monorepo ni al kit, y se despliega desde el repo, no desde una carpeta local;
- ventanas por fecha de recolección con marca, dedupe por (feed, id), entrega atómica (.part y
  renombrar), destinos independientes, un solo worker, respaldo propio, heartbeat y alertas;
- antes de decir "en producción", pasa la lista de CONNECTORS.md §5 y dime cuáles faltan;
- deja escrito su runbook concreto en el repo privado, con CONNECTORS.md §7 como base.

NO NEGOCIABLES:
- El proveedor de la escucha nunca aparece en lo que sale: ni su nombre, ni sus nombres de campo, ni
  sus prefijos de id, ni en nombres de archivo, mapeo o mail. Se verifica con --forbid.
- El crudo va intacto o no va. Lo transformado va en otra carpeta y con otro nombre.
- Encabezados idénticos y en el orden del archivo del cliente; las columnas extra, al final.
- Un solo dialecto CSV en toda la entrega. Vacío cuando no hay dato, cero cuando el dato es cero.
- Ids estables entre corridas, sin prefijos del proveedor.
- Zona horaria de la cuenta de origen, con su cambio de horario, nunca un offset fijo.
- Ningún volumen se cita sin su definición. El total con comentarios heredados nunca se presenta
  como "menciones de la marca".
- De una lectura sale la etiqueta final, el peso y la cita; nunca la evidencia por eje, las pasadas
  ni las columnas de control. Con licencia escrita y sin entrenar modelos.
- Nada de llaves, datos de cliente ni volúmenes en el repo. Ninguna llave en la carpeta del caso.
- Ningún compromiso en el mail que no esté verificado.

Si en algún punto los datos no dan para lo que se pidió (una red que no llena un campo, un hueco en
la serie, una cifra que no cuadra con lo que se dijo en la llamada), dímelo antes de mandar, no
después. Al final dime qué se entregó, qué no se replica y por qué, y qué queda abierto.

AL TERMINAR, no edites el kit ni hagas commits en el repo desde esta sesión. Escribe lo que
aprendimos en CAMBIOS_PROPUESTOS_AL_PITCH_KIT.md, en la carpeta del caso, desde
packages/pitch-kit/templates/, y marca cuáles de nuestras decisiones fueron excepción de este caso
y no deben volverse regla.
```

## Prompt para decks internos

Para una presentación al equipo: un status update, cómo operamos, el producto y su estado. **No
uses el prompt maestro para esto**: está hecho para entregables de cliente, y seguirlo al pie de la
letra es lo que hace que un deck interno salga con tono de pitch.

```text
Vamos a hacer una presentación INTERNA de Noisia, para el equipo. No es un reporte, un estudio ni
una propuesta: no corras el cuestionario de entregables del kit ni uses su tono comercial.

EL KIT ESTÁ EN: packages/pitch-kit/, dentro del repo de Noisia. Si no sabes dónde está el repo en
esta máquina, pregúntame. Trabaja sobre main actualizado (git pull), y si no encuentras
packages/pitch-kit/CANON.md estás en una versión vieja del kit: detente y avísame.

LEE PRIMERO:
- INTERNAL.md     manda sobre la voz, la estructura y la portada de este deck. Completo.
- CANON.md        el contrato del sistema
- LAYOUTS.md, COPY_RULES.md, CHARTS.md, ICONS.md   para el diseño, que sí es el del kit
- slides/catalog.json   los componentes que existen
Y mira renderizado, completo, el deck aprobado más reciente de examples/_local/ como vara de
calidad visual. De ahí se toma el acabado, no el tono.

PREGÚNTAME ANTES DE EMPEZAR:
1. ¿Quién va a estar en la sala, y qué tiene que saber al salir?
2. ¿Qué universos cubre? Por ejemplo, lo que operamos hoy y el producto en desarrollo.
3. ¿Cuál es la fuente de verdad de cada uno? Repo, rama, documentos, recibos de UAT, capturas.
4. ¿Hay algo que no deba aparecer?

ANTES DE CONSTRUIR, entrégame en texto y espera mi visto bueno:
- el mapa narrativo: los universos, sus capítulos y cómo se conectan entre sí;
- la lista de funciones que no pueden quedar sin explicar;
- el estado de cada una con su evidencia: existe en código, comprobado en UAT, diseñado o pendiente.

REGLAS DE ESTE DECK, todas en INTERNAL.md:
- Portada: solo el título. Sin ilustración, sin eyebrow, sin subtítulo.
- El título de cada slide nombra el tema, llano. Nada que venda, justifique o impresione.
- Cada función: para qué sirve, qué recibe, qué proceso y qué componente, qué resultado deja, qué
  existe y qué falta, y cómo alimenta lo siguiente. Repartido en las slides que haga falta.
- Cada tecnología se explica por lo que hace, no solo se nombra. Un logo solo si es real y va
  atado a una función.
- Diagramas: cada flecha es una relación real, entradas y salidas nombradas, orden de lectura obvio.
- Los ejemplos simulados dicen "simulado". Las capturas son reales y recortadas a lo relevante.
- Máximo tres tamaños de texto en todo el deck.
- Todo el diseño del kit sigue vigente: engine, cards, sin bordes de acento, sin gradientes,
  iconos reales, cero em dash, el footer.
- El deck vive fuera del repo.

FLUJO:
mapa narrativo aprobado
  → slides sobre el engine
  → render de cada slide con builders/qa-render.py, y las miras todas
  → PDF revisado página por página
  → GUION_POR_SLIDE.md con el detalle y las fuentes que no caben en la slide

Si en una revisión te digo "rehazla entera", reconsidera la estructura y el diseño del conjunto, no
solo las slides que mencioné.

AL TERMINAR, no edites el kit ni hagas commits en el repo desde esta sesión. Escribe lo que
aprendimos en CAMBIOS_PROPUESTOS_AL_PITCH_KIT.md, en la carpeta del caso, desde
packages/pitch-kit/templates/, y marca cuáles de nuestras decisiones fueron excepción de este caso
y no deben volverse regla.
```

## Bloque · Estudio de Triggers y Barriers

```text
FAMILIA: estudio T&B. Freebie o base chica: 10 a 15 slides. Pagado: 25 a 40, con el esqueleto
multipregunta (una subportada, su análisis y su recomendación por pregunta; si el brief trae
hipótesis, cada una se vuelve pregunta). Secuencia en LAYOUTS.md.

El método, que se nombra en inglés en la slide del marco:
- Triggers, lo que empuja hacia el sujeto. Barriers, lo que frena.
- Cuatro capas donde vive cada motivo: psicológica, personal, social y cultural.
- Doble codificación: cada expresión se clasifica por dirección y por capa.
- Permiso para actuar: una marca mueve lo psicológico y lo personal de lleno, lo social
  parcialmente, y con lo cultural solo se alinea. De ahí sale la slide de dónde actuar.

El orden lo dan las tres frases: la primera abre justo después del marco, y la secuencia de
LAYOUTS.md ordena lo que sobra. Las tres frases deciden qué abre, no achican un pagado. La slide de
las cuatro capas lleva una mención real por capa, y la de la conversación de categoría lleva el
desglose completo: recolectadas, por canal, en el tiempo, temas por canal. Si el tema es escaso, la hipótesis se prueba con su peso: menciones
por cada 10,000 de la conversación de cada marca. Si el query se armó con el vocabulario del
problema, el balance de dirección es en parte del query, y se dice.

Obligatorias de esta familia: la portada con ilustración, la slide que explica las cuatro capas
con el mapa detrás, la slide de canales, el mapa de hallazgos, el espejo, dónde actuar, la
respuesta en slide oscura y la slide de método. Las specs exactas están en LAYOUTS.md, y cuatro de
ellas ya existen como fragmento: cover-study, tb-layers, channels y method.
```

## Bloque · Reporte

```text
FAMILIA: reporte, 9 a 10 slides, secuencia en LAYOUTS.md.

El reporte parte del dato y del periodo, no de una pregunta. Describe qué está pasando y qué
cambió contra el periodo anterior, con una capa ligera de interpretación.

Ningún número va solo: todo se compara contra el periodo anterior. Si es el primer periodo, se
dice que es la línea base y que todavía no hay comparación. No se le inventa una tesis a un
reporte.
```

## Bloque · Muestra o freebie

```text
FAMILIA: muestra, variante corta del estudio, 10 a 14 slides.

Sirve para enseñar el nivel de lectura con un alcance recortado. Se detiene en el diagnóstico: las
slides de oportunidades, plan de acción y qué vigilar se colapsan en un solo bloque de teaser y un
cierre con siguiente paso.

Ante cliente final se muestra participación sobre la conversación depurada, no conteos crudos.
Ver CANON.md, sección 5.3.
```

## Bloque · Comercial

```text
FAMILIA: comercial (opener, outbound, overview, oferta, propuesta o one-pager). Lee
packages/pitch-kit/commercial/COMMERCIAL.md completo antes de construir. El deck sale en PPTX
nativo con commercial/builder/compose.py a partir de un brief; el copy canónico está en
commercial/copy/ y no se reescribe. Haz la entrevista de §3, una pregunta a la vez. Si ya hay un
deck hecho fuera del kit, sigue el paso 0b: mapeo lámina por lámina y lista del copy que choca,
antes de construir; las láminas sin módulo van en `extra`. Cero insights:
solo preguntas que Noisia podría responder, aterrizadas a la marca con hechos públicos citados en
las notas. Precios en XXX salvo que te den el monto en el chat.
```

## Registros de sujeto

El método no cambia con el sujeto. Cambia el vocabulario y lo que se puede afirmar. Añade el
párrafo que aplique.

```text
SUJETO POLÍTICO O DE ASUNTOS PÚBLICOS:
Triggers y barriers se leen como cercanía y rechazo hacia el actor. Lo que mueve la comunicación
de campaña es lo psicológico y lo personal, lo social parcialmente, y con lo cultural solo se
alinea. No se proyecta intención de voto desde volumen de conversación, y un pico se nombra solo
con su publicación raíz verificada. Si el tema se mueve rápido, un marco de volatilidad,
incertidumbre, complejidad y ambigüedad ordena la lectura, y se explica en una slide propia antes
de usarlo.

SUJETO DE PROTESTA O CONFLICTO:
La dirección se mide hacia la movilización, con blanco nombrado, y la postura frente a la violencia
es un campo aparte: condena, justifica o ninguna. Mezclarlas hace que "solo condeno a los
vándalos" caiga en barrier para unos codificadores y sin dirección para otros. Lo que las fuentes
no traen (mensajería privada, grupos de Facebook, comentarios de Instagram) define lo que se puede
afirmar: el estudio describe la capa pública, no la organización. Si el cliente pide alcance, se
lee como concentración y junto a las interacciones, nunca sumado entre queries.

SUJETO DE CATEGORÍA, SIN MARCA:
El estudio es agnóstico. Ninguna marca es protagonista, y el silencio de una marca en su propio
mercado es un hallazgo, no un vacío. Cada competidor se escucha con su propio universo, nunca
mezclado en un mismo query.

AUDIENCIA DE AGENCIA O PARTNER:
El vocabulario del marco es válido y hasta esperado en eyebrows y etiquetas de sección. No entra
al título ni al cuerpo, donde la idea se dice en humano. Ver COPY_RULES.md.

MERCADO EN INGLÉS:
Se traduce la idea, no las palabras. Los verbatims se dejan en su idioma original y se marcan como
traducidos solo si se tradujeron.
```
