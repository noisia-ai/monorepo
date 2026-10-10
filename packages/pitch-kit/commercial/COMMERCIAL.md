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

La receta visual es la misma de los estudios aprobados: lienzo blanco con una atmósfera cyan y
roja muy tenue por slide, cada una en otra esquina; los fondos fuertes del website en portada,
statements y cierre; cards `#fafafa` con borde `#eeeeee` y radio 16; eyebrow teal con ícono real;
una palabra en teal por título; sin sombras, sin bordes laterales, sin gradientes en un valor.

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
8. **Logo del cliente.** Que lo suba al chat como imagen. Si no, sale el recuadro para
   reemplazarlo.
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
- [ ] Ninguna etiqueta encima del título que repita el título.
- [ ] Ningún nombre de herramienta (SentiOne, Brandwatch…) ni palabra de proceso interno.
- [ ] Un solo idioma por deck. En español, los anglicismos técnicos se quedan: dashboard, insight,
  share of voice, Social Listening, Scope of Work.
- [ ] Ningún nombre de otro cliente.
- [ ] Los precios solo en las slides de precio, y en XXX salvo que el usuario dé el monto.

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
- **Íconos y fondos:** `builder/make_assets.py` los regenera desde Iconoir y Simple Icons. Los PNG
  se suben al repo.
- **La skill:** `python3 build_skill.py` arma `dist/noisia-comercial.zip`. Se sube en claude.ai, en
  Organization settings, Skills (Team) o en Customize, Skills (cuenta personal). Cada cambio al
  kit comercial se vuelve a empaquetar y a subir.
- **Lo que aprende un deck comercial** va al caso, no al kit, igual que en el resto del kit
  (`AGENTS.md`, cuando una sesión aprende algo).

## 13. Decisiones abiertas

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
