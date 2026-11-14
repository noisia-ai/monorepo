# ExecPlan R16 · Clasificación sólida y separación Escucha / Estudio

## Autoridad y alcance

El objetivo del fundador guardado en el adjunto `goal-objective.md` y el diseño privado DISENO_R16 del 14 de noviembre de 2026 sustituyen cualquier R16 previo. La auditoría privada del 13 de noviembre acepta R15. No se versionan esos documentos privados ni sus ejemplos de cliente. Alias único: Estudio real A (cerveza, Brasil).

Se trabaja desde develop, mediante PR y revisión independiente, CI y PostgreSQL. Sólo UAT: cada migración aditiva se ensaya en una copia y se aplica una vez. Producción, main, el engine multimétodo pausado y el rediseño de Signal quedan fuera. R15 y sus resultados permanecen disponibles.

Signal es el backend genérico del Reporte. Escucha y Estudios comparten corpus, raíces, vectores y etiquetas. Las preguntas provienen exclusivamente de configuración versionada de Brand OS; las metodologías son plantillas configurables, nunca textos fijos en workers. Se conserva Investigar marca de BrandOsForm y la capacidad del esquema para futuras propuestas de agente, sin construir esa experiencia ahora.

No hay aprobaciones humanas intermedias en los procesos de análisis: Sonnet 4.6 decide donde hay juicio, nunca Opus. El humano edita al terminar y sus decisiones prevalecen en ciclos posteriores. La revisión técnica de PR, los límites de gasto y la aprobación comercial de un plan son controles operativos, no pasos del análisis.

## Progreso

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

## Registro de decisiones

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

## Resultado y retrospectiva

Los contratos de R16 están integrados. Las páginas durables tienen evidencia PostgreSQL aislada y el transporte está en validación tras corregir la revisión. No hay migraciones R16 aplicadas en UAT ni llamadas pagadas nuevas. El benchmark integral, la configuración genérica de Escucha y las ejecuciones de aceptación siguen pendientes.

Las observaciones H0 y su procedencia se guardan en custodia privada; la implementación, el benchmark integral y las ejecuciones reales de R16 siguen pendientes. Ninguna prueba de adaptador aislado o store en memoria se usa como aceptación global.

En ejecución. Lectura y verificación inicial completas; implementación, mediciones detalladas y aceptación UAT pendientes. Este documento conserva el alcance completo y no sustituye el objetivo por un piloto reducido.
