# ExecPlan R16 · Clasificación sólida y separación Escucha / Estudio

## Autoridad y alcance

El objetivo del fundador guardado en el adjunto `goal-objective.md` y el diseño privado DISENO_R16 del 14 de noviembre de 2026 sustituyen cualquier R16 previo. La auditoría privada del 13 de noviembre acepta R15. No se versionan esos documentos privados ni sus ejemplos de cliente. Alias único: Estudio real A (cerveza, Brasil).

Se trabaja desde develop, mediante PR y revisión independiente, CI y PostgreSQL. Sólo UAT: cada migración aditiva se ensaya en una copia y se aplica una vez. Producción, main, el engine multimétodo pausado y el rediseño de Signal quedan fuera. R15 y sus resultados permanecen disponibles.

Signal es el backend genérico del Reporte. Escucha y Estudios comparten corpus, raíces, vectores y etiquetas. Las preguntas provienen exclusivamente de configuración versionada de Brand OS; las metodologías son plantillas configurables, nunca textos fijos en workers. Se conserva Investigar marca de BrandOsForm y la capacidad del esquema para futuras propuestas de agente, sin construir esa experiencia ahora.

No hay aprobaciones humanas intermedias en los procesos de análisis: Sonnet 4.6 decide donde hay juicio, nunca Opus. El humano edita al terminar y sus decisiones prevalecen en ciclos posteriores. La revisión técnica de PR, los límites de gasto y la aprobación comercial de un plan son controles operativos, no pasos del análisis.

## Progreso

- H0: mediciones remotas de sólo lectura y pruebas de IO sintético registradas antes de cambios productivos; se distingue latencia histórica del proveedor de Storage/DB actuales. H1 se implementa en tres worktrees separados y todavía no acredita el throughput final.

- [x] Leer objetivo completo, diseño aprobado, auditoría y reglas del repositorio; contrastar develop y checkout.
- [x] Verificar límites y saldos actuales en las consolas autenticadas antes de cambiar el pipeline. Recibos privados, sin claves.
- [x] H0: baseline medido (ver «Sorpresas»). En la reanudación R16b (26-nov) se hizo además el mapa de qué se toma del PR de referencia #198 y qué se descarta.
- [x] H1 (R16b, PR #228): camino JEV nuevo con ritmo compartido de la cuenta, reintentos con Retry-After, páginas crudas y escritura en bloque. Corrida real en UAT de 5,000 raíces a 51.4 raíces/s con la solicitud de R15 sin cambios. La meta sintética de 1,000/s se sustituyó por una medición real (ver «Registro de decisiones»).
- [x] H2 (R16b, PR #229): configuración versionada de Escucha, caché por pregunta, «preguntar sólo lo pendiente» comprobado en UAT y vista genérica mínima en Signal.
- [x] H3 (R16b, PR #230): ciclo automático de tópicos, corrido completo en UAT (3 vueltas) y paquete ciego de 500 casos entregado al auditor.
- [x] H4 (R16b, PR #231): objeto Estudio, plantilla T&B como datos y corrida real en UAT; paquete ciego de §5.2 y cobertura privada de las causas humanas.
- [x] H5 (R16b, PR #236): sugerencias del léxico sin palabras vacías y por lift, edición posterior mínima, la página de Tópicos de Signal lee el mapa revisado, ADR 033 y guía de QA (`QA_R16B_UAT.md`).
- [x] Tras las evaluaciones ciegas (PR #236): pertenencia en dos niveles; pares de tópicos resueltos por el clasificador con una pregunta de elección; plantilla T&B v2 (dirección con fuerza propia desde 0.85, capa leída por menciones, léxico propio de un estudio); ciclo y estudios repetidos en UAT con esas reglas.
- [x] H5 parcial: corregir la extrapolación del recibo R15 y documentar el escenario de aproximadamente USD 114/millón, separando raíces de grupos/vueltas.
- [x] Ejecución real en UAT de Escucha y Estudio T&B; muestras ciegas sin clave, costos y tiempos en el recibo privado.
- [ ] Aceptación: la evaluación de las muestras ciegas es del auditor y las metas de calidad las decide el fundador. Este plan no declara precisión.

## H0 · Medición y presupuesto antes de cambiar código

Registrar organización, fecha, solicitudes/s y tokens/s visibles. Medir por separado duración física HTTP, subida/lectura de crudos, transacciones de base y materialización; distinguir espera de cola, ejecución, admisión y recuperación. Medir tokens facturados por raíz y número de preguntas sobre una cohorte reproducible. Los tiempos históricos orientan, pero no sustituyen medición actual del baseline. Usar operaciones de sólo lectura y un laboratorio desechable para escrituras de prueba; no modificar recibos originales.

Registrar importación CSV, preparación, Voyage, descubrimiento, clasificación, almacenamiento y Signal con un reloj de punta a punta, sin sumar intervalos superpuestos. Identificar esperas, retries y throughput sostenido, no sólo picos. Preparar la solicitud de aumento a Typesafe para varios millones de raíces mensuales, con tokens/raíz medidos y escenarios explícitos; no enviarla ni aceptar planes o costos sin autorización comercial.

Estimado del fundador: USD 10–15 para R16. Releer saldos antes de ejecutar; no comprar créditos ni activar recarga. Publicar cotización/cota total y conservar reservas, llamadas, uso, liquidación y exposición incierta. Agotar presupuesto nunca autoriza excederlo o reenviar respuestas ambiguas.

## H1 · Pipeline masivo

Quitar los techos internos que serializan el trabajo sin debilitar autoridad, presupuesto, idempotencia o recuperación. Admisión y ritmo global compartidos entre claves de una organización: solicitudes/s y tokens/s, con backoff 429/529 y Retry-After. La concurrencia debe cubrir latencia de red y almacenamiento, no limitarse al número de peticiones por segundo.

Guardar crudos por página en JSONL inmutable conservando bytes, identidad y procedencia de cada intento. Persistir en bloque con COPY o equivalente y materializar Signal incrementalmente. Separar envío, durabilidad y escritura para solapar I/O; recuperar páginas y llamadas sin dobles cargos ante caídas parciales. Medir presión de memoria, colas y etapas de persistencia.

Probar el pipeline completo, incluyendo durabilidad, escritura y materialización: ≥1,000 raíces/s sostenidas con proveedor simulado 0.1–0.5 s. Añadir fallos de proveedor, saturación de Storage/DB, caída entre página y manifiesto y reanudación. Luego correr JEV real al límite efectivo de la organización. Reducir tokens retirando trigger_barrier de la base y acortando definiciones contrastadas; conservar comparación de calidad y probabilidades.

## H2 · Escucha configurable

Base fija únicamente voice y promotion; textos y opciones en Brand OS versionado. Se conservan hashtags deterministas y léxico de categoría. Separar tópicos definidos y descubiertos, con originales y EN/ES. Umbral operativo inicial documentado de ocho definidos preguntados universalmente; sobre ese número se seleccionan candidatos por vectores. Descubiertos: cuatro candidatos próximos.

Preguntas choice genéricas: clave, pregunta, opciones con definición y alcance (corpus o consumidor/categoría). La identidad semántica de cada pregunta, ámbito y entrada determina la caché; añadir una pregunta sólo clasifica lo pendiente. Cambiar versión no invalida preguntas ajenas. Historia aditiva de trigger_barrier y sus etiquetas, sin borrado ni reinterpretación retroactiva.

Signal mínimo: distribución, cruce con tópicos y tendencia de cualquier pregunta. Sin nombres de metodología codificados en sus lectores o gráficos. Regresiones de Investigar marca y propuestas agénticas futuras como datos versionados.

## H3 · Descubrimiento cerrado

Evidencia local por vuelta: coaprobación/Jaccard de gemelos, aceptadas/preguntadas por tópico, huérfanas de categoría reagrupadas, centroides de miembros confirmados y fuera de categoría. Sonnet revisa una vez por vuelta: fusiona, contrasta definiciones, crea tópicos, asigna categoría/adyacente/fuera y organiza dos niveles de aproximadamente diez temas. Fuera se oculta por defecto con filtro para verlo. JEV posterior sólo pregunta tópicos.

Antes de la primera corrida se fija y sella la población comparable y los umbrales de detección y parada con sus denominadores. Propuesta operativa inicial a validar con pruebas: máximo tres vueltas; detener cuando huérfanas y coaprobación de gemelos mejoren ambas menos de un punto porcentual absoluto entre vueltas completas o el mapa sea idéntico. No cambiar esos umbrales después de ver la evaluación. Toda edición humana de nombre, definición, fusión o pertenencia queda congelada y protegida por versión frente al agente.

## H4 · Estudio y plantilla T&B

Objeto pequeño: corpus + corte/periodo + metodología versionada + sujeto. Reutiliza datos, vectores y etiquetas; ampliar corpus no crea otra copia. Leer METHODOLOGY del Pitch Kit §4/§4.6, KB de T&B y playbook antes de implementar. No modificar el engine pausado.

1. Corte consumidor: individual, promoción ≤0.7, sin sólo hashtags y con léxico de categoría.
2. Configurar tres preguntas con sujeto exacto: dirección trigger/barrier/mixed/none; objetivo category/own_brand/competitor_brand/alternative; uso literal/figurative_or_ironic/other. Invertir rechazo a convencional cuando el sujeto sea alternativa. Reportar competencia aparte del agregado de categoría, sin descartarla. Ironía se cuenta aparte.
3. Agrupar juntas trigger, barrier y mixed literales, con una clave de motivo y reparto por dirección. Muestra por grupo: 30–40 aleatorias y unas cinco lejanas; no sólo cercanas al centroide. Sonnet define y fusiona.
4. Capa del motivo mediante diagnósticos en orden: isla, dinero/tiempo, nadie se entera, sin amigos/redes. Fragmento literal obligatorio como evidencia; sin él unclear. Cultural exige lenguaje normativo. Sin capa por omisión: dos capas implican partir motivo. Permiso por regla: psicológico/personal movible, social parcial, cultural estructural, unclear sin permiso; excepción motivada y marcada.
5. Dos pasadas ciegas independientes Sonnet con muestras diferentes: medir κ. Si κ<0.8, ajustar fronteras y recodificar sólo esas; segundo fallo se marca sin repetir indefinidamente.
6. JEV asigna cuatro motivos cercanos sólo donde existe dirección distinta de none. Concentración >50% del corte en motivo o capa provoca definición contrastiva y repregunta sólo afectada. Nota automática de sesgo del query con razón base.
7. Salida direccional: pesos por capa/dirección, tensiones, motivos×tópicos de Escucha, motivos×canal y serie temporal. Verbatims como subcadenas verificadas, enlace/red/fecha y redacción de usuarios y personas privadas. Contar menciones con señal, no cantidad de barreras.
8. Acción explícita posterior para promover motivos a tópicos definidos en Brand OS del reporte.

## H5 · Complementos y ADR033

Recibo: separar Voyage/JEV por raíz de Claude por número de grupos y vueltas; fórmula explícita del escenario de aproximadamente USD 114/millón, no extrapolación lineal de Claude. Léxico con stopwords por idioma y lift; verificar que cerva y litrão estén entre las primeras diez sugerencias. Edición posterior mínima: corregir/quitar etiqueta de mención y fusionar tópicos, además de renombrar/redefinir. Nunca necesaria para avanzar. ADR033 explica Escucha/Estudio sin datos del cliente.

## Validación y aceptación

- Transporte: benchmark reproducible end-to-end ≥1,000 raíces/s con proveedor simulado, medición real limitada por organización, tokens/raíz y CSV→Signal por etapa. Solicitud de aumento preparada, sin contratación.
- Escucha real UAT: base y descubrimiento, apuestas/racismo, sin T&B fijo; ciclo completo y pares de evaluaciones ciegas antes/después de 500 casos de tópicos por cohortes de volumen.
- T&B real UAT sobre mismo corpus: ≥200 casos estratificados de dirección/objetivo/uso (mixed, marcas ambiguas y falsos irónicos); unos 30 falsos none dentro y 30 fuera del corte; diez miembros por cada uno de veinte motivos mayores para pureza/herencia; cuatro candidatos por cohortes; κ entre pasadas.
- Comparación privada de las 22 causas humanas y medición literal/irónico como candidata a base, sin activarla por defecto.
- Paquetes sin claves con SHA256SUMS; claves privadas separadas. Auditor evalúa; no se promete precisión no medida ni se usa como puerta humana intermedia.
- Todas las migraciones ensayadas en copia, aplicación única UAT y paridad de históricos/permisos. PR revisados; CI y PostgreSQL efectivamente verdes. UI mínima y regresión Brand OS agéntico.
- Recibo de costo/tiempos por etapa, guía corta QA en UAT y diez líneas en español. No declarar completo por tests locales o por leer este plan.

## Sorpresas y descubrimientos

- El PR documental agotó el heap de aproximadamente 2 GiB de Node en el build completo de Studio, sin cambios de aplicación respecto a R15. La misma construcción local con 4 GiB y placeholders aislados de CI pasó completa. Se conserva el primer log y el resultado posterior de CI se verificará antes de fusionar.
- La sección 4.6 de METHODOLOGY no está en el checkout de develop; se consultó el archivo vigente mediante una referencia Git de main en sólo lectura. No se fusiona ni modifica esa rama. El diseño aprobado R16 manda sobre diferencias del playbook anterior.

- H0: 83,962 llamadas históricas completas, 137,026,416 tokens y 1,632.005 tokens/raíz. Se leyeron 24 crudos físicos con hashes verificados: latencia histórica de proveedor p50 82.4 ms y p95 134.6 ms. No se presenta como inferencia nueva. Lecturas Storage actuales: media 250 ms; RTT de DB aproximado 72–77 ms salvo un valor de 159 ms.
- H0: adaptador Storage actual, prefijo sintético propio en UAT: cinco archivos lógicos causaron 21 operaciones HTTP. Tras el primer envío de 2.87 s, cuatro envíos tardaron 1.12–1.31 s. Una página de cuatro filas tardó 1.20 s, frente a aproximadamente ese costo por cada raíz individual. No se modificaron objetos anteriores.
- H0: en tabla temporal de la copia privada, 200 actualizaciones individuales tardaron 108.9 ms y una actualización JSONB equivalente de 200 filas 5.45 ms. Es SQL representativo en copia, no un benchmark del store productivo ni evidencia del objetivo de 1,000/s.
- H0: además del techo de ocho slots que incluyen persistencia, el scheduler deja 30 s entre páginas de 200 y el drainer consulta cada diez segundos. PersistRawPage aún guarda objetos por raíz: cambiar sólo un flag no produce páginas JSONL.

- Baseline preliminar sin proveedores ni datos reales: el transporte productivo intacto procesó tres cohortes sintéticas de 80 raíces con proveedor simulado 100/500 ms y crudo individual de 100 ms. Los resultados, tiempos por etapa y límites se guardan en custodia privada; esta prueba no sustituye las mediciones remotas H0 ni el benchmark de aceptación completo con durabilidad/DB reales.

- Los documentos privados reflejaban saldos previos. La consola actual muestra más crédito; se registra evidencia privada nueva y no se presupone recarga por parte del agente.
- El cliente JEV actual tiene concurrencia por defecto dos y valida máximo ochenta; el worker mass-labeling v2 agrega un techo interno de ocho. Esto requiere perfilado por etapa antes de elegir un cambio.
- El checkout no tiene .data local. La custodia existente está en el checkout privado de Downloads; no copiarla a Git.
- El promedio del piloto completo incluye una etapa editorial que no escala por raíz. Multiplicarlo linealmente daba USD 205.81/millón; mantener explícitamente los grupos y una vuelta de referencia produce USD 114.035250. Ambos cálculos parten del mismo recibo, cuyo uso histórico permanece USD 17.280463.

- R16b: los límites de la cuenta de JEV (80 solicitudes/s y 100,000 tokens/s) son el freno real: 51–68 raíces/s sostenidas según cuántas preguntas lleve cada raíz. La solicitud de aumento se envió sin aceptar planes.
- R16b: una revisión completa del mapa con razonamiento previo no cabe en el límite de salida de Sonnet 4.6 (se cortó a 64 mil tokens tras 16 minutos). Sin razonamiento previo, con los tópicos conservados reducidos a su clave y con los cambios pedidos antes que la lista de conservados, tarda 85–160 s.
- R16b: sin razonamiento previo el orden del esquema decide el orden del juicio. La misma instrucción hizo 1 fusión con «conservados» primero y 3 fusiones más 10 redefiniciones con «cambios» primero.
- R16b: promediar en una sola consulta los vectores de todas las raíces confirmadas pasa el límite de 2 minutos de UAT; se leen por páginas.
- R16b: en cada vuelta los candidatos de una raíz se recalculan con los centros de los miembros confirmados, así que una vuelta vuelve a preguntar a la mayoría de las raíces aunque cambien pocos tópicos. Las huérfanas bajaron de 22.3 % a 15.8 %; la señal de posibles gemelos subió de 20.8 % a 35.4 % porque cada raíz acumula respuestas de más tópicos. Si la evaluación ciega confirma gemelos como fallo principal, el ajuste es la regla de fusión, no más vueltas.
- R16b: un texto cortado a media letra (emoji) no se puede guardar como JSON; una revisión independiente lo encontró antes de la primera corrida del Estudio.
- R16b: el panel de sugerencias del léxico tarda cerca de 50 s en la marca de prueba por la consulta base de población, anterior a R16b.
- R16b: la primera evaluación ciega del ciclo dio una precisión baja con la rúbrica completa de tópicos visibles. Los miembros aceptados entre 0.70 y 0.85 acertaban unas seis veces de cada diez, contra ocho o nueve por encima; y la revisión fusionaba pocos de los pares que el clasificador acepta juntos.
- R16b: las causas del estudio humano de referencia responden otra pregunta (qué acerca o aleja de seguir el torneo) que un estudio sobre la categoría del léxico, y la mayoría de sus menciones queda fuera del corte por léxico. La cobertura privada sale baja por eso, no por la mecánica del estudio.
- R16b: el almacén de colas de UAT se suspendió por tope de presupuesto durante la jornada; el ritmo compartido hace una operación en él por cada solicitud a JEV. Mientras duró, las corridas se hicieron desde un equipo local contra la base y los proveedores de UAT, con el mismo código.

## Registro de decisiones

- 2026-11-26 (R16b): el brief de reanudación sustituye la aceptación sintética de H1 (≥1,000 raíces/s con proveedor simulado) por una corrida real en UAT de 5,000 raíces a ≥40 raíces/s. No se construyó el benchmark sintético.
- 2026-11-26 (R16b): camino JEV nuevo y delgado junto al de R15, que queda como historia legible. La validación vive en TypeScript, no en triggers; las migraciones 0295–0297 son aditivas.
- 2026-11-27 (R16b): las huérfanas se agrupan con k-means esférico sobre los vectores existentes en lugar de BERTopic; Sonnet decide si hay tópico y JEV confirma cada miembro.
- 2026-11-27 (R16b): umbrales de posibles gemelos fijados antes de correr: Jaccard 0.2, coaprobación 0.4 o solapamiento 0.5 del tópico menor. Parada: máximo 3 vueltas, o mapa sin cambios, o mejora menor a un punto en huérfanas y gemelos.
- 2026-11-27 (R16b): Sonnet 4.6 responde sin razonamiento previo en revisión de mapa y en el Estudio; cada esquema pide las razones antes del veredicto. Toda respuesta pagada se guarda y se cobra antes de construir sobre ella.
- 2026-11-27 (R16b, a pedido del auditor): la página de Tópicos de Signal lista el mapa revisado; lo que listaba antes queda plegado como mapa anterior. No se reconstruyó el linaje de recibos anterior.
- 2026-11-27 (R16b, decidido por el auditor tras la evaluación ciega): pertenencia confirmada desde 0.85 y probable de 0.70 a 0.85. Es política del ciclo, no una constante.
- 2026-11-27 (R16b, corregido por el auditor tras evaluar el estrato de fusión): un par aceptado en conjunto en 0.4 o más ya no se fusiona por omisión. La revisión escribe contraste y el clasificador elige para cada mención compartida entre izquierda, derecha, ambos o ninguno; el par se fusiona si la mayoría es de ambos. Quien implementa agregó una condición al aplicarla en la corrida real: además el par debe solaparse en conjunto (Jaccard de 0.2 o más), porque dos pares con solapamiento de 0.04 y 0.10 tenían 95 % de sus compartidas en ambos.
- 2026-11-27 (R16b, decidido por el auditor tras la evaluación ciega del estudio): plantilla T&B v2. `none` por omisión y dirección desde 0.85; pertenencia a motivo desde 0.85; capa leída sobre unas veinte menciones por motivo en dos lecturas ciegas, con acuerdo medido sobre las menciones.
- 2026-11-27 (R16b, decisión de validación del auditor): segundo estudio sobre el mismo corpus con sujeto «seguir el torneo» y corte por léxico propio, para poder compararlo con las causas del estudio humano. Un estudio puede traer su léxico; el de la marca sigue siendo el del reporte.
- 2026-11-27 (R16b, decidido por el auditor sobre dos muestras ciegas): la dirección del Estudio se redacta en positivo, cuenta desde 0.70 sobre la probabilidad de la opción elegida y la banda de 0.50 a 0.70 sólo ayuda a descubrir motivos (plantilla `r16b-v3.3`). Antes se probaron y descartaron: una redacción en dos pasos con restricciones (más estricta que la anterior), dos preguntas de sí o no, y ampliar la definición del sujeto. Entra a motivos toda mención con dirección contada cuyo uso no sea figurado o irónico.
- 2026-11-27 (R16b, a pedido del auditor): al terminar un ciclo se pregunta al clasificador por todos los pares de posibles gemelos, no sólo por los que la revisión señala. Una fusión que esa pasada pida se guarda con la vuelta y se aplica al leer el mapa.
- 2026-11-27 (R16b): las correcciones de personas son filas agregadas que se aplican al leer el mapa; una fusión deja ambos tópicos bloqueados para el agente y el siguiente ciclo parte del mapa revisado.

- 2026-11-14: reservar 4 GiB de heap únicamente al paso de construcción de Studio en CI; no omitir lint, tipado, build ni gates. UAT y sus variables no cambian.

- 2026-11-14: implementar H1 en tres ramas/worktrees existentes limpios y separados: crítico DB/páginas/lector dual, estándar proveedor/scheduler, mecánico benchmark con almacenamiento y PostgreSQL reales. El orquestador conserva integración, pruebas remotas, gasto, revisión y fusión; ninguno opera cuentas o UAT. El resultado sintético inicial y la escritura temporal no cuentan como aceptación de 1,000/s.

- 2026-11-14: R16 nuevo prevalece sobre el plan piloto anterior. La evidencia literal de T&B sirve para integridad de la salida/capa y no se convierte en Claude por mención ni puerta de clasificación.
- 2026-11-14: preservar R15 aceptada y empezar en rama desde develop c1c7ed5e. No modificar implementación hasta cerrar baseline H0; lecturas y documentación preparatoria son gratuitas.
- 2026-11-14: separar capacidad interna sintética de throughput real: organización observada 80 solicitudes/s y 100,000 tokens/s compartidos entre claves. No prometer 1,000 raíces/s reales con ese límite.
- 2026-11-14: publicar una fórmula condicional con coeficientes medidos en R15 y costo editorial por grupos/vueltas; actualizar la proyección histórica sin cambiar sus recibos ni presentarla como costo medido de R16. Reconstrucción verificada con aritmética decimal exacta.

## Resultado y retrospectiva

R16b (26–27 de noviembre de 2026) implementó los cinco hitos sobre develop y los corrió en UAT con la marca de prueba «Estudio real A (cerveza, Brasil)». Lo que existe ahora:

- **Escucha configurable.** La base es `voice` y `promotion`; tópicos definidos, tópicos descubiertos y preguntas con opciones viven en la configuración versionada de Brand OS. Agregar una pregunta pregunta sólo lo pendiente.
- **Ciclo cerrado.** Señales sin proveedor, revisión del mapa por Sonnet 4.6 una vez por vuelta, JEV sólo repregunta tópicos, máximo 3 vueltas, sin aprobación humana.
- **Estudios.** Un Estudio es corpus + corte + metodología versionada + sujeto. La plantilla T&B es un archivo de datos. Su salida se marca direccional.
- **Edición posterior mínima**, **sugerencias del léxico por lift** y el **mapa revisado en la página de Tópicos** de Signal.
- **Pertenencia en dos niveles**, como política de cada ciclo, y **pares de tópicos resueltos por el clasificador** mención por mención, también al cierre del ciclo.
- **Plantilla T&B `r16b-v3.3`**, con la línea de dirección medida en ciego. Lo que un estudio encuentra depende del corpus: el segundo estudio de prueba pregunta por un sujeto que la consulta del corpus no buscó y encuentra poco.

Qué no se hizo o quedó distinto de este plan: no hay benchmark sintético de 1,000 raíces/s; no hay pruebas de integración con Postgres para las funciones nuevas (se verificaron con corridas reales y con un ejercicio en UAT dentro de una transacción deshecha); el mapa revisado en la página de Tópicos todavía no tiene tendencia ni evidencia por tópico; el runner de R15 sigue en el código; con más de ocho tópicos definidos todavía se preguntan todos; y las pantallas nuevas no se revisaron con una sesión iniciada en UAT.

Costos, tiempos por etapa, identificadores y paquetes ciegos están en la custodia privada (`.data/piloto-masivo/r16b/`), no en el repositorio. La calidad la mide el auditor con los paquetes ciegos; este documento no declara precisión.

El modelo de costo de referencia sigue en R16_COST_MODEL_BASELINE.md.
