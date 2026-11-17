# ExecPlan R16 · Clasificación sólida y separación Escucha / Estudio

## Autoridad y alcance

El objetivo del fundador guardado en el adjunto `goal-objective.md` y el diseño privado DISENO_R16 del 14 de noviembre de 2026 sustituyen cualquier R16 previo. La auditoría privada del 13 de noviembre acepta R15. No se versionan esos documentos privados ni sus ejemplos de cliente. Alias único: Estudio real A (cerveza, Brasil).

Se trabaja desde develop, mediante PR y revisión independiente, CI y PostgreSQL. Sólo UAT: cada migración aditiva se ensaya en una copia y se aplica una vez. Producción, main, el engine multimétodo pausado y el rediseño de Signal quedan fuera. R15 y sus resultados permanecen disponibles.

Signal es el backend genérico del Reporte. Escucha y Estudios comparten corpus, raíces, vectores y etiquetas. Las preguntas provienen exclusivamente de configuración versionada de Brand OS; las metodologías son plantillas configurables, nunca textos fijos en workers. Se conserva Investigar marca de BrandOsForm y la capacidad del esquema para futuras propuestas de agente, sin construir esa experiencia ahora.

No hay aprobaciones humanas intermedias en los procesos de análisis: Sonnet 4.6 decide donde hay juicio, nunca Opus. El humano edita al terminar y sus decisiones prevalecen en ciclos posteriores. La revisión técnica de PR, los límites de gasto y la aprobación comercial de un plan son controles operativos, no pasos del análisis.

## Progreso

La fuente `c400d9308ad0bb1e046803eabf5b3b04b58ecb82` permanece congelada. El estado siguiente procede de las APIs y recibos del 17-nov-2026; los detalles de corridas anteriores están en el [archivo histórico](R16_PROGRESS_HISTORY_2026-11-17.md).

- El FULL [44068444485](https://github.com/noisia-ai/monorepo/actions/runs/44068444485) termina FAILURE sobre `c400d930`/source-tree `3749fa10cb826b3cdc9b80231af5c872e82ff48bc78fd8c7bb3a37af87a1a504`: 32,768 raíces resueltas y 65,536 llamadas; 134.183245 raíces/s, 218/220 ventanas bajo 1,000 y 878 HTTP sobre 500 ms (máximo827.482 ms). Censo, serving, matriz10 y witnessC0331 coinciden; H1 queda rechazado por throughput, ventanas y latencia. Custodia e interpretación cierran revisión independiente sin P0/P1/P2:46JSON,43traces,1604blobs y nueve gates recalculados. No hay otro FULL activo ni redispatch autorizado sobre esta misma fuente.
- El PR [198](https://github.com/noisia-ai/monorepo/pull/198) sigue OPEN/DRAFT con head `dfcb1191e3c0875e442b2cc6206f50c35809b081`; `develop` sigue en `e12f81d710de58cd3c6e3dc6fac6f3e93ac9844a`. No hay merge ni UAT R16. [CI general](https://github.com/noisia-ai/monorepo/actions/runs/44064884898), [runtime](https://github.com/noisia-ai/monorepo/actions/runs/44064884902) y los seis jobs de [PostgreSQL](https://github.com/noisia-ai/monorepo/actions/runs/44064884912) terminan SUCCESS para `dfcb`: incluye Listening113/113 y Study23/23 sin fallos ni omisiones. AutoH1 de ese evento fue cancelado, no verde. Estos checks no acreditan el candidato `c400` ni la rama lateMark.
- `FULL187` [44049874678](https://github.com/noisia-ai/monorepo/actions/runs/44049874678) quedó rechazado y terminal: 32,768 raíces y 65,536 solicitudes completas; throughput 221.225389 raíces/s, 130/133 ventanas bajo 1,000 y 341 respuestas HTTP >500 ms. Mantener la barra intacta.
- El candidato lateMark `e1799c65` está compuesto y publicado en `c400d930`. Sus cambios revisados de store, worker y observabilidad tienen 8 blobs exactos a autores; 51 pruebas focales y TSC Listening verdes. Revisión de código cerrada sin P0/P1/P2; su FULL no acredita capacidad. Se preserva la fuente experimental sin promoverla a `develop`. La comparación con187 es descriptiva entre hosts/fuentes, sin atribución causal.
- H0 parcial: lectura UAT RR/READ ONLY confirma release62/top0294, 83,962 llamadas JEV históricas liquidadas y exposición abierta cero. Tokens de entrada por raíz:1,632.005145. Se recuperan 48 RAW históricos verificados (16inicio/16medio/16final): p50 nearest-rank75.754ms, p95134.157ms. Son recibos R15 observados ahora, no una corrida R16 ni saldo/cuota actual.97GET de Storage y cero llamadas nuevas al proveedor; contenidos RAW temporales eliminados. Revisión de evidencia sin P0/P1/P2. Faltan upload, DB/apply, materialización y mediciones reales R16 separadas.
- Root encarga un prototipo manual-latest sin migración productiva: Crítico posee SQL no numérico y oráculo nativo OLD/NEW de14columnas; Mecánico añade un paso manual al job PostgreSQL existente. Mismo snapshot y parámetros, paridad de bytes y multiplicidad, perfil4096raíces vacío/con historial. No cambia Mark, campos de autoridad, defaults ni barras H1. Revisión y prueba remota aún pendientes; no hay nueva corrida despachada.
- H0–H6 siguen incompletos. No se ha ensayado físicamente la copia de las 37 migraciones 0295–0331, no se aplicaron migraciones R16 ni se desplegó en UAT. Human22 continúa cerrado hasta congelar la salida real de Study.

### Seguimiento de aceptación

- [x] Leer el objetivo aprobado, diseño, auditoría y guardas; contrastar `develop` y checkout.
- [x] Consultar previamente saldos y límites; conservar recibos privados sin claves.
- [ ] H0: baseline actual separado de proveedor, tokens/raíz, RAW, DB, materialización, importación y Voyage; cotización del aumento preparada, sin compra ni contratación.
- [ ] H1: pipeline duradero completo y capacidad simulada ≥1,000 raíces/s; aceptación full con todas las ventanas, HTTP real observado, diez fallos y censo/witness íntegros.
- [ ] H2: Escucha genérica versionada y aceptada en CI/PG/UAT; original y traducciones visibles para tópicos nuevos y edición de históricos.
- [ ] H3: ciclo cerrado automático completo, umbrales sellados antes de la corrida y precedencia humana demostrada.
- [ ] H4: Study T&B real y versionado, validaciones/evidencias, κ y recodificación de frontera según contrato.
- [ ] H5: sugerencias reales cerva/litrão top-10, edición posterior, recibo real con fórmula y ADR033.
- [ ] H6: Estudio real A en UAT, paquetes ciegos, Human22 sólo después del freeze, comparación privada, recibos y QA.
- [ ] Aceptación final punto por punto, PR revisados, CI y PostgreSQL verdes para cada merge, `SHA256SUMS` y diez líneas para auditor.

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

- Ambos FULL completan población y diez fallas, pero rechazan capacidad. En c400, Mark167cohortes/batchp50298 y103.566s inclusivos no demuestran una mejora. Las cuatro consultas dominantes tienen56.127/53.998/50.578/49.769s inclusivos para answers/Mark/reserve/inputs: no son CPU, no se suman ni aíslan esperas. El primer job empieza19.473s tras admisión; el tail de verificación18.784s permanece dentro del reloj.
- Los candidatos D, codec y E se descartaron: E y codec preservaron comportamiento, pero empeoraron sus cuatro pares medidos; D falló su expectativa nativa. Sus corridas y razones permanecen en el archivo histórico.
- El código lateMark selecciona sólo llamadas ya reservadas después de autoridad y antes de locks de llamadas; conserva COMMIT antes de enviar. Sus RED/GREEN focales prueban el orden y fallos, no un aumento de throughput.
- El testigo de recursos registra límites configurados (memoria 512 MiB, `max_in_flight` 1,024, ventana 4,096, flush 1,024 cada 250 ms, dos flushes) y máximos del stream. Ese límite no mide concurrencia HTTP física. RSS se muestrea al inicio, al concluir cada job y al final; no es peak RSS ni entra a la aceptación.
- En c400 el máximo lógico observado es512MiB; cinco muestras RSS llegan a1,369,112,576B. Son alcances distintos: no prueban fuga, causa de la lentitud ni concurrencia HTTP física. El recibo187 no se rellena con esas muestras nuevas.
- El ledger Drizzle de UAT tiene30filas, pero el ledger autoritativo de releases es `noisia_release_control.migrations`, con62/top0294. Consultar el primero no prueba otra base ni ausencia de las migraciones R15. La evidencia H0 conserva los sobres iniciales como UNVERIFIED y documenta la distinción.
- Descartes estáticos siguientes: el ID page ya excluye raíces con todos los digests enviados en el run; otro filtro all-configured-cache no demuestra utilidad H1 y no equivale a all-applicable. OLD reservado tampoco acredita validación nativa en todas las rutas SQL: se conservan fullSHA y beforeSubmit. No se implementan esos atajos.
- En0326 queda un LATERAL de decisión manual tras raíz×pregunta. Resolver su slice estrecha una vez por sentencia es un diseño candidato, no una mejora medida; los planes existentes ocultan sus índices/loops internos. Se evalúa además si la función materializa columnas anchas que sus callers de metadata no consumen. No se cambia la población ni se omiten censos para acelerar.
- El tipado global local alcanzó OOM al límite acotado; se traslada a CI. Las pruebas focales verdes no sustituyen los jobs integrados ni el PostgreSQL real.

## Registro de decisiones

- 2026-11-17: conservar el rechazo completo de `44068444485`, sin repetirlo para observar ni rebajar barras. El código y sus artefactos quedan congelados; sólo un mecanismo nuevo y revisado justifica otra prueba. Analizar por separado el lector nativo y la validación repetida de Mark, sólo lectura antes de decidir implementación.
- 2026-11-17: full187 falla las barras originales. No rebajar 1,000 raíces distintas en cada ventana completa de 1 s desde 5 s, 20 s activos, 1,000 raíz/s end-to-end ni HTTP observado de 100–500 ms; mantener 32,768 raíces, 65,536 solicitudes, diez fallos y límites/custodia originales.
- 2026-11-17: el mecanismo lateMark requiere CI/PG y medición full sobre su propia fuente congelada antes de adoptar; ninguna regresión funcional autoriza una conclusión de rendimiento.
- 2026-11-17: no aumentar heap ni abrir Docker en el equipo local; suites pesadas, PostgreSQL y benchmarks se ejecutan en CI remoto. Mantener sólo un owner por cada handle.
- 2026-11-17: no fusionar a `develop` ni desplegar hasta revisión exacta, CI/PG, H1 y ensayo físico en copia. Componer y publicar una rama para prueba está permitido. Después sólo `develop`/UAT y aplicación única forward-only. No `main`, producción ni compras.
- 2026-11-17: mantener Human22 privado y sin abrir hasta congelar la salida real de Study; nunca inventar muestras, κ, costos o citas.
- 2026-11-17: extraer las entradas históricas verbatim al archivo vinculado. Conservar la fuente original con SHA para que se puedan recuperar incluso los estados `IN_PROGRESS` antiguos; el banner advierte que no son handles vivos.
- 2026-11-17: usar metadata y RAW históricos de UAT para completar la referencia H0 sin nuevas inferencias ni escrituras. Separar ejecución Nov9–12 de observación Nov17, percentiles de muestra de estadísticas poblacionales, tiempos de ledger de HTTP puro y lectura Storage de upload. Esto no abre Human22 ni concede autoridad de copia, despliegue o gasto.
- 2026-11-17: preservar fullSHA y beforeSubmit; la inmutabilidad de la fila por sí sola no prueba su procedencia validada. No añadir certificados, cachés de autoridad ni counters monetarios como atajo sin un diseño demostrado. Medir un candidato set-based acotado sólo después de identificar su equivalencia y revisión; no otra corrida full sobre código idéntico.
- 2026-11-17: probar primero la slice manual estrecha, antes de ampliar el productor de metadata. El perfil nativo es diagnóstico, no H1: sólo considerar el candidato si conserva todas las filas/bytes, reduce al menos10% la mediana wall en ambos escenarios OLD/NEW/NEW/OLD y ninguna ejecución NEW supera110% de su pareja OLD. Conservar números crudos y rechazar si no mejora; CPU y coste interno manual siguen desconocidos. El helper estrecho tiene más alcance y los textos sintéticos de este ensayo son cortos28–29B, sin ahorro grande demostrado por ancho.

## Ruta restante de ejecución

1. Cerrar la revisión terminal de `44068444485` rechazado y preservar artefactos/fuente exactos. Evaluar los dos análisis de mecanismo siguiente (lector e inmutabilidad de Mark); no ejecutar otro diagnóstico genérico ni repetir fuentes descartadas. Las nuevas correcciones necesitan responsables, pruebas y revisión antes de integrar.
2. Completar revisión y checks del candidato lateMark sobre su fuente integrada. Si el FULL actual pasa todas las barras, conservar esa aceptación y no repetirlo por observar o recopilar más métricas. Si falla, o una modificación posterior cambia código relevante y deja obsoleta esa evidencia, decidir desde el resultado; despachar otro FULL sólo sobre una fuente congelada que haya pasado revisión y CI/PG, y sólo para aceptar esa fuente nueva. Medir throughput, ventanas, HTTP, fallas, memoria, RAW/DB/Signal y testigos sin omisiones.
3. Ensayar físicamente las 37 migraciones 0295–0331 en una copia aislada. Root integra a `develop` sólo tras las puertas técnicas; aplicación UAT única y despliegue únicamente `studio-uat`/`workers-uat`.
4. Refrescar saldo, límite, cotización y cota antes de cualquier etapa pagada. Correr Escucha automática (base, descubrimiento y apuestas/racismo) y luego Study T&B real sobre el mismo corpus; medir CSV→Signal, importación, Voyage, JEV, almacenamiento y serving por etapa.
5. Congelar Study antes de Human22. Armar los paquetes sin clave para 500 tópicos antes/después, ≥200 casos de dirección/objetivo/uso, ~30 `none` dentro y ~30 fuera, 10×20 miembros de motivos y cuatro candidatos por cohortes. Mantener clave, semillas y comparación de las 22 causas en privado.
6. Emitir recibo público, anexo privado, claves separadas y `SHA256SUMS`; verificar léxico, fórmula/costos/tiempos, κ, evidencia literal e integridad de citas. No sustituir resultados reales por R15 o simulaciones.
7. QA en UAT desde Dashboard→Estudio real A→Menciones→abrir mención→Monitoreo y Study; comprobar inglés, originales, filtros e Investigar marca. Entregar guía breve y diez líneas para el auditor.
8. Auditar cada requisito contra fuentes y artefactos actuales. Completar sólo si todos están probados, con CI y PostgreSQL verdes para cada cambio fusionado.

## Resultado y retrospectiva

R16 H0–H6 sigue activo y no logrado. El último FULL `c400d930` termina rechazado por134.183245raíces/s, ventanas y HTTP. Calibración, censo y matriz10 correctos no sustituyen capacidad. El PR198 tiene CI general/runtime y seis jobs PG verdes para `dfcb`, pero no está fusionado. No inferir aceptación entre fuentes.

`FULL187` continúa rechazado por 221.225389 raíces/s y ventanas/HTTP; no se cambia la barra. La revisión y las pruebas tardías de cohorte/observabilidad corrigen contratos y mejoran evidencia, sin acreditar aún capacidad integral.

H2/H3 tienen wiring revisado y checks nativos de dfcb; falta el uso real UAT y el gate del candidato final. Las51focales de `c400` son lateMark/observación, no aceptación H2/H3. H0 añade metadata y48RAW históricos verificados; sigue parcial. H4/H5/H6 mantienen las pruebas y entregables indicados arriba; el corpus real no se ha procesado en R16. No se han aplicado SQL R16, desplegado UAT ni hecho gasto R16 real.

## Historial y recibos

La [historia íntegra del ExecPlan anterior](R16_PROGRESS_HISTORY_2026-11-17.md) preserva exactamente la versión de W2 con SHA-256 `b85821f33b76371ff72a175658063ff06f97599d26bbe434ba34605491c834f7`. Las entradas antiguas son historia, no estado vigente. Este plan conserva la autoridad, los hitos H0–H5 y la aceptación completa; úsalo como único punto de reanudación.

Los recibos privados están bajo `.data/piloto-masivo/r16/`. Puntos de entrada privados actuales: `CURRENT.md`, recibo de dispatch del FULL c400, paquete de checks dfcb, y artefactos de revisión/focales lateMark. Confirmar SHA y estado real de cada artefacto antes de usarlo. El [contrato del paquete ciego](../../../scripts/r16/BLIND_PACKAGE_README.md), el [harness](R16_BENCHMARK_HARNESS.md), la [prerregistración H1](../../../scripts/r16/LISTENING_CAPACITY_PREREGISTRATION_V2.md), la [guía UAT](R16_UAT_QA_GUIDE.md) y [ADR033](../../adr/033-listening-and-studies-on-shared-corpus.md) complementan el trabajo; su existencia no demuestra aceptación.
