# Cultural Momentum Mapping · `cultural-momentum-mapping`

> El método de tendencias de Noisia. En español, **momentum cultural**; en el equipo, "crece y
> prende": *crece* es la curva, *prende* es que la gente lo hace suyo. Método en validación (nov
> 2026): salió de un estudio de tendencias de comida en un mercado europeo y se definió aquí con lo
> que ese estudio dejó abierto. La v1.1 suma lo que hacían mejor las referencias que lo inspiraron
> (un método de la industria por drivers y horizonte, el ciclo de vida de una plataforma de listening)
> y dos estudios propios de panificación. Playbook ejecutable:
> [`05-ai-playbooks/run-cultural-momentum-mapping.md`](../05-ai-playbooks/run-cultural-momentum-mapping.md).

## Pregunta que responde

> ¿Qué está ganando tracción de verdad en una cultura de consumo, qué solo sube de volumen o ya
> cansa, y en qué momentos de la vida vive cada tema?

## Cuándo aplica

- El cliente pregunta "qué está pasando" en una categoría o un mercado sin decir el nicho.
- Hay que separar la moda empujada por marcas y medios de lo que la gente adopta.
- Hay que encontrar puertas de entrada para una marca: el momento donde el tema vive y la marca
  todavía no está.
- Hay que medir mercados chicos o de otro alfabeto, donde los paneles de tendencias no llegan.

## Cuándo NO aplica

- **Tamaño de mercado, ventas o pronóstico.** Mide conversación y la etapa que la voz expresa.
- **Menos de 12 meses de historia.** Sin el mismo trimestre del año anterior, el crecimiento se
  confunde con la temporada. Hay plan B (6 meses contra 6), y se declara.
- **La motivación o la fricción de una decisión.** Eso es Triggers & Barriers: aquí la unidad es el
  tema, no la decisión.
- **Temas que viven en espacios cerrados** (grupos, mensajería): el método describe la capa pública.
- **Una marca sola.** La marca se lee dentro de los temas, no como tema del mapa.
- **Lo que formó a una generación.** Eso mira hacia atrás: ver
  [`historia-de-influencias.md`](historia-de-influencias.md).

## La estructura: dos relojes por tema

Los métodos de tendencia del mercado clasifican por la forma de la curva de volumen. Noisia, con
etiquetado masivo, lee **dos relojes por tema** y busca dónde no marcan la misma hora:

| Reloj | Qué dice | Cómo se obtiene |
|---|---|---|
| **La curva** | Si más **personas** hablan del tema, descontando que la conversación entera también crece | Se calcula sobre todo el corpus, sin etiquetar |
| **La voz** | Qué hace la gente con el tema (lo descubre, lo adopta, lo da por hecho o se cansa) y en qué momento de su vida vive | Se etiqueta una muestra estratificada con un libro de códigos |

**El hallazgo está en el desacuerdo.** Un tema que sube de volumen mientras su voz ya se cansa está
cerca del pico. Un tema plano en volumen cuya voz está descubriendo va adelantado.

**Voz** es la capa no emitida: personas y creadores. Medios, marcas y páginas son la capa **emitida**:
no entran a los relojes y alimentan la medida de **empuje**.

### Reloj de la curva

- **Voces de un tema en una ventana W:** `v(t, W)` = autores únicos en W + menciones sin autor en W
  (hay plataformas cuyos comentarios llegan sin autor).
- **Ventanas:** `PREV` y `NOW` son **el mismo trimestre** en dos años seguidos, así que no hay efecto
  de temporada. El **año de lectura** son los 12 meses que cierran en NOW.
- **Corpus:** `V(W)` son las voces de toda la voz del corpus en W.

**Momentum pertinente**, el que se reporta. Cada ventana se corrige por la parte de la voz que de
verdad habla del tema (`p`, del reloj de la voz), y se resta el crecimiento del corpus:

```
p(t, P)        = Σ peso(codificadas de t en P que son pertinentes) / Σ peso(codificadas de t en P)
v'(t, P)       = v(t, P) × p(t, P)
momentum(t)    = ln( (v'(t,NOW) + K) / (v'(t,PREV) + K) ) − ln( V(NOW) / V(PREV) )      K = 5
multiplicador  = exp(momentum)                     # lo que se muestra: "×2.2"
```

- `K = 5` amortigua los temas chicos: de 2 a 10 voces no es "×5".
- Restar el crecimiento del corpus evita leer como tendencia que la herramienta indexa más los meses
  recientes.
- Corregir por pertinencia evita que un uso figurado (un platillo usado como insulto político) mueva
  la curva. En el estudio que lo definió, menos de la mitad de lo codificado era pertinente.

**Otras medidas por tema, en el año de lectura:**

| Medida | Definición | Para qué |
|---|---|---|
| Tamaño por 1,000 voces | `1000 × voz_del_tema(m) × p / voz_del_corpus(m)`, promedio de 12 meses | Comparar temas sin que el corpus creciente los infle; es la serie de cada tarjeta |
| **Pendiente de 12 meses** | Regresión de la serie mensual por 1,000 voces, desestacionalizada si hay 24 meses | Segunda medida de la curva: que un evento de un trimestre no domine el multiplicador |
| **Intervalo del multiplicador** | Bootstrap por tema (1,000 remuestreos de voces) | Con bases de cientos, ×2.0 y ×2.2 no se distinguen: el intervalo lo dice |
| **Empuje** | Parte emitida del tema en el año | Una tendencia empujada es campaña, no cultura |
| Concentración | Parte del hilo y del autor más grandes en la voz del año | Un pico de un solo post no es tendencia |
| **Salto de comunidad** | Canales e hilos distintos con el tema en NOW contra PREV | Lo que predice lo masivo es saltar de comunidad, no el volumen |
| **Crecimiento de la resonancia** | La misma regla del momentum aplicada a las interacciones del tema (engagement normalizado por fuente y tipo de post), NOW contra PREV | El cruce con engagement que se pidió. Su **nivel** casi no separó temas en el primer estudio; su **crecimiento** se prueba como segunda medida de la curva, como hace Synthesio con interacciones |
| Por 10,000 menciones | `menciones_del_tema / menciones_analizadas × 10,000` | Contrastar con listas externas de tendencias (lo viral de las listas a veces se busca y no se conversa) |
| Piso de señal | ≥240 menciones en el año (unas 20 por mes) | Debajo, "señal débil", nunca en porcentaje |

### Reloj de la voz

Cada mención de la muestra recibe cuatro ejes independientes y tres banderas:

| Eje | Valores | Prueba clínica |
|---|---|---|
| `pertinencia` | dominio · precio_dominio · figurado · otro | ¿Habla del tema en su sentido del dominio, o lo usa como metáfora, apodo o insulto? |
| `emisor` | persona · creador · marca_negocio · medio | ¿Quién habla, y vende algo? |
| `etapa` (sobre el tema, no sobre la categoría) | descubre · adopta · normaliza · se_cansa · sin_senal | Ver abajo |
| `momento` | casa y familia · amigos y salida · restaurante · al paso · delivery · pantalla o partido · fiesta o ritual · vacaciones · trabajo o estudio · entreno o dieta · temporada · otro · sin_senal | ¿En qué momento de su vida dice que lo hace? El más explícito |
| Banderas | precio · marca · citable | Y una glosa para elegir citas, nunca para contar |

**La etapa, en orden:**
- **Descubre:** lo prueba o lo conoce por primera vez ("lo probé hoy", "¿alguien sabe dónde venden…?").
- **Adopta:** lo hace suyo, lo repite, lo recomienda ("ya lo hago cada semana").
- **Normaliza:** lo da por hecho, es parte de la rutina, sin novedad.
- **Se cansa:** rechazo, ironía o fatiga ("ya hasta en el pan le ponen…", "otra vez esto").
- **Sin señal:** se nombra sin decir qué hace con él.

**Pesos:** cada mención pesa lo que pesa su estrato en el corpus, `peso = población(t, P) /
codificadas(t, P)`. Los repartos de etapa y momento son ponderados sobre las pertinentes con señal;
`sin_senal` queda fuera del denominador y se reporta como **cobertura**, junto al n.

**Índice de voz**, el eje Y:

```
indice_voz(t) = (descubre + adopta) − se_cansa        # entre −1 y 1; normaliza no suma ni resta
```

**Giro de etapa:** el índice de voz en NOW menos el de PREV. Solo se lee con ≥100 menciones con etapa
en cada ventana; con menos, la etapa es una foto del año, no una trayectoria.

### El mapa, sus lecturas y sus banderas

- **X:** el multiplicador, en escala logarítmica, con su intervalo.
- **Y:** el índice de voz.
- **Burbuja:** el tamaño por 1,000 voces.
- **Entran al mapa** los temas con ≥20 menciones con etapa, multiplicador calculable y ≥50 voces
  pertinentes en el año. Los paraguas y las queries de servicio (discovery, marca) no entran.

**Cortes:** umbrales absolutos, con la mediana del set dibujada como referencia.
- **Crece:** multiplicador ≥ ×1.5 y su intervalo no toca ×1.
- **Cansa:** `se_cansa` ≥ 20% de las menciones con etapa, o índice de voz por debajo de la mediana.

| Lectura | Regla | Qué significa |
|---|---|---|
| **Catching on** · prende | Crece, y la voz descubre o adopta | Crece más rápido que la conversación y la gente dice que lo hace |
| **Growing, but tiring** · pico cerca | Crece, y la voz cansa | Crece, pero ya con rechazo o rutina: lo que se adopta rápido se abandona rápido |
| **The steady base** · la base | No crece, y la voz adopta o normaliza | Sigue en la vida diaria. Lo obvio es contexto; su movimiento no |
| **Losing pull** · pierde tirón | No crece, y la voz cansa | Crece menos y con más rechazo o rutina |

**Banderas sobre la burbuja**, que no son cuadrantes:
- **Ahead of the curve · señal temprana:** multiplicador ≤ ×1.2 y `descubre` ≥ 35% de las menciones
  con etapa. Plano en volumen, con la voz descubriendo. Es la señal más valiosa para un cliente de
  tendencias: va en su propia slide aunque el tema caiga en "la base".
- **Empujada:** más de 60% emitido. Borde punteado: es campaña antes que cultura.
- **En declive:** multiplicador < 1 con el intervalo debajo de ×1.
- **Saturado:** el tercio de mayor tamaño y multiplicador < 1. Grande y bajando es otra lectura que
  "pierde tirón": la gente lo sigue haciendo, pero ya no crece.
- **Estacional:** su serie mensual repite un pico en la misma temporada (con 24 meses, o con Google
  Trends a cinco años). Un tema estacional que además crece año contra año se dice así: "crece, y
  además es de temporada". En comida es media historia.

**Los cuadrantes del mapa son exactamente las lecturas del marco.** Lo que el marco promete, el mapa
lo mide; un hallazgo que agrupa temas sale del cuadrante del dato, y el builder lo comprueba.

La tradición entra al corpus a propósito: la base es la línea contra la que se mide si algo importado
crece de verdad.

### De temas a drivers

El cliente no recibe 20 temas sueltos: recibe **drivers**, grupos de temas que comparten una misma
fuerza cultural, cada uno con su tesis en una frase ("la proteína se volvió argumento de todo"). Es lo
que mejor hace el método de referencia de la industria (de miles de tendencias a catorce drivers), y es
lo que evita agrupar temas a mano en los hallazgos.

- Se agrupan los temas del mapa por lo que dicen sus menciones (glosas y asuntos dominantes), no por
  su posición en el mapa. Cada tema pertenece a un solo driver; un driver lleva dos temas o más.
- Cada driver lleva su tesis, su porqué cultural, cómo se extiende a categorías vecinas y qué
  significa para la marca.
- El builder comprueba la pertenencia: cada tema citado en un driver está en ese driver.

### El horizonte: cuándo actuar

El método no pronostica fechas, pero sí ordena por horizonte con reglas que se escriben antes de los
datos. Salió de un estudio propio de panificación, que ya lo hacía con tamaño por crecimiento:

| Horizonte | Regla | Para qué |
|---|---|---|
| **1 año · actuar ya** | Prende y está en el tercio de mayor tamaño | Lo que ya pasa a escala: llega tarde quien no está |
| **3 años · construir** | Prende con tamaño medio, o señal temprana con su crecimiento confirmado por el intervalo | Lo que se puede construir antes de que sea masivo |
| **5 años · vigilar** | Señal temprana chica | Lo que vale la pena seguir sin invertir todavía |

Un tema empujado (más de 60% emitido) nunca entra a "actuar ya" sin decir que es campaña.

### Dónde pesa más: índices de sobre-representación

Para estudios con varias categorías del cliente o varios mercados, cada tema lleva su índice: su peso
en esa categoría o mercado contra su peso promedio, donde 100 es el promedio ("en Brasil pesa 173").
Una celda sobre-representada es prioridad; los índices van en un mapa de calor tema × categoría o
tema × mercado, con el n de cada celda.

### Del tema a la señal

El mapa ordena **temas** por números; los reportes publicados de Noisia (`HUMAN_SIGNALS.md`) eligen
**señales** por lo que dicen ("las señales se eligen por lo que dicen, no por cuánto suben"). No se
contradicen: un tema del mapa se vuelve señal cuando una tensión de su voz, con las frases que la
sostienen, explica su lectura. El mapa dice dónde mirar; la señal dice qué significa.

## Fundamentos teóricos

| Fuente | Qué aporta | Qué se tomó |
|---|---|---|
| Synthesio / Ipsos, *Trend Lifecycle* | Etapas por crecimiento y volumen | La idea de etapa. Se rechazó clasificar solo por la curva y contar igual a medios, marcas y personas |
| Black Swan / Mintel (*emerging, growing, mature*) | La madurez traducida a acción | Un "qué hacer" por lectura |
| Google *FoodTrends* (*sustained*, *seasonal risers*) | Quitar la temporada antes de clasificar | El mismo trimestre, año contra año |
| Pulsar | Lo que predice lo masivo es saltar de comunidad | La medida de salto de comunidad |
| Rotabi y Kleinberg, *The Status Gradient of Trends in Social Media* | Las tendencias se mueven entre capas de estatus | Separar persona, creador, marca y medio |

**Propuestos, todavía no citados ante un cliente** (se leen antes de citarlos): Rogers, *Diffusion of
Innovations* (la etapa es su versión observable desde la voz); Berger y Le Mens (2009, *PNAS*), *How
adoption speed affects the abandonment of cultural tastes* (la razón del "pico cerca"); Simmel y
Bourdieu sobre moda y distinción (por qué lo importado se adopta y luego se ironiza).

## Inputs típicos

**Mínimo viable:** 15 meses (12 más el trimestre del año anterior); ~30,000 menciones depuradas; ≥4
canales con voz propia; 15 temas semilla más discovery abierto; ~2,000 menciones codificadas; la
lista de tendencias publicada del mercado como desk research.

**Ideal:** 24 meses (dos comparaciones y la temporada visible); 100,000+ menciones; 6 a 10 canales
con TikTok y YouTube; 30 a 45 semillas en 3 o 4 territorios (lo viral importado, salud y cuerpo, la
tradición, momento y economía); 5,000+ codificadas, con ≥100 por ventana en los temas del mapa.

## Outputs típicos

- **El mapa** a todo lo ancho, con sus cuatro lecturas y sus banderas.
- **Todos los temas:** rejilla de pequeños múltiplos con tamaño por 1,000, curva y multiplicador.
- **Las etapas de todos** y el **mapa de calor tema × momento**.
- **Momentos y marca:** dónde vive cada tema y dónde ya están las marcas; el momento sin marca es la
  puerta de entrada.
- **Un hallazgo por lectura** que pese (en datos y en la vida real), y uno para las señales tempranas.
- **Drivers** con su tesis, y el **roadmap por horizonte** (actuar ya, construir, vigilar).
- **Índices de sobre-representación** por categoría o mercado, cuando el estudio tiene varios.
- **Quién ya actúa:** marcas y startups que ya mueven oferta sobre el tema, con su evidencia pública.
  Es la prueba de que la tendencia mueve mercado, y lo que más pregunta un equipo de innovación.
- `curva.csv` y `voz.csv` como dataset entregable, **con su diccionario de columnas**, para que el
  equipo del cliente, o su copiloto de IA, pueda consultar el estudio sin el deck.
- Opcional: el mapa interactivo (pasar el cursor por un tema muestra su tarjeta).

**Cuando el cliente tiene datos de oferta** (lanzamientos, catálogo, anaquel), el cruce con la demanda
es el insumo de mayor valor: dice dónde la conversación va adelante de lo que se vende.

## Variantes

- **Rápida, de 3 a 6 meses.** Solo con la curva mes a mes y la voz de la ventana. Sirve para "qué se
  está discutiendo ahora". No permite decir "crece" contra la temporada ni leer el giro de etapa; usa
  las palabras "sube en estos meses" y se declara en el método.
- **Solo curva, para reportes recurrentes.** Sin el reloj de la voz: multiplicador, pendiente,
  empuje, saturación y estacionalidad, con la misma regla cada mes. Es reproducible y barata; pierde
  el "prende o cansa", que es lo que distingue a Noisia, y se dice así.

## Limitaciones

- **Ventas, consumo, audiencia, participación.** Son tendencias de lo que la gente escribe.
- **Edad, género, residencia.** El país es una estimación de la plataforma.
- **Espacios cerrados.** Grupos, mensajería y casi todo Instagram fuera de cuentas de empresa.
- **Pronóstico.** Dice en qué etapa está un tema hoy, no cuándo llega al pico.
- **Acuerdo humano.** Si el piloto lo codificaron dos agentes del mismo modelo, es consistencia del
  libro, no acuerdo entre personas: la validación humana es parte del protocolo.
- **Niveles de cifra:** exacto son las menciones recolectadas y analizadas; direccional son etapa,
  momento, precio y crecimiento; exploratorio, un tema con menos de 20 menciones con etapa.

## Decisiones abiertas

- **Un solo vocabulario con los reportes publicados.** Los reportes de noisia.ai clasifican cada señal
  por madurez según la forma de su curva mensual: **emergente** (mínima al principio y rampa al final),
  **acelerando** (crecimiento visible, más fuerte en los últimos meses) y **mainstreaming** (tráfico
  alto y crecimiento gradual), con colores canónicos. Este método usa otras palabras para su mapa. Un
  cliente que vea los dos productos tiene que ver un solo vocabulario. Propuesta: la madurez de los
  reportes nombra al reloj de la curva (emergente, acelerando, mainstreaming, más saturado y en
  declive), y el reloj de la voz la califica (prende o cansa); las cuatro lecturas del mapa se
  vuelven combinaciones de las dos. Pendiente de decisión.
- **El engagement.** Se prueba el crecimiento de la resonancia como segunda medida de la curva en el
  siguiente estudio. Si separa temas, entra al mapa como color de la burbuja; si no, sale con su razón
  escrita.

## Ver también

- Playbook ejecutable: [`05-ai-playbooks/run-cultural-momentum-mapping.md`](../05-ai-playbooks/run-cultural-momentum-mapping.md)
- [`triggers-barriers.md`](triggers-barriers.md), para la decisión dentro de un tema
- Principios operativos: [`00-overview/principles.md`](../00-overview/principles.md)
