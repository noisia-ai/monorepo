# Cultural Momentum Mapping · `cultural-momentum-mapping`

> El método de tendencias de Noisia. En español, **momentum cultural**; en el equipo, "crece y
> prende": *crece* es la curva, *prende* es que la gente lo hace suyo. Método en validación (nov
> 2026): salió de un estudio de tendencias de comida en un mercado europeo y se definió aquí con lo
> que ese estudio dejó abierto. Playbook ejecutable:
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
| Resonancia | Engagement normalizado por fuente y tipo de post | Ver "Decisiones abiertas" |
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

**Los cuadrantes del mapa son exactamente las lecturas del marco.** Lo que el marco promete, el mapa
lo mide; un hallazgo que agrupa temas sale del cuadrante del dato, y el builder lo comprueba.

La tradición entra al corpus a propósito: la base es la línea contra la que se mide si algo importado
crece de verdad.

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
- `curva.csv` y `voz.csv` como dataset entregable.

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

- **El engagement.** Se pidió cruzar la evolución con el engagement. La resonancia (engagement
  normalizado por plataforma) se calculó y no entró al mapa porque casi no separó temas. Mientras no
  se decida otra cosa, va como color opcional de la burbuja y se reporta en la tarjeta del tema.
- **Los nombres finales** de las lecturas en español y en inglés.

## Ver también

- Playbook ejecutable: [`05-ai-playbooks/run-cultural-momentum-mapping.md`](../05-ai-playbooks/run-cultural-momentum-mapping.md)
- [`triggers-barriers.md`](triggers-barriers.md), para la decisión dentro de un tema
- Principios operativos: [`00-overview/principles.md`](../00-overview/principles.md)
