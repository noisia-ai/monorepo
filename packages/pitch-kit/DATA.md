# Datos · de exportación a evidencia defendible

> La capa de ejecución. `METHODOLOGY.md` dice **qué se puede afirmar y con qué fuerza**, y de
> dónde sale el corpus (LQL, sourcing, reglas de query). Este archivo dice **cómo se ejecuta**:
> inventario, ETL, controles, codificación y contratos de salida. Es agnóstico al sujeto, al
> proveedor y a la industria. Funciona con social listening, reviews, tickets o cualquier corpus
> conversacional.

Cuatro principios sostienen todo lo demás:

1. Cada mención conserva su origen.
2. Los archivos se procesan en streaming.
3. Un conteo se publica solo después de pasar sus controles.
4. Todo hallazgo cualitativo regresa a una mención y un hilo reales.

La meta no es resumir un archivo. Es construir evidencia que alguien pueda revisar, comparar y
usar para decidir.

## 1. Modelo mental

```text
brief
  ↓ alcance y pregunta de decisión
  ↓ queries y exportaciones          (METHODOLOGY.md)
  ↓ inventario y manifiesto
  ↓ perfilado en streaming
  ↓ reconciliación y pruebas de pertinencia
  ↓ normalización, deduplicación y solapamiento entre queries
  ↓ lectura por publicación, comentario, hilo, canal y tiempo
  ↓ taxonomía conocida y descubrimiento emergente
  ↓ codificación y selección de verbatims
  ↓ hallazgos, límites y procedencia
```

## 2. Lo que se cierra antes de procesar

Si una respuesta cambia el universo, no se asume. Se documenta.

1. La pregunta de investigación en una frase.
2. Sujeto, geografía, idioma y periodo.
3. Qué fecha está completamente cerrada.
4. Si el trabajo es agnóstico, de marca o comparativo.
5. Qué decisión toma quien recibe el análisis.
6. Qué query representa el universo y cuáles son cortes, contexto o competidor.
7. Si los archivos traen el universo completo o una muestra.
8. Qué totales del tablero existen para reconciliar.
9. Qué idiomas y canales se conservan.
10. Qué exclusiones, homónimos y ruido se esperan.

## 3. Contrato de entrada

### Por archivo se registra

Nombre, tamaño, query asociada, rol analítico, periodo solicitado, fecha de exportación, zona
horaria, total mostrado por la plataforma, si es universo o muestra, versión vigente y versión
sustituida.

### Roles de query

El error más caro del método es sumar queries que contienen las mismas menciones.

| Rol | Función | Regla de volumen |
|---|---|---|
| Universo principal | Dimensiona la conversación del sujeto | Puede sostener el total general |
| Corte temático | Aísla un tema dentro del universo | No se suma al universo |
| Referencia indirecta | Recupera formas de nombrar que el ancla principal no cubre | Se reporta aparte hasta medir solapamiento |
| Narrativa emitida | Sigue mensajes y contenidos propios | No equivale a percepción recibida |
| Contexto | Describe el entorno de la conversación | No se suma como percepción del sujeto |
| Competidor | Permite comparación independiente | Universo propio y llave de entidad propia |

### Esquema mínimo

Los nombres de campo cambian entre proveedores. El esquema lógico necesita equivalentes de:
identificador, tipo de mención, título, autor, texto propio, fecha, contexto o publicación padre,
liga, dominio, grupo de fuente, sentimiento del proveedor, interacciones, idioma, país e hilo.

La ausencia masiva de autor, país o geolocalización no se corrige inventando datos. Se convierte
en una limitación explícita del entregable.

## 4. Lectura segura del archivo

Configuración típica de una exportación de listening: codificación `utf-8-sig` para absorber el
BOM, delimitador `;`, lectura por iteración, límite de campo ampliado por los saltos de línea
dentro del contenido, fechas parseadas como fecha y números limpiados antes de convertir.

**Streaming, no licuadora.** Los archivos llegan a cientos de megabytes. En una sola pasada, con
acumuladores, se obtiene todo lo que hace falta para decidir: filas totales, fechas mínima y
máxima, conteos por fuente, tipo, sentimiento y mes, campos faltantes, identificadores únicos y
sus colisiones, hilos y ligas únicas, anclas de pertinencia, indicadores de ruido, los registros
de mayor interacción y una muestra aleatoria reproducible. Se fija la semilla y se registra.

## 5. Periodo comparable

Nunca se compara un día o un mes incompleto contra periodos cerrados. Se define explícitamente
`period_start`, `closed_before`, `exported_at` y la zona horaria, y la regla de inclusión es
`period_start <= created_at < closed_before`.

Si la exportación incluye el día en curso, esas filas se conservan en el inventario, se excluyen
del análisis comparable y se reporta cuántas fueron.

## 6. Perfilado

Cada archivo produce un perfil con cuatro bloques:

- **Cobertura.** Filas exportadas, filas dentro del corte cerrado, filas del periodo parcial,
  primera y última fecha, fechas inválidas.
- **Composición.** Fuente, tipo, sentimiento del proveedor, idioma, país, mes o semana.
- **Completitud.** Autor, país, geolocalización, texto, liga e hilo vacíos.
- **Identidad y concentración.** Identificadores únicos y repetidos, filas exactamente repetidas,
  hilos y ligas únicas, participación de los diez hilos más grandes y de las diez ligas más
  repetidas.

El perfilado es un diagnóstico del corpus. Todavía no es un hallazgo sobre la audiencia.

## 7. Reconciliación contra el tablero

El total del tablero y el número de filas pueden diferir por fuentes no incluidas en el widget,
agrupaciones distintas de tipo de contenido, hora de captura, exportación posterior al screenshot,
límites de la plataforma o registros añadidos entre consultas.

Se suma el desglose por fuentes del tablero, se cuentan las filas por la misma clasificación, se
aíslan las categorías presentes en uno solo de los dos, se comparan los timestamps y se explica
toda diferencia material.

No se elige el número que se ve mejor. Se usa el número cuya definición coincide con la
afirmación que se va a hacer.

## 8. Pertinencia y contaminación

Antes de clasificar temas se comprueba que el query recuperó lo que debía. Se construyen reglas
de ancla para sujeto, geografía, tema de alta confianza, variantes ortográficas y alias, y reglas
separadas de ruido para homónimos, otras geografías, sentidos comunes de una palabra de marca,
noticias ajenas que secuestran el término y temas parecidos que no responden la pregunta.

Si un archivo falla pertinencia: se conserva la versión anterior como evidencia de control, se
corrige el query, se exporta de nuevo, se comparan volumen y anclas, se mide cuánto del archivo
corregido ya estaba en el universo principal y se declara cuál versión queda vigente. **No se
borra en silencio el archivo fallido ni se mezclan sus filas con la versión corregida.**

## 9. Solapamiento entre queries

Para cada par se calcula intersección, unión, índice de Jaccard y cobertura de cada uno en el
otro. Alta cobertura de B en A significa que B es un corte de A. Baja cobertura con propósito
distinto significa que B puede ser referencia o contexto. Competidores distintos no se unen ni se
suman sin una llave de entidad.

Los queries solapados sirven para leer capas. No sirven para inflar el tamaño de la conversación.

## 10. Llave canónica y deduplicación

El identificador del proveedor no siempre es único. Orden de preferencia: identificador estable
si pasa la prueba de colisiones, llave compuesta de fuente, liga, fecha, tipo y texto, o un hash
estable de esa llave compuesta.

Normalización permitida para la llave: decodificar entidades HTML, colapsar espacios, normalizar
Unicode, convertir la fecha a ISO y bajar dominio y tipo a minúsculas.

La limpieza genera campos nuevos. **No reescribe la evidencia original.** Se conservan siempre el
texto, el título, el contexto, el identificador y la liga en su forma cruda.

## 11. Unidad de análisis

Una fila no siempre significa lo mismo.

| Unidad | Qué permite afirmar |
|---|---|
| Mención | Volumen de registros |
| Publicación raíz | Agenda o marco emitido |
| Comentario | Lenguaje de aprobación, tensión o experiencia |
| Hilo | Dinámica conversacional y contexto |
| Autor | Concentración, solo con buena cobertura del campo |
| Reach | Distribución posible, nunca personas únicas |
| Interacción | Resonancia o actividad, nunca apoyo |

Nunca se dice personas si solo se contaron menciones. Nunca se presenta reach como cambio de
opinión.

## 12. Texto propio y contexto

Se separan al menos tres campos: el texto escrito en esa mención, el contexto heredado de la
publicación, y el texto completo. El texto propio se usa para codificar reacción, dirección e
intención. El texto completo, para pertinencia y búsqueda temática. El contexto, para leer el
hilo y atribuir la reacción.

Un comentario no se clasifica como positivo o negativo porque la publicación original contenga
esas palabras.

## 13. Muestreo antes de etiquetar

Antes de escribir una sola regla se lee una muestra que preserve variedad: publicaciones con más
interacción, hilos con más respuestas, muestra aleatoria reproducible, muestra estratificada por
canal y por mes, cada tipo de contenido por separado, casos de cada sentimiento del proveedor,
coincidencias de ancla y de ruido, y casos cercanos al límite de cada regla.

El top de engagement descubre agenda. La muestra aleatoria descubre frecuencia. Ninguna sustituye
a la otra.

## 14. Taxonomía

Dos movimientos a la vez. La taxonomía conocida sale de la pregunta de investigación. El
descubrimiento emergente sale de la muestra: se leen ejemplos diversos, se escribe una definición
operativa por tema, se guardan ejemplos positivos y negativos, se crean las reglas, se revisan
los falsos positivos, se iteran nombres y límites, y se congela una versión.

La taxonomía es un artefacto versionado, no una lista informal de palabras.

## 15. Codificación de triggers y barriers

El criterio y el permiso para actuar viven en `METHODOLOGY.md`. La ejecución:

- **Dirección.** Trigger, barrier, mixta o sin señal. Sin señal no significa neutralidad real,
  significa que la regla no encontró evidencia suficiente.
- **Capa.** Psicológica, personal, social o cultural. Una mención puede ocupar varias capas, por
  eso los conteos por capa se traslapan y **no se suman como partes de un total**.
- El etiquetado asistido sirve para encontrar candidatos, dimensionar señales y construir muestras
  de revisión. Por sí solo no afirma percepción poblacional ni precisión estadística.
- Se etiqueta después de ingerir. **Nunca se buscan triggers o barriers dentro del query**, porque
  eso pre-decide la respuesta.

### Validación antes de publicar conteos

Muestra fija por etiqueta, con positivos, negativos y casos sin señal. Se revisa sarcasmo,
negación, cita y lenguaje figurado. Se miden falsos positivos y negativos, se ajustan las reglas y
se congela versión y fecha. Se registra la versión de taxonomía y de clasificador, el tamaño de la
muestra, la precisión por etiqueta, los modos de falla conocidos y quién revisó.

Sin validación formal, los conteos se llaman direccionales. Así, con esa palabra.

### Si se usa un modelo generativo

Entra después del perfilado, para descubrimiento de temas, naming, clasificación asistida y
síntesis. No recibe el archivo completo para producir una respuesta sin estructura. Se envían
lotes con la llave estable, se exige salida estructurada por mención, se conservan modelo,
versión, prompt y fecha, se valida que regresó exactamente una respuesta por fila, se revisa una
muestra humana por etiqueta, y las menciones sin clasificar se quedan sin clasificar en lugar de
inventarles categoría. Los conteos salen de la tabla resultante, nunca del texto de síntesis.

## 16. Verbatims

Son evidencia, no decoración. Texto real y legible, liga conservada, fecha y canal, hilo
disponible cuando el contexto cambia el sentido, pertinencia clara al hallazgo, sin duplicados
textuales, sin datos personales innecesarios y sin corregir ortografía ni tono.

Un score puede ordenar candidatos combinando reglas activadas, claridad de la dirección, longitud
legible y diversidad de canal, fecha e hilo. **El score ordena. Una persona verifica la cita en su
fuente antes de que entre a una slide.**

## 17. Tiempo, picos y eventos

Se construye una serie diaria sobre el periodo cerrado, conservando menciones totales, por tema,
canales participantes e hilos dominantes.

Para leer un pico: identificar fecha y magnitud, localizar los hilos y publicaciones raíz
dominantes, leer los comentarios del hilo, nombrar el evento con evidencia, verificar
externamente si se va a presentar como hecho, y separar el acontecimiento de la reacción que
generó.

Un pico no se nombra por palabras frecuentes. Puede ser una publicación replicada o una
coincidencia territorial.

## 18. Rol de los canales

La distribución responde dónde. El rol responde para qué funciona ese canal en esta conversación:
masa y reacción, breaking news, tutoriales y decisión, queja, investigación, comunidades
especializadas. El rol se demuestra con verbatims de ese canal, no se asigna por estereotipo de
plataforma.

Esta lectura alimenta la slide de canales, que es parte de la secuencia canónica en `LAYOUTS.md`.

## 19. Contratos de salida

| Archivo | Contiene |
|---|---|
| `corpus_manifest.json` | Archivos, queries, periodos, roles, versiones y totales de plataforma |
| `corpus_profile.json` | Cobertura, composición, faltantes, pertinencia, ruido, duplicados, hilos y solapamiento |
| `coded_mentions.csv` | Llave, identificador crudo, fecha, fuente, tipo, liga, hilo, texto propio, contexto, banderas de pertinencia y ruido, temas, dirección, capas, elegibilidad de cita y versión del clasificador |
| `events.json` | Serie temporal, picos, publicaciones raíz, temas y evidencia de verificación |
| `verbatims.csv` | Texto, hallazgo, dirección, capa, fecha, canal, hilo, liga y estado de verificación |
| `PROVENANCE_AND_CHANGELOG.md` | Ver `templates/` |

## 20. Jerarquía de evidencia

| Nivel | Qué es | Cómo se escribe en la slide |
|---|---|---|
| Exacto | Conteo reconciliado con definición estable | Se afirma |
| Verificado | Evento o cita revisados en su fuente | Se afirma |
| Proxy de alta confianza | Regla con pocos falsos positivos conocidos | Se afirma con su alcance |
| Direccional | Clasificación asistida sin validación completa | Sugiere, apunta, se lee como tendencia |
| Exploratorio | Patrón que necesita nueva muestra | Se nombra como hipótesis |

El lenguaje del entregable respeta este nivel. No se escribe demuestra cuando la evidencia
sugiere.

## 21. Gates de calidad

Un entregable no pasa a deck mientras falle un gate que afecte su conclusión principal.

- **A. Integridad.** Los archivos crudos intactos, el parser leyó todas las filas, no hay fechas
  inválidas sin explicar, el periodo cerrado está documentado.
- **B. Reconciliación.** El total del tablero tiene definición, la diferencia contra el archivo
  está explicada, las fuentes omitidas están identificadas.
- **C. Pertinencia.** Anclas de sujeto y de mercado suficientes, ruido conocido cuantificado,
  versiones defectuosas retiradas del análisis.
- **D. Relaciones.** Solapamiento medido, cortes temáticos no sumados, contexto y percepción
  separados.
- **E. Codificación.** Texto propio y contexto separados, reglas versionadas, traslape declarado,
  casos ambiguos conservados.
- **F. Verbatims.** Cada cita con liga, fecha y canal, hilo leído cuando afecta el significado,
  ninguna cita inventada ni corregida.
- **G. Afirmaciones.** Menciones no son personas, reach no es apoyo, país incompleto no es
  residencia, sentimiento automático no es percepción final.

## 22. Fallas comunes

| Falla | Consecuencia | Corrección |
|---|---|---|
| Cargar todo el archivo en memoria | Bloqueo o truncamiento silencioso | Iterar con acumuladores |
| Tomar el día de exportación como día completo | Pico o caída falsos | Definir el cierre del periodo |
| Sumar queries temáticos | Volumen inflado | Medir intersecciones y asignar roles |
| Deduplicar solo por identificador | Pérdida o mezcla de registros | Llave compuesta estable |
| Clasificar un comentario con texto heredado | Polaridad contaminada | Separar texto propio y contexto |
| Tomar el neutral automático como neutral real | Se pierde el sarcasmo y la crítica | Leer contenido y validar reglas |
| Seleccionar solo posts virales | Agenda confundida con frecuencia | Combinar top, aleatoria y estratos |
| Citar sin hilo | Sentido incompleto | Recuperar publicación raíz y respuestas |
| Convertir multilabel en porcentajes sumables | Lectura matemática falsa | Declarar traslape y denominador |
| Ocultar el ruido eliminado | Falsa sensación de cobertura | Publicar exclusiones y su volumen |

## 23. Checklist operativo

**Antes del ETL.** Pregunta cerrada, decisión definida, archivos y queries inventariados, roles
asignados, periodo comparable cerrado, totales del tablero disponibles.

**Durante el perfilado.** Lectura en streaming, esquema y codificación confirmados, faltantes
medidos, colisiones revisadas, fuentes conciliadas, anclas y ruido cuantificados, solapamiento
calculado.

**Durante el análisis.** Publicaciones y comentarios separados, hilos reconstruidos, muestra
diversa leída, taxonomía versionada, reglas documentadas, casos ambiguos conservados, verbatims
verificados, eventos nombrados con evidencia.

**Antes de publicar.** Denominadores definidos, conteos sumables distinguidos de los que no lo
son, sentimiento y reach limitados a su función real, fuentes y filtros registrados, changelog
actualizado, y el hallazgo rector regresando a evidencia real.

## 24. Definition of done

El procesamiento está terminado cuando otra persona puede responder qué archivos entraron, qué
periodo se analizó, qué filas se excluyeron y por qué, qué universo representa cada query, cómo se
resolvieron duplicados y colisiones, qué significa cada conteo, qué etiquetas se traslapan, cómo
regresar de un hallazgo a sus menciones, qué afirmaciones son exactas o direccionales, y cómo
volver a ejecutar el proceso sin reconstruir decisiones de memoria.
