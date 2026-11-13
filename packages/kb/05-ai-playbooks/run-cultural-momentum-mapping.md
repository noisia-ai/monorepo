# Run Cultural Momentum Mapping · Playbook operativo

> Protocolo ejecutable. Las definiciones, fórmulas y lecturas viven en
> `01-methodologies/cultural-momentum-mapping.md`. Las reglas generales de corpus, ETL y gates son
> las de `packages/pitch-kit/DATA.md` y `METHODOLOGY.md`; esto agrega lo propio del método.

## Inputs requeridos

| Input | Mínimo viable | Ideal |
|---|---|---|
| Historia | 15 meses: 12 más el trimestre del año anterior | 24 meses |
| Corpus analizado | ~30,000 menciones depuradas | 100,000+ |
| Canales | ≥4 con voz propia (foro, red abierta, video, comentarios) | 6 a 10, con TikTok y YouTube |
| Temas | 15 semillas + discovery abierto | 30 a 45 semillas en 3 o 4 territorios |
| Muestra codificada | ~2,000 | 5,000+, hasta 60 por estrato y ≥100 por ventana en los temas del mapa |
| Desk research | Las listas de tendencia publicadas del mercado | Más reportes de categoría y precios |

## Pre-flight check

1. **¿Hay pregunta y quién la usa?** Si no, se detiene.
2. **¿La herramienta da el mismo trimestre del año anterior?** Si no, plan B: 6 meses contra 6, con
   los temas estacionales marcados (Google Trends), y se declara.
3. **¿Funciona el filtro de idioma?** Se prueba en la vista previa, sin costo: un ancla con y sin el
   idioma marcado. Si el total baja y la muestra está en el idioma, sirve; si no, el idioma se ancla
   en la query. El país **nunca** se deja al filtro (`METHODOLOGY.md` §1).
4. **¿El export completo cabe?** Con más de 50,000 menciones se baja por mes desde el principio.
5. **El marco se cierra antes de los datos:** las cuatro lecturas, las banderas, sus umbrales y las
   reglas del horizonte se escriben en el plan. El mapa mide exactamente lo que el marco promete.
6. **¿Cuánto tiempo hay?** Con menos de 15 meses se corre la variante rápida (3 a 6 meses) y se
   declara; para un reporte recurrente, la variante de solo curva. Ver "Variantes" en la definición.
7. **¿El cliente tiene datos de oferta** (lanzamientos, catálogo, anaquel) o varias categorías y
   mercados? Se piden en el plan: el cruce con la oferta y los índices de sobre-representación salen
   de ahí.

## Protocolo

### Paso 1. Queries

- **Una query universo** cuando el filtro de idioma funciona: Advanced Query con `rawText:`, unión de
  la query de discovery (vocabulario del dominio), la de marca y las anclas de todos los temas. Los
  temas se asignan **en local** con las mismas anclas (`topics.json`): todos se cuentan con la misma
  definición y el discovery sale del mismo corpus.
- Si el filtro **no** funciona: una query por tema, en dos versiones (sin `rawText:` para el total,
  con él para el análisis).
- **Modos de ancla según el idioma:** **U**, la forma es inequívoca y va sola; **L**, la forma es
  global o compartida, va `AND` a palabras funcionales del idioma; **F**, choca con otra palabra, va
  `AND` a vocabulario del dominio; **P**, como F, con contexto a 25 palabras exigido en el ETL. Se
  prefieren formas con morfología local.
- **Ninguna query busca el tono ni la etapa** ("probé por primera vez", "ya me cansé"): si va en la
  query, sesga el reloj de la voz.
- El ruido se declara por tema: homónimos, uso político, empleo, recetas médicas.

### Paso 2. ETL y pertinencia

1. Todas las filas de todos los archivos, zona horaria del mercado, dedupe por id, corte del periodo.
2. **Capa por fila:** emitido (medio, marca, página) o voz (persona, creador).
3. **Pertinencia por reglas:** el ancla en el texto propio; los temas con uso figurado conocido piden
   vocabulario del dominio a ≤25 palabras del ancla.
4. **El uso figurado se cuenta aparte** y se reporta: es un hallazgo cultural y es ruido para el
   conteo.
5. **Descarte declarado**, con su conteo por razón.

### Paso 3. Discovery abierto

- **Términos que crecen en la voz:** palabras y pares contados una vez por mención, NOW contra PREV,
  marcando cuáles ya cubre un ancla.
- **Vocabulario propio del dominio:** lift ≥2 en menciones del dominio contra el resto de la voz, y
  su crecimiento.
- **Un candidato se lee en muestra antes de volverse tema.** Si pasa, entra en una ronda 2 con el
  mismo molde.
- **Resultado posible y válido: que no aparezcan temas nuevos con volumen.** Entonces la salida del
  discovery son cortes nuevos (momentos, marca), no temas, y se dice así.

### Paso 4. Reloj de la curva

Por tema: voces PREV y NOW, momentum pertinente y multiplicador con su **intervalo bootstrap**,
pendiente de 12 meses, empuje, concentración, salto de comunidad, resonancia, serie mensual por 1,000
voces y piso de señal. Salida: `curva.csv`.

### Paso 5. Reloj de la voz

1. **Muestra estratificada:** unidad = mención de voz; estratos = tema × periodo (PREV, NOW, resto);
   hasta 60 por estrato con semilla fija, y **≥100 por ventana en los temas candidatos al mapa** para
   leer el giro de etapa. Una mención con varios temas se codifica una vez. El codificador ve el texto
   propio (~900 caracteres alrededor del ancla) y 250 del post padre, que sirven para atribuir y nunca
   para codificar.
2. **Libro de códigos v1** con ejemplos en el idioma del mercado.
3. **Piloto de 300, codificado dos veces a ciegas**, kappa por eje ≥ 0.80. Los desacuerdos se vuelven
   reglas (v2). El kappa va al registro, **nunca a la slide**.
4. **Validación humana:** 150 menciones por eje leídas por una persona. Sin ella, el acuerdo es
   consistencia del libro y se declara así.
5. **Codificación completa** en lotes de 150, con validador por lote y revisión de texto contra glosa
   después de cada ola (`packages/pitch-kit/DATA.md` §15).
6. **Agregación:** pesos por estrato, pertinencia por periodo, etapas, índice de voz y su giro,
   momentos con cobertura y n, precio en lo pertinente, momentum pertinente. Salida: `voz.csv`.

### Paso 6. El mapa y los hallazgos

1. El mapa con sus lecturas y banderas, la rejilla de todos los temas, las etapas de todos, el mapa de
   calor tema × momento y la marca por momento.
2. **Cada porcentaje de momento va con su cobertura y su n:** "0% con amigos" de una muestra donde el
   momento casi no se declara no es un hallazgo hasta que se ve su base.
3. **Las tres frases** con su cifra y su prueba de lo obvio, en el chat, para el sí del usuario antes
   de las slides.
4. **Citas** literales, verificadas en su liga y con `assert` contra el corpus; elegidas verificables
   desde el principio (`DATA.md` §16).
5. **Imágenes reales** por hallazgo, con su pie.

### Paso 7. Drivers, horizonte y quién ya actúa

1. **Agrupa los temas del mapa en drivers** por lo que dicen sus menciones (glosas y asuntos
   dominantes), no por su posición. Cada tema en un solo driver, cada driver con dos temas o más y
   una tesis en una frase. Los hallazgos del deck se escriben por driver.
2. **Ordena por horizonte** con las reglas del plan: actuar ya, construir, vigilar.
3. **Índices de sobre-representación** por categoría del cliente o por mercado, con el n de cada
   celda, si el estudio tiene varios.
4. **Quién ya actúa:** por cada driver que llegue a "actuar ya" o "construir", las marcas y startups
   que ya mueven oferta sobre él, con fuente pública y fecha.
5. **El cruce con la oferta**, si el cliente la compartió: dónde la conversación va adelante de lo
   que se vende.
6. **El dataset con su diccionario:** `curva.csv` y `voz.csv` con una línea por columna (qué es, cómo
   se calcula, su unidad), para que el equipo del cliente o su copiloto lo consulten sin el deck.

## Quality gates

| Gate | Pasa si |
|---|---|
| A · Integridad | Todos los archivos y todas sus filas leídos, sin fechas inválidas |
| B · Reconciliación | Filas contra el tablero, con la diferencia explicada |
| C · Pertinencia | El tema en el texto propio, contexto a 25 palabras donde aplica, figurado aparte |
| D · Traslape | Los temas se traslapan y **nunca se suman** |
| E · Codificación | Libro versionado, piloto con kappa ≥ 0.80, validación humana, validador por lote |
| F · Verbatims | Cada cita verificada en su liga y literal contra el corpus |
| G · Afirmaciones | Menciones no son personas, el país es una estimación, cada cifra con su nivel |
| M1 · Marco = mapa | Las lecturas del mapa son exactamente las del marco, con sus umbrales escritos antes de los datos |
| M2 · Cuadrante del hallazgo | El builder hace `assert` de que cada tema citado en un hallazgo está en la lectura que dice su título; si se agrupa distinto, el título dice por qué |
| M3 · Intervalo | Ningún "crece" con un intervalo que toca ×1 |
| M4 · Empuje | Un tema con más de 60% emitido lleva su bandera y nunca se presenta como adopción |
| M5 · Base | Ningún porcentaje de etapa o momento sin su n y su cobertura; debajo del piso, "señal débil" |
| M6 · Drivers | Cada tema citado en un driver pertenece a ese driver (`assert`), y cada driver tiene su tesis |
| M7 · Horizonte | Las reglas de actuar ya, construir y vigilar se escribieron en el plan antes de los datos, y cada tema cae donde dicen |
| M8 · Saturado y estacional | Un tema grande que baja lleva "saturado" y no "pierde tirón"; un tema de temporada lo dice, aunque crezca |
| M9 · Vocabulario | La madurez se nombra igual que en los reportes publicados de noisia.ai (ver "Decisiones abiertas" en la definición) |

## Formato de output

La secuencia aprobada (19 slides; un primer corte de 15 regresó con "calidad por debajo"):

| # | Slide | Qué lleva |
|---|---|---|
| 1 | Portada | La pregunta y una cifra gancho |
| 2 | Las respuestas | Las tres frases con su página |
| 3 | Panorama | Embudo, reparto por canal y mes a mes por red |
| 4 | El marco | Cultural Momentum Mapping en palabras llanas: dos relojes, cuatro lecturas y la señal temprana |
| 5 | **El mapa** | A todo lo ancho, lecturas sombreadas y nombradas, ejes en palabras, banderas visibles (`CHARTS.md` §9) |
| 6 | Todos los temas | Rejilla de pequeños múltiplos: tamaño por 1,000, curva y multiplicador |
| 7 | Las etapas | Barras apiladas de etapa de todos los temas |
| 8 | Tema × momento | Mapa de calor |
| 9 a 14 | Un driver en dos tiempos | "En datos" y "en la vida real", con su tesis y quién ya actúa sobre él |
| + | El horizonte | Los drivers en actuar ya, construir y vigilar, con la regla de cada columna |
| + | Señales tempranas | Los temas "ahead of the curve", si los hay |
| 15 | Momentos y marca | Dónde vive cada tema y dónde ya están las marcas: el espacio vacío |
| 16 | Canales | Para qué sirve cada canal y la parte figurada |
| 17 | La respuesta | Cierre y puertas de entrada |
| 18 | Método | Periodo, mercado, corpus, analizadas, tres columnas llanas. Sin κ |
| 19 | Glosario | |

Además: `curva.csv` y `voz.csv` como dataset y el video de estudio (`packages/motion`, formato
study).

## Failure modes conocidos

| Síntoma | Causa | Corrección |
|---|---|---|
| Un tema "explota" ×10 | Base chica o un hilo viral | K = 5, piso de 240 al año, concentración, intervalo |
| La curva sube por política | Un platillo usado como insulto o apodo | Contexto a 25 palabras, pertinencia por periodo, figurado aparte |
| Todo parece crecer | El corpus mismo crece | Restar el crecimiento del corpus y series por 1,000 voces |
| Una tendencia que es campaña | Empuje de marcas y medios | Bandera de empujada |
| Lo viral de las listas no aparece | Se busca, no se conversa | Contrastar por 10,000 menciones y decirlo como hallazgo |
| Un trimestre domina | Un evento cayó en esas ventanas | Pendiente de 12 meses como segunda medida |
| El mapa no se entiende | Gráfica chica, cuadrantes como texto gris | Tamaño mínimo y lecturas nombradas |
| El marco promete una lectura que el mapa no mide | El marco se escribió después de los datos | Gate M1 |
| 20 temas sueltos y hallazgos agrupados a mano | No se agruparon en drivers con regla | Paso 7 y gate M6 |
| El cliente pregunta "¿y cuándo actúo?" | El método no ordenaba por horizonte | Las reglas de actuar ya, construir y vigilar |
| Dos vocabularios de madurez en el mismo cliente | El estudio no leyó los reportes publicados | Gate M9 |
| Un hallazgo agrupa un tema que el mapa pone en otra lectura | El agrupamiento se hizo a mano | Gate M2 |

## Versionado

v1.0 · nov 2026 · definido desde el primer estudio, con lo que dejó abierto (señal temprana,
umbrales absolutos, intervalos, empuje, giro de etapa, salto de comunidad, validación humana) ya
dentro del protocolo.

v1.1 · nov 2026 · contrastado contra todas las referencias que lo inspiraron y contra los reportes
publicados de noisia.ai: drivers con tesis, horizonte con reglas, saturado y estacional, crecimiento de
la resonancia, índices de sobre-representación, quién ya actúa, cruce con la oferta, el dataset con su
diccionario, y las variantes rápida y de solo curva. Pendiente: un solo vocabulario con los reportes.
Se revisa después del segundo estudio.
