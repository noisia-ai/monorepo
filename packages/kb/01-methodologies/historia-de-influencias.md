# Historia de influencias · `historia-de-influencias`

> **Influence History** en la slide del marco. Método en validación (nov 2026): salió de un estudio
> de una categoría de consumo con la Gen Z en México y se definió aquí para que el siguiente estudio
> no lo reinvente. Playbook ejecutable: [`05-ai-playbooks/run-historia-de-influencias.md`](../05-ai-playbooks/run-historia-de-influencias.md).

## Pregunta que responde

> ¿Qué de lo que formó a esta generación sigue vivo hoy, de qué forma, y dónde cabe la categoría
> del cliente?

No mide la vida de una persona: mide lo que rodeó a una generación mientras crecía (caricaturas,
música, juegos, hechos, productos) y lee en la conversación de hoy qué sigue presente y cómo.

## Cuándo aplica

- El cliente quiere entender a una **generación o cohorte** ("la Gen Z", "los que crecieron con X")
  y la pregunta "¿quiénes son?" se queda en estereotipo.
- La categoría tiene **historia propia con esa generación**: estuvo en su infancia con premios,
  mascotas, licencias o rituales, o pudo haber estado.
- Se buscan **territorios de comunicación o de producto fuera de la categoría**: colaboraciones,
  licencias, ocasiones, regresos de clásicos.
- El resultado tiene que ser accionable para la marca y explicable para negocio, no un retrato de
  tendencias.

## Cuándo NO aplica

- **Cuando la pregunta es por las tendencias de hoy** (la jerga de los últimos meses). Es otro
  estudio, con otro diseño: ver [`cultural-momentum-mapping.md`](cultural-momentum-mapping.md).
- **Cuando se necesita representatividad** ("qué porcentaje de la generación…"). La escucha no trae
  edad.
- **Cuando el mercado no tiene una cronología documentable** de lo que rodeó a la generación: sin
  fuentes, el primer paso queda en opinión.
- **Cuando la pregunta es de tamaño de mercado o de compra.** Mide presencia en lo que se escribe, no
  ventas.
- **Cuando la generación casi no tiene pasado que recordar** (menores de unos 12 años).

## En qué se distingue de Triggers & Barriers

| | Triggers & Barriers | Historia de influencias |
|---|---|---|
| Unidad | La categoría y su decisión | La influencia: algo de fuera de la categoría que rodeó a la generación |
| Pregunta | Qué motiva y qué frena la decisión | Qué sigue vivo de lo que los formó, y si la categoría está ahí |
| Ejes | Trigger o barrier × 4 layers (doble codificación) | **Vigencia** × **vía** × **cruce con la categoría** (multieje) |
| Tiempo | El presente de la decisión | El pasado formativo, leído en la conversación de hoy |
| Ausencia | Una barrera que no aparece no se reporta | La ausencia de la categoría **es un hallazgo**: espacio en blanco, medido contra quién sí está |

Se combinan bien: historia de influencias para encontrar el territorio, T&B para entender la decisión
dentro de él. El bloque de categoría de este método ya lleva una lectura ligera de T&B (dirección ×
motivo, sin los 4 layers).

## Estructura

### Dos familias de búsqueda

1. **Influencias:** una búsqueda por cada influencia candidata (de 8 a 13): la TV y el anime de la
   infancia, la música de una década, un juego coleccionable, un hecho que partió a la generación.
2. **Categoría:** la categoría, cada marca relevante y la variante de uso que importe.

Las búsquedas **nunca se suman entre sí.** Cada una es un corte con su propio denominador; una
mención que cae en dos cuenta en las dos.

### Codificación multieje

Cada mención se lee una vez y recibe todos sus ejes a la vez; cada eje se reporta por separado. Se lee
**solo el texto propio** (el post padre ayuda a entender, nunca es evidencia). **No hay categoría por
defecto:** sin un fragmento literal que la sostenga, va `sin_senal`, y toda otra etiqueta lleva su
fragmento copiado tal cual.

| Eje | Aplica a | Para qué |
|---|---|---|
| `rel` | Todas | Filtro: ¿trata de verdad el sujeto de la búsqueda? Da la precisión |
| `emisor` | Todas | Persona, marca o comercio, medio, institución |
| **`vigencia`** | Todas | **El eje central:** cómo aparece hoy lo que se nombra |
| **`via`** | Todas | Por dónde llegó o llega |
| **`cruce_categoria`** | Influencias | Si la mención de una influencia nombra la categoría |
| `direccion` | Categoría | Empuja o detiene el consumo |
| `motivo` | Todas (se reporta en categoría) | El porqué principal, uno solo |
| `tema` | Todas | De qué habla, en cuatro palabras como máximo |
| `citable` | Todas | Si sirve como verbatim |
| `cohorte` | Todas | Solo como gate: casi nunca se declara la generación de quien escribe |

### Vigencia: cinco formas y su prueba clínica

La prueba se aplica **en orden** y gana la primera que se cumple.

| Forma | Prueba clínica | Ejemplo |
|---|---|---|
| **Viva** | ¿Quien escribe **lo hace, lo consume o lo sigue hoy**? | "Hay que juntarnos a intercambiar las estampas que nos faltan" |
| **Transformada** | ¿Aparece **en otra forma**: meme, remake, relanzamiento, colaboración, coleccionable de adulto? | Un chiste que usa la frase de una caricatura para hablar de otra cosa |
| **Heredada** | ¿Dice que **llegó por otra generación**: la mamá, la abuela, "en mi casa siempre"? | "En mi casa siempre se veía los domingos" |
| **Recuerdo** | ¿Solo se cuenta **en pasado**, sin práctica de hoy? | "Cuando iba en la primaria…" |
| **Sin señal** | Se nombra sin decir si se vive, se recuerda o volvió | El nombre de un artista, sin más |

**Reglas de borde:**
- Un recuerdo de la infancia **con práctica actual** ("de niño las comía y hasta hoy") es `viva`.
- Un meme o un chiste con la influencia es `transformada`.
- Mirar al pasado sin práctica es `recuerdo`.
- "Ya no venden X" o "que regrese X" es `recuerdo`, con dirección `empuja` y motivo
  `disponibilidad_novedad`.

**Sigue vivo = viva + transformada.** Es la altura de cada influencia en el journey. `sin_senal` **se
muestra y nunca se reparte**: que una influencia se nombre sin decir cómo (en la música pasó en dos
de cada tres menciones) es un hallazgo.

### Vía: por dónde llegó

| Vía | Prueba clínica |
|---|---|
| `casa_familia` | ¿En la casa o con la familia? |
| `escuela_patio` | ¿En la escuela, el salón, el recreo? |
| `pantalla_tv` | ¿En la TV abierta, las caricaturas, una serie? |
| `internet_redes` | ¿En YouTube, TikTok, foros, un streamer? |
| `musica_conciertos` | ¿En un concierto o en la música misma? |
| `tienda_calle` | ¿En la tienda, el puesto, el estadio? |
| `pares` | ¿Por amigos, la pareja o el grupo? |
| `sin_senal` | No dice por dónde |

Es la señal más delgada: en la mayoría de las influencias menos de la mitad de las menciones dice por
dónde llegó. Se reporta "de lo que se dice, la parte que menciona la vía".

### Cruce con la categoría y espacio en blanco

`cruce_categoria = 1` si la mención de una influencia nombra la categoría, una marca o el acto de
consumirla. **Qué cuenta y qué no se escribe antes de codificar** (por ejemplo, cuenta una botana
salada o su marca; no cuentan los dulces ni los refrescos).

**El espacio en blanco no sale de la muestra sino de todo el universo:** un conteo de palabras de la
categoría contra un grupo de comparación (otras categorías que ya hacen colaboraciones en ese
territorio), en el texto propio y sin repetidos. Se reporta como "X a 1" y con el verbo **nombra**,
nunca "habla de". La muestra comprueba que el conteo no está inflado, y diez textos por grupo y
búsqueda se revisan a mano para cazar falsos positivos.

**Ausencia no es rechazo.** Que la categoría no aparezca no dice que no funcione: dice que hay poca
presencia, y que quien sí ocupa el lugar marca el camino.

### Bloque de categoría: dirección y motivo

| `direccion` | Prueba clínica |
|---|---|
| `empuja` | ¿Acerca al consumo o al gusto? Antojo, recomendación, recompra, ritual |
| `detiene` | ¿Aleja? Rechazo, culpa, precio, salud, "ya no es lo mismo" |
| `mixta` | Las dos en la misma mención |
| `sin_senal` | Nombra la categoría sin dirección: un dato, una receta neutra, un meme |

**Motivo**, uno principal, de un catálogo cerrado por categoría (por ejemplo sabor, precio y valor,
ocasión y compañía, antojo y premio, nostalgia, preparación, coleccionable y juego, salud y culpa,
disponibilidad y novedad, identidad de marca, humor). Prueba clínica: ¿qué palabra del texto responde
"por qué lo dice"? Si ninguna, `sin_senal`. Si dos compiten, gana la que el texto pone como razón.

## Fundamentos teóricos

El método salió de la práctica, con una mirada antropológica: entender a una generación por lo que la
formó, no por su edad. Estos anclajes encajan con lo que mide. **Todavía no se han usado ante un
cliente: se leen antes de citarlos.**

| Teoría | Autor | Qué sostiene |
|---|---|---|
| El problema de las generaciones | Mannheim (1928) | Una generación se forma por lo que vive en sus años formativos: partir de qué los rodeó, no de la edad |
| Memoria colectiva | Halbwachs (1925) | El recuerdo se reconstruye en grupo desde el presente: leer la memoria en la conversación de hoy |
| Nostalgia restauradora y reflexiva | Boym (2001) | Querer que algo regrese no es recordarlo con distancia: la línea entre "que regrese" y `recuerdo` |
| Preferencias formadas en la juventud | Holbrook y Schindler (1989, 1991) | Los gustos fijados en la adolescencia persisten: buscar la vigencia de esas influencias |
| Cultura participativa y remix | Jenkins (2006) | Lo que vuelve como meme o colaboración circula, no se recuerda: `transformada` es una forma propia |

## Inputs típicos

**Mínimo viable:** una cronología del mercado de unas 50 filas con fuente; de 8 a 13 influencias
candidatas, cada una con su razón; 12 meses de escucha con texto propio separable; unas 200 menciones
leídas por búsqueda; un brief con la categoría y las marcas.

**Ideal:** además, fuentes secundarias en el SSOT (escucha previa, desk research, opinión experta);
una capa de búsquedas a 48 meses para poder decir "creció"; dos codificadores en una submuestra de
cada búsqueda; una encuesta corta para lo que la conversación no dice (quién habla, qué compra,
sabores, región).

## Outputs típicos

- **Journey de vida:** cada influencia en su año de llegada, la altura es lo que sigue vivo y el punto
  su volumen estimado.
- **Mapa de vigencia:** las cinco formas por influencia, de la más viva a la menos.
- **Una lectura por influencia que pese:** vigencia, de qué se habla, curva mes a mes, citas con
  portada.
- **Vía de transmisión:** influencia × vía.
- **Espacio en blanco y quién lo ocupa:** la categoría contra su grupo de comparación, y las
  colaboraciones de otras categorías que ya están ahí.
- **Bloque de categoría:** empuja contra detiene, motivos, lo que detiene, la marca contra sus
  competidores.
- **Recomendaciones** con cómo, de dónde sale, quién lo ha hecho, cuándo y riesgo.

## Limitaciones

- **Nada sobre la población.** Los porcentajes describen lo que se escribe en cada conversación, no a
  la generación. Cada porcentaje se dice "de lo que se dice de X".
- **Edad.** La escucha no la trae: el estudio lee la conversación sobre lo que formó a la generación,
  no la voz verificada de la generación.
- **Causalidad.** Que una influencia siga viva no prueba que mueva el consumo de la categoría.
- **Crecimiento.** Con 12 meses no se puede decir "creció desde su infancia".
- **Demanda.** El espacio en blanco mide presencia, no demanda: poca presencia no es una oportunidad
  comprobada.
- **Consumo pasado.** Que algo estuviera disponible no prueba que esa generación lo consumiera.
- **Lo que no se nombró no se midió.** El sesgo del método es el de su lista de influencias.

## Lo que se aprendió presentándolo

- **El enfoque se defiende como más de negocio que uno de tendencias:** mira hacia atrás para entender
  qué moldeó la percepción, y de ahí salen territorios que la marca puede ocupar.
- **Los porcentajes generan dudas si no se ve de dónde salen.** Hace falta una explicación en lenguaje
  de negocio de cada número, sin exponer el tamaño de la muestra (ver el playbook, gate H10).
- **El equipo del cliente tiene que entender la slide del método antes que todo lo demás.** Se explica
  con una influencia recorrida de punta a punta.
- **Dos entregables:** un ejecutivo de 12 a 15 slides para negocio y el completo para analistas.

## Ver también

- Playbook ejecutable: [`05-ai-playbooks/run-historia-de-influencias.md`](../05-ai-playbooks/run-historia-de-influencias.md)
- [`triggers-barriers.md`](triggers-barriers.md), para la decisión dentro del territorio
- Principios operativos: [`00-overview/principles.md`](../00-overview/principles.md)
