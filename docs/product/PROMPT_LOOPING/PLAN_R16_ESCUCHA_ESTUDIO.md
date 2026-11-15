# ExecPlan R16 · Clasificación sólida y separación Escucha / Estudio

## Autoridad y alcance

El objetivo del fundador guardado en el adjunto `goal-objective.md` y el diseño privado DISENO_R16 del 14 de noviembre de 2026 sustituyen cualquier R16 previo. La auditoría privada del 13 de noviembre acepta R15. No se versionan esos documentos privados ni sus ejemplos de cliente. Alias único: Estudio real A (cerveza, Brasil).

Se trabaja desde develop, mediante PR y revisión independiente, CI y PostgreSQL. Sólo UAT: cada migración aditiva se ensaya en una copia y se aplica una vez. Producción, main, el engine multimétodo pausado y el rediseño de Signal quedan fuera. R15 y sus resultados permanecen disponibles.

Signal es el backend genérico del Reporte. Escucha y Estudios comparten corpus, raíces, vectores y etiquetas. Las preguntas provienen exclusivamente de configuración versionada de Brand OS; las metodologías son plantillas configurables, nunca textos fijos en workers. Se conserva Investigar marca de BrandOsForm y la capacidad del esquema para futuras propuestas de agente, sin construir esa experiencia ahora.

No hay aprobaciones humanas intermedias en los procesos de análisis: Sonnet 4.6 decide donde hay juicio, nunca Opus. El humano edita al terminar y sus decisiones prevalecen en ciclos posteriores. La revisión técnica de PR, los límites de gasto y la aprobación comercial de un plan son controles operativos, no pasos del análisis.

## Progreso

- H1 CI en 841042c5: verify y PostgreSQL verdes; benchmark falló antes de JEV por statement_timeout en la invalidación semántica heredada durante INSERT de menciones. Se conserva la traza del trigger y se investigará una corrección productiva aditiva, sin ampliar timeouts ni saltar guards. El perfil por operación 1a9b4a28 y su matriz 8/8 están en diagnóstico de 1,002 raíces.
- H4: recibido el contrato puro aa9f12f5; revisión detectó tres P2: contraste sin definiciones vecinas, κ parcial ante particiones y dirección que mezclaba ironía. Se corrigen antes de integrar. El objeto persistente, sus owners y la ejecución siguen pendientes.

- H3 parcial: integrados 280e7e21 y los contratos puros canónicos de e961a366 como abde5169/f9dedc78, conservando H2 y H5. Tipado/lint 11/11, query-engine 678/678, DB 658/184 omisiones por entorno. La prueba dedicada conjunta de descubrimiento, léxico, runtime y recuperación pasó 4/4 sin omisiones, con 281 migraciones por clon. El owner monetario, la orquestación de vueltas y la aceptación real siguen pendientes.

- H1: el ensayo completo sobre 36668da1 terminó 32,768/32,768 raíces con crudos y aplicación íntegros, pero sólo 485.19 raíces/s y una ventana completa de cero. Proveedor simulado p50 301 ms/p95 459 ms; 147 páginas. El resultado rechaza H1 y exige localizar las pausas de SQL/materialización antes de otra corrida o proveedor real.
- H5: sugerencia genérica de léxico implementada en rama: categoría confirmada fuera del léxico frente a toda conversación de consumidor, conteos por raíz y lift suavizado, stopwords PT/ES/EN y soporte mínimo tres. Revisión sin P0/P1/P2; tipado/lint 11/11, query-engine 661 pruebas, API/algoritmo 6/6, UI montada 10/10, PostgreSQL nativo 1/1 sin omisiones con revocación de fuente y build completo de Studio verdes. Suites Studio 1,341/7 omisiones y DB 658/183; las pruebas nativas dedicadas no tienen omisiones. Falta CI, despliegue y comprobar cerva/litrão en el estudio real.

- H2: integración 92888e83 conserva H1 completo y las correcciones revisadas de calibración heterogénea, selección visible y recuperación anterior a nuevos envíos. Tipado/lint 11/11, workers 1,026 aprobadas/46 omisiones de entorno, Studio 1,339/7 y DB 658/182; build completo de Studio aprobado. Las dos pruebas dedicadas PostgreSQL pasaron 2/2 sin omisiones, con 280 migraciones por clon. Se añade un paso CI explícito para los cinco contratos DB y ambos runtimes, que falla ante cualquier omisión. Publicación/revisión final/CI y UAT siguen pendientes.

- H1: CI y PostgreSQL verdes en 5b2729a6. Su benchmark falló antes de JEV al alcanzar el límite del fixture de proyección. Los ajustes revisados 2c0f5e6d y 36668da1 mantienen límites ordinarios y productivos, habilitan explícitamente la población sintética y paginan metadatos en lotes de 2,000. La matriz posterior pasó 8/8 sobre 36668da1; el ensayo de 32,768 sigue activo y no acredita todavía throughput.

- H1: repetida la matriz 8/8 sobre 2f477597 después de ajustar únicamente el setup sintético; recibo SHA-256 022542af9f46c0723400897b69cb20e602e3f1420eee5935ed80f6b4c89cf6bc. Las páginas de preparación 3 y 100 produjeron idénticos textos, hashes, chunks, disposiciones y censo en PostgreSQL. El benchmark ahora usa 100, máximo admitido por el contrato productivo; los demás casos conservan 3. La cohorte de 32,768 está en ejecución y su throughput sigue sin acreditarse.
- H1: matriz integral completa 8/8 sobre 20004a41, con huella de código idéntica a 499c3116 en DB, workers, query-engine, scripts y workflow. Se verificaron 429/529 con exposición incierta, fallos de Storage/commit/ACK/reinicio y ambas fronteras de lease; cero reenvíos o liquidaciones duplicadas y cero HTTP tras denegaciones. El recibo sintético privado tiene SHA-256 2a0067a50a61898f475c97571ffb4b825d5f3df002b67138ca57eb79a24f9cd5. La corrida de 32,768 raíces sigue en preparación; todavía no acredita 1,000/s ni H1 completo.
- H1: la matriz distingue la entrega al adaptador del HTTP físico. Cohortes listas y una prueba privada del cliente para cancelaciones anteriores a fetch conservan las reservas no enviadas. Revisión independiente sin P0/P1/P2 para esos cambios; tipado/lint 11/11 y workers 1,007 aprobadas con 44 omisiones por entorno. CI y PostgreSQL de la nueva cabeza siguen pendientes.
- H1: integrado el harness con PostgreSQL/Redis reales, Storage HTTP con fsync/readback, matriz de fallos y workflow propio. La revisión corrigió una prueba de presupuesto que usaba el ID incorrecto, la mezcla de procedencia entre recibos, picos de memoria omitidos por muestreo y un doble fallo accidental en la prueba de lease. El benchmark sostenido sigue pendiente; no hay aceptación por pruebas unitarias.
- H1: la matriz encontró que reservas no entregadas al proveedor se finalizaban como errores. La corrección conserva esas reservas, drena toda escritura antes de liberar la lease y cubre también una caída durante recuperación anterior al primer envío. Las 41 pruebas focales y el caso PostgreSQL de reencolado pasan; faltan revisión final e integración del benchmark completo.
- H2: backend y UI mínimos integrados en rama separada; tipado/lint 11/11 y Studio 1,335 aprobadas con siete omisiones por entorno. La revisión detectó población completa recalculada por llamada y dos casos de lifecycle/precedencia humana; se corrigen mediante una migración posterior antes de solicitar aceptación.
- PR195 integrado a develop en 952eb507 tras revisión independiente de 60abe0e2 y CI/PostgreSQL verdes. Publica contratos y el heap del build; no modifica el despliegue de UAT.
- H1 parcial: páginas inmutables y lectores duales pasaron seis escenarios PostgreSQL con 276 migraciones, build y tipado/lint. La revisión del transporte encontró tres P1: ausencia de backoff sin cabecera, liquidación indebida de un rechazo con usage cero y errores técnicos sin aplicar. Se reprodujeron y las 48 pruebas focales pasan; suite workers con 987 aprobadas y 43 omisiones por entorno, tipado/lint 11/11. Faltan revisión del SHA final, integración del harness, CI y benchmark sostenido.
- H0: mediciones remotas de sólo lectura y pruebas de IO sintético registradas antes de cambios productivos; se distingue latencia histórica del proveedor de Storage/DB actuales. H1 se implementa en tres worktrees separados y todavía no acredita el throughput final.
- H1 diagnóstico integral: 1,002 raíces sintéticas completaron solicitudes, páginas durables y proyección Signal usando PostgreSQL y Redis reales. La corrida corta dio aproximadamente 494 raíces/s y no acredita la meta; el ensayo de 32,768 está en preparación/ejecución. Las fallas de aplicación y acuse perdido tienen prueba RED→GREEN, 48 focales pasan y la suite DB integrada suma 658 aprobadas/163 omisiones por entorno.
- H2 inició contratos y persistencia en rama/worktree separado. La exploración confirmó que V2 no tiene caché por pregunta y su unicidad por mapa impide ejecuciones incrementales; no se altera esa historia para añadir el nuevo flujo.
- H1 CI: verify pasó en e5606cde; PostgreSQL detectó una expectativa heredada que exigía repetir un rechazo HTTP incierto. La regresión focal sobre PostgreSQL migrado ahora comprueba una única solicitud, reserva conservada y recibo intacto. Las tres oportunidades explícitas siguen probándose con respuesta HTTP 200 inválida y uso conocido, que permite distinguir fallo semántico de facturación incierta. Falta el nuevo CI del candidato corregido.

- [x] Leer objetivo completo, diseño aprobado, auditoría y reglas del repositorio; contrastar develop y checkout.
- [x] Verificar límites y saldos actuales en las consolas autenticadas antes de cambiar el pipeline. Recibos privados, sin claves.
- [ ] H0: medir baseline separado de proveedor, tokens por raíz, crudos, base, materialización e importación/Voyage. Sin cambios productivos antes de esa medición.
- [ ] H1: transporte JEV masivo durable y rendimiento simulado ≥1,000 raíces/s con latencia 0.1–0.5 s; después medición real respetando ambos límites de la organización.
- [ ] H2: configuración versionada de Escucha, caché por pregunta y visualización genérica mínima.
- [ ] H3: ciclo automático de tópicos, con evidencia calculada, límites de vueltas y precedencia humana.
- [ ] H4: objeto Estudio, plantilla T&B completa y salida con evidencia literal verificada.
- [ ] H5: stopwords/lift, edición posterior, recibo de costo corregido y ADR033.
- [x] H5 parcial: corregir la extrapolación del recibo R15 y documentar el escenario de aproximadamente USD 114/millón, separando raíces de grupos/vueltas. El costo real de R16 sigue pendiente.
- [ ] H6: ejecución real en UAT de Escucha y Estudio T&B; muestras ciegas, comparación privada, guía QA, costos y tiempos.
- [ ] Aceptación final requisito por requisito, PR revisados y checks reales verdes, paquete con SHA256SUMS y resumen de diez líneas.

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

- El fixture de capacidad conserva de forma persistente los datos tras completar la corrida. Para perfilar sin alterar resultados se selló un pg_dump del laboratorio propio, se renombró la base sintética completa y se creó otra vacía. No se reiniciaron estados de llamadas ni se eliminó el corpus o sus recibos.
- La traza CI distingue el timeout de importación del throughput JEV: sync_signal_mention_governance invoca la procedencia por raíz y ésta dispara invalidate_signal_semantic_review_from_attributions_v1. Los límites de fixture ya no explican esa interrupción; falta medir y corregir el costo de esa ruta sin omitir su invalidación.

- El primer benchmark integral que completó toda la población conservó integridad y recuperabilidad, pero no velocidad: wall 67.54 s, 485.19 raíces/s. El setup de importación/preparación sintética tardó 827.58 s y se informa separado. Las duraciones de SQL y Signal se solapan; no se suman para inventar un tiempo de extremo a extremo.

- El fixture ampliado también heredaba un máximo de ocho páginas de embeddings y 1,200 raíces de proyección; después alcanzó el lector productivo limitado a 2,000 IDs. Se conservan esos límites por omisión y se pagina el lector oficial. Todos esos fallos fueron anteriores a la medición JEV: no son pruebas de velocidad ni justifican reiniciar un proceso vivo por tiempo de espera.

- El setup de 32,768 raíces heredaba páginas de tres, más de diez mil páginas de preparación antes de medir JEV. Se terminó expresamente esa corrida al identificar el parámetro y cambiar la fuente, conservando diagnóstico y comprobando rollback, cierre de sockets y cero envíos al proveedor. No fue un reinicio por falta de salida o duración. El ajuste se limita al ensayo sintético y no presenta como nueva una medición de importación del estudio real.
- Marcar sólo cohortes listas no bastó: mientras se confirmaba una cohorte, podía fallar un flush anterior y cancelar el cliente antes del HTTP. El adaptador sí recibió la llamada, pero no hubo solicitud física. Se distingue esa prueba local de una respuesta incierta o un aborto posterior a fetch; una excepción con el mismo código sin procedencia del cliente no acredita ausencia de envío.
- El recuento de resultados no bastaba para probar recuperación: dos respuestas físicas se recuperaban correctamente, pero una tercera raíz nunca enviada se convertía en error técnico final. Se exige recuperar resultados válidos sin reenviar las respuestas pagadas. Si se pierde la lease antes de persistir bytes, el resultado correcto conserva exposición incierta, sin fingir crudo durable.
- La prueba de denegación presupuestaria del primer harness pasaba por una admisión inexistente. Ahora usa el ID real, un control positivo y el código exacto de agotamiento. Matriz y capacidad deben compartir huellas del código y configuración; una fecha reciente o el mismo PostgreSQL no bastan.
- Las respuestas 429/529 pueden incluir campos de uso, incluso cero. Eso no prueba ausencia de procesamiento ni un cargo definitivo. El transporte conserva cuerpo y exposición como unknown, detiene nuevos envíos de la ventana y aplica un error técnico sin inventar una liquidación.
- La suite completa reveló que los consumidores híbridos anteriores inferían uso cero del HTTP 429/529. Se elimina esa inferencia al compartir el validador; sus errores técnicos conservan el crudo y exposición sin repetir el proveedor. No se habilita esa ruta ni se alteran recibos liquidados históricos.
- La segunda revisión detectó que un fallo de aplicación podía sustituir una respuesta válida por un error, incluso después de liquidarla. Las pruebas reproducen tanto fallo de apply como pérdida del acuse de settlement. La recuperación debe releer el recibo y ledger sin reenviar ni escribir una etiqueta sustituta.
- También se cubre el acuse perdido de una aplicación ya confirmada: el ledger debe cerrar la ejecución completa o dejar pendiente recuperable, nunca fallarla sin llamadas unknown que permitan reclamarla. Los fallos de nuestra persistencia se reconcilian bajo la lease antes de devolver el error.
- El primer ensayo de 32,768 raíces quedó sólo en preparación sintética: dos INSERT seriales por raíz y sus triggers dominaron el tiempo. Se terminó explícitamente al confirmar que su instrumentación anterior no podía acreditar aceptación, conservando el diagnóstico y el rollback con cero envíos. El siguiente ensayo usa inserciones agrupadas equivalentes, con todos los guards y admisiones nativos.
- La prueba de capacidad usa un proveedor y una cuenta de cuota sintéticos, aislados. El limiter Redis sigue siendo real y respeta esa cuota declarada; otra prueba conserva 80 solicitudes/s y 100,000 tokens/s. Limitar el proveedor simulado a 80 no demostraría la capacidad interna de 1,000/s ni sustituye la corrida posterior con Typesafe real.
- El recibo histórico R15 separa importación (6 h 35 min 45 s), preparación (16 min 25 s), Voyage (59 min 58 s), mapa y JEV. «Mapa disponible» incluye etapas interiores: no se suman para aparentar un tiempo CSV→Signal. La nueva corrida debe registrar sus propios extremos y esperas.
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

## Registro de decisiones

- 2026-11-14: conservar la base sintética completada como archivo y respaldarla con SHA antes de crear un laboratorio lógico vacío para el perfil siguiente. No reutilizar el map_id único mediante UPDATE de estados o recibos. Corregir el cuello de botella de importación por una migración posterior revisada; no elevar statement_timeout para ocultarlo.

- 2026-11-14: un tópico conservado sin miembros confirmados debe expresar esa ausencia. Se permite una extensión aditiva posterior con source_seed de cero miembros, centroide NULL y lineage no_confirmed_members verificado; permanece inactivo para candidatura hasta tener evidencia. No se inventan vectores, etiquetas ni cargos, y las preguntas no formuladas no cuentan como negativas.

- 2026-11-14: rechazar la aceptación H1 de 36668da1 a pesar de 32,768 resultados íntegros. Investigar pausas y costo por fase sin relajar la meta de 1,000/s ni mover el inicio de la medición para ocultarlas. El léxico nuevo usa evidencia de tópicos de categoría y no vuelve a introducir T&B en la base; ningún término del estudio recibe un impulso manual en el ranking.

- 2026-11-14: integrar la preparación y recuperación H2 sobre las cohortes H1 sin marcar toda la ventana como enviada. Incluir pruebas PostgreSQL de Escucha expresamente en CI; los skips esperados de suites sin entorno no sustituyen esas pruebas dedicadas.

- 2026-11-14: ampliar sólo las opciones explícitas del benchmark y paginar los metadatos sintéticos; no elevar el límite productivo de 2,000 raíces por lectura. Conservar el recibo fallido de CI y exigir una nueva matriz con la misma huella de fuente que la corrida sostenida.

- 2026-11-14: añadir un parámetro opcional de tamaño de página a la fixture, con los límites productivos 1–100. Mantener el valor histórico de tres por omisión y usar cien en el benchmark, con prueba de equivalencia y matriz completa regenerada bajo la misma huella que la nueva prueba de capacidad.
- 2026-11-14: permitir reencolado bajo la lease vigente de cancelaciones anteriores a fetch sólo con procedencia creada por el cliente nativo en el mismo proceso (marca privada), código y resultado explícitos y señal abortada. No inferirlo de JSON, ausencia de crudo, HTTP 429/529 o aborto posterior al envío. Conservar reserva, identidad y controles SQL; no inventar recibo ni liquidación cero.
- 2026-11-14: reencolar sólo los IDs que el scheduler vivo sabe que nunca entregó a evaluate, con lease vigente y sin crudo, página, uso, liquidación, resultado, lote o exposición terminal. Mantener identidad y reserva; nunca inferir ausencia de envío después de una caída. Drenar todas las escrituras antes de reencolar o liberar la lease, también si falla una recuperación previa al primer envío.
- 2026-11-14: mantener separadas la pérdida de lease antes y después de durabilidad; la primera acredita contención de exposición, la segunda recuperación de resultados. Un diagnóstico filtrado no produce un recibo de aceptación de la matriz completa.
- 2026-11-14: mantener unknown los rechazos ambiguos 429/529 aunque su JSON declare uso cero. Backoff compartido siempre, con piso exponencial de 1–30 s cuando Retry-After falte o sea menor; nunca reenviar el intento incierto. Si falla la actualización de la cuota compartida, cerrar nuevas admisiones y conservar el recibo físico.
- 2026-11-14: conservar la reserva de memoria de cada respuesta hasta terminar su página durable, liquidación/aplicación y feedback; liberar las referencias locales al crudo al concluir. La recuperación reutiliza la última página autenticada por pase sin compartirla entre ámbitos.
- 2026-11-14: el harness utiliza el pool de la base sintética acreditada directamente; las pruebas PostgreSQL normales conservan sus clones. No falsificar GITHUB_ACTIONS ni ampliar los guards para admitir pools arbitrarios.
- 2026-11-14: reservar 4 GiB de heap únicamente al paso de construcción de Studio en CI; no omitir lint, tipado, build ni gates. UAT y sus variables no cambian.

- 2026-11-14: implementar H1 en tres ramas/worktrees existentes limpios y separados: crítico DB/páginas/lector dual, estándar proveedor/scheduler, mecánico benchmark con almacenamiento y PostgreSQL reales. El orquestador conserva integración, pruebas remotas, gasto, revisión y fusión; ninguno opera cuentas o UAT. El resultado sintético inicial y la escritura temporal no cuentan como aceptación de 1,000/s.
- 2026-11-14: iniciar el backend H2 aditivo mientras se mide H1, sin ejecutar etapas pagadas posteriores hasta acreditar la capacidad. La identidad de caché será por pregunta/entrada/contexto/modelo/alcance, independiente del run o revisión global; V1/V2 y sus guards conservan su reproducción histórica.
- 2026-11-14: H2 reutilizará kind mass_labeling y action mass_labeling_jev con un owner nuevo. SQL0296 añadirá una rama exclusiva listening-jev-v1 ligada a su configuración y preguntas congeladas; conserva literalmente la validación V1/V2 y rechaza versiones desconocidas. No concede políticas, presupuesto ni permisos nuevos por sí sola.

- 2026-11-14: R16 nuevo prevalece sobre el plan piloto anterior. La evidencia literal de T&B sirve para integridad de la salida/capa y no se convierte en Claude por mención ni puerta de clasificación.
- 2026-11-14: preservar R15 aceptada y empezar en rama desde develop c1c7ed5e. No modificar implementación hasta cerrar baseline H0; lecturas y documentación preparatoria son gratuitas.
- 2026-11-14: separar capacidad interna sintética de throughput real: organización observada 80 solicitudes/s y 100,000 tokens/s compartidos entre claves. No prometer 1,000 raíces/s reales con ese límite.
- 2026-11-14: publicar una fórmula condicional con coeficientes medidos en R15 y costo editorial por grupos/vueltas; actualizar la proyección histórica sin cambiar sus recibos ni presentarla como costo medido de R16. Reconstrucción verificada con aritmética decimal exacta.

## Resultado y retrospectiva

R16 sigue en ejecución con alcance completo H0–H6. ADR033 y el modelo condicional de costo están integrados en develop. H1, H2 y la persistencia inicial H3 están implementados en ramas revisadas; H5 tiene léxico genérico con pruebas locales y nativas. H3 monetario y H4 siguen en desarrollo. Las pruebas por contrato y PostgreSQL sostienen estos avances, pero no sustituyen la aceptación integral.

El primer ensayo completo de transporte terminó 32,768 raíces con sus recibos y resultados íntegros, pero dio 485.19 raíces/s. H1 no está aceptado: falta resolver el cuello de botella y repetir el benchmark de al menos 1,000/s, seguido de la medición real con los límites de la cuenta. El setup sintético y las fases solapadas se informan por separado.

R15 permanece disponible. No hay migraciones ni despliegues R16 en UAT ni nuevas llamadas pagadas R16. Siguen pendientes las ejecuciones reales de Escucha y T&B, las evaluaciones ciegas, la comparación privada, los costos y tiempos actuales, la guía de QA y el paquete final con SHA256SUMS. El costo histórico y su fórmula no se presentan como una medición R16.
