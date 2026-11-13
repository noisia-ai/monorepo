# Run Historia de influencias · Playbook operativo

> Protocolo ejecutable. La teoría y las definiciones viven en
> `01-methodologies/historia-de-influencias.md`. Aquí solo se ejecuta. Las reglas de corpus, ETL y
> gates generales son las de `packages/pitch-kit/DATA.md` y `METHODOLOGY.md`; esto agrega lo propio
> del método.

## Inputs requeridos

| Input | Mínimo viable | Ideal |
|---|---|---|
| Cronología del mercado | ~50 filas, cada una con año y URL | 100+ filas, verificadas en su fuente |
| Influencias candidatas | 8 a 13, cada una con su razón | Lo mismo, con su puente con la categoría |
| Escucha | 12 meses, texto propio separable | 12 meses más una capa a 48 meses |
| Lectura | ~200 menciones por búsqueda | Más donde la búsqueda es chica o ruidosa |
| Brief | Categoría y marcas | Más la decisión que se va a tomar y lo que ya tiene el cliente |

## Pre-flight check

1. **¿La pregunta es generacional y mira hacia atrás?** Si pide las tendencias de hoy, es otro método.
2. **¿Hay cronología documentable del mercado?** Sin fuentes, abortar o declararlo exploratorio.
3. **¿El dueño del caso decidió qué detalle de método ve el cliente?** Tamaño de muestra, controles y
   bases se deciden antes de construir (gate H10). Decir "leímos 200 menciones al azar por búsqueda"
   deja al producto en desventaja: el estudio se vende por su corpus.
4. **¿El brief pide algo que el método no cubre** (sabores, formatos, región)? Se diseña su búsqueda o
   se declara fuera desde la propuesta.

## Protocolo

### Paso 0. SSOT cualitativo, antes de escuchar

Un documento interno que junta **todas las fuentes sin licuarlas**: cada tema dice qué dice cada
fuente por separado, con su clase de evidencia, dónde coinciden y dónde se contradicen, y termina con
**qué tiene que probar la escucha**.

Regla de lectura: **las fuentes de opinión proponen, la escucha previa sugiere, la escucha del
estudio prueba.** Una idea que solo dice una fuente de opinión no llega a un titular. El brief manda
sobre el alcance; las reuniones, sobre el método; la cronología es contexto (disponibilidad no es
consumo).

### Paso 1. La cronología

Qué estaba disponible mientras la generación crecía en ese mercado: caricaturas, música, juguetes,
hechos, regulación, productos de la categoría. **Una fila por hecho, con año y URL**, marcada como
verificada, por confirmar o inferencia.

De aquí salen los años del journey y las **bisagras** entre la categoría y la infancia (un premio que
seguía a una caricatura; una regulación que sacó a los personajes de los empaques y partió a la
generación en dos).

### Paso 2. Elegir las influencias, con su regla escrita antes de escuchar

Cada candidata entra con por qué entra, qué tema del SSOT prueba y cuál es su puente con la categoría.
**La regla de entrada y de salida se escribe antes de escuchar**, con su umbral de volumen si lo hay,
y **lo que queda fuera se anota con su razón** (por ejemplo, un género musical cuyo volumen no se
puede anclar al mercado). Esa lista va al deck como una slide corta: el cliente pregunta cómo se
eligieron.

### Paso 3. Búsquedas en dos versiones

- **A:** sin ancla de texto propio. Da el volumen total del embudo. No se analiza.
- **B:** con el ancla en el texto propio (`rawText:`). Es el corpus de análisis.

La distancia entre A y B mide el contexto heredado (en una búsqueda de contexto generacional, A dio
unas 18 veces B). Se validan con `builders/check-queries.py` y se escriben con `AND NOT`, nunca `NOT`
suelto.

### Paso 4. ETL y gates de datos

Los gates de `DATA.md`. Lo propio de este método:
- **Texto propio** medido contra el ancla de cada búsqueda, nunca contra la columna de keywords.
- **Mercado:** si filtrar por país borra las redes de la generación (TikTok e Instagram suelen
  quedarse sin país), se agrega un corte "red sin país, en el idioma" y esas citas se rotulan "en
  español", no "en México".
- **Edad:** ningún campo la trae. Se declara.

### Paso 5. Libro de códigos y piloto a ciegas

1. Libro de códigos v1.0 con los ejes y sus pruebas clínicas
   (`01-methodologies/historia-de-influencias.md`).
2. **Piloto:** unas 11 menciones por búsqueda, dos codificadores a ciegas.
3. **Kappa por eje ≥ 0.80** en los ejes que se reportan. Vigencia es el más difícil (sale cerca del
   umbral); una categoría rara puede dar kappa bajo con acuerdo alto, y se acepta anotándolo.
4. **Antes de congelar, probar una regla para el presente implícito** en música y figuras públicas
   ("me sigue rompiendo el corazón"): sin ella, dos de cada tres menciones de música quedan
   `sin_senal`.
5. Los desacuerdos se vuelven aclaraciones escritas (v1.1). **Se congela con su sha256**; nada cambia
   después del piloto.

### Paso 6. Muestra y codificación

- **Muestra aleatoria por búsqueda**, con semilla fija, del universo B sin duplicados, dentro del
  periodo y con el tema en el texto propio. **El tamaño se decide por lo que se va a reportar**, no
  fijo: una búsqueda chica o ruidosa (la marca del cliente con pocas menciones pertinentes) pide más
  lectura o se declara cualitativa desde el diseño.
- Se guarda el **marco de muestreo** (N del universo y n de la muestra) para expandir.
- Una línea JSON por mención, con el mismo id y orden; un validador revisa ids, orden, catálogo y que
  cada evidencia esté **palabra por palabra** en el texto.
- **Dos codificadores en una submuestra de cada búsqueda**, no solo en el piloto, para medir la
  dispersión entre lotes.
- **Volumen estimado** de cada conversación = universo sin duplicados × precisión (`rel` = sí entre
  las leídas), con intervalo de Wilson.

### Paso 7. Armar la historia desde los datos

En este orden, cada pieza con su script y su fuente:

1. **Journey de vida.** Cada influencia en el año que le da la cronología (qué fila la ancla es una
   decisión editorial, escrita en el script). Altura = sigue vivo; punto = volumen estimado; debajo,
   una portada real, cómo vive hoy y el espacio en blanco. Lo que no tiene año se rotula "toda la
   infancia".
2. **Mapa de vigencia:** barra apilada al 100% por influencia, de más viva a menos.
3. **Una slide por influencia que pese:** vigencia, de qué se habla, curva mes a mes, citas con
   portada.
4. **Vía:** tabla de calor influencia × vía.
5. **Espacio en blanco**, del conteo en todo el universo, con la historia de la categoría al lado.
6. **Quién ocupa el espacio:** galería de las colaboraciones de otras categorías con más
   interacciones. Es ilustración, no muestra.
7. **Categoría:** empuja contra detiene, motivos, una slide por motivo que pese, lo que detiene.
8. **Marcas:** volumen estimado y la parte de las menciones de cada marca que de verdad es la marca.
9. **Recomendaciones:** cómo, de dónde sale en el estudio, quién lo ha hecho, cuándo y riesgo.
10. **La respuesta** en una frase, preguntas a validar, método y alcance, glosario.

**Regla de afirmaciones:** cada porcentaje se dice "de lo que se dice de X", nunca "de los mexicanos"
ni "de la Gen Z". Una celda con menos de 20 menciones no va como porcentaje: va en conteo o en citas.

## Quality gates

| Gate | Pasa si |
|---|---|
| **H1. Cronología** | Cada año del journey sale de una fila con fuente. Ninguno se teclea |
| **H2. Selección** | Cada influencia tiene su razón escrita, y lo que quedó fuera también |
| **H3. Piloto** | Kappa ≥ 0.80 en los ejes que se reportan, libro de códigos congelado con hash |
| **H4. Evidencia** | Cada etiqueta distinta de `sin_senal` tiene su fragmento literal, verificado contra el texto |
| **H5. Sin señal** | `sin_senal` aparece en las gráficas y nunca se reparte entre las demás formas |
| **H6. Espacio en blanco** | El conteo es de todo el universo, con lexicón versionado, revisión manual de falsos positivos y el verbo "nombra" |
| **H7. Ausencia** | Ninguna frase dice que la categoría "no funciona" o que el espacio "está libre": se dice "poca presencia, oportunidad a explorar" |
| **H8. Voz** | Ninguna frase atribuye la voz a la generación: "la conversación sobre lo que formó a X", no "X dice" |
| **H9. Alcance** | Lo que el brief pide y el método no cubre se declara en método y pasa a preguntas a validar |
| **H10. Método en el deck** | El dueño del caso decidió antes qué detalle de método ve el cliente |

Y **"creció" solo se dice con la capa a 48 meses.** Sin ella, la palabra no entra al deck.

## Formato de output

La secuencia que se sostuvo de la primera a la cuarta versión (36 slides en la completa):

| Bloque | Slides |
|---|---|
| La pregunta | Portada con la cifra gancho · las respuestas, tres filas con su cifra y la página de la prueba · el método (**con una influencia recorrida de punta a punta** y las cinco formas de vigencia, cada una con una cita) · embudo y alcance · dónde vive (tamaño de cada conversación y peso de cada red) |
| Qué sigue vivo | **Journey de vida** · **mapa de vigencia** · una por influencia que pese · vía de transmisión |
| Dónde cabe la categoría | **Espacio en blanco** · quién ocupa el espacio · clásicos que piden regresar y adyacencias |
| La categoría | Empuja contra detiene · motivos · un motivo por slide · lo que detiene (en conteos, no porcentajes) · la marca contra sus competidores |
| Qué hacer | Recomendaciones · la respuesta en slide oscura · preguntas a validar · método y alcance · glosario |

**Dos entregables desde el principio:** un ejecutivo de 12 a 15 slides para negocio y el completo
para analistas, con un anexo "de dónde sale cada número" en lenguaje de negocio. Las dos clases de
número se dicen igual en todo el deck: el volumen es "cuánto se habla, de toda la conversación del
año" y los porcentajes son "cómo se habla, de leer las menciones una por una". Además: PDF con marca
y white-label, PPTX editable y el guion para presentar.

**Fuera del deck:** el tamaño de la muestra, las tarjetas de menciones clasificadas y los controles
de calidad viven en el registro (`PROVENANCE_AND_CHANGELOG.md`), salvo que el dueño del caso decida
otra cosa (H10).

## Failure modes conocidos

- **Porcentajes sin origen visible.** El equipo del cliente no se apropia del reporte y lo cuestiona
  todo. Remedio: la slide del método con un ejemplo recorrido y el anexo de cada número.
- **"Espacio libre" o "nadie ocupa".** Suena a oportunidad comercial demostrada. La evidencia sostiene
  poca presencia (H7).
- **Una respuesta de marca contada por un usuario** ("la marca me contestó") presentada como
  observada. Se atribuye a quien la cuenta.
- **Reporte denso** que ya no invita a leer. Remedio: el ejecutivo aparte.
- **`cohorte` como hallazgo.** Casi nunca se declara y su kappa es inestable: solo gate.
- **Una sola persona codificando cada búsqueda.** La dispersión entre lotes no se puede medir.

## Versionado

v1.0 · nov 2026 · definido desde el primer estudio que lo usó. Se revisa después del segundo.
