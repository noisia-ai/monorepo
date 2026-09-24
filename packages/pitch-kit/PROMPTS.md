# Prompts · cómo arranca una corrida

> Un solo prompt parametrizado, en lugar de un handoff nuevo por cada caso. Rellena los campos
> entre `<< >>`, borra el bloque de la familia que no uses, y pégalo en el chat nuevo. Todo lo que
> el prompt necesita explicar ya vive en los rulebooks: el prompt apunta, no repite.

## Cómo se usa

1. Copia el prompt maestro. No hace falta rellenar nada: el prompt pregunta.
2. Si ya sabes la familia y quieres ahorrarte la ronda, pega debajo el bloque que corresponda y
   las respuestas que ya tengas.
4. Si hay un caso anterior del mismo terreno, pasa su `PROVENANCE_AND_CHANGELOG.md` **solo como
   registro**, para heredar decisiones de alcance y caveats. Nunca para reusar su contenido.

## Prompt maestro

Agnóstico al método y a la familia: el prompt pregunta lo que necesita saber antes de decidir
nada. Copia el bloque completo, no le quites las preguntas.

```text
Vamos a construir un entregable de Noisia. Antes de proponer nada, lee el kit y pregúntame.

EL KIT ESTÁ EN: /Users/brandhon_o/Downloads/noisia-product/packages/pitch-kit/
Rama: pitch-kit/canon-2026-09

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
Y si el entregable toca lo comercial, la KB manda sobre el contenido:
packages/kb/00-overview/positioning.md y packages/kb/02-services/product-model.md

PREGÚNTAME ESTO ANTES DE EMPEZAR, y no asumas ninguna:
1. ¿Reporte, estudio, o los dos?
2. ¿En qué idiomas? Si son dos, se construyen juntos desde una sola fuente de contenido.
3. ¿Qué método uso? Se nombra en inglés en la slide del marco. Si el deck va en español, ¿qué
   par de verbos acompaña a los términos? Por ejemplo Motiva / Desmotiva, o Empuja / Detiene si
   la pregunta es por qué compran o no.
4. La pregunta de investigación en una frase, si es estudio. Un reporte no lleva.
5. Sujeto, mercado y periodo, y qué fecha está completamente cerrada.
6. Contra qué se compara: competidores, categoría, o nada.
7. Quién recibe el deck, para calibrar vocabulario.
8. ¿Ya hay exportaciones, o arrancamos por las queries?

SI ARRANCAMOS POR LAS QUERIES:
Entrégamelas listas para copiar y pegar, una por bloque, con su nombre corto arriba y la
configuración de interfaz al lado: idioma, país, ventana y fuentes. Nunca en piezas para que yo
las combine. El razonamiento de cada query va en un archivo aparte. Recuerda que los acentos no
están documentados en LQL, así que cada término acentuado va también sin acento.

FLUJO:
advisor para cerrar el alcance
  → queries listas para pegar
  → ETL en streaming, nunca licuadora
  → los gates de DATA.md antes de cualquier conclusión, y me dices cuáles fallan
  → codificación en dos ejes, con su cobertura y su guard de sesgo
  → mapa de hallazgos con verbatims reales ligados
  → slides sobre el engine, con los fragmentos de slides/
  → render slide por slide con builders/qa-render.py, y los miras
  → PDF, y lo revisas página por página
  → PROVENANCE_AND_CHANGELOG.md y GUION_POR_SLIDE.md desde templates/

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
- Los assets se entregan al tamaño del canvas, 1920 x 1080.
- Verbatims reales, con liga, plataforma y fecha, y sin la liga pegada dentro del texto.
- Ningún dato de cliente entra al repo. El deck vive en una carpeta local.

Avísame en cuanto una decisión cambie el universo o la interpretación, y si los datos no dan para
lo que pedí, dímelo antes de construir, no después. Al final dime qué puede afirmarse, qué solo es
direccional y qué no permite concluir esta base.
```

## Bloque · Estudio de Triggers y Barriers

```text
FAMILIA: estudio T&B, 14 a 17 slides, secuencia en LAYOUTS.md.

El método, que se nombra en inglés en la slide del marco:
- Triggers, lo que empuja hacia el sujeto. Barriers, lo que frena.
- Cuatro capas donde vive cada motivo: psicológica, personal, social y cultural.
- Doble codificación: cada expresión se clasifica por dirección y por capa.
- Permiso para actuar: una marca mueve lo psicológico y lo personal de lleno, lo social
  parcialmente, y con lo cultural solo se alinea. De ahí sale la slide de dónde actuar.

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

## Bloque · Propuesta

```text
FAMILIA: propuesta. Lee packages/pitch-kit/PROPOSALS.md y packages/kb/02-services/product-model.md
completos antes de construir. Lo que Noisia vende son Reportes y Estudios. Data está marcada como
exploratoria y no se pitchea. Foundation, Intelligence y Strategy son calibración interna y no van
en una slide.

La propuesta no contiene hallazgos sobre el prospecto. Cierra la pregunta, el alcance, los
entregables, lo que no incluye y el siguiente paso. Todo ejemplo va rotulado como ilustrativo.
Sin montos inventados y sin lenguaje interno de proceso.

Cierra antes de construir: cliente y aprobador, decisión y fecha, pregunta de negocio en una
frase, qué producto del catálogo o scope especial es, sujeto y competidores, mercados e idiomas,
fuentes y periodo, entregables, qué no incluye, dependencias del cliente y términos aprobados.
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
