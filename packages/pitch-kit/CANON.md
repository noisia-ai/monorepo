# Canon Noisia · el contrato del sistema de entregables

> Este es el punto de entrada. Si vas a construir un reporte, un estudio, una muestra, una
> propuesta o una presentación de producto, empieza aquí y sigue los punteros. Ningún documento
> de este kit repite lo que dice otro: cada uno manda sobre su capa y los demás lo citan.

## 1. Qué reemplaza este canon

Antes de esto, el método vivía en cinco documentos sueltos que se pisaban entre ellos, cada uno
con su copia parcial de las mismas reglas. Todos quedan absorbidos aquí:

| Documento original | Dónde vivía | Qué aportaba | Dónde vive ahora |
|---|---|---|---|
| Handoff de estudio genérico | carpeta de descargas | Prompt de arranque de un Estudio T&B | `PROMPTS.md` |
| Handoff de estudio político | carpeta de descargas | El mismo prompt con vocabulario político | `PROMPTS.md`, como registro del sujeto |
| Handoff de procesamiento de menciones | carpeta de un estudio | El pipeline de datos completo, gates y contratos de salida | `DATA.md` |
| Handoff maestro de propuestas | carpeta de propuestas | La familia propuesta, que no existía en el kit | `PROPOSALS.md` |
| Spec de producto Study to Deck | repo de website | La versión productizada del mismo pipeline | Sigue en su repo. Este canon es su contrato de contenido |

Regla de higiene: **un handoff nuevo no se escribe.** Si aprendiste algo reutilizable, entra al
rulebook que le toca y se cita desde aquí. Un documento suelto más es deuda, no memoria.

## 2. Jerarquía de fuentes

Hay tres autoridades y no se pisan.

**`packages/kb/` manda sobre el contenido**: qué es Noisia, cómo se posiciona, cómo se ejecuta cada
metodología, la lógica de pricing sin montos, y **el catálogo de productos**, que vive en
`02-services/product-model.md` porque el producto y el pitch tienen que decir lo mismo.

**La KB comercial manda sobre la venta, y vive fuera de este repo**, en Drive. Ahí están las fichas
completas de cada producto, qué recibe el cliente cada periodo, qué no incluye, los montos reales,
el guion de venta y las notas de cliente. Esa frontera es deliberada y está declarada en
`packages/kb/README.md`: **el repo es público, así que nombre de cliente, monto real o estrategia
comercial no pasan por aquí.** Si una propuesta necesita el detalle de una ficha, se pide, no se
inventa y no se copia al repo.

**Este kit manda sobre el entregable**: qué familia es, cómo se estructura, cómo se escribe y cómo
se construye. Si un documento de aquí contradice a la KB en materia de producto, gana la KB y hay
que corregir aquí.

Dentro del kit, cuando dos documentos se contradigan gana el de arriba:

1. La instrucción vigente del usuario y el brief confirmado con el cliente.
2. `packages/kb/` para todo lo comercial y de producto.
3. Este canon.
4. Los rulebooks: `LAYOUTS.md`, `COPY_RULES.md`, `ICONS.md`, `METHODOLOGY.md`, `DATA.md`, `PROPOSALS.md`.
5. `slides/recipes.json` y `slides/catalog.json`.
6. El engine (`engine/`) y los assets (`assets/`).
7. Los decks ya entregados, como referencia de acabado.

Un deck entregado enseña forma, densidad y ritmo. **No manda sobre una regla** y no autoriza
reusar contenido de otro cliente.

## 3. Las cinco familias de entregable

Antes de la tabla, la distinción que evita el malentendido más caro: **lo que Noisia vende son
Reportes y Estudios.** El catálogo comercial, R1 a R3 y E1 a E5, vive en
`packages/kb/02-services/product-model.md` y manda sobre cualquier cosa que se escriba aquí.

Las cinco familias de abajo son **artefactos, no productos**. Una muestra es una pieza comercial
recortada de un estudio, no algo que se cotiza aparte. Una propuesta es cómo se acuerda el trabajo
antes de que exista. El bloque de producto solo explica a la compañía. Ninguna de esas tres se
vende por sí sola, y ninguna se presenta al cliente como si fuera una línea de servicio.

Dos cosas más que la KB declara y que aquí no se reabren. **Data existe como línea, pero está
marcada como exploratoria y sin precio**, así que no se pitchea como si estuviera lista ni aparece
como tercera columna en una slide. Se menciona como capacidad solo cuando el brief la pide y
Noisia confirma que puede entregarla. Y **Foundation, Intelligence y Strategy son calibración
interna de profundidad**, nunca la historia comercial: no van en una slide. La escalera visible es
workshop, reporte, estudio y estudios recurrentes.

Dicho eso, no son cinco plantillas. Son cinco preguntas distintas, y confundirlas es el otro error
caro.

| Familia | Pregunta que responde | Arranca de | Largo típico | Secuencia canónica |
|---|---|---|---|---|
| **Reporte** | Qué está pasando y qué cambió contra el periodo anterior | Un tablero y un periodo | 9 a 10 slides | `LAYOUTS.md` |
| **Estudio** | Por qué la gente se acerca o se aleja, y dónde se puede actuar | Una pregunta de investigación | 14 a 18 slides | `LAYOUTS.md` |
| **Muestra** | Qué tan buena es la lectura de Noisia, con alcance recortado | Una pregunta corta y un corpus acotado | 10 a 14 slides | `LAYOUTS.md`, variante de Estudio |
| **Propuesta** | Qué haremos, para qué decisión, con qué alcance y qué recibe el cliente | Un discovery | 10 a 14 slides | `PROPOSALS.md` |
| **Producto** | Qué es Noisia y dónde entra | Nada, es institucional | 14 a 15 slides | `PROPOSALS.md`, bloque de producto |

Dos fronteras que no se cruzan:

- **Reporte no es Estudio.** El reporte parte del dato y describe el periodo. El estudio parte de
  una pregunta y responde por qué. Un reporte con una tesis inventada es un estudio mal hecho.
- **Propuesta no adelanta hallazgos.** Puede enseñar la forma de la entrega y el nivel de
  evidencia. No puede decir qué va a encontrar. Ver `PROPOSALS.md`, regla de frontera.

Cada familia **se delimita a sí misma en sus glosarios**, con el vocabulario del cliente y no con
el nuestro. Ahí se declara qué se midió, contra qué se compara y hasta dónde llega la lectura. No
es anexo decorativo, es el contrato de alcance del entregable, y es lo que permite que dos decks
de meses distintos sigan siendo comparables. Los bloques exactos de cada familia están en
`LAYOUTS.md`.

## 4. Mapa de lectura

Lee solo lo que tu entregable necesita:

| Capa | Archivo | Manda sobre |
|---|---|---|
| Contrato del sistema | `CANON.md` | Familias, jerarquía, dónde vive cada cosa, definition of done |
| Estructura | `LAYOUTS.md` | Secuencia de slides, qué componente usa cada una, portada y slide de método |
| Palabras | `COPY_RULES.md` | Cada palabra que se ve en una slide |
| Glifos | `ICONS.md` | Iconos, logos de plataforma, assets del mapa |
| Criterio | `METHODOLOGY.md` | Qué se puede afirmar y con qué fuerza |
| Ejecución de datos | `DATA.md` | Inventario, ETL, gates de calidad, contratos de salida |
| Comercial | `PROPOSALS.md` | Propuestas, alcance, entregables, lo que no incluye |
| Arranque | `PROMPTS.md` | El prompt con el que empieza cualquier corrida |
| Registro | `templates/` | Procedencia, changelog y guion por slide |
| Contenido y catálogo | `packages/kb/` | Qué es Noisia, las metodologías, el catálogo de productos, pricing sin montos |
| Venta y fichas completas | KB comercial, en Drive | Qué recibe el cliente, qué no incluye, montos, guion. Fuera del repo a propósito |

## 5. Reglas duras transversales

Estas se verificaron contra los decks entregados. Donde el kit y la práctica no coincidían, aquí
queda la decisión.

### 5.1 El engine no se forkea

`noisia-tokens.css`, `deck.css`, `deck-components.css` y `deck-stage.js` se copian tal cual desde
`engine/`. Se verificó: en los decks entregados estos archivos son idénticos byte a byte. Esa
disciplina se mantiene.

Lo que sí se rompió: **casi ningún deck enlaza `deck-components.css`** y en su lugar carga entre
70 y 145 líneas de `<style>` inline que duplican exactamente ese archivo. A partir de aquí:

- Se enlazan los cuatro archivos del engine, en este orden: tokens, deck, components.
- El bloque `<style>` del deck queda solo para lo específico de ese deck, y no redefine una clase
  que ya exista en `deck-components.css`.
- Si una clase de tu bloque inline aparece en un segundo deck, deja de ser específica. Súbela al
  engine con el ciclo de contribución de `AGENTS.md`.

### 5.2 Copy

- **Cero em dash.** No es una preferencia estilística, es una huella de IA que el lector detecta.
  Se verifica antes de entregar, incluido el `<title>`:
  `grep -c '—' index.html` tiene que dar `0`.
- **Footer izquierdo:** `noisia · social intelligence architects`, exactamente así.
- **Header derecho:** la marca `noisia.ai`, o una etiqueta corta de sección, o el mercado y el
  año. Nunca el propósito de la slide ni la misma frase del eyebrow o del título. Una sola
  convención por deck, elegida en la portada y sostenida hasta el cierre.
- El resto vive en `COPY_RULES.md` y no se repite aquí.

### 5.3 Números ante el cliente

Los conteos crudos y los porcentajes no son intercambiables, y la elección depende de la audiencia:

| Audiencia | Qué se muestra |
|---|---|
| Cliente final, C-level, freebie o muestra | Participación sobre la conversación depurada. Nada de conteos crudos de menciones |
| Agencia, partner o equipo que ya trabaja el marco | Conteos y participación, con el denominador visible |
| Slide de método y anexo, en cualquier audiencia | El volumen total sí se dice, porque ahí se está explicando el alcance |

Nunca se suman etiquetas que se traslapan, y todo conteo declara su denominador. El criterio
completo está en `METHODOLOGY.md`, la ejecución en `DATA.md`.

### 5.4 Assets

Un solo archivo por asset, con un solo nombre. Se encontraron tres nombres distintos para el mismo
mapa y tres para la misma ilustración de portada, todos idénticos byte a byte. Los nombres
canónicos son:

- `assets/tb-map.png`, el diagrama de anillos concéntricos.
- `assets/cover-illustration.png`, la ilustración de portada.
- `assets/logo_norm.svg`, el logotipo.

El mapa se usa tal como viene, con su anillo interior en inglés, en cualquier idioma de deck. No
se le pone nada encima. Ver `ICONS.md`.

### 5.5 Verbatims

Reales, con liga al post, plataforma y fecha visibles. Sin corregir ortografía ni tono. Si no se
puede verificar en su fuente, no entra. Sin excepción y en cualquier familia.

## 6. Ciclo de vida de un entregable

```text
brief y alcance  →  datos (DATA.md)  →  hallazgos y verbatims  →  deck (LAYOUTS + COPY + ICONS)
      →  render slide por slide  →  PDF  →  procedencia y changelog
```

Advisor antes que constructor. Se cierra el alcance, se corre el ETL una vez sobre lo correcto, y
hasta entonces se abre el HTML. **No se construyen slides antes de que el corpus pase sus gates.**

El render slide por slide no es opcional. Un deck revisado solo en código llega con overflow,
iconos rotos y texto cortado.

```bash
# una slide, para revisarla a tamaño real
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --force-device-scale-factor=1 --window-size=1920,1080 \
  --screenshot=out.png "file://$PWD/index.html#3"

# el PDF
node builders/build-pdf.mjs <deck>/index.html <deck>/salida.pdf

# un solo archivo portátil, para quien no tiene el repo
node builders/build-portable.mjs <deck>/index.html <deck>/salida.html
```

## 7. Dónde vive cada cosa

Este repo es **público**. La regla 1 de `AGENTS.md` no tiene excepciones.

| Va al repo | Se queda fuera, en `examples/_local/` o una carpeta local |
|---|---|
| El engine, los builders, los assets | El deck real con nombres, cifras y verbatims |
| Los rulebooks y este canon | Los CSV y cualquier exportación |
| Los fragmentos de `slides/` con placeholders | `PROVENANCE_AND_CHANGELOG.md` de cada caso |
| El índice de referencias por función | El índice de referencias por cliente |
| `templates/` | Los términos comerciales y los montos |

Estructura de una carpeta de trabajo:

```text
<entregable>/
├── inputs/            brief, notas de discovery, queries, exportaciones
├── work/              scripts, perfiles, muestras, renders, qa
├── index.html         la fuente maestra
├── noisia-tokens.css  deck.css  deck-components.css  deck-stage.js  logo_norm.svg
├── assets/            tb-map.png, cover-illustration.png
├── GUION_POR_SLIDE.md
├── PROVENANCE_AND_CHANGELOG.md
└── <Nombre>.pdf       <Nombre>.html       <Nombre>.pptx
```

`index.html` es la fuente. El PDF, el HTML portátil y el PPTX son salidas y no se editan como
fuente.

## 8. Definition of done

El entregable está terminado cuando alguien que no participó puede responder, solo con el
artefacto y su registro:

1. Qué pregunta responde y para qué decisión.
2. Qué entró al corpus, qué se excluyó y por qué.
3. Qué significa cada número y cuál es su denominador.
4. Cómo regresar de un hallazgo a sus menciones reales.
5. Qué afirmaciones son exactas, cuáles direccionales y cuáles exploratorias.
6. Qué no puede concluirse con esta base.
7. Cuál es el siguiente paso.

Y la revisión técnica pasa:

- [ ] `grep -c '—' index.html` da `0`.
- [ ] No quedan `{{PLACEHOLDER}}`, comentarios ni TODO visibles.
- [ ] El footer dice `noisia · social intelligence architects` y la numeración `NN / TOTAL` es correcta.
- [ ] Se enlaza `deck-components.css` y el `<style>` del deck no redefine sus clases.
- [ ] Cada slide se renderizó a 1920 × 1080 y se vio, no solo se leyó en código.
- [ ] El PDF se revisó página por página.
- [ ] Cada verbatim tiene liga, plataforma y fecha.
- [ ] Ningún dato de cliente entró a este repo.

## 9. Deuda del kit

Lo que se construyó más de una vez y ya quedó en el engine, verificado con un render de prueba de
cada componente:

| Promovido | Dónde vive ahora |
|---|---|
| `.card`, la card de superficie que cada deck redefinía | `engine/deck-components.css` |
| El bloque de canales, `.roles` y `.role`, con su barra `.rbar` | `engine/deck-components.css` |
| La portada con ilustración, `.cover-art` y `.cover-copy` | `engine/deck-components.css` |
| El mapa T&B con sus labels de empuje y freno, `.tbmap` | `engine/deck-components.css` |
| Las cards de permiso por capa, `.lperm` | `engine/deck-components.css` |
| La rejilla que explica un marco, `.fwg` y `.fwc` | `engine/deck-components.css` |
| Portada de estudio, las cuatro capas, canales y método | `slides/cover-study`, `slides/tb-layers`, `slides/channels`, `slides/method`, registradas en `catalog.json` |
| El enlace a `deck-components.css` en el shell | `engine/deck-template.html` |
| `.atmos.plain`, que apaga el blob cyan en la portada | `engine/deck.css` |

Los nombres cambiaron al promoverse: lo que en un deck se llamaba `.vgrid` y `.vc` aquí es `.fwg`
y `.fwc`, y `.layer-permissions` es `.lperm`. Si abres un deck viejo, esa es la equivalencia.

Lo que sigue pendiente:

| Pendiente | Por qué importa | Prioridad |
|---|---|---|
| Migrar los decks entregados al engine enlazado | Siguen cargando su bloque inline. No urge, pero el siguiente que se toque debería migrarse | Baja |
| Fragmentos para hipótesis, mapa, espejo y kanban | Los componentes ya están en el engine, falta el fragmento con placeholders | Baja |
