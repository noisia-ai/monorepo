# Prompts · cómo arranca una corrida

> Un solo prompt parametrizado, en lugar de un handoff nuevo por cada caso. Rellena los campos
> entre `<< >>`, borra el bloque de la familia que no uses, y pégalo en el chat nuevo. Todo lo que
> el prompt necesita explicar ya vive en los rulebooks: el prompt apunta, no repite.

## Cómo se usa

1. Elige la familia en `CANON.md`, sección 3.
2. Copia el prompt maestro y rellena los campos.
3. Pega el bloque de la familia que corresponda.
4. Si hay un caso anterior del mismo terreno, pasa su `PROVENANCE_AND_CHANGELOG.md` **solo como
   registro**, para heredar decisiones de alcance y caveats. Nunca para reusar su contenido.

## Prompt maestro

```text
Eres mi partner para construir un << reporte | estudio | muestra | propuesta >> de Noisia sobre
<< sujeto, marca, categoría o tema >>, en << idioma y mercado, default español MX >>.
Entregable: deck HTML 1920×1080 y su PDF.

LEE PRIMERO, en este orden. Es la fuente de verdad, no inventes estructura ni método:
- packages/pitch-kit/CANON.md          el contrato del sistema y la familia que aplica
- packages/pitch-kit/LAYOUTS.md        la secuencia de slides y qué componente usa cada una
- packages/pitch-kit/COPY_RULES.md     cómo se escribe cada palabra
- packages/pitch-kit/ICONS.md          iconos, logos de plataforma y assets
- packages/pitch-kit/METHODOLOGY.md    qué se puede afirmar y con qué fuerza
- packages/pitch-kit/DATA.md           el pipeline de datos, sus gates y sus salidas
- packages/pitch-kit/engine/           el motor, se copia tal cual, no se forkea
- packages/pitch-kit/slides/catalog.json  qué slides ya existen, no rehagas ninguna
- packages/pitch-kit/slides/recipes.json  el esqueleto por escenario comercial
- packages/pitch-kit/templates/        procedencia, changelog y guion por slide

Y si el entregable toca lo comercial, la KB manda sobre el contenido, no este kit:
- packages/kb/00-overview/positioning.md   qué es Noisia y cómo se posiciona
- packages/kb/02-services/product-model.md el catálogo vigente, R1 a R3 y E1 a E5
- packages/kb/02-services/pricing-logic.md la lógica de cobro, nunca montos inventados

MONTAJE:
- Carpeta de trabajo fuera del repo, o en packages/pitch-kit/examples/_local/ que está gitignored.
- Copia engine/deck-template.html como index.html y los cuatro archivos del engine junto a él:
  noisia-tokens.css, deck.css, deck-components.css, deck-stage.js, más logo_norm.svg y los assets.
- Arma las slides con los fragmentos de slides/, no desde cero. Para un estudio ya existen
  cover-study, tb-layers, channels y method. Rellena cada {{PLACEHOLDER}} y el NN / TOTAL del footer.

ANTES DE ARRANCAR, pregúntame y cierra conmigo:
1. La pregunta de investigación en una frase.
2. Sujeto, geografía y periodo, y qué fecha está completamente cerrada.
3. Contra qué se compara, y si es agnóstico, de marca o comparativo.
4. Las rutas de las exportaciones y sus totales de tablero.
5. Idioma, mercado y quién recibe el deck.

FLUJO:
advisor para cerrar el alcance
  → queries y exportaciones
  → ETL en streaming, nunca licuadora
  → gates de calidad de DATA.md antes de cualquier conclusión
  → mapa de hallazgos con conteos y verbatims reales ligados
  → slides sobre el engine y las clases de deck-components.css
  → render slide por slide y revisarlas a tamaño real
  → PDF
  → PROVENANCE_AND_CHANGELOG.md y GUION_POR_SLIDE.md

NO NEGOCIABLES:
- Cero em dash en todo el HTML, incluido el title. Se verifica con grep antes de entregar.
- Footer izquierdo: noisia · social intelligence architects
- Se enlaza deck-components.css y se usan sus clases. El style del deck es solo para lo específico.
  Si una clase tuya ya existe en el engine, bórrala y usa la del engine.
- La portada y cualquier slide con ilustración a sangre llevan class="atmos plain", si no el blob
  cyan del engine se encima sobre la ilustración.
- assets/tb-map.png se usa tal cual, con su anillo interior en inglés, en cualquier idioma de deck.
  No se le pone nada encima.
- Iconos reales de Iconoir y Simple Icons. Nada dibujado a mano.
- Verbatims reales, con liga, plataforma y fecha. Ninguno inventado.
- Nunca se buscan triggers o barriers dentro del query. Se etiqueta después de ingerir.
- No se suman queries solapados, no se confunden menciones con personas ni reach con apoyo.
- Un conteo sin validación se llama direccional, con esa palabra.
- Ningún dato de cliente entra al repo. El deck vive en una carpeta local.

Avísame en cuanto una decisión cambie el universo o la interpretación. Al final dime qué puede
afirmarse, qué solo es direccional y qué no permite concluir esta base.
```

## Bloque · Estudio de Triggers y Barriers

```text
FAMILIA: estudio T&B, 14 a 17 slides, secuencia en LAYOUTS.md.

El método, que no se nombra en las slides:
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
