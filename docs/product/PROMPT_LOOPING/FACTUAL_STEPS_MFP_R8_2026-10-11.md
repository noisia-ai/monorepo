# Pasos factuales MFP para el auditor · revisión 8

No sustituye `QA_FUNDADOR_MFP.md`. Los recorridos se registran separados y cada fila contiene una acción. Los números del primer recorrido se observaron el 11de octubre; el recorrido nuevo se ejecutó sobre Studio fijado 061028c0y Runner f20209e2 (runtime equivalente); la proyección final y Signal se validaron sobre Studio f251e368, deployment 063fa49e.

## Resultados existentes · Marca QA MFP Oct07R4

| Paso | Control exacto / acción | Número visible esperado | Espera típica observada | Incidencia |
|---|---|---|---|---|
| 1 | Abrir «Marcas» | 6marcas antes del alta nueva | 1–5s | El listado no certifica cobertura. |
| 2 | Abrir «Marca QA MFP Oct07R4» | 1,176menciones / 3archivos aceptados | 1–5s | Marca desechable de desarrollo. |
| 3 | Abrir «Topics» | Ficha, consolidación, catálogo y pertenencia | 12–26s para población | La build R8muestra carga y permite seguir usando la página. |
| 4 | Pulsar «Consultar estado» en preparación | 1,086 raíces en la población actual | 12–26s | No inicia proveedor. |
| 5 | Pulsar «Relevante 468» | 468relevantes; Ajena481 / Indeterminada107 / Spam30 | 12–26s | Son estados guardados, no aceptación semántica humana. |
| 6 | Pulsar «Ver resultados guardados» | 13/ 13: 5Topics / 0Narrativas / 4Noise / 4 insuficientes / 0errores / 0 pendientes | 1–5s | Son resultados editoriales previos. |
| 7 | Abrir un resultado guardado de Topic | Definición y evidencia del resultado | 1–5s | La propuesta no publica en Signal automáticamente. |
| 8 | Abrir «Cobros y depósitos en la renta» | 468 raíces relevantes / 423sin concepto | 12–26s | La definición actual es v2; §13.3propone v3en otro PR. |
| 9 | Abrir «Abrir mención» de una evidencia | Original íntegro de esa raíz | 1–5s | «Abrir fuente original» puede salir a un sitio externo. |

Costo visible previo: análisis USD 0.272274; editorial USD 0.171858, reserva y conciliaciónUSD 0.00. Ficha muestra próxima ejecuciónUSD 0.00y recálculo completoUSD 3.2689. Evitar usar «Analizar conversaciones», «Completar fichas pendientes» o «Calcular pertenencia completa» para revisar estos resultados: son acciones de procesamiento.

## Marca nueva · Marca QA MFP Oct11R8

La build 061028c0añade «Ver estimación editorial» → checkbox «Confirmo iniciar la revisión editorial pagada con esta estimación.» → «Iniciar revisión editorial». La estimación cubre screening y tres etapas globales, es orientativa y no sustituye al costo real. Un máximo estricto sólo aparece si existe. La cotización vence a los cuatro minutos; «Actualizar estado» permite solicitar una nueva.

La cola de población espera hasta 120s antes de responder con el error específico recuperable y «Actualizar». Sigue limitando a un lector pesado por proceso; esta entrega no afirma que todas las consultas se hayan acelerado. Los números siguientes corresponden al recorrido observado sobre el pin indicado.

| Paso | Control exacto / acción | Número visible observado | Espera observada | Incidencia |
|---|---|---|---|---|
| 1 | Abrir «Crear marca» | Formulario nuevo | 1–2s | Cuenta Admin Noisia autenticada; sin cambio de rol. |
| 2 | Completar «Marca» | Marca QA MFP Oct11R8 | Inmediato | Workspace desechable de desarrollo. |
| 3 | Completar «Nombre visible» | Marca QA MFP Oct11R8 | Inmediato | — |
| 4 | Completar «Organización» | MFP QA Revisión 8Oct11 | Inmediato | — |
| 5 | Completar «Slug» | mfp-qa-r8-20261011 | Inmediato | — |
| 6 | Seleccionar «Travel & Hospitality» en Industria | 1industria | Inmediato | Catálogo buscable con «Travel». |
| 7 | Completar «Aliases / handles» | National Car Rental / National / Emerald Club | Inmediato | Entrada por líneas. |
| 8 | Completar «Competidores» | Hertz / Avis / Enterprise | Inmediato | Entrada por líneas. |
| 9 | Activar «Activar ficha por mención, descubrimiento y pertenencia para este workspace» | Marcado | Inmediato | — |
| 10 | Completar «Descripción estratégica» | Contexto de renta de autos; marca principal National | Inmediato | Prueba, sin investigación pagada. |
| 11 | Completar «Notas de Knowledge Base» | Dos intereses confirmados | Inmediato | — |
| 12 | Pulsar «Crear marca y continuar» | Brand OS propio, 3competidores y 1KB | ~2s | Contexto semántico antiguo muestra política sin configurar; MFP usa contexto propio. |
| 13 | Abrir «Datos y fuentes» | 0archivos / 0 filas / 0menciones | 1–2s | — |
| 14 | Marcar «Confirmo que tengo permiso para almacenar y analizar los datos de esta fuente y mostrar sus menciones y métricas a los usuarios autorizados de la marca.» | Marcado | Inmediato | Corpus de QA autorizado. |
| 15 | Marcar «Esta fuente permite procesar su contenido con proveedores de inteligencia artificial.» | Marcado | Inmediato | No inicia proveedor. |
| 16 | Pulsar «Continuar a la carga» | Fuente Exportaciones de SentiOne | ~1s | — |
| 17 | Pulsar «Importar» de Primary brand | Formulario Importar en Primary brand | Inmediato | — |
| 18 | Seleccionar load1.csv en «Archivo CSV» | Archivo de 1,000 filas | Inmediato | CSV original de 47columnas. |
| 19 | Marcar «Voy a importar este archivo sin adjuntar su consulta de búsqueda.» | Marcado | Inmediato | — |
| 20 | Completar «Cobertura del archivo desde» | 2026-01-01 | Inmediato | — |
| 21 | Completar «Cobertura del archivo hasta» | 2026-08-23 | Inmediato | Zona America/Mexico_City. |
| 22 | Pulsar «Importar CSV» | 1,000 registros; 905incluidos / 72excluidos / 23duplicados | <30s | 977 únicas; sin repetir import. |
| 23 | Pulsar «Cerrar» | Datos del workspace | Inmediato | — |
| 24 | Abrir «Topics» | Ficha y catálogo nuevos | ~12s población | Carga visible; editor disponible. |
| 25 | Pulsar «Preparar texto» | 905preparadas / 72excluidas | <30s | Gratis, sin proveedor. |
| 26 | Pulsar «Actualizar» de Procesamiento del workspace | 0/ 905; estimación USD 2.7824 | ~12s | La primera lectura conservaba 0/ 0hasta refrescar después de preparar. |
| 27 | Pulsar «Completar fichas pendientes» | Procesando; reserva temporal USD 18.051 | ~1s inicio | Sonnet5.5Batch: 194 llamadas originales + 35de recuperación; 229liquidadas USD 3.167715, reserva final0; ~19min. |
| 28 | Pulsar «Crear tópico» | Definición nueva | Inmediato | Editor usable durante Batch. |
| 29 | Completar «Nombre» | Cobros y depósitos en la renta | Inmediato | — |
| 30 | Completar «Qué conversación debe encontrar» | Experiencias concretas de cargos y depósitos | Inmediato | Definición confirmada v1del corpus de prueba. |
| 31 | Completar «Señales que ayudan a incluir — una por línea» | 3señales | Inmediato | — |
| 32 | Completar «Límites y exclusiones — una por línea» | 3límites | Inmediato | — |
| 33 | Completar «Ejemplos positivos — opcional» | 2ejemplos | Inmediato | — |
| 34 | Completar «Ejemplos negativos — opcional» | 2ejemplos | Inmediato | — |
| 35 | Pulsar «Guardar interés» | Borrador creado | ~1s | Sin gasto. |
| 36 | Pulsar «Crear tópico» | Definición nueva | Inmediato | — |
| 37 | Completar «Nombre» | Atención durante la entrega y devolución | Inmediato | — |
| 38 | Completar «Qué conversación debe encontrar» | Interacción de servicio concreta | Inmediato | — |
| 39 | Completar «Señales que ayudan a incluir — una por línea» | 3señales | Inmediato | — |
| 40 | Completar «Límites y exclusiones — una por línea» | 3límites | Inmediato | — |
| 41 | Pulsar «Guardar interés» | Segundo borrador creado | ~1s | Sin gasto. |
| 42 | Abrir «Datos y fuentes» | Texto preparado | 1–2s | «Ver datos y preparación» no navegó en primera pulsación; navegación lateral funcionó. |
| 43 | Pulsar «Calcular costo» | Máximo estimado USD 1.321393 | <1s | No llama proveedor. |
| 44 | Pulsar «Crear vectores · estimación USD 1.321393» | En cola | <1s inicio | Voyage4-large. |
| 45 | Pulsar «Actualizar estado» | 905 raíces completas; costo USD 0.097130 / reserva 0 | ~2min ejecución | 3,158referencias, 3,144chunks nuevos y 14cache hits; censo remoto. |

| 46 | Pulsar «Actualizar estado» en análisis | 905 fichas con estado; 503relevantes | ~1s | 2errores técnicos, 130abstenciones indeterminadas; no se ocultan. |
| 47 | Pulsar «Analizar conversaciones» | 18grupos interpretados de 18; costo USD 0.427017/reserva 0 | ~7min | Estimación USD 1.536483sobre 503menciones/~47grupos; no es máximo. |
| 48 | Pulsar «Calcular pertenencia completa» | 116 decisiones / 2definiciones / 58 raíces marca principal | ~8min | Estimación USD 0.4288;34 llamadas Batch;USD 0.338914liquidado/reserva 0. |
| 49 | Recargar la página Topics | 18grupos en preparación numérica | ~12s población | El panel conservaba 0hasta recargar, aun con análisis terminal. |
| 50 | Pulsar «Preparar revisión de Topics» | 18de 18preparados | ~2min | Gratis; no repetir análisis. |
| 51 | Pulsar «Ver estimación editorial» | USD 1.08056para 18grupos | <2s | Sin proveedor ni reserva. |
| 52 | Marcar «Confirmo iniciar la revisión editorial pagada con esta estimación.» | Checkbox marcado | Inmediato | Botón de inicio deshabilitado previamente. |
| 53 | Pulsar «Iniciar revisión editorial» | En curso; reserva máximaUSD 17.612485 | ~1s inicio | Una admisión; estimación distinta de reserva temporal. |
| 54 | Marcar «Mostrar este concepto en Signal» de Cobros | Marcado | ~2s | Control asíncrono: la primera comprobación inmediata devolvió error aunque el guardado terminó. |
| 55 | Abrir «Atención durante la entrega y devolución» | 5belongs/ 47no/ 3insuficiente/ 3error | ~12s | Cobros:4belongs/ 51no/ 3error. |
| 56 | Marcar «Mostrar este concepto en Signal» de Atención | Marcado | ~2s | — |
| 57 | Abrir «Abrir Signal» | Topics2; 905total / 6 únicas seleccionadas / 503relevantes / 241ajenas / 29spam / 132indeterminadas / 497sin concepto | ~20s | No sumar4+ 5: conceptos se superponen. Aviso experimental visible. |
| 58 | Pulsar «Ver evidencia» de Atención | 5originales con pasajes de pertenencia | ~2min cola | Apertura inmediata; la evidencia tarda después. |

| 59 | Pulsar «Abrir mención» desde evidencia de Atención | Menciones del workspace | ~20s | Original interno completo; no salir a otra web. |
| 60 | Pulsar «Actualizar estado» de editorial | 18/ 18:0Topics/ 0Narrativas/ 12Noise/ 6 insuficientes;USD 0.235624/reserva 0 | ~6min desde admisión | Sólo19 llamadas:18screening+ 1global. No hay Topic automático adoptable; Signal mantiene selección manual. |
| 61 | Abrir «Brand OS» | Identidad y set competitivo | ~2s | — |
| 62 | Cambiar «Descripción estratégica» | Nueva prioridad narrativa | Inmediato | No se cambian entidades en esta acción. |
| 63 | Pulsar «Guardar Brand OS» | Overview con cambios guardados | ~2s | CEv1/digest y229+ 34 llamadas conservados; cambio narrativo no dispara proveedor. |
| 64 | Abrir «Brand OS» | Identidad editable | ~2s | — |
| 65 | Escribir «Emerald Aisle» en input de «Aliases / handles» | Texto de alias | Inmediato | — |
| 66 | Pulsar Enter en el input de alias |4 aliases | Inmediato | — |
| 67 | Pulsar «Guardar Brand OS» |Overview con4 aliases |~2s | — |
| 68 | Abrir «Brand OS» |Set competitivo editable |~2s | — |
| 69 | Completar «Agregar seeds competitivos Uno por línea. Esto crea relaciones competitivas, no notas de research.» |Sixt | Inmediato | — |
| 70 | Pulsar «Agregar» |Competidores(4),Sixt visible |~1s | — |
| 71 | Abrir «Topics» |Población y estado del nuevo contexto |~12s | — |

| 72 | Pulsar «Completar fichas pendientes» | CEv2targeted64 + 2 recuperaciones= 66 raíces/ 25 llamadas | ~7min | Estimación USD 0.2406, reserva temporalUSD 2.3083; 841no afectadas por CE:2 recuperaciones técnicas y839sin reenvío. TerminalUSD 0.340485/reserva 0; desvío+ 41.5%, seguimiento #54. |
| 73 | Abrir «Cobros y depósitos en la renta» | Editor del interés |~12s población | — |
| 74 | Editar «Qué conversación debe encontrar» | Atribución específica a National y exclusión de cargos ajenos | Inmediato | Atención conserva definición v1. |
| 75 | Pulsar «Guardar cambios» | «Definición guardada.» |~2s | Sin proveedor. |
| 76 | Abrir «Datos y fuentes» | Importar deshabilitado; ámbitos necesitan actualizarse |~2s | Cambio de Brand OS exige reconciliar plan. |
| 77 | Recargar la página | Controles hidratados |~2s | «Actualizar ámbitos» no desplegó configuración hasta recargar. |
| 78 | Pulsar «Actualizar ámbitos» | «Crear borrador del plan» disponible | Inmediato | No inicia proveedor. |
| 79 | Pulsar «Crear borrador del plan» |6slots, incluyendo Sixt; «Activar plan» |~1s | Conector y permisos existentes conservados. |
| 80 | Pulsar «Activar plan» |Modal versión2/ 6slots | Inmediato | — |
| 81 | Completar «Motivo o evidencia La activación queda registrada con actor, fecha y evidencia.» |Evidencia del cambio para segunda carga | Inmediato | — |
| 82 | Pulsar «Activar plan completo» |Importar habilitado |~1s | Activación manual, sin generación Claude de queries. |
| 83 | Pulsar «Importar» de Primary brand |Formulario avanzado de import | Inmediato | La configuración quedó abierta; controles diferentes a carga1. |
| 84 | Marcar «Actualizar contenido de IDs existentes» |Marcado | Inmediato | El CSV contiene20 filas designadas de revisión; tras deduplicar son19IDs revisados. |
| 85 | Marcar «Confirmo que la query ejecutada no está disponible.» |Marcado | Inmediato | Motivo «El proveedor no incluyó la query». |
| 86 | Seleccionar load2.csv en «Archivo CSV» |250 filas | Inmediato | CSV original de47columnas. |
| 87 | Completar «Cobertura del archivo desde» |2026-01-01 | Inmediato | — |
| 88 | Completar «Cobertura del archivo hasta» |2026-08-23 | Inmediato |Zona America/Mexico_City. |

| 89 | Pulsar «Importar CSV» con load2original |Falló/ 0 registros aplicados |~10s | Rechazo correcto:3IDs con contenido contradictorio dentro de250 filas; original conservado. |
| 90 | Seleccionar load2-r8-reconciled.csv en «Archivo CSV» |250 filas/ 47columnas/ 245IDs;0 conflictos internos | Inmediato | Copia determinista autorizada: última revisión designada porID, si no primera de load1, si no primera de load2.6 filas normalizadas; hashes en evidencia privada. |
| 91 | Pulsar «Importar CSV» con copia reconciliada |250= 200incluidas+ 18excluidas+ 32duplicadas |<30s |199IDs nuevos/ 46 conocidos/ 19IDs revisados;2archivos aceptados/ 1250 filas/ 1176 únicas. |
| 92 | Pulsar «Cerrar» |Datos actualizados | Inmediato | — |
| 93 | Abrir «Topics» |1086preparadas/ 90excluidas |~12s población | Preparación automática gratis:931 raíces reutilizadas/ 199nuevas/ 46 fingerprints cambiados;886assets elegibles idénticos/ 19 revisados. |
| 94 | Pulsar «Completar fichas pendientes» |Estimación USD 0.6061vs completoUSD 3.2798 |~8min | Transporte real201 raíces/ 52 llamadas= 181nuevas+ 19revisadas+ 1recuperación;885 elegibles sin nuevo transporte. TerminalUSD 0.566797/reserva 0. |
| 95 | Abrir «Datos y fuentes» |Vectores previos905/ 905visibles |~2s | Estado histórico hasta nueva cotización. |
| 96 | Pulsar «Calcular costo» |1086 elegibles/ 3634 fragmentos;máximoestimadoUSD 0.266225 |<1s |No llama proveedor. |
| 97 | Pulsar «Crear vectores · estimación USD 0.266225» | En cola |~1s inicio | Reutiliza chunks vigentes; no fit completo. |

| 98 | Abrir «Topics» |1086/ 1086 fichas vigentes;616relevantes/ 300ajenas/ 35spam/ 135abstenciones |~2min población |0 pendientes/errores; vectores1086/ 1086,515chunks nuevos/ 3119cachehits,USD 0.014512/reserva 0. |
| 99 | Abrir «Cobros y depósitos en la renta» |Definición v2, próximaestimaciónUSD 0.4255 |~2min población |Atención conserva v1; selección de Cobros exige versión actual. |
| 100 | Pulsar «Calcular pertenencia completa» | En cola, run47155e50 |~1s admisión |Calcula únicamente claves faltantes; no repetir ni ejecutar fit completo. |

| 101 | Pulsar «Actualizar» en pertenencia |Completado;Cobrosv2= 2pertenece/ 61no/ 3insuf/ 1error, Atenciónv1= 7pertenece/ 56no/ 3insuf/ 1error |~8min desde admisión |38 llamadas/ 91 claves;USD 0.365335/reserva 0.43 decisiones Atenciónv1conservadas. |
| 102 | Marcar «Mostrar este concepto en Signal» en Cobrosv2 |Marcado, versión actual seleccionada |~2s |Atenciónv1conserva su selección previa. |
| 103 | Pulsar «Abrir Signal» | Tópicos y narrativas; resultado anterior durante proyección | ~2min | Gate de CE histórico corrigió SQL0263; no se repitió fit. |
| 104 | Pulsar «Actualizar» en Signal | Vigente · interpretación parcial; total1,086=616relevantes+300ajenas+35spam+135sin determinar | ~2min | Generación6b3f577a revisión12; proyección1,086/1,086. |
| 105 | Abrir «Atención durante la entrega y devolución 7 0.6%» | 7menciones, definiciónv1; Cobrosv2=2/0.2%; ocho únicas seleccionadas | Inmediato | Conteos por concepto se superponen. |
| 106 | Pulsar «Ver evidencia» | Siete originales con citas y enlaces; generación vigente | ~5 min | La carga de detalle fue lenta; no se repitió procesamiento. |
| 106a | Pulsar «Abrir mención» de la primera evidencia | Original íntegro en Menciones | ~2 min | Navegación de producto; no abre fuente externa. |
| 107 | Abrir «Gestionar Topics» | Topics e intereses | ~2s | Tras cambiar el pin apareció excepción de navegación; recarga completa resolvió. |
| 108 | Recargar la página de Topics | UI del build final, reserva temporal máxima y mensaje de carga | ~2s | No inicia proveedor. |
| 109 | Pulsar «Preparar evidencia · sin costo Claude» | Preparando evidencia de temas nuevos; conserva18/25 | ~2min | Sólo preparación gratis; no se autorizó interpretación pagada por falta de estimación previa visible, seguimiento #56. |

Proyección numérica completa y Signal vigente confirmados. Gate operativo producer false identificado y habilitado sólo en Runner dev-test, con mismo artefacto fijado; no es paso de usuario fundador.

### Integridad del CSV de segunda carga

Original `load2.csv`: SHA256 `ee7081bc576510ec97130830bced41f6ae253e5ee977c8cad497b340cef03465`.
Copia QA `load2-r8-reconciled.csv`: SHA256 `60f0c94dec9c950caa9aeaa55c1dda364c251e9574ecd8c6c534296a9fa2835e`.
Ambos conservan 250 filas, 47columnas y 245IDs únicos. La copia normaliza seis filas y elimina tres IDs con contradicciones internas. Por ID se toma la última fila entre las veinte revisiones designadas; si no existe, la primera fila de load1para un ID conocido; si no, la primera fila de load2. Se repite esa fila canónica en las posiciones originales del ID. El original permanece intacto. Preflight: cero conflictos, 199IDs nuevos, 46 conocidos y 19IDs efectivamente revisados. El rechazo original queda visible como intento fallido con cero escritura; la copia usa los mismos derechos y `revise_existing` por UI.

### Gate numérico y límite de interpretación

Producer false→true sólo Runner dev-test admitió revisión12, modo `frozen-model-delta`, parent `74691fb2-b36a-410a-babf-61cd816bfd64`; conservó el modelo/checkpoint inicial. Cálculo ready616/616sin nuevo fit. El guard histórico rechazó CE distinto aun con parent vigente/catálogo idéntico. SQL0263pasó PG17real (8PASS) y se aplicó una vez, con destino/preimage/hash comprobados; recuperó la misma derivación. Proyección `1fedd26b-7d83-465b-bdc6-ef19703074ce` ready1086/1086, generación `6b3f577a-ddbb-4a49-9234-5a7ea96c38af` vigente; sin errores ni trabajo numérico pendiente. Signal muestra los denominadores del paso104y608relevantes sin concepto.

Interpretación18/25es cobertura parcial visible. La preparación incremental gratuita se solicitó una vez; el siguiente formulario sólo ofrece máximo opcional, no estimación orientativa previa. No se iniciaron las siete unidades pagadas; [seguimiento #56](https://github.com/noisia-ai/monorepo/issues/56) exige quote y continuación conservando las18anteriores. Editorial automático produjo cero Topics adoptables; los dos conceptos seleccionados son manuales. No se acredita adopción de dos Topics automáticos ni aceptación semántica. Autodeploy OFF/una réplica; UAT y producción intactos.

Guard SQL0263: SHA256 `92134fb77a96cd9ce1ea15434b720d92a4a02402354e2d55cee7af141fa39739`; preimage `361c0e022cfe5b27cd64cd10e839c4f7ab6a28141478e36bc0514bfcc9bd4fa5`; postimage `dccefa6abd24e033893b7c1e773a5f398d043be3ee063628f4dd67227c479d9e`. Aplicación única dev-test registrada en evidencia privada.
