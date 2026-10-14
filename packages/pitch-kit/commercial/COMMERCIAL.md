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
| **Oferta comercial** | Piden precios. El catálogo con las slides de precio, en XXX | 10 a 11 |
| **Propuesta** | Después del workshop. Lo que entendimos, qué proponemos, cuánto cuesta y qué no incluye | 7 a 9 |
| **One-pager** | Una página A4 para correo o WhatsApp: oferta o piloto | 1 |

Las secuencias exactas están en `recipes.json`. Cada entregable sale en **español o inglés**, en
**versión para presentar o para mandar** (§7), y en **PPTX editable, PDF o los dos**.

El deck de metodologías no es un entregable aparte: el catálogo de estudios va dentro del opener y
de la oferta.

## 3. La entrevista

Antes de construir, el agente pregunta. Una pregunta a la vez, corta, con opciones. Nunca asume:
cada respuesta cambia el deck.

0. **¿Ya hay un brief lleno?** Si la persona tiene uno de los briefs de §13 contestado, que lo
   pegue o lo suba. El agente lo usa como fuente (§13) y solo pregunta lo que falte.
1. **¿Qué necesitas?** Los seis entregables de §2, con su "cuándo" en una línea. Si no sabe,
   lo ayuda a elegir con esa columna.
2. **¿En qué idioma?** Español o inglés.
3. **¿Para presentar o para mandar?** Presentar: poco texto, el guion en las notas. Mandar: cada
   slide se entiende sola.
4. **¿En qué formato?** PPTX editable para Google Slides, PDF, o los dos.
5. **¿Para quién?** Marca, industria y mercado. Si es un opener o un overview, el agente investiga
   la marca (§4.2).
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

Para el opener y el overview, el agente busca a la marca en fuentes públicas: su sitio, sus
comunicados, prensa de los últimos doce meses. Busca hechos que abran preguntas: una apertura, un
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

`compose.py` toma la receta, pone el copy canónico, encima las slides del cliente y las variables,
y pasa los filtros antes de guardar: sin em dash, sin `{{ }}` sin llenar, sin frases prohibidas.
Si algo falla, no construye y dice dónde. Con Google Sans instalada (la skill la trae), el builder
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

El agente entrega el PPTX y, si se pidió, el PDF, con tres cosas dichas en el chat:

1. Qué XXX quedan por llenar y en qué slides.
2. Si el logo del cliente quedó como recuadro, cómo reemplazarlo.
3. Cómo abrirlo en Google Slides: subir el PPTX a Drive y abrirlo con Google Slides, o en Slides,
   Archivo, Importar diapositivas.

**PDF.** En el sandbox de Claude se exporta con LibreOffice. Si la fuente no se ve bien en ese PDF,
el PDF exacto sale de Google Slides: Archivo, Descargar, PDF. Después de llenar los XXX, ese es
el PDF que se manda.

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
