# Comercial · presentaciones y propuestas de venta

> La familia comercial del kit: openers, overview, oferta con precios, propuesta y one-pager.
> **Sobrescribe todo lo comercial del Pitch Kit.** `PROPOSALS.md` queda como puntero a este
> archivo. Reportes y estudios no cambian: siguen en el engine HTML con `LAYOUTS.md`.
>
> Quién lo usa: el equipo comercial, desde la app de Claude (web, escritorio o celular), con la
> skill `noisia-comercial`. No hace falta repo, terminal ni Python local: la skill trae todo y
> corre en el sandbox de Claude. Quien trabaja en el repo usa lo mismo con `compose.py`.

## 1. Por qué es distinto al resto del kit

Reportes y estudios se construyen en HTML y salen a PDF. Lo comercial no, por una razón: el
equipo edita. Cambia el logo del cliente, ajusta un precio, duplica una slide, hace una versión
para presentar y otra para mandar. Un PPTX que viene de un HTML son cajas sueltas con posición
fija, y cada edición lo descuadra. Por eso los decks comerciales salían mal: no por falta de
gusto, por falta de un archivo que aguante la edición.

Así que aquí **el PPTX es la fuente** y el PDF se exporta de él:

- Todo es PowerPoint nativo: cajas de texto, rectángulos redondeados e íconos PNG. Nada es una
  captura. Se abre en Google Slides y se edita palabra por palabra.
- La fuente es **Google Sans**, la misma del engine, open source (OFL) y nativa en Google Slides.
  Se probó: el PPTX importado en Slides se ve igual que la vista previa.
- El fondo de cada slide es el fondo de la slide, no una imagen encima: no se mueve por accidente.
- El número de slide es un campo vivo: si se reordenan, se renumeran solas.
- El logo del cliente es un recuadro que se reemplaza (clic derecho, Reemplazar imagen).
- Los precios salen como **XXX** y se llenan en el editable.

**Lo comercial no se ve como un entregable.** Si una propuesta se parece a un estudio, el cliente
no distingue qué compró de qué le vendieron, y todo empieza a verse hecho en serie. La diferencia
vive en portadas y fondos, nunca en la UI: las cards, la tipografía, los íconos y la retícula son
los mismos del sistema de diseño.

- **Portada, statement y cierre** llevan el *bloom* de Noisia sobre lienzo blanco, con el texto a
  la izquierda y el color entrando desde el borde derecho. Reemplaza a la ilustración de personas,
  que queda para los estudios.
- **Seis portadas, cada una con su cierre.** Cada deck usa una pareja, elegida a partir del nombre
  del cliente: el mismo cliente siempre recibe la misma y dos clientes casi nunca comparten. El
  brief puede fijarla con `"cover_variant": 1..6`.
- **Las slides de contenido** llevan un bloom chico y tenue que entra por la mitad de un borde, nunca
  por una esquina: en las esquinas viven el logo, `noisia.ai`, el pie y el número.
- **Una slide cuyo visual es una animación va en blanco liso**, sin fragmento: el grano tenue cubre
  toda la slide y un GIF con fondo blanco encima se ve como una caja. Alternar slides animadas en
  blanco con estáticas con bloom le dio ritmo al deck donde se probó.
- **El bloom se hace por código** (`builder/make_shapes.py`, modo lineal). No es una figura con
  contorno: el color nace en un punto focal del borde y avanza con un frente ondulado. Navy profundo
  junto al foco, cyan `#00EEEE` y rojo `#EE0B00` a media distancia, apagados en el frente, y se
  disuelve en el blanco con grano intenso, que es lo que lo distingue de un degradado genérico.
- **Los fondos son JPEG estándar, nunca progresivo.** Google Slides no abre un PPTX con un JPEG
  progresivo adentro: dice "No se ha podido abrir el archivo". Pasó con los demos de octubre.
- **El texto de las orillas** (`noisia.ai`, el pie y el número) cambia solo según lo que tiene
  detrás: gris sobre blanco, tinta sobre un tono medio, blanco sobre el núcleo oscuro.
- **UI:** cards `#fafafa` con borde `#eeeeee` y radio 16; íconos reales; sin sombras, sin bordes
  laterales, sin gradientes en un valor, sin eyebrows (§6).

## 2. Los entregables

| Entregable | Cuándo | Slides |
|---|---|---|
| **Opener informativo** | Lead tibio que ya nos conoce. Objetivo: confirmar interés y conseguir la reunión | 9 |
| **Opener outbound** | Lead frío, después del Loom. Objetivo: que conteste. Igual al anterior, la slide 2 es una pregunta | 9 |
| **Overview a la medida** | Lead calificado, antes o justo después del workshop. Noisia contada con las preguntas del cliente | 9 a 10 |
| **Credenciales** | Primera reunión con un prospecto que todavía no nos compra. Pocas slides sobre Noisia y casi todo casos de uso animados con sus preguntas. Se presenta desde el HTML (§2.1) | 8 a 12 |
| **Oferta comercial** | Piden precios. El catálogo con las slides de precio, en XXX | 10 a 11 |
| **Propuesta** | Después del workshop. Lo que entendimos, qué proponemos, cuánto cuesta y qué no incluye | 7 a 9 |
| **One-pager** | Una página A4 para correo o WhatsApp: oferta o piloto | 1 |

Las secuencias exactas están en `recipes.json`. Cada entregable sale en **español o inglés**, en
**versión para presentar o para mandar** (§7), y en **PPTX editable, PDF o los dos**.

El deck de metodologías no es un entregable aparte: el catálogo de estudios va dentro del opener y
de la oferta.

El conteo de slides es de referencia. Cuando se rehace un deck que ya estaba aprobado (§3, paso
0b), manda el deck original: una propuesta salió en 16 slides y estaba bien.

## 2.1 Credenciales: pocas slides, casos de uso animados

El formato que mejor ha funcionado en una primera reunión: "muy pocas slides sobre nosotros y más
de casos de uso con ellos", todas animadas. Salió de dos decks reales, uno para un negocio de un
mercado y otro para un portafolio global, y vive en `credentials/`.

**Es la excepción a §1: aquí la fuente es el contenido, no el PPTX.** Un JSON de contenido produce
tres salidas: el **HTML** para presentar desde el navegador (cada animación se reproduce al entrar a
su slide), el **PPTX editable** (texto nativo y cada animación como GIF que abre en su cuadro final)
y el **PDF** (Chrome imprime todos los diagramas terminados). El copy vive en un solo lugar.

```bash
cd packages/pitch-kit/commercial/credentials
python3 build.py examples/portfolio.en.json --out ~/Downloads/<Lead>/credenciales --pptx --pdf
```

Con eso salen las tres: `index.html` para presentar, el PPTX con las animaciones como GIF y el PDF
con cada animación en su último cuadro. `--pptx` corre `capture_gifs.py` y `build_pptx.py`; `--pdf`
imprime con Chrome. Pide Chrome, node con el repo instalado (`pnpm install`), numpy, Pillow,
websocket-client y gifsicle.

**Dos modos, el mismo motor:**

| | Funnel | Portafolio |
|---|---|---|
| Para quién | Un mercado y una marca: un retador, un equipo de growth, marketing o producto | Multimercado o de portafolio: insights o estrategia de un corporativo, que compra una capacidad recurrente |
| Slide de cómo trabajamos | Reportes y estudios (`ways`) | Un protocolo en cada mercado (`pillars` con la animación `protocol-zooms`) |
| Los casos | Recorren el funnel del cliente: confianza, fricción, competencia real, reputación, campaña | Recorren territorios: tendencias por categoría, inmersión por país, una pregunta de innovación, una campaña |
| El cierre | Tres pasos (workshop, Scope of Work, primera entrega) y una muestra, dentro del último caso | Una slide de piloto con el menú de estudios y reportes y sus tiempos |
| Plantilla | `examples/funnel.es.json` | `examples/portfolio.en.json` |

**La secuencia base:**
1. Portada: una afirmación de la oferta, nunca una pregunta armada ("o la cierre" se leyó como
   frase de IA).
2. Qué es Noisia: la animación de la conversación a la decisión.
3. **Dónde estamos**: la comparación contra herramientas de listening y agencias, con el copy
   `where_we_stand` del kit. Va aquí porque es donde el cliente piensa "¿esto no lo hace ya mi
   herramienta?". Para agencias, `where_we_stand_agency`.
4. Cómo trabajamos, según el modo.
5. De 3 a 5 casos de uso, uno por formato del catálogo.
6. Dónde escuchamos (anillos de plataformas alrededor de la persona), en el modo portafolio.
7. El cierre, según el modo.

**La slide de caso:** a la izquierda, la pregunta del cliente en su voz (9 a 14 palabras, una sola
palabra en teal), una línea de por qué importa, "Qué recibes" con 2 a 4 entregables sin adjetivos, y
abajo un chip con el formato y otro con el tiempo. A la derecha, el escenario animado con la etiqueta
"Ilustrativo". El vocabulario de la categoría (CURP, CLABE, tanda; ocasiones, empaque) es lo que hace
que el deck "no sea tan genérico" sin nombrar la marca.

**Las animaciones** (`credentials/anims/`, 14, cada una con su descripción arriba) siguen cinco
reglas: `render(estado, t)` depende solo de `t`; el cuadro final siempre está completo; el aleatorio
lleva semilla, así que el GIF coincide con el HTML; la coreografía dura de 5 a 7 segundos
(estructura, datos escalonados, un resalte, la leyenda); y **cero datos**: cifras como `XX%`, texto
en barras esqueleto, "City 1". Teal suma, coral frena, gris es ruido. Las listas de etiquetas se
cambian por prospecto con `labels` en el JSON; el resto del texto está en el idioma del archivo.

**Reglas del formato**, además de las de §4 y §6:
- El prospecto no aparece en las slides, ni otras marcas, ni otros clientes. Su contexto público
  (resultados, lanzamientos, campañas) va en las notas del orador, con fuente y fecha.
- Solo se prometen **reportes y estudios**. Data queda fuera de una primera reunión.
- La cobertura se dice como un total de fuentes ("170+ fuentes", la suma del catálogo aprobado),
  no como un conteo de plataformas, y cierra con "si falta una fuente, construimos el conector".
- "Protocolo", no "taxonomía".
- Herramientas y proveedores nunca se nombran, tampoco en la comparación: van categorías.

**Las animaciones del website entran tal cual.** El tipo de slide `website` pone a la derecha una
pieza cuadrada de noisia.ai, con su copy en el idioma del deck, y a la izquierda el punto que la
slide quiere hacer. No se portan ni se redibujan: `packages/motion` renderiza las composiciones del
sitio con Remotion (`src/website/registry.tsx`, `builders/website-assets.mjs`), así que el deck y el
sitio dicen siempre lo mismo. Cada pieza sale en tres archivos: un MP4 que se reproduce al entrar a
la slide del HTML, un GIF que abre en el diagrama terminado para el PPTX, y ese cuadro terminado en
PNG para el PDF. La lista completa sale con `node builders/website-assets.mjs --list`. Las que más
sirven en unas credenciales:

| Pieza | Para qué slide |
|---|---|
| `survey` | Contra encuestas: la encuesta dice cuántos, la conversación dice por qué |
| `approach-noisia`, `approach-listening`, `approach-ai`, `approach-agency` | Quién lee la conversación cambia la respuesta |
| `keywords` | Buscar palabras contra leer toda la conversación |
| `understand` | La persona en cuatro capas: lo que mueve y lo que frena |
| `method-count`, `method-weight`, `method-number` | Contar contra entender, cuántas contra cuánto pesan, mover el número contra mover la razón |
| `architect`, `evidence` | Un experto firma; cada hallazgo abre su evidencia |
| `one-conversation`, `sources-hub` | La misma conversación cortada como piensa cada equipo; todas las fuentes en una lectura |
| `offer-report`, `offer-study`, `offer-plan` | Las formas de trabajar con Noisia |

Las cifras del sitio ("16 idiomas", "20+ países") entran a una slide solo cuando estén aprobadas en
`copy/`.

## 3. La entrevista

Antes de construir, el agente pregunta. Una pregunta a la vez, corta, con opciones. Nunca asume:
cada respuesta cambia el deck.

0. **¿Ya hay un brief lleno?** Si la persona tiene uno de los briefs de §13 contestado, que lo
   pegue o lo suba. El agente lo usa como fuente (§13) y solo pregunta lo que falte.

   **0b. ¿Ya hay un deck, hecho fuera del kit?** Pasa seguido: una propuesta con copy y precios
   ya aprobados que hay que pasar a la marca. El agente lo lee completo y, antes de construir,
   entrega en el chat dos listas: el mapeo de cada lámina a un módulo de la receta o a un tipo de
   slide del builder (las que no tienen módulo van en `extra`, §5), y el copy que choca con las
   reglas (eyebrows, contrastes "no es X: es Y", cifras de conversación, índices, precios). La
   persona decide qué se queda. El copy aprobado se respeta palabra por palabra salvo en lo que
   ella decida corregir.

   Tres cosas más cuando el deck ya está en Drive y otra persona lo trabaja:
   - **Se vuelve a bajar justo antes de construir y otra vez antes de subir**, comparando el
     `modifiedTime` del archivo con el de la copia. En un caso, otro fundador reescribió un párrafo,
     cambió una card, borró una slide y reordenó mientras el agente trabajaba, y la primera v2 se
     armó sobre la versión vieja.
   - **Se edita ubicando las formas por texto y posición, nunca por ID:** Slides renumera los IDs al
     guardar. `noisia_pptx.Deck` sirve para editar un PPTX ajeno: se le asigna `prs` y sus primitivas
     (`text`, `box`, `icobox`, `icon`, `chrome`, `background`) dibujan sobre las slides existentes.
   - **Los comentarios pueden venir como cajas dentro de las slides**, no en el panel (otro idioma,
     otro color, tono de nota). Se listan aparte y nunca se tratan como copy; una imagen de
     referencia pegada junto a un comentario no entra a la slide.
1. **¿Qué necesitas?** Los seis entregables de §2, con su "cuándo" en una línea. Si no sabe,
   lo ayuda a elegir con esa columna.
2. **¿En qué idioma?** Español o inglés.
3. **¿Para presentar o para mandar?** Presentar: poco texto, el guion en las notas. Mandar: cada
   slide se entiende sola.
4. **¿En qué formato?** PPTX editable para Google Slides, PDF, o los dos.
5. **¿Para quién?** Marca, industria y mercado. El agente investiga la marca (§4.2).
6. **¿Quién firma?** El nombre y el correo que van en el cierre.
7. **Precios** (solo oferta, propuesta y one-pager, o si el opener lleva "desde"): ¿en qué moneda,
   con qué impuestos? El agente avisa que las slides de precio salen en XXX para llenarlas en el
   editable. Si la persona da los montos en el chat, se usan esos y nada más.
8. **Logo del cliente.** El agente le pide a la persona que lo baje del sitio del cliente y lo suba
   al chat como imagen. La skill no lo busca sola: el sandbox de Claude no tiene internet abierto.
   Si no lo sube, sale el recuadro para reemplazarlo en Slides.
9. **Solo para propuesta y overview:** lo que se habló con el cliente. Qué necesita decidir, para
   cuándo, qué formatos le interesan, mercados, competidores, qué queda fuera. Si no hay notas de
   la reunión, el agente lo dice y propone un overview en lugar de una propuesta.
10. **Opcionales:** estudio de muestra (con el link real del Drive), el slide de cómo funciona el
    engine, quitar alguna slide de la receta.

Con eso escribe el brief (§5) y construye.

## 4. Lo que escribe el agente, y lo que no

### 4.1 Cero insights. Sin excepción

Un deck comercial **nunca afirma qué dice la gente** de la marca, de la categoría o de un
competidor. Ni cifras de conversación, ni porcentajes, ni "el 40% se queja de…", ni "los
consumidores prefieren…", ni hallazgos de un estudio de otro cliente. No los hemos leído todavía,
y lo que no se leyó se inventa. Esa es la razón por la que el equipo se quejaba del copy: sonaba a
IA porque afirmaba cosas que nadie había medido.

Lo que sí va: **preguntas**. Lo que Noisia podría responder, explorar o investigar para esa marca.

### 4.2 Investigar la marca

En todo entregable con cliente, no solo en el opener y el overview, el agente busca a la marca
en fuentes públicas: su sitio, sus comunicados, prensa de los últimos doce meses. En una propuesta
que se rehízo, la confirmación encontró que dos aliados del programa de lealtad del cliente eran
de otro país del mismo grupo. Busca hechos que abran preguntas: una apertura, un
lanzamiento, una expansión, una adquisición, un cambio de precio, una campaña, un programa de
lealtad.

- Un hecho público entra a la slide solo si está verificado, y **su fuente va en las notas del
  orador** con la fecha.
- Ningún número que no venga de esa fuente. Si la fuente dice "récord de ventas", la slide no dice
  "creció 20%".
- Nada que se haya dicho en una reunión, nada confidencial, nada que el cliente no haya hecho
  público.

**Antes de construir, confirma.** Terminada la investigación, el agente escribe en el chat un
resumen corto y espera un sí: qué hace la empresa y en qué industria la ubica, en qué mercado, los
hechos públicos que va a usar con su fuente, y las preguntas que piensa poner. La IA confunde
giros y empresas homónimas; un error aquí arruina el deck entero y cuesta un mensaje evitarlo.
Sin ese sí no se construye nada.

### 4.3 Las preguntas, por industria

`INDUSTRIES.md` tiene las preguntas que ya sabemos responder en cada industria donde trabajamos.
El agente elige tres a cinco y las **aterriza a la marca** con lo que encontró en §4.2. Así no
inventa: parte de algo que Noisia ya hizo y lo vuelve específico.

Cada pregunta lleva un tema corto (Confianza, Precio, Lanzamiento…), un ícono del set y, en la
versión para mandar, una línea de por qué importa. Esa línea habla del negocio, no de la
conversación: "Las bebidas de temporada viven o mueren en las primeras semanas", no "la gente dice
que…".

### 4.4 Las slides de cliente, una por una

| Módulo | Qué lleva | Regla |
|---|---|---|
| `cover_client` | Una pregunta que el cliente reconozca como suya y una línea de qué responde el documento | Nunca el tipo de documento como título |
| `statement_punch` | La frase de entrada del opener, sobre el sector o la marca | Provoca sin afirmar datos. Una sola idea |
| `question_hook` | La pregunta trampa del outbound | Una pregunta que el cliente no sabe responder con sus números |
| `questions_client` | 3 a 5 preguntas aterrizadas, y el contexto público de la marca | §4.1 a §4.3 |
| `understood` | El titular del contexto, la pregunta de negocio y 2 a 4 decisiones | Sale de las notas de la reunión. Si no hay, no hay propuesta |
| `formats` | Qué responde cada formato para este cliente, con entregables y tiempos | Tiempos aprobados: 3 a 5 días hábiles después del workshop por estudio, salvo que se diga otra cosa |
| `blocks` | Los bloques de preguntas del estudio, de la A a la H | Preguntas, nunca respuestas |
| `investment` | Cada formato con lo que incluye y su precio en XXX | El "qué no incluye" siempre va |
| `sample` | El estudio de muestra real de su categoría, con su link | Solo estudios que existen en el Drive. Si no hay link, el módulo no va |
| `onepager` | Reto, decisiones, propuesta, cómo y con qué, precio, siguiente paso | Cabe en una página o se recorta |

Todo lo demás es copy canónico (§6) y no se reescribe.

## 5. El brief y la construcción

El agente escribe un solo archivo, `brief.json`, con las respuestas de la entrevista y las slides
de cliente. Ejemplos completos en `examples/`.

```json
{
  "deliverable": "overview",
  "lang": "es",
  "mode": "send",
  "vars": {"CLIENTE": "…", "MERCADO": "México", "FECHA": "Octubre 2026",
           "MONEDA": "USD", "IMPUESTOS": "más impuestos",
           "FIRMA": "Ferdinand Meister y David Alfaro · Fundadores", "EMAIL": "hola@noisia.ai"},
  "client_logo": "logo-cliente.png",
  "include": ["sample"],
  "slides": {"cover_client": {…}, "questions_client": {…}, "formats": {…}}
}
```

```bash
python3 builder/compose.py brief.json Noisia_<Cliente>_<Entregable>_ES.pptx --pdf
python3 builder/preview.py Noisia_<Cliente>_<Entregable>_ES.pptx revision --sheet
```

**Slides fuera de la receta.** `slides` solo modifica módulos de la receta; si trae uno que la
receta no usa, `compose.py` avisa. Para sumar slides, el brief lleva `extra`: cada una es un spec
de slide con su `type` del builder, colocada después de un módulo de la receta (o `start`, `end`).
Los tipos que existen alcanzan para casi todo: `factor_pricing` sirve para cualquier tabla de
precios de tres columnas, `questions` para listas de preguntas con su momento de decisión,
`formats` para condiciones comerciales, `coverage` para datos y fuentes.

```json
"extra": [{"after": "cover_client", "slide": {"type": "factor_pricing", "title": "…", …}}]
```

**El fondo de una slide.** Cada slide de contenido lleva un fragmento del bloom, en otra esquina
que la anterior; las de precios, inversión y catálogo nunca lo reciben por la derecha, donde
taparía la columna de texto. Una slide puede fijar el suyo con `"bg": "frag-3.jpg"` (1 y 4 entran
por la derecha, 2 y 5 por abajo, 3 y 6 por la izquierda).

`compose.py` toma la receta, pone el copy canónico, encima las slides del cliente y las variables,
y pasa los filtros antes de guardar: sin em dash, sin `{{ }}` sin llenar, sin frases prohibidas.
Si algo falla, no construye y dice dónde. Avisa, sin bloquear, de los contrastes "no es X: es Y",
"X, no en Y" y "no X, sino Y": hay frases con "no" que sí van, así que las lee una persona. Los
precios no se validan, solo se cuentan los XXX: si la persona dio montos en el chat, el agente
los revisa a mano contra su fuente. Con Google Sans instalada (la skill la trae), el builder
mide cada texto con la fuente real para acomodar títulos y bloques. `preview.py` dibuja cada slide
con esa misma fuente y marca todo texto que no cabe en su caja. **El deck no se entrega con un desborde marcado, y no se
entrega sin mirar las hojas de contacto.**

## 6. El copy

`copy/es.json` y `copy/en.json` son el copy aprobado del equipo comercial, casi palabra por
palabra: el Commercial Overview, Productos y Precios 2026, las propuestas y los one-pagers más
recientes. Se limpió lo que delataba IA o descuido, nada más:

- typos ("Gambing", "Automatic", "Delivery the answers");
- em dash, y las comas que quedaron donde había uno;
- contrastes forzados ("no es un score, es…", "te vas con un scope, no con un pitch");
- la nota interna que se había colado en slides de cliente ("land & expand");
- índices y scores inventados.

Los estudios conservan su copy de venta, con el nombre comercial y sus dos beneficios. Ese copy
corto no cambia cómo se hacen los estudios: las metodologías siguen siendo las de
`packages/kb/01-methodologies/`. Para no contradecirlas, el copy comercial no dice cuántas
metodologías hay.

**Antes de entregar, el agente lee cada slide contra esta lista** (adaptada de
impeccable.style/slop y de `COPY_RULES.md`):

- [ ] Ninguna frase "no es X, es Y", "más que un…", "no se trata de…".
- [ ] Ninguna palabra de hype: revolucionar, potenciar, desbloquear, de clase mundial, sinergia.
- [ ] Cero em dash.
- [ ] Ninguna afirmación sobre lo que dice la gente (§4.1).
- [ ] Ningún número que no sea del copy canónico, de una fuente pública citada o del usuario.
- [ ] Ningún eyebrow: ninguna etiqueta encima de un título (ver abajo).
- [ ] Ningún nombre de herramienta (SentiOne, Brandwatch…) ni palabra de proceso interno.
- [ ] Un solo idioma por deck. En español, los anglicismos técnicos se quedan: dashboard, insight,
  share of voice, Social Listening, Scope of Work.
- [ ] Ningún nombre de otro cliente.
- [ ] Los precios solo en las slides de precio, y en XXX salvo que el usuario dé el monto.

### Títulos y eyebrows

Un título de una o cuatro palabras que resume la slide ("Lo que encontramos", "Una línea nueva, una
pregunta puntual") es el título que escribe una IA. Una persona hace otra cosa:

- **En una slide de research**, si hay un insight fuerte, evidente en los datos, va en el título.
  Solo entonces. En lo comercial no hay slides de research, así que este caso no aplica.
- **En una slide de presentación**, se pregunta primero si necesita título. Si lo necesita porque
  sin él no se entiende qué es, se pone **descriptivo y llano**: "Cómo empezamos", "Precios de
  reportes", "Dónde escuchamos". Si la slide se entiende sola, va **sin título**.
- **Los eyebrows no van.** Una etiqueta encima del título ("Qué hacemos", "Cobertura", "La
  propuesta") es ruido que delata un deck hecho en serie. El builder ya no los dibuja.
- Portada y cierre son la excepción: llevan la frase que abre o cierra la conversación, con una
  palabra en teal.

## 7. Presentar o mandar

Las dos versiones salen del mismo brief:

- **Mandar** (`"mode": "send"`): cada slide trae la línea que la explica, y cada pregunta su "por
  qué importa". Se entiende sin nadie al lado.
- **Presentar** (`"mode": "present"`): esas mismas líneas se van a las notas del orador. La slide
  queda limpia y el presentador tiene el guion.

## 8. Precios

- Las slides de precio son: `cooperations` (desde), `report_pricing`, `studies_pricing`,
  `year_plan`, `investment` y el one-pager. **En ninguna otra slide hay un monto.**
- Salen en **XXX** y se llenan en el editable. El agente no completa precios de memoria, de un
  deck anterior ni de otro cliente. Si la persona da los montos en el chat para ese deck, se usan.
- Moneda e impuestos por mercado: México en MXN + IVA, el resto en USD más impuestos, salvo que se
  pida otra cosa.
- Los montos vigentes viven en el Drive comercial (*Sales · Pricing*). Nunca en este repo, que es
  público.

## 9. La entrega

**A Drive, a la carpeta del lead.** Si la persona tiene conectado Google Drive en Claude, el
agente sube el PPTX (y el PDF) a la carpeta del cliente dentro de *Leads* en el Drive comercial: la
busca por nombre y, si no existe, la crea. El enlace a *Leads* lo inyecta `build_skill.py` al
empaquetar, porque este repo es público. Sin Drive conectado, entrega los archivos para descargar.

Desde el repo, en Claude Code, el conector de Drive no sirve para subir: manda el archivo en base64
dentro de la llamada y un PPTX de unos MB no cabe. Ahí el conector solo busca o crea la carpeta y
confirma que el archivo quedó; el archivo se sube por el navegador, con el botón de Drive, o por
Drive para escritorio. Un PPTX en Drive se abre en Slides sin convertirlo.

Con Claude in Chrome, el botón de subir abre el selector nativo del sistema, que no se puede
operar. Lo que funciona: parchar `HTMLInputElement.prototype.click` para capturar el
`input[type=file]` que crea Drive, disparar "Subir archivo" desde el menú "Nuevo", llenar ese input
con `file_upload` y restaurar el `click` al terminar. `file_upload` acepta hasta 10 MB por archivo.
Un PPTX que pasó por Slides trae Google Sans embebida en cuatro variantes (unos 2.5 MB): si el deck
no usa cursiva, quitar las dos cursivas es seguro, porque Slides tiene la fuente nativa.

**Animación.** Lo que se probó en Drive y Slides:
- Un **GIF** dentro del PPTX anima en el editor y en modo presentación, y viaja con el archivo.
- Un **MP4 embebido** en el PPTX llega como ícono de audio y Slides avisa que lo quitará.
- Un video **insertado desde Drive** dentro de Slides (Insertar, Video, Google Drive) sí queda y se
  reproduce, pero es un paso manual en Slides.
- El PDF que exporta Slides muestra solo el primer cuadro del GIF.

La receta que funcionó, nueve animaciones en 5 MB:
1. La animación en Remotion con los tokens del kit: Google Sans local y los íconos cortados de los
   sprites del kit, los mismos glifos que el PPTX.
2. Un MP4 de cada animación, de respaldo.
3. El GIF desde una secuencia PNG de Remotion (`--sequence`, cada dos cuadros, 15 fps), con paleta
   fija de 64 colores, sin dithering y con mapeo exacto en numpy, y después
   `gifsicle -O3 --lossy=30`. El codec GIF de Remotion pesa cinco veces más, porque el dithering
   cambia cada píxel entre cuadros; `quantize(palette=)` de Pillow manda el blanco a 252 y en la
   slide se ve una caja gris; y el ffmpeg que trae Remotion no tiene `fps`, `setpts` ni `palettegen`.
4. Cada GIF arranca en su cuadro completo, con la línea de tiempo rotada, para que el PDF muestre el
   diagrama terminado.

El agente entrega el PPTX y, si se pidió, el PDF, con tres cosas dichas en el chat:

1. Qué XXX quedan por llenar y en qué slides.
2. Si el logo del cliente quedó como recuadro, cómo reemplazarlo.
3. Cómo abrirlo en Google Slides: subir el PPTX a Drive y abrirlo con Google Slides, o en Slides,
   Archivo, Importar diapositivas.

**PDF.** El PDF exacto sale de Google Slides: Archivo, Descargar, PDF. Es el camino por defecto, y
después de llenar los XXX es el PDF que se manda. En el sandbox de Claude, `--pdf` exporta con
LibreOffice como vista previa. En una Mac no hay exportador automático: Keynote solo se intenta con
`NOISIA_PDF=keynote`, necesita Google Sans instalada en el sistema (la trae el kit, no la Mac) y en
un caso no abrió ningún PPTX por script. Si un exportador falla, el build dice cuál falló, no que
no existe.

**Nombre del archivo:** `Noisia_<Cliente>_<Entregable>_<ES|EN>_v1.pptx`. Una versión nueva no pisa
la anterior: sube el número.

## 10. Cuando David edita en Google Slides

Lo que se puede tocar sin romper la marca:

- Cualquier texto, duplicar y reordenar slides (los números se ajustan solos).
- El logo del cliente: clic derecho sobre el recuadro, Reemplazar imagen.
- Los precios XXX.

Lo que rompe la marca:

- Cambiar la fuente. Todo es Google Sans.
- Colores fuera de la paleta: tinta `#0a0a0a`, gris `#2b2b2b` y `#6d6d6d`, teal `#008a8a`, teal
  suave `#e6f7f7`, coral `#e2543c` y coral suave `#fdece8`, superficie `#fafafa`.
- Sombras, bordes de color a un lado de una card, cards negras, gradientes en barras.
- Íconos dibujados o de otra librería. Si falta uno, se pide.
- Poner el logo del cliente más grande que el de Noisia en una slide que no es la portada.

## 11. La frontera de una propuesta

Una propuesta puede enseñar cómo se verá el trabajo. No puede adelantar qué dirá.

| Se puede afirmar | No se puede afirmar |
|---|---|
| La pregunta que se va a responder | Qué piensa la audiencia antes de analizarla |
| Las fuentes que se buscarán | Cuál será el hallazgo principal |
| El periodo, los mercados y las marcas | Cuántas menciones útiles habrá |
| Los entregables, límites y etapas | Que una hipótesis ya está validada |
| La modalidad comercial aprobada | Que Noisia predice resultados |

Los ejemplos ilustrativos van rotulados como ilustrativos. Nada de verbatims de otro cliente, ni
benchmarks inventados, ni un índice de escucha vendido como indicador de gestión: un score de
conversación no es controlable por el cliente, y ya se descartó una vez (`DATA.md` §18.5).

## 12. Cómo crece esto

- **Copy:** se cambia en `copy/es.json` y `copy/en.json`, por PR. Las dos lenguas a la vez.
- **Una slide nueva:** un método en `builder/noisia_pptx.py`, su módulo en los dos copys, y la
  receta que la usa. Se revisa con `preview.py` antes del PR.
- **Íconos y marcas:** `builder/make_assets.py` los regenera desde Iconoir y Simple Icons, en un
  sprite por color con su índice. La skill de claude.ai acepta como máximo 200 archivos, así que
  nada va suelto: el builder recorta cada ícono del sprite al usarlo.
- **Formas:** `builder/make_shapes.py` genera la familia y las composiciones de portada, cierre,
  statement, fragmentos y one-pager (`--sheet` para verla, `--build` para escribirlas).
- **La skill:** `python3 build_skill.py` arma `dist/noisia-comercial.zip`. Se sube en claude.ai, en
  Organization settings, Skills (Team) o en Customize, Skills (cuenta personal). Cada cambio al
  kit comercial se vuelve a empaquetar y a subir.
- **Lo que aprende un deck comercial** va al caso, no al kit, igual que en el resto del kit
  (`AGENTS.md`, cuando una sesión aprende algo).

## 13. Briefs

Antes de un estudio o un reporte, el cliente llena un brief. Hay cuatro, en Google Docs con cajas
para escribir y casillas para marcar: estudio de marca, reporte de marca, estudio político y
reporte político. Viven en el Drive comercial (*Sales › Briefs Noisia (plantillas)*): se duplican
por cliente, nunca se llenan sobre la plantilla. Cada uno cierra con una sección *Lo completa
Noisia* que alimenta el prompt de arranque del estudio o del reporte (`PROMPTS.md`). Los políticos
traen los cuatro límites que se acuerdan desde el inicio. Se regeneran con `briefs/make_briefs.py`,
que explica también los pasos que se hacen en el navegador.

**Del brief al deck.** Un brief lleno es la mejor fuente para una propuesta o un overview: lo
escribió el cliente. Si la persona lo pega o lo sube, el agente lo usa así y no vuelve a
preguntar lo que ya está contestado:

| Del brief | Al deck |
|---|---|
| Empresa, marca, industria, mercados, idioma | `vars`, `lang` y la industria de `INDUSTRIES.md` |
| La pregunta de negocio, en una frase | Título de la portada y la pregunta de `understood` |
| ¿Qué decisión vas a tomar? · ¿Quién va a usar el resultado? | Las decisiones de `understood` |
| Momento de decisión (lanzar, entrar, defender, optimizar, innovar) | El estudio que se propone y su copy de catálogo |
| ¿Qué crees que está pasando? | Bloques de preguntas (`blocks`): cada hipótesis se vuelve una pregunta a medir, nunca una afirmación |
| Sujeto, competidores, periodo, fuentes | El alcance en `formats` y en `blocks` |
| Formato y quién va a estar en la presentación | Versión presentar o mandar, PPTX o PDF |
| Temas sensibles o confidenciales | Lo que no aparece en ninguna slide ni en las notas |
| En un reporte: tipo, cadencia, marcas y competidores | Los formatos de Social Listening y la base de factores para la inversión |

La sección *Lo completa Noisia* del brief es interna: alimenta el estudio, no el deck.

## 14. Decisiones abiertas

Quedan para el equipo comercial. Mientras no se decidan, el copy hace lo que dice la columna de
la derecha.

| Decisión | Hoy |
|---|---|
| ¿El primer estudio se regala? | Solo el workshop y el Scope of Work son gratis |
| ¿Primero estudio o primero monitoreo, después del workshop? | La primera entrega es cualquiera de los dos |
| ¿Un tema cuenta como factor? | Factor es marca, producto, servicio, influencer o persona de interés |
| ¿Un correo por idioma? | El de quien firma, que la entrevista pregunta |
| ¿Se queda el tercer tipo de cooperación (audiencias y tendencias)? | Sí, en el opener |
| Tiempo de entrega por defecto | 3 a 5 días hábiles después del workshop |
| Tiempo de entrega de un estudio en Credenciales | **Decidido (nov 2026): 72 horas** en los dos modos. Los reportes conservan su cadencia (mensual, alertas en 24 h) |
| Cuántos países e idiomas se dicen en Credenciales | El deck dice "especialistas locales" sin número hasta que haya una cifra aprobada |
| ¿Un índice diseñado y acordado con el cliente puede ir en su propuesta? Se pidió para un cliente con NPS y el equipo dice que va a pasar seguido | Excepción del caso, autorizada en el chat. §11 sigue igual: ningún índice de escucha como indicador genérico de Noisia, ni en decks de otros clientes |
| ¿Los resultados de un piloto ya entregado al mismo cliente pueden abrir su propuesta? La razón de §4.1, "no los hemos leído", no aplica | Excepción del caso, autorizada en el chat, con el entregable y la fecha en las notas. Nunca en el deck de otro cliente |

## 15. Outbound SDR: Drive → mensajes por lead → Instantly

**Este es el procedimiento canónico de preparación, no una autorización para enviar.**
La familia comercial también incluye los correos SDR. Sus mensajes aprobados viven en Drive;
Instantly conserva el estado de cada lead y ejecuta el journey; este repo público conserva
el método y los patrones reutilizables. No copiar aquí listas, mensajes reales, correos,
IDs de campañas, enlaces privados de Drive, capturas, credenciales ni cifras de un caso.

El diseño toma los tokens y el shell de `../NOTIFICATIONS.md`, **no** sus reglas de envío:
no lleva etiquetas API, estados operativos ni pie de notificación automática. La regla CID de
Data API no se traslada a Instantly: aquí se probaron assets públicos HTTPS. El texto comercial
sigue viniendo de la fuente aprobada, no se inventa al maquetar.

### 15.1 Dónde guardar cada cosa

- **Reglas, límites y prompt reutilizable:** esta sección. Cambios al procedimiento se integran
  aquí, no en un nuevo handoff que compita con el canon.
- **Evidencia de una ejecución:** carpeta privada de trabajo del grupo. Guardar un manifiesto,
  snapshots previos, conciliación, diferencias, HTML exacto aprobado y pruebas. No subirlos a git.
- **Fuente:** archivo original vigente del grupo en el Drive comercial compartido por el dueño.
  Buscarlo por nombre y confirmar su ID y carpeta, no elegir una descarga por fecha de archivo.
  Los enlaces internos se suministran en privado como en §9; no están publicados en este repo.
- **Índice privado de fuentes:** registrar carpeta/archivo/hoja, versión o modifiedTime,
  fecha UTC de lectura, encabezados y hash del contenido leído. Si el archivo cambia durante
  la conciliación, releer y reconciliar antes de escribir. No modificar el original.
- **Plantilla:** conservar el HTML exacto aprobado en la carpeta privada. Este runbook explica
  cómo reutilizarlo; no sustituirlo con un diseño reconstruido de memoria.

### 15.2 Preflight y permisos

1. Leer las instrucciones del repo y confirmar el workspace de Instantly, ID de campaña,
   grupo, estado y cuenta remitente. Verificar que no hay otro operador escribiendo lo mismo.
2. Leer todas las páginas de leads y todos los pasos/variantes. Guardar snapshot de IDs,
   email, campos, estado y progreso; asunto y HTML de cada paso; delays, threading, sender,
   firma y ajustes HTML/text-only. El snapshot queda privado y permite restaurar campos.
3. Separar lo autorizado: investigar, editar un borrador concreto, actualizar leads existentes,
   importar nuevos, editar una firma persistente, enviar pruebas y activar campaña son acciones
   diferentes. Preparar mensajes no autoriza activar ni enviar a prospectos.
4. Una firma de cuenta afecta futuros correos de esa cuenta: confirmar cuenta y cambio concreto
   con su responsable antes de modificarla. No generalizar autorización de una cuenta a otras.
5. Si una campaña ya envía o sus leads avanzaron, detener cambios masivos y acordar alcance.
   No pausar, borrar, reiniciar ni cambiar estatus por inferencia.
6. No cambiar remitente, límites, horario, tracking, ajustes globales, permisos ni credenciales
   como efecto secundario. El equipo decide la cuenta desde la que saldrá el journey.

### 15.3 Leer y conciliar la fuente completa

La columna final usada en el flujo es **`Mensaje (datos Noisia)`**. Una columna antigua
`mensaje` puede seguir vacía o contener copy obsoleto. No sustituir la columna final por ella.
Un contador de Resumen puede apuntar todavía a la columna antigua: verificar su fórmula antes
de concluir que no hay mensajes. No corregir fórmulas, comentarios o formatos sin encargo.

- Leer filas completas y encabezados reales, incluidas variantes antiguas. Contar filas,
  mensajes finales no vacíos y contactos únicos por separado. Una fila no equivale a un lead.
- Identidad primaria: email, con espacios exteriores removidos y comparación normalizada.
  No quitar puntos, sufijos `+` ni fusionar por nombre/empresa. Conservar el email original.
- Clasificar: coincidencia uno-a-uno, solo fuente, solo campaña, duplicado/ambiguo y mensaje
  ausente. No importar, borrar ni elegir entre variantes automáticamente.
- En coincidencias, comparar la versión final íntegra con los campos actuales. Mantener
  cambios humanos divergentes hasta reconciliarlos. Guardar diferencias por lead en privado.
- Los asuntos se validan **aparte**: varias opciones separadas por `|` no son un asunto final;
  `(sin mensaje)` no lo es. No inferir asunto a partir del cuerpo ni elegir opción por posición.
- Un link mencionado en el copy sin URL es pendiente, no una invitación a inventar un enlace.

### 15.4 Contrato de campos y variables

Escala con **una plantilla por paso y datos por lead**, no con una variante por persona.
Los nombres siguientes son el mapeo probado; confirmar los campos existentes de cada campaña.

| Capa | Función |
|---|---|
| Fuente `Mensaje (datos Noisia)` | Texto final aprobado, sin reescrituras |
| Campo de referencia `Correo personalizada` | Copia exacta del texto final para conciliación |
| Campo `Personalization` | Versión de presentación: texto escapado en párrafos HTML |
| Variable `{{personalization}}` | Inserta esa versión en el cuerpo del paso personalizado |
| Variable `{{accountSignature}}` | Inserta la firma de la cuenta remitente seleccionada |
| Asunto personalizado | Solo cargar cuando exista un asunto final aprobado y mapeado |

**Insertar variables desde el selector de Instantly.** El encabezado visible no determina
el token: derivar `{{correo_personalizada}}` de una etiqueta falló porque esa variable no existía.
No dar por hecho que cada campaña tenga los mismos campos. Comprobar que el selector los reconoce.

Transformación controlada: preservar el original exacto; escapar `&`, `<`, `>`, comillas y
apóstrofos como texto, después envolver párrafos en etiquetas con estilos inline. No ejecutar
HTML procedente de una celda ni hacer doble escape. Preservar acentos, signos y párrafos.
Solo retirar un cierre personal duplicado si se aprobó usar la firma de cuenta; registrar esa
única diferencia. No cambiar claims, cifras, CTA ni identidad del autor silenciosamente.
Una firma dinámica no corrige un cuerpo que se presenta como otra persona: detener esa contradicción.

### 15.5 Escribir sin perder progreso

**Reimportar los mismos emails no es un upsert:** Instantly omite duplicados y no sobrescribe
sus variables. **No borrar y reimportar** para forzar cambios: puede reiniciar al lead en Step 1.

- Leads existentes: editar sus campos en detalle, o usar una API soportada cuyo alcance,
  permisos y semántica se hayan comprobado. No prometer actualización masiva si la tool no la tiene.
- Antes de cada cambio, releer el lead y comparar con el snapshot. Si hay una diferencia nueva,
  detener ese lead y conciliar; continuar únicamente los independientes.
- Guardar, recargar y comprobar cada campo actualizado. Mantener checkpoint privado con ID,
  hash previo/esperado/leído y resultado. No repetir una escritura de resultado incierto sin leer.
- Con muchos leads, trabajar en lotes verificables. Al reanudar, saltar los ya confirmados.
  La segunda corrida sin diferencia debe realizar **cero escrituras**.
- Nuevos leads: solo con autorización de importación del grupo. CSV UTF-8, Email obligatorio,
  encabezados únicos de máximo 20 caracteres y máximo 50 variables por upload. Revisar mapping
  antes de confirmar. No activar Verify Leads ni gastar créditos por inferencia.

El conector y el navegador tienen límites distintos. Usar acciones documentadas disponibles;
si el usuario dejó una sesión en Chrome, verificar esa sesión y campaña, no un navegador cloud
sin el mismo acceso. No extraer tokens, usar APIs privadas ni eludir una denegación de permisos.
Una vista truncada no prueba haber revisado todos los leads: paginar hasta terminar.

### 15.6 Los tres pasos del journey

1. Guardar el contenido original de cada paso y variante, su asunto, delay y variables.
2. Aplicar el shell aprobado a cada paso. El primero puede usar `{{personalization}}`;
   los demás conservan su texto y variables existentes salvo cambios aprobados en la fuente.
3. Colocar una sola firma por paso, preferentemente `{{accountSignature}}` cuando la firma
   de cuenta funcione. No combinarla con otra firma embebida ni un nombre duplicado.
4. Preservar delays y comportamiento de respuesta. No convertir los delays de un caso en
   una cadencia universal. Revisar todos los pasos, no solo el primer correo.
5. Dejar asuntos o links sin evidencia como bloqueos explícitos. Un cuerpo configurado no
   significa que la campaña esté lista para activar.
6. Guardar en Code view (`<>`), volver a la vista visual, recargar y releer el HTML persistido.
   Seleccionar un lead real y una cuenta concreta en Preview para comprobar la resolución.

### 15.7 HTML, firma, fuente y responsive

Conservar el shell aprobado: fondo exterior `#f4f4f4`, tarjeta blanca, logo de Noisia,
texto y separaciones legibles, tablas de presentación y estilos inline. No añadir contenido
operativo de las plantillas de notificaciones. El correo debe seguir siendo entendible si el
cliente bloquea imágenes. Evitar diseños pesados o convertir el texto a imagen.

- Fuente preferida inline en cuerpo, títulos, labels y firma:
  `font-family:'Google Sans',Roboto,Arial,Helvetica,sans-serif;`.
  Google Sans tiene licencia OFL, pero disponibilidad/licencia no equivale a soporte de webfonts
  en email. Gmail/Outlook pueden usar fallback. No garantizar Google Sans real en todos los clientes.
- **Un solo atributo `style` por elemento.** Al añadir font-family, fusionar propiedades,
  no añadir otro `style`. Un atributo duplicado hizo que desapareciera el fondo gris: fue un bug,
  no una decisión de diseño. Revisar sintaxis además del aspecto visual.
- Assets con URL HTTPS pública estable, alt, dimensiones y escala adecuadas. No `blob:`,
  rutas locales, data URLs enormes ni CID sin adjunto correspondiente. No pegar una captura de firma.
- Editar firma por Code view si el editor visual altera imágenes/links. Se observó que copiar
  una firma por la vista visual generó `blob:` y perdió `href`; comprobar HTML guardado y recibido.
- Firma y cuerpo fluidos, sin tabla rígida de 660 px que fuerce scroll móvil. Usar estructura
  que pueda envolver columnas con estilos inline, y probar widths pequeños y nombres largos.
  No asumir que media queries sobrevivirán al editor y al cliente.
- Preferir firma dinámica reparada. Si no se puede resolver, firma embebida aprobada como fallback,
  sin duplicación, vinculada al remitente correcto. No extender una firma personal a todas las cuentas.
- Respaldar la firma previa antes de editarla y verificarla recargando su configuración.

Revisar tres filtros que pueden quitar HTML: text-only para toda la campaña, text-only del
primer email y text-only del primer email a nivel workspace. El ajuste global puede prevalecer.
Inspeccionar no autoriza cambiarlos. Clean HTML no significa lo mismo que text-only y puede
alterar una maquetación: no aplicarlo ciegamente sobre la versión aprobada.

### 15.8 Pruebas: cuatro cosas distintas

| Paso | Qué prueba | Qué no prueba |
|---|---|---|
| Lectura posterior | Datos y HTML quedaron guardados | Apariencia en el inbox |
| Preview con lead + sender | Variables/firma se resuelven | Que un override se guardó en el lead |
| Send test autorizado | Composición y envío de una prueba | Lanzamiento ni entrega a todos los leads |
| Recepción/MIME/cliente | Lo recibido y render probado | Compatibilidad universal o inbox futuro |

Los overrides en Preview **no persisten**. Send test envía inmediatamente a **todos** los
destinatarios listados: revisar y dejar únicamente las direcciones autorizadas en esa prueba.
No usar un prospecto para probar. Un toast de envío no demuestra recepción; comprobar ambas cosas.

Checklist antes de entregar al responsable:
- [ ] Toda la población conciliada y paginada, sin faltantes ocultos; excepciones separadas.
- [ ] Relectura de **todos** los leads modificados contra la fuente, no solo una muestra.
- [ ] Los tres pasos/variantes persistidos, asuntos y links aprobados o bloqueo declarado.
- [ ] Ninguna variable vacía, inválida o literal, ni etiquetas HTML visibles en el mensaje.
- [ ] Remitente y texto coherentes, exactamente una firma; no `blob:` ni links sin `href`.
- [ ] Sin atributos `style` duplicados; fondo, logo, cuerpo y firma conservados.
- [ ] Preview con texto corto/largo, signos y caracteres especiales; no solo la celda más fácil.
- [ ] Prueba recibida en los clientes disponibles: desktop y móvil; documentar qué no se probó.
- [ ] Si se inspecciona MIME: imágenes/links estables y resultado de autenticación observado.
- [ ] Estado/progreso, sender, delays, límites y número de envíos sin cambios no autorizados.
- [ ] Diferenciar configurado, probado, bloqueado y listo para revisión. No decir “lanzado”.

**Deliverability:** Instantly recomienda reducir HTML/media en cold email. Una imagen no implica
spam automáticamente. Reputación, autenticación, volumen, rebotes y quejas también importan.
SPF/DKIM/DMARC pass, un score de la tool o una prueba en Inbox no garantizan entregabilidad.
No alterar campañas ni lanzar experimentos de volumen como parte de una prueba visual.

### 15.9 Cierre, reversión y límites conocidos

Entregar al responsable conteos y diferencias, campos/steps cambiados, pruebas y límites,
source-only/campaign-only pendientes, asuntos/URLs faltantes y decisión de remitente. No enviar
ese informe a terceros por inferencia. El dueño decide cuándo activar.

Si hay un problema, restaurar solo campos/HTML de esta ejecución desde el snapshot, tras releer
para evitar pisar cambios nuevos. No “rollback” borrando leads o reiniciando la campaña. Un envío
real no se deshace con un rollback; escalar el incidente sin repetirlo.

Aprendizajes observados al preparar journeys: la fuente puede tener variantes antiguas y más
contactos que la campaña; el cuerpo final puede estar completo mientras el asunto está vacío;
las variables de Preview no actualizan leads; la firma de sistema puede romperse aunque la firma
embebida se vea bien. Los conteos y decisiones concretos pertenecen al registro privado, no son
valores por defecto para el siguiente grupo. La cobertura de un cliente de correo no es universal.

### 15.10 Prompt para el agente del equipo

Completar los campos entre corchetes en privado. Sin campaña/fuente verificadas, investigar y
pedir solo lo imprescindible; no inventarlas. Este prompt prepara borradores, no autoriza envíos.

```text
Trabaja con noisia-ai/monorepo. Lee AGENTS.md, packages/pitch-kit/AGENTS.md,
CANON.md y packages/pitch-kit/commercial/COMMERCIAL.md §15 antes de actuar.

Grupo: [GRUPO]. Archivo/carpeta Drive original: [URL PRIVADA].
Campaña exacta Instantly: [URL/ID PRIVADO]. Plantilla HTML aprobada: [UBICACIÓN PRIVADA].
Alcance: conciliar y actualizar mensajes de los leads EXISTENTES y los tres pasos en borrador.
No activar, lanzar ni mandar a prospectos. No añadir ni borrar leads. No cambiar remitente,
firmas de cuenta, límites, horarios o ajustes globales sin autorización específica.
Pruebas: [NO AUTORIZADAS / DIRECCIONES CONCRETAS Y ALCANCE AUTORIZADO].

Lee la última versión completa de Drive y toda la campaña paginada. Usa Mensaje (datos Noisia)
si ese es el encabezado final confirmado. No alteres el archivo, comentarios ni formatos.
Haz snapshot privado y concilia uno-a-uno por email, no nombre. Separa coincidencias,
source-only, campaign-only, duplicados y mensajes/asuntos faltantes. Preserva cambios humanos.

Conserva texto final exacto como referencia. Genera el HTML de presentación escapando texto,
preserva copy y registra cualquier cierre duplicado retirado. Usa el HTML aprobado, no rediseñes.
Inserta variables desde el selector: valida personalization y accountSignature en esta campaña.
Conserva texto/variables/asuntos/delays de pasos siguientes salvo cambios explícitos de la fuente.
La firma debe corresponder a la cuenta que el responsable elija. Si hay contradicción, señálala.

Actualiza campos existentes sin borrar/reimportar. Relee antes y después de cada escritura;
checkpoint por lead para reanudar sin duplicar. No uses Preview overrides como datos persistidos.
No ejecutes APIs privadas ni extraigas tokens para superar limitaciones de la tool.

Verifica todos los datos guardados, HTML de los tres pasos y Preview con lead y sender.
Revisa fondo gris, Google Sans con fallbacks, HTTPS, href, firma única, responsive y style único.
Pruebas solo dentro del alcance dado y a todas las direcciones revisadas; verifica recepción.
No inventes asunto final, link del post ni compatibilidad móvil/Outlook no probada.

Entrega un reporte privado de cambios, conteos, fuentes/versiones, pruebas, límites y pendientes.
Una segunda pasada sin diferencias no debe escribir nada. Mantén la campaña sin activar.
No publiques PII, mensajes reales, IDs/URLs privados ni credenciales en el repo.
```

### 15.11 Referencias operativas

Documentación consultada el 13 de noviembre de 2026; releer si cambia la UI o el comportamiento:

- [HTML en campañas](https://help.instantly.ai/en/articles/7911973-html-in-campaign-email)
- [Editor](https://help.instantly.ai/en/articles/11967303-getting-started-with-editor-section)
- [Variables](https://help.instantly.ai/en/articles/6135930-how-to-add-and-use-variables-in-campaigns)
- [Importar CSV](https://help.instantly.ai/en/articles/6254215-how-to-add-leads-to-your-campaign-from-a-csv-file)
- [Duplicados y variables](https://help.instantly.ai/en/articles/13631826-why-are-variables-not-showing-up)
- [Actualizar lead](https://help.instantly.ai/en/articles/6762327-update-lead-data-and-lead-status)
- [Preview y test](https://help.instantly.ai/en/articles/7002900-preview-and-send-test-emails)
- [Firmas](https://help.instantly.ai/en/articles/8278149-how-to-add-email-signatures)
- [Clean HTML](https://help.instantly.ai/en/articles/6525904-clean-html-features)
- [Deliverability](https://help.instantly.ai/en/articles/16034903-deliverability-guide)
- [CSS soportado por Gmail](https://developers.google.com/workspace/gmail/design/css)
- [Google Sans y licencia](https://github.com/googlefonts/googlesans)
