# ADR 033 · Escucha y Estudios sobre un corpus compartido

Estado: implementado en develop y corrido en UAT (R16b, 27 de noviembre de 2026). La evaluación de calidad es del auditor y está pendiente; producción queda fuera.
Fecha: 2026-11-14; implementación añadida el 2026-11-27.

## Contexto

La clasificación masiva comparte datos útiles para monitoreo y para metodologías específicas. Mantener preguntas metodológicas en el clasificador base acopla ambos productos y repite costo por mención. Una clasificación rápida requiere separar envío HTTP, evidencia durable y materialización sin perder derechos, presupuesto o recuperación.

## Decisión

### Corpus y Escucha

El corpus pertenece a la marca y conserva importación, raíces deduplicadas, fragmentos y vectores. Se reutiliza entre Reporte y Estudios; un Estudio no crea otra importación o ejecución Voyage por defecto.

Brand OS posee una configuración de Escucha versionada. Sus unidades son tópicos definidos, tópicos descubiertos y preguntas con opciones. Cada pregunta define clave, texto, opciones con definición y alcance. La base común contiene sólo voice y promotion, además de filtros deterministas existentes de hashtags y léxico de categoría. trigger_barrier sale de la base hacia la plantilla T&B; sus versiones y resultados históricos permanecen legibles.

Todos los textos enviados a JEV se obtienen de esa configuración. Un compilador genérico puede validar y serializar el contrato, pero no contiene preguntas específicas de metodología. Las plantillas metodológicas son datos versionados que producen la configuración de un Estudio. La identidad de pregunta, entrada y alcance permite reutilizar respuestas y clasificar sólo preguntas nuevas o cambiadas.

Se preserva Investigar marca de Brand OS. El esquema admite propuestas con procedencia de agente para preguntas y tópicos; la experiencia agéntica de diseño no se construye en R16.

Signal sirve el Reporte como backend agnóstico de metodología: volumen por tópico, distribución por pregunta, cruces y tendencia. R16 añade únicamente las superficies necesarias para esas preguntas genéricas.

### Descubrimiento cerrado

El descubrimiento calcula coaprobación de gemelos, tasa de aceptación, huérfanas, centroides de miembros confirmados y relación con la categoría. Sonnet 4.6 revisa el mapa una vez por vuelta, fusiona y contrasta definiciones, crea tópicos y organiza una jerarquía de dos niveles. Clasifica categoría, adyacente y fuera de categoría; esta última queda oculta por defecto con acceso mediante filtro.

Las vueltas posteriores vuelven a preguntar sólo tópicos. La regla de parada y sus denominadores se sellan antes de correr; hay un máximo de tres vueltas. No hay aprobación humana intermedia. La revisión humana de la evaluación ciega mide calidad y no bloquea el proceso automático.

Las ediciones humanas posteriores prevalecen: nombres, definiciones, fusiones y asignaciones manuales quedan protegidas frente al agente mediante versiones y precedencia explícitas. Un resultado automático no sobrescribe una edición concurrente.

### Estudios

Un Estudio es corpus + corte/periodo + metodología versionada + sujeto. Es un objeto nuevo y pequeño, independiente del engine multimétodo pausado.

La plantilla T&B aplica el método de la KB y Pitch Kit: corte consumidor/categoría; dirección, objetivo y uso; agrupación conjunta de trigger, barrier y mixed en motivos; capa por motivo; asignación JEV de motivos; chequeos y salida direccional. El objetivo distingue categoría, marca propia, competidor y alternativa. El rechazo de lo convencional puede empujar hacia una alternativa; los motivos de competencia se reportan aparte del agregado de categoría. Ironía queda separada del uso literal.

La capa se determina automáticamente por Sonnet siguiendo los diagnósticos metodológicos, con evidencia literal de la muestra y sin valor por defecto. Dos capas requieren dividir el motivo; ausencia de evidencia produce unclear. El permiso para actuar se deriva de la capa mediante reglas, con excepciones justificadas y marcadas. Dos pasadas independientes y ciegas miden estabilidad; los casos frontera tienen una sola recodificación y el segundo fallo queda explícito.

Un motivo tiene identidad única y reparto por dirección, incluyendo tensiones. La salida ofrece pesos, cruces con Escucha/canal y tendencia. Cada verbatim se verifica como subcadena del texto y lleva procedencia, con redacción de usuarios y personas privadas. Esta integridad de la salida no implica Claude por mención ni aprobación humana del etiquetado.

Una acción explícita posterior puede promover motivos del Estudio a tópicos definidos del Brand OS del Reporte. No modifica silenciosamente la Escucha que originó el Estudio.

### Transporte, durabilidad y autoridad

JEV es un clasificador masivo. El transporte desacopla solicitudes, páginas durables y escrituras en bloque con colas y memoria acotadas. El ritmo se gobierna por límites de solicitudes y tokens de la cuenta del proveedor compartidos entre claves y productores, no por organización de cliente ni por workspace. Respeta Retry-After y conserva evidencia de rechazos físicos; un resultado ambiguo no autoriza reenvío.

Los crudos nuevos se almacenan por página JSONL inmutable. El manifiesto de página y cada miembro preservan ámbitos, digest de solicitud, bytes y hashes. La página debe estar durable y verificada antes de liquidar o aplicar resultados. Los lectores mantienen compatibilidad con objetos históricos individuales. La recuperación no vuelve a llamar al proveedor para una respuesta ya guardada.

La base ya dispone de operaciones por lote y proyecciones incrementales; se reutilizan y se miden. No se elimina un control de lease, permisos, política, derechos, presupuesto o identidad para obtener throughput. La aceptación de capacidad interna usa el pipeline completo con PostgreSQL y almacenamiento durables, no sólo fetch simulado o un store en memoria. La medición con proveedor real informa separadamente el límite de su cuenta.

### Operación y costo

Los procesos avanzan automáticamente dentro de su autoridad y presupuesto iniciales. El agente de juicio es Sonnet 4.6, nunca Opus. Revisión técnica, aplicación controlada de migraciones y contratación comercial son controles operativos separados de los pasos analíticos.

El recibo separa partidas que escalan por raíz de las que escalan por grupos y vueltas. No extrapola linealmente toda la factura editorial de un piloto al tamaño de otro corpus. Conserva uso a tarifa, cargos observados, reservas y exposición incierta como magnitudes distintas.

## Consecuencias y verificación

- Se conserva la historia de R15 y se agrega configuración nueva, sin borrar etiquetas previas.
- Cada pregunta y resultado puede rastrearse hasta su versión y ámbito; cambios ajenos no invalidan respuestas reutilizables.
- T&B produce motivos y capas además de indicadores, sin acoplar el backend genérico del Reporte a esa metodología.
- Toda migración se ensaya en una copia antes de aplicarse una vez en UAT. Producción y main quedan fuera de R16.
- La aceptación exige ejecución real de Escucha y Estudio en UAT, muestras ciegas separadas de sus claves, comparación privada y los gates del [ExecPlan R16](../product/PROMPT_LOOPING/PLAN_R16_ESCUCHA_ESTUDIO.md).
- El rediseño de Signal, el release a producción y la experiencia agéntica de diseño permanecen fuera del alcance de esta decisión de implementación.

## Implementación (R16b)

Lo que sigue describe cómo quedó construida la decisión y en qué se apartó del texto de arriba. No contiene datos del cliente; los recibos y paquetes están en custodia privada.

### Dónde vive cada pieza

| Pieza | Datos | Código |
|---|---|---|
| Preguntas, respuestas y pasadas de JEV | migración 0295: configuraciones, preguntas, pasadas, páginas crudas y respuestas | `signal-listening-questions-v1`, `signal-listening-config-v1`, `signal-listening*.ts`, `jev-paced-client`, `jev-account-rate-limit` |
| Ciclo de descubrimiento y correcciones | migraciones 0296, 0298 y 0299: ciclos, vueltas, tópicos por vuelta, ediciones de personas y lo que el clasificador eligió entre dos tópicos | `signal-listening-cycle-v1`, `signal-listening-cycle.ts`, `signal-listening-edits.ts`, `signal-listening-cycle-job` |
| Estudios | migraciones 0297 y 0300: estudios, motivos, motivos pasados al reporte y el léxico propio de un estudio | `signal-study-v1`, `data/study-templates/triggers-barriers.r16b-v1.json`, `signal-study.ts`, `signal-study-job`, `sonnet-json-agent` |

Todo se enciende con `NOISIA_SIGNAL_LISTENING_ENABLED=true`; apagado, nada de esto se ejecuta ni se muestra.

### Reglas que el código hace cumplir

- **Una respuesta se pregunta una vez.** La identidad de una pregunta es el modelo más la pregunta exacta; la respuesta se guarda por raíz junto con la huella del texto clasificado. El alcance decide a quién se pregunta, no forma parte de la identidad. Por eso agregar una pregunta, un tópico o un estudio sólo paga lo que falta.
- **Todo gasto nace con tope.** Cada pasada, ciclo y estudio fija su tope al pedirse y reserva lo que necesitan sus pasos siguientes. Una respuesta pagada se guarda y se cobra antes de construir sobre ella; una respuesta inservible también se cobra.
- **Sin puertas humanas.** Ciclos y estudios avanzan solos de principio a fin. Un fallo ajeno al proceso se reintenta unas pocas veces; un estudio fallido se puede volver a encolar sin repetir lo pagado.
- **Sonnet 4.6 para el juicio**, con salida restringida a un esquema y sin razonamiento previo: el razonamiento comparte el límite de salida y, sobre un mapa completo, no deja lugar a la respuesta. Cada esquema pide las razones antes del veredicto.
- **Las reglas de la metodología no se confían al agente.** En T&B la capa se lee mención por mención, sobre unas veinte menciones confirmadas de cada motivo y en dos lecturas ciegas. Una capa sin fragmento literal de esa misma mención queda como `unclear`; cultural exige además un fragmento normativo en la mención. El acuerdo se mide sobre las menciones y el motivo toma la capa que reúne la mayoría de los votos; si ninguna la reúne, queda `unclear`. El permiso sale de la capa.
- **Una dirección necesita la fuerza de quien habla.** `none` es la respuesta por omisión; una dirección cuenta desde 0.85 y por debajo se guarda como probable. La primera redacción leía simples menciones como impulso.
- **La dirección se pregunta en dos pasos (plantilla `r16b-v3.1`).** La segunda plantilla pedía una razón dicha y dejaba fuera lo que la metodología cuenta como impulso o freno: la emoción o la experiencia que alguien expresa sobre el sujeto. Jueces ciegos encontraron fuerza en tres de cada diez menciones que respondió `none`. Lo que la primera hacía mal era otra cosa: menciones sobre otro tema que sólo nombran al sujeto. Ahora se pregunta primero si la fuerza apunta al sujeto y luego su dirección, con un fragmento literal de cada lado. Una mención con dirección contada entra a motivos salvo que su uso sea figurado o irónico: la pregunta de uso responde «otro» cuando el sujeto no es un producto. Si una dirección pasa de la mitad del corte, la salida lo dice.
- **La línea de la dirección se midió, no se supuso (plantilla `r16b-v3.2`).** La tercera plantilla salió más estricta que la segunda: cada restricción en la redacción («por omisión», «sólo cuando», «sin fragmento, ninguna») le baja la confianza al clasificador, y la redacción casi no mueve lo que pasa de 0.85. Sobre dos muestras ciegas se eligió la redacción en positivo (qué es una fuerza, con «ninguna» como una opción más y una frase que dice que el sujeto incluye lo que es vivirlo) y la línea de conteo en 0.70, donde impulso y freno siguen en 85 % o más de acierto. Una dirección entre 0.50 y 0.70 sólo ayuda a descubrir motivos: sus menciones se agrupan y se nombran con las demás y no cuentan en volúmenes, pesos ni reparto por dirección. La salida separa las menciones que agruparon de las contadas.
- **La línea se lee sobre la misma cifra con que se midió (plantilla `r16b-v3.3`).** Para una pregunta de opciones, el clasificador da la probabilidad de cada opción y, aparte, una «confianza» en la elegida que corre más abajo (en promedio 0.07). Las muestras ciegas se juzgaron sobre la probabilidad de la opción elegida; `r16b-v3.2` leía sus líneas sobre la confianza y contaba una quinta parte menos de lo medido. Ningún estudio terminó con ella. Las plantillas anteriores conservan la confianza, que es con lo que corrieron.
- **Lo que un Estudio encuentra depende del corpus, no sólo de la plantilla.** El segundo estudio de prueba pregunta por seguir un torneo sobre un corpus que se levantó con una consulta de la categoría de la marca. Jueces ciegos vieron fuerza expresada hacia ese sujeto en 16 % de su corte: casi todo es comentario del partido. Se probó ampliar la definición del sujeto para que una emoción sobre un partido o un equipo contara; el clasificador marcó lo que no era (60 % de acierto en 0.70) sin captar mucho más, y se descartó. La cobertura baja de ese estudio frente al estudio humano del mismo tema viene del corpus. Un estudio sobre un sujeto que la consulta del corpus no buscó necesita su propio corpus.
- **Excepción única a «todo lo que se pregunta nace versionado».** Los dos estudios de prueba con la tercera plantilla se crearon el 27-nov-2026 con `r16b-v3`, que sólo dejaba entrar el uso literal. Antes de que agruparan se decidió la regla de uso, y en vez de crearlos de nuevo se editó en UAT la copia congelada de su plantilla (`group_uses` y la versión, que pasó a `r16b-v3.1`). Su copia es idéntica a la `r16b-v3.1` del repositorio. No hay código que cambie la plantilla de un estudio ya creado y no debe haberlo.
- **Lo que se muestra es literal.** Una cita es un fragmento exacto de su publicación, con liga, red y fecha, y sin nombres de usuario. Es integridad de la salida, no un requisito para etiquetar.
- **Las personas mandan.** Sus correcciones son filas agregadas que se aplican al leer el mapa: la última corrección de una mención y un tópico gana al clasificador. Una fusión deja ambos tópicos bloqueados para el agente, y el siguiente ciclo parte del mapa revisado.

### En qué se apartó del texto de arriba

- **Transporte.** Se construyó un camino nuevo y delgado junto al de R15 en vez de rehacer aquél; el de R15 queda como historia legible. La validación vive en TypeScript, no en triggers. La aceptación fue una corrida real al límite de la cuenta del proveedor, no un banco sintético: el freno medido es el límite de tokens por segundo de la cuenta.
- **Huérfanas.** Se agrupan con k-means esférico sobre los vectores que ya existen, no con el motor de tópicos, que exige el manifiesto completo de una preparación. El agente decide si un grupo es un tópico y el clasificador confirma cada miembro.
- **Candidatos por vuelta.** Después de cada revisión los candidatos de una raíz se recalculan con el centro de los miembros confirmados. Una vuelta vuelve a preguntar a la mayoría de las raíces aunque cambien pocos tópicos, y cada raíz acumula respuestas de más tópicos; eso reduce huérfanas y eleva la señal de posibles gemelos.
- **Signal.** La página de Tópicos lista el mapa revisado en dos niveles, para el periodo de la página y con lo de fuera de categoría oculto por omisión. Lo que listaba antes (el mapa de R15, con su linaje de recibos) queda plegado debajo como mapa anterior; no se reconstruyó ese linaje. Las preguntas genéricas se sirven en un panel de Monitoreo. El detalle por tópico del mapa revisado es una muestra de menciones, todavía sin gráfica de tendencia.
- **Pertenencia en dos niveles.** Tras la primera evaluación ciega (los miembros entre 0.70 y 0.85 acertaban seis de cada diez), la política del ciclo cuenta como confirmada la pertenencia desde 0.85 y guarda como probable la de 0.70 a 0.85, sin contarla. La política viaja con cada ciclo: uno ya terminado conserva la suya.
- **Los pares los resuelve el clasificador, mención por mención.** Un par de tópicos aceptado en conjunto en 0.4 o más de lo preguntado a ambos no se fusiona por esa señal: jueces ciegos sólo dieron por buenos los dos lados en 15 % de lo que esos pares comparten, porque uno de los dos suele ser un tópico que el clasificador acepta de más. La revisión escribe definiciones con contraste, a las menciones que ambos tienen se les pregunta a cuál pertenecen (izquierda, derecha, ambos o ninguno) y esa respuesta reemplaza sus dos pertenencias. El par se fusiona sólo si la mayoría pertenece a ambos y además los dos tópicos se solapan en conjunto (Jaccard de 0.2 o más): «ambos» alto con Jaccard bajo es solapamiento real; una mención puede llevar varias etiquetas y eso no hace duplicados a sus tópicos. El umbral vive en la política versionada del ciclo (`merge_min_jaccard`).
- **Vuelta de asentamiento.** Un ciclo que termina con pares por fusionar los fusiona, y manda al clasificador, con la redacción que tengan, todos los pares que sigan en la lista de posibles gemelos y a los que no se les preguntó en esa vuelta, estén o no sobre la línea de 0.4. Hace una pasada final sin revisión. En la evaluación ciega del ciclo corregido, de 48 menciones de los 16 pares que quedaban sobre la línea sólo una era de los dos tópicos. Una fusión que esas últimas respuestas pidan queda para el ciclo siguiente.
- **Léxico propio de un estudio.** El léxico de la marca dice qué menciones hablan de la categoría que escucha el reporte. Un estudio puede tratar de otra cosa dentro del mismo corpus, así que puede traer su propio léxico para su corte.
- **Ritmo compartido.** El límite del proveedor es de toda la organización y lo comparten todas las llaves y entornos; el limitador sólo ve el almacén de colas de su entorno. Si otro entorno llama al mismo tiempo, lo absorbe el reintento con espera.
- **Dos caminos de JEV.** El de R15 sigue en el código para leer su historia y para la pantalla anterior de etiquetado. Lo nuevo (Escucha, ciclo, Estudios) usa sólo el camino nuevo. Retirar el runner de R15 queda pendiente de una decisión de producto, no de una razón técnica.
- **Ensayo de migraciones.** El ensayo en copia es el trabajo de CI que aplica todas las migraciones numeradas a un PostgreSQL desechable. En UAT se aplicaron ejecutando el SQL, porque el diario de migraciones está desfasado.
- **Pruebas.** Las funciones puras tienen pruebas unitarias. Las funciones nuevas de base de datos se comprobaron con corridas reales y con un ejercicio en UAT dentro de una transacción deshecha; no tienen todavía pruebas de integración con Postgres.

### Pendiente fuera de esta decisión

Tendencia y evidencia por tópico del mapa revisado en la página de Tópicos; retirar el runner de R15; candidatos por vectores cuando haya más de ocho tópicos definidos; y un ritmo compartido que tome cupo por bloques en vez de una operación del almacén de colas por solicitud, siempre que no cueste velocidad (la cuenta del almacén de UAT se suspendió por presupuesto durante R16b). Un error no capturado del worker ya no imprime las propiedades del error, que en un fallo de autenticación del almacén incluían su contraseña; rotar esa contraseña en UAT queda a cargo de quien administra la cuenta.
