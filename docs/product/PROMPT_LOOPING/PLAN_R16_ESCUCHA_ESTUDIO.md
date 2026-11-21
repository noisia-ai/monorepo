# ExecPlan R16 · Clasificación sólida y separación Escucha / Estudio

## Autoridad y alcance

El objetivo del fundador guardado en el adjunto `goal-objective.md` y el diseño privado DISENO_R16 del 14 de noviembre de 2026 sustituyen cualquier R16 previo. La auditoría privada del 13 de noviembre acepta R15. No se versionan esos documentos privados ni sus ejemplos de cliente. Alias único: Estudio real A (cerveza, Brasil).

Se trabaja desde develop, mediante PR y revisión independiente, CI y PostgreSQL. Sólo UAT: cada migración aditiva se ensaya en una copia y se aplica una vez. Producción, main, el engine multimétodo pausado y el rediseño de Signal quedan fuera. R15 y sus resultados permanecen disponibles.

Signal es el backend genérico del Reporte. Escucha y Estudios comparten corpus, raíces, vectores y etiquetas. Las preguntas provienen exclusivamente de configuración versionada de Brand OS; las metodologías son plantillas configurables, nunca textos fijos en workers. Se conserva Investigar marca de BrandOsForm y la capacidad del esquema para futuras propuestas de agente, sin construir esa experiencia ahora.

No hay aprobaciones humanas intermedias en los procesos de análisis: Sonnet 4.6 decide donde hay juicio, nunca Opus. El humano edita al terminar y sus decisiones prevalecen en ciclos posteriores. La revisión técnica de PR, los límites de gasto y la aprobación comercial de un plan son controles operativos, no pasos del análisis.

## Progreso y punto de reanudación vigente

Actualizado: 2026-11-21T02:53:58.892455+00:00. **Goal completo H0–H6 ACTIVO. R15 aceptada; R16 todavía no ejecutado con el estudio real ni desplegado en UAT. Human22/Gold sin abrir y cero etapas pagadas en esta fase.** No confundir una prueba, un paquete o CI verde con completar el goal.

1. Root trabaja en `codex/r16-native-dml-profile`, HEAD local/remoto **6e1c176bf83fb495c13e51215ef415717041d9b9** (Source16), árbol `2a90705f7b2a354d1a1000d6196dad9efa3bbd77`. Padre local `a2395b0a7252f47b62df9108e69ffcf60447fe13` (Source15) se creó pero **nunca tuvo CAS ni POST de CI**; su operator quedó cerrado como superseded antes de activación. Una sola CAS remota `26db9e13→6e1c176b`, force=false, incluyó ese padre y se verificó mediante GET.
2. **CI16 terminó FAILURE:** run44855664322/verify136697159926/head6e1/attempt1/manual. TSCglobal/lintSUCCESS; pnpmtestFAIL yposterioresR16puras/compiler/StudioBuild/DataOSSKIP. Único not-ok observado84:fixtureNativeFetchLatin1,é1024esperadas frenteÃ©1024. FuenteoficialNode20.20.2_http_outgoing358–376 confirma stringbodycoalesceaheadersUTF8; Bufferbodylosseparalatin1. TresnuevosH4ynuevefirstKnowncasosnominalesPASS; Agentprobe8intercambiosPASS,node20.20.2/undici6.24.1,H8192/B16sólofixture,cleanupACK. NativeFetchdefaultfrontierUNKNOWNporqueassertLatin1fallóantesemitirrecibo. Query745/745PASS0skip;Studio1408/1401PASS7skip;Workers1371/1310PASS1FAIL60skip; DBsinresumenfinal. **Cerrado, no másGET.** Terminal12files/11sumas closure6afd15fc8d674251bcc7b343a130ac5659b67c219538086a6d8449e7b3deb0c3/SUMS2ad4109d7b071698bff497154976d0d06f7352765be38d663c32438207c0063c;dispatch19files/18sumas closure62cbfb4dc4304297f40c07802f41603df6775c000720b5a57280791ee13ec45b/SUMS4bf112cae10b52d8121da8f3c49877ccdf7b4fcf2d8b245788d837f17d6a1506.
3. Source16 está congelada antes de cualquier byte de ejecución: **1670 Gitblobs/25882931B**, canon311438B/SHA**ae81ee017bffe0d72c34f7f80876f91465f27bedea7d1f1d6a04a94cea95d3c1**, tuple**e1146774e61c2f15cf0b950762b5cd07ebe8c890e5b359bb25f81b78468e892d**, freezeproof**a2feaf8a9dbb1640998a7c5ead3935685968c8b6f7fe52de61570ae38f974059**. Revisor cotejó TODAS las entradas SHA1/SHA256/bytes FS/modos y los cinco campos canónicos. Control CI **f3c99366fc02feb724eacc56b70f775ed438cecedd6a3d770992f30133d30ccc**; MFP **55a902aee724f8099d1b2cd646fd1b624fbd9a5e7b30e9281a1cef46ae087c3b**. `P/global-ci-Q16-dispatch-v1`: prereg8e7da617…ed4b9, helper08ccc87e…dde55, prep b14ef072…70859; seis normas y Full acceptance **0b276d413aaad65caf89faadbfc408c03a97b7696a370469992d71749c1f5069** literales. Full futuro debe reconciliar la fuente final real antes de sus bytes; no copiar counts históricos.
4. Source16 contiene: (a) H4 `global4∩affected`, sin nuevos vecinos, respetando locks y reemplazando sólo pares respondidos; worker/replay con regresión independiente319×4; (b) H6 cuotas de ejes solapadas y custodia de los cuatro candidatos originales con overlay vigente; (c) primer error null/undefined/0 preservado en canales fatal/notificación, sin cambiar su prioridad ni detener drenaje comprometido; (d) dos probes Node20 HTTP loopback —Fetch nativo y Agent dedicado— con controles/errores/cierre; (e) retirada conjunta de tres prototipos rechazados, restaurando **exacto Q8** projectiontest25539B/SHAf6179c77e9cbe6f6302f7adfda916caf04c97758badaf10cba0baa403454d37a, sus3títulos/103asserts. Tres helpers TESTONLY eliminados; **335SQL**, cinco tests previos y prefijo Native95124B/SHA92ab4899577ee786421b80bf76ea8214a9d50652db3693a465e2f5561f808e05 intactos. Tres entregas nuevas y composición FINALfavorables; CI16TSC/12casosnuevosH4/P2yAgentprobePASSnominales acreditados,peroCIglobalFAILEDporelfixture; ningunaaceptaciónFullPG/H1/H6/UAT. Nada de modeloV3 habilitado.
5. El último FullH1 real es Q8 y **falló:139.165raíces/s**, no1000. Los ensayos Q9(questionbytes),Q13(work_mem32) yQ14(Width) se rechazaron por ausencia de ganancia material. **No0340, nuevo índice/GUC ni cambio del productor SQL adoptado.** No repetir esos handles o adquisiciones cerradas.
6. **Source17 en preparación, sinGit/dispatch todavía:** fixúnico20B `response.end(Buffer.from(body,'utf8'))`,mismasassertionsLatin1/TAB/cotas/cierre,FINALfavorable; másdosarchivosnuevosmotorARITMÉTICOdepresupuestoV3,parametrizadoH/B+P/R/F/ledgercon16casospropuestos,FINALfavorableV3packetd63ca281/module739e537b/test0607f12b. Rootadoptóúnicamenteestos3archivos,proof77a344b33879aa0fd1decd9a55a53758d01ee3038d29ef3170b3153136def3a0. **NOcaller/factoryproductivaregistraelmodelo,niV3enabled,niH/Brealacreditado.** Motor pruebaGmonótono/borrowerúnico/segundoFcompleto/prefijos/shrink/claims/counterpoisonfalsy; no demuestra geometríadeHeaderobjetos ni transporte. Nuevafuente/revisión/preregCI17paraambosprobesymotor. Después cerrar/wiringV3completo; no bajar24×porintuición niquitarRAW/extras/usage. NativeFetchdescomprime,AgentmaxResponseSizelimitaWIRE: decodedB≠wireB,sobretodochunkedsinContentLength. HTTP1/TLS/H2yUATsondistintos. RosterIDsnoeliminaSurvey4096/extremos32/7.
7. **Mac:** Docker cerrado. Prohibidos Node/TSC/PG/Docker/instalaciones/builds locales. Sólo Git/metadatos y Pythonstdlib acotado; comprobaciones pesadas REMOTAS. No abrir Human22/Gold hasta Study real COMPLETED yfreeze. No stages pagadas hasta capacidad/checks/orden UAT yH0 frescos. Root sigue sólo con develop/UAT: main/producción intocables.

P denota el directorio privado común `.data/piloto-masivo/r16` del checkout principal en Downloads; `P/CURRENT.md` refleja este archivo. Las carpetas de evidencia cerradas se pueden LEER localmente, pero nunca modificar ni adquirir nuevamente. La copia privada exacta del plan anterior es `P/EXECPLAN_BEFORE_Q16_CONSOLIDATION.md`, SHA**05206236889bd05b304e0d2e3d74eb93607c2f162fb8208175932aece79c5782**. Es historia; este punto de reanudación y la ruta restante mandan.

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

## Contrato operativo de H1

Mantener32768raíces distintas,65536solicitudes primarias/dos por raíz y diez fallos:429,529,RAWwrite,PostgresCOMMIT,settlementACKlost,restartafterpage,leaseexpiry,leaseexpiryafterdurable,RAWACKlost yCOMMITACKlost. Runtime nativo real; no subset diagnóstico ni perfil aislado como aceptación.

Cotas originales:1024in-flight,4096por ventana,512MiB de working memory,flush1024/250ms y máximo dos flushes simultáneos. Working memory no equivale a RSS; muestras dispersas no prueban pico. HTTP físico observado debe estar entre100–500ms. Cada ventana completa fija de1s desde5s hasta processing/drain debe resolver≥1000raíces, con≥20s activos; throughput end-to-end≥1000 incluyendo verificación/serving. No mover warmups o admisión fuera del reloj; CSV y preparación se informan aparte con su cold clock.

Fuente/prerregistro/checks/revisión antes de publicación, Root único dispatch, un dueño por handle y descarga acotada única. Resultado desconocido no autoriza repetir una escritura ni descargar nuevamente. Comparar manifiesto runtime completo contra Git inmutable. Para el Full actual el método conserva fullbefore y assert de digest after; no afirmar que se retuvo una lista after inexistente.

## Organización con subagentes

| Responsable | Propiedad y estado |
|---|---|
| Root | Único dueño de composición, refs/dispatch, PR/merge develop, UAT y etapas pagadas. Custodia/freeze y ExecPlan. No activa ni fusiona antes de revisión/checks. |
| `/root/r16_compile_memory_review` · revisor | Sólo lectura; Source16 yoperator FINALfavorables. Revisa hallazgos/retención de resultados antes de cierre; corrige P0/P1 antes de merge. |
| `/root/r16_phase_response_budget` · mfp_critico | V3 privado: nuevos `signal-jev-response-budget-v3.ts` ytest primero; luego callers transport/stream/sizing/Listening/calibración cuando contrato esté cerrado. FirstKnown yAgentprobe entregados/revisados/adoptados. Managedworktree sigue en handle `g126:2`, no repetir creación; lectura/propuestas privadas independientes siguen. Ningún RootWTedit. |
| `/root/r16_rejected_probe_cleanup` · mfp_mecanico | Entrega cerrada Q16: exactoQ8entry y eliminación de3helpers TESTONLY; WTpropio r16-listening-dml-plan, rama codex/r16-listening-dml-plan, limpio e histórico. |
| `/root/r16_survey_spill_candidate` · mfp_estandar | Entregó cuotasH6 yfixH4 enWT r15-import-scale/rama codex/r16-survey-native-correction; conservar trabajo ajeno. |
| Explorers readonly | Auditorías de H6/dominance, costes normales vsinstrumentados y rosteradvisory cerradas. No asumir que propuestas son código probado. |

Cada autor usa su worktree/rama o paquete privado de objetos Git mientras una creación gestionada sigue viva; no revierte edits ajenos. Root espera entrega yrevisor antes de integrar. No subagente publica refs remotos, corre etapas pagadas ni toca UAT. Una observación agotada no significa proceso terminado.

## Evidencia vigente y límites

| Fuente/ejecución | Resultado y ubicación privada |
|---|---|
| Q8 `52f0c342` · MFP44806479997 | SUCCESS17jobs=10seleccionados/7opcionalesSKIP. Log cerrado:3actor+104MFP+151Listening=258PASS0skip, Native unused-column test106PASS. `postgres-functional-Q8-terminal-v1`. No transfiere verde a fuente posterior. |
| Q8 · Full44806506996 | Benchmark136531806296FAILURE; calibration136531806699SUCCESS.32768raíces/65536HTTP/1job/0unresolved;wall235461.194868ms,139.16518184rps;224bins completos todos<1000,2HTTP>500ms;6/9gatesPASS. CPU/GC/picoRSSUNKNOWN. `full-evidence-52f0c342-v1`,66files/65sumas,closure971ec2f9…69d49/SUMS3b44c82a…b885. 56manifiestosSource×1663entradas y4testigosMAIN cotejados. No menorcohorte/ventanaselegidas/relojexcluido. |
| Q9 `0b8f6dce` ·44816036141 | SmokeSUCCESS, candidataquestionbytesREJECTED: media218.8596495→229.9966455ms,+5.09%. `survey-question-bytes-Q9-terminal-v1` cerrado; no producto promovido. |
| Q12 `01ff233c` ·44832526584 | RunoriginalFAILURE por namespacePID delvalidador.67puras+1PG+cleanupPASS; recuperación offline sobrebytesguardados exit0sinrerun.17archivos/8manifiestos×1668,9tablas+exposición+ACK/catálogos íntegros. `native-late-evidence-Q12-v1`,61files/60sumas,closure6069d870…b236/SUMSc87c55a0…dc7. Native61440→62160calls reales sintéticos, no seedfalso deledger. Sigue diagnóstico, no H1. |
| Q13 `293756e2` · CI44839957459 /MFP44840578061 | AmbosSUCCESS; cincoMFPjobs seleccionados/10scopeSKIP. Work_mem32MiBREJECTED:189.297120→191.4539035ms,ratio1.01139364;temp3270→0 no compensa pared. `global-ci-Q13-dispatch-v1`, `survey-work-mem-Q13-{dispatch,terminal}-v1` cerrados. NoGUCproducto. |
| Q14 `26db9e13` · CI44849989374 | SUCCESS24steps,verify136678804121;19files/18sumas. `global-ci-Q14-dispatch-v1`,closure1be2f78ec4546af8930144cfb58a150194aaa7df7198a495b407b8f4d6137874/SUMSc765bbc5b17e4b265b2698e8d903b1a9303c7a98407a6f2855f310109fec9f5e. No logs/artifact adquiridos por faltar gap. |
| Q14 · MFP44851318950 | FAILURE:smoke,bounded,RAW SUCCESS;projection136685850351FAILURE;shared SKIPdependencia+10scopeSKIP. Logúnico547323B/SHA4133d557ca3122c3dbbb31ef554188075a15ed33da60cc0dc1368a3dde4936b3,600antesparse.3tests/2PASS/1FAIL0skip. ABBA4096/2q:215.278430→213.926029ms,ratio.9937178983>.9:WidthREJECTED. PrimariointernoAggregateUNKNOWN;4lifecycleposterioresDROPcommit/catalogACK, noACKprimerfixture. `wire-width-Q14-terminal-v1`15files/14sumas closurebe31dc702803a517774887ec57b56a21e9d152ba83a9a23ac1b326194121eee7/SUMS5343d2f639dc7f41dc3e58ef5a2615eea96d1b54ce2cfce948d5deb41e6d87d9;dispatch18files/17sumas closureeb3cb86b…b6a40c/SUMSab9c5c1b…bf61. No0340/retry/rescate. |
| Q15 `a2395b0a` | Git/freeze1671/canon37064352…499d yoperator estáticosfavorables, **NOACTIVADO**. `global-ci-Q15-dispatch-v1` cerrado8files/7sumas, supersessionbededa339d4d5817b6f0f4ef97feb80c36eef36d43ecdeb4a3f022cba3117a3c/SUMS52c6dc2b…e87bf. NoCIverde inventado. |
| Source16 `6e1c176b` | CI44855664322FAILUREfixtureLatin1;TSC/lint y12nuevosH4/P2nominalPASS+AgentPASS,defaultfrontierUNKNOWN. Paquetescloseddescritosarriba. NoFullPG/H1/H6/UATgreen;Source17fix+motoraisladoenpreparación. |

## Protocolo operativo y custodia

- Antes de fuente/ejecución, revisar entregas ycomposición; resolverP0/P1. Construir Git inmutable ycanon desde blobs, compararSHA1/SHA256/bytesFS/modos ycinco campos completos con TODAS sus entradas. CI/MFPworkflowcontrols separados. Un count/hashpropio no acredita lista completa.
- Para cualquier acciónRoot: metadatafresca≤300s de refs/runs/PR/develop, expectedhead exacto ysinconflictos; sellar todos los inputs/helpers ydeadline. Una CASforcefalse+GET si procede; una POST, O_EXCLattempt, TLS/NoRedirect,0retry. Timeout/ACKambiguo significa investigar mismohandle, nunca reenviar a ciegas.
- CI16 actual sóloautoriza CI. Un nuevo MFP/Full/H1/UAT/pago necesita su propio registro/fuente/revisión/metadata/sellos; no deducir autorización de un campoóptimo ni transferir verdes entreSHA. Seisnormas+Fullacceptance0b276 siguen literales enprereg16; no reducir dominio32768/65536, diezfallos, censos, cotas o barras.
- Adquirir bytes sólo después de metadata terminal ligadaa run/attempt/job/source y gapconcreto. Descarga única yacotada: ZIP16MiB/128entries/expand32MiB/JSON8MiB,APIartifactID+digestantesabrir; archivosregularesprivados600/dirs700, sin traversal/symlinks/duplicados/casefoldcollision. Logs decoded≤4MiB,persist600antesanálisis,0retry; el conector sigue redirección internamente, no afirmar cap de red inexistente. No duplicarTAPartifact si logbasta.
- JSONestricto duplicados/no finitos; TAPJSONlargo se parte: quitar sólo timestamp/prefijoTAP yconcatenar fragmentoscontiguos SINLF. Recuperar parse localdebytesya guardados noautorizaotroGET. Reportar censosreales, erroresynulos literalmente; no inventarinnercauses ni snapshots/listasafterinexistentes.
- ParaFull final, todo objetoSource completo retenido compara5campos/cadaentrada contra M real; cuatrotestigosMAIN independientes completos (MoneyE parcialycatálogo,compact0338,answer_guard0339),inclACL/OID/owner/atributos antes/después. No hardcodeowner10 ni asumir snapshotcompartido. Relojes yvalidación dentrodelwall original. Falloafter conserva beforeypublicaafter null conprimererrorlatched. Gates OLD0334/NEW0339unusedcolumn yINNER RETURNING* son distintos yambos obligatorios.
- Funciones financieras/freshSHA/permisos/actorlocks no se cachean ni debilitan. Survey/Native/RAW/APPLY conservan COMMIT/ACK/idempotencia. UNKNOWN se contiene hasta reconciliación; nunca blindreplay ni DROP/rescate anteACKdesconocido.
- UAT no defaultRailway: projectb7b7b325-f273-4eb6-80e0-d66e266159b2, env13f17965-6ae3-4b5f-bcf3-08b496ff5d54; studio184f8966-0cac-4bb0-85bb-9348abde594f, workers0da3b6f5-0017-4568-8ad8-5dc727834037. Nov20UIreadonly mostró **autodeploydisabled** enambos; refrescar antespublicar. Noactivarsettings ni asumir pinscomoatestación deautodeploy. CódigoactivoUAT Nov13era studio17651d06/workersef61d9ef, sólohistórico.
- COPY45(0295–0339,969177B) yensayo aislado privado existentes son históricos; retargetear únicamente la fuente final aceptada, conservarOIDs yrecibosanteriores. No nuevasmigraciones sinensayo/verificación/orden segurocontra código/schema. Secretosprivados no se imprimen, versionan ni pasanenargv.

## Sorpresas y descubrimientos

- FullQ8 es parednormal conprofilerJS, noauto_explain. Native115ops93.778s yAPPLY227ops42.063s sonobservadosinclusivos,noCPU ni sumandosdelwall.97Native nonempty suman91.426s: quitarsóloesperas no demuestra1000. Survey335metadata77.365s; nointersecciónSurvey/Native observada. No inferirinvalidaciónepoch de todofinalAPPLY.
- Q12nested sígeneró15841notices/~109MiBduranteAPPLY; guard1491ms/actor470ms contieneninstrumentación ydescendientes. NoatribuiraSHA/CPU/esperalocks ni usarlo para repartir42sQ8. PlanesouterNative temp0; Survey4096símostróspill. Q13quitótempperonoganópared;Q14widthsólo.6%demediacon2muestras/brazo,noevidenciamejoraestadística.
- Memoria: reservaactual448KiB/call=24×16KiB+64KiB; A720330301440B másworkspace seacerca512MiB. ParseJSyaessíncrono,pero answers/usageextras,physical.body,RAWcodec,PGJSONyfeedback sobrevivenawait. No recortar16KiBni extras/usage. G debequedarcargadoparaunflushmáximo; segundoF entero; no liberarG trasflushpequeño. HTTP1/H2,TLS,UAT yheadersdefault soncontratosdistintos aúnporacreditar.
- Nativefresco valida batch, noeldominio4096ni nuevosoutliers/anclajes32/7. Cola desplazada yBASEAPPLY quehabilitaIDanterior requierenlecturafresca; hydrate expiraalcallbackRR. Un rosterincremental necesitaría versionado/refill/exclusiónporroot+input+preguntas/digest+run/config/map/context yactivaciónúnica, no autoridad/payloadcache.
- Inventario335SQL=333árbolmigrations(320numerados+13fixtures/tests)+2fixturesafuera. Norelabeled333comomigracionesaplicables. PrefijoNative95124B pertenecea `signal-listening-money-batches.postgres.test.ts`, noeselarchivoentero ni elproductor.
- La preparaciónH6 encontrócuotasdoblecontadas ynearestparcial: fixesencódigoCI14puras/TSCgreen; no equivalenapaquetereal. Dominancepodíaagregar7vecinosalrankingdesubset: H4arregloencandidatoactual,pendingruntimeCI16. Fuentehistóricasepreserva; Human22/Goldsiguenunopened.

## Registro de decisiones

- Source17: corregirfixtureemisordelacodificaciónconBuffer,sinrelajarassertniquitarelcaso; motorV3únicamente aritmético/test16,0registroproductivo. CI16sigueFAILEDynoserepite. Validarprobe ygeometríacompletaanteswiring. Agentbodywirelimit no se declaraparidaddecodedB:chunkedcompressionlegalexigecontratocompleto.

- La autoridad esobjetivoR16+Diseño14nov+ADR033, noR15/avisoshistóricos. MantenergoalH0–H6; progresarautónomamente porhitossinpedirpasossiguientes. Sóloparar porfondosinsuficientes, riesgorealdedatos o formatoproveedorquenoentra; nada de comprarcréditos/aceptarplan ni Claudepermención.
- Se rechazaronQ9,Q13,Q14 por resultadospared ycontroles, sin cambiarcriterios después. CriterioWidth prospectivo≤.9+semántica/catálogos/cierre/recursos;temporalesexplicativos,no50%obligatorio. Rechazar no exige rescatarfixture/promoverfunciónnueva. Originales3tests103asserts se restauran exactamente al retirarprototipos.
- Q15unpublishedsuperseded antesactivación para combinarH4+probes+P2+cleanup enSource16 yevitarCIredundante. Source16 tiene revisiónindependiente yregistro nuevos. NoCAS15 niPOST15; uncambiofeatureQ14→16, no develop/main.
- Los probes sonHTTPloopbackpropio, pocosbytes/attempts/deadlines, erroresnativosexactos yACKdecierre; no fijanH/Bproducción ni pruebanTLS/UAT/H2, ni habilitanV3. Diseñar el modelo completo parametrizado mientrascorreCI; no rebajarfactor por intuición. Cualquiercandidato futurorequiererevisión/checks/Fullsinbarrasrelajadas.
- Mantenerprioridadentrecanalesfatal/notificación existente al añadirflagsfirstKnown; preservarundefined/null/0 ydraincomprometido, sincambiosdecaps/dinero. H4reaskglobal4∩affected, no rellenarvecinos nuevos ni repreguntarcorpuscompleto; humanosmandan.
- Estapoda archivaelplananterior byteexacto (SHAarriba), quita instrucciones históricas contradictorias ydejaunsolo puntode reanudación. Autoridad/H0–H6/validación/contratoH1 quedan literalmente iguales. La historia sigue enGit yarchivosprivados, sin alterarrecibos cerrados.

## Ruta restante de ejecución

1. Source17: tresarchivosfixfixture+motor/testV3aisladoadoptadosyFINALfavorables. CrearGit/freeze1672esperados(derivardesdeGit),prereg/revisión+metadatafresca/seals,CAS6e1→17forcefalse+GET yCIúnico. NoMFP17automáticodeeseregistro. Retenerterminalysóloadquirirlogúnico≤4MiBsi gapfrontier/resultados;600antesparse,0retry. CI16yacerradoFAILED; no restart/reejecutar/GETviejos.
2. Cerrar/implementarV3completo: motorcréditosH/Bfinito,physicalretenido sinwrapperhastaF,RAWexacto/extras/usageintactos, GmonotónicoantesCOMMIT, unsoloborrower ysegundoF entero, releases/UNKNOWN/recoverylegacy. Callerssizing/quote/selectFresh/Mark/prefetch/calibración compartenmodelo; wrapperproviderpropagaperfilacreditado,no WeakMap perdidoen spread. Añadirregresiones debytesmáximos/escapes/1e20/dosflushes/recepciónSurvey/una fila/errorACKlost/dobleliberación. Sólo activarprimeraAPIcerrada con límites acreditados. Revisar antesRootadopta.
3. Probarcandidato congananciamaterialnormal antesnuevoFull. Para fuente final MISMA: CI/type/lint/test/build/DataOS, PostgreSQLcompleto+Nativeoriginales/nuevos/2gates42501, imagen yFull32768/65536/10fallos/todosbins/4testigosMAIN. DerivarM real/manifestcadaentradaantesbytes, no transferirevidenciaentreSHA. No repetirFullque sabefallar sin cambioalineadoconcausa.
4. Refrescarautodeploy/configUAT yplanearorden schema→código sinpublicarcódigocon schemaausente. Retargetear/ensayarCOPY45 finalconlímites/OID/recibos/aplicaciónúnica. RootPRrevisado/merge develop yUATsolamente, nunca main/prod. No préstamosdecredenciales alogs.
5. H0fresco: saldo/cuotastokens/raíz/cotacosto visibleantespaid. EjecutarEscuchareal(base+discovery+apuestas/racismo,sinT&Bfijo) yciclocerrado≤3conumbralpreviamente sellado; luegoStudyT&Bsobremismocorpus/corte, sinreimportar/recomprarVoyage. Mantenercostos/etapas ycashdesconocidocomoUNKNOWN, no extrapolarClaudelineal.
6. CongelarStudyrealCOMPLETED ydigest, registrarsemillaciegaprerregistradaySHAcomonative_receipt ensealantesHuman22. ExportarciegosEscucha500antes+500después, Study≥200axes(mixed50,target40cadauno,ironía/marcaambiguacandidatas30),none30dentro+30fuera sinllamarfaltaejesFN,20motivosOFICIALES×10(no21fallback),nearest10cohortes×20y4candidatosoriginales/custodia/overlayvigente. Claves/semillasprivadasaparte. Comparar22causasprivadodespuésfreeze; calidadUNKNOWNhastaauditor,nohuman-gate.
7. QArealUAT Dashboard→estudio→Menciones→abrir→Monitoreo/Study, filtros/EN/originales,postedit/Investigar marca. Si hacefaltaedición deQAusarcasossintéticospropios,noalterarjuiciosreales sóloparacaptura. Entregarrecibopúblico,anexocomparación/paqueteprivadoSHA256SUMS, clavesaparte/guíaQA y10líneas enespañol. Auditar cada requisito antesupdate_goalcomplete.

## Resultado y retrospectiva

CI16FAILEDporunfixtureLatin1:nodeHTTPcoalesceaheader/stringbodyUTF8;laaserciónestrictadetectóésefallodelasimulación. TSC/lint,3H4+9firstKnowncasosnominalesyAgentprobe8controlesPASSsonpruebasacotadas;DBnoacabócenso,defaultFetchfrontierUNKNOWNylasúltimasetapasCIseomitieron. ElfixBufferharnessyelmotoraritméticoV3aisladoquedanrevisados/adoptadosparaSource17,nocorridostodavía. NohaymodeloV3productivonigeometríatransporteaceptados.

Q14CIpasó24steps,perosuMFPexperimentalfallóyWidthfuerechazadoporratio.9937vs.9+permisoUNPROVEN; noSQL/GUCpromovidos. Source16restauróoriginales ypreservórecibos. ÚltimoFull139.165rpssiguesinaceptar. R16aúnsinestudio real/pagos/UATniHuman22;goalH0–H6ACTIVO ynosecompletaconestedoblefix/probe/motoraislado.

Consultar [harness](R16_BENCHMARK_HARNESS.md), [H1V2](../../../scripts/r16/LISTENING_CAPACITY_PREREGISTRATION_V2.md), [ciego](../../../scripts/r16/BLIND_PACKAGE_README.md), [guíaUAT](R16_UAT_QA_GUIDE.md) y[ADR033](../../adr/033-listening-and-studies-on-shared-corpus.md). Soncontratos/guías,nopruebasdeejecuciónactual.
