# Lista factual R10 · §15.1 · recorrido completado en dev-test

Esta lista alimenta al auditor; `QA_FUNDADOR_MFP.md` permanece intacta. **Corte 18-oct 18:54 UTC: recorrido funcional R10 completo en dev-test, pendiente QA final del fundador y revisión del auditor.** Las filas 1–30 son historia fechada; las posteriores documentan su continuación real. Signal final sirve cuatro conceptos con pertenencia semántica, 235 raíces únicas de 1,101. Calidad no calibrada; no acredita producción ni aprobación del etiquetador. No se usan datos de R4/R8 para completar R10.

## Destino y custodia

- Build fijada `0e84ddf634326b964253024d7a239f19a60e175d`; Studio y Runner SUCCESS, 38 hashes comunes más dos catálogos de idioma en Studio y siete variables privadas verificados en ambos; una réplica, autodeploy OFF y salud HTTP200. El fundador eligió opción B: una sola QA final con R10 completa. Respaldo anterior preservado; no redeploy durante import activo del estudio.
- Marca «Marca QA MFP Oct11 R10»; brand `20c7d12a-57fd-49d9-a97b-7b19bf5f2d8f`, workspace `b466a888-c3f6-4b53-babe-e076be9e82d1`, slug `mfp-qa-r10-20261011`.
- URL Topics: https://mfp-studio-dev-test.up.railway.app/studio/brands/20c7d12a-57fd-49d9-a97b-7b19bf5f2d8f/topics. Signal propio: `/signal/mfp-qa-r10-20261011/topics-narratives`; servido con tres intereses manuales y un concepto Categoría adoptado, todos con pertenencias vigentes.
- CSV: `/Users/brandhon_o/Downloads/noisia-website/.data/dev-corpus/r10/load1.csv` y `load2.csv`; 47 columnas/1,000 y250 filas. Load1 SHA256 `4773f7ff553419422163d89c688cfa86227736844f4c9d5e02d0de3a4fb41d86`; load2 `8817c1fa4a055a807198582f449265d01a38821f6b1b2ecf0fb0e93cf2c213ea`.
- Muestra QA limpia: excluye344 IDs/1,230 filas contradictorias. Manifest privado enumera todos los IDs/filas/motivos y hashes originales/nuevos, SHA256 `86cfde3bda7aa9fa9f4c1eea3fd52b60009d7a2f7db80031436f186e61881c0f`. No representa la fuente íntegra; originales preservados, sin reconciliar durante importación.
- Fuente «SentiOne QA MFP R10», Primary brand, cobertura 2026-01-01→2026-08-23, America/Mexico_City. Revisión IDs OFF en load1; load2 se importó una sola vez después de Signal inicial, con revisión ON.

## Acciones observadas, una por fila

Los tiempos son límites clic→observación, salvo duración worker indicada. Campos de formulario son entrada directa, no latencia del servidor. La espera de Batch es asincrónica; no pulsar otra autorización mientras siga en curso.

| Paso | Control exacto / acción | Número o valor visible | Espera y coste | Incidencia |
|---|---|---|---|---|
| 1 | Pulsar «Crear marca» en Dashboard | Formulario nuevo | <1.954s; USD0 | Sesión Admin Noisia existente. |
| 2 | Completar «Marca» | Marca QA MFP Oct11 R10 | Entrada directa; USD0 | Marca nueva, no R4/R8. |
| 3 | Completar «Nombre visible» | Marca QA MFP Oct11 R10 | Entrada directa; USD0 | — |
| 4 | Completar «Organización» | Noisia | Entrada directa; USD0 | — |
| 5 | Completar «Slug» | mfp-qa-r10-20261011 | Entrada directa; USD0 | — |
| 6 | Seleccionar Industria | Travel & Hospitality | Entrada directa; USD0 | MX, America/Mexico City guardados. |
| 7 | Completar «Aliases / handles» | National Car Rental, Emerald Club | Entrada directa; USD0 | Dos aliases, tres competidores Hertz/Avis/Enterprise guardados. |
| 8 | Marcar «Activar ficha por mención, descubrimiento y pertenencia para este workspace» | Marcado | Entrada directa; USD0 | No activa H1. |
| 9 | Pulsar «Crear marca y continuar» | Brand OS; 1 KB/2aliases/3competidores | <8.058s; USD0 | Descripción/KB manuales guardadas; no ayuda Claude opcional. |
| 10 | Pulsar «Gestionar tópicos» | Catálogo0; fichas0/0; relevantes0 | <2.935s; USD0 | Aviso semántico legacy «Procesamiento sin configurar» no bloqueó carga/preparación/vectores. Copy corregido localmente. |
| 11 | Guardar interés «Cobros y depósitos en la renta» | Borrador1; Marca principal; interés marcado | Observación55.068s después; USD0 | Intervalo de observación, no duración exacta del guardado. |
| 12 | Guardar interés «Atención y resolución de reclamaciones» | Borrador2; Marca principal; interés marcado | <1.901s; USD0 | Definición/inclusión/exclusión/ejemplos guardados. |
| 13 | Guardar interés «Reserva y entrega del vehículo» | Borrador3; Marca principal; interés marcado | <9.317s; USD0 | Tres manuales propios, ninguno seleccionado todavía en Signal. |
| 14 | Marcar «Confirmo que tengo permiso para almacenar y analizar los datos de esta fuente y mostrar sus menciones y métricas a los usuarios autorizados de la marca.» | Marcado | Entrada directa; USD0 | Declaración de derechos. |
| 15 | Marcar «Esta fuente permite procesar su contenido con proveedores de inteligencia artificial.» | Marcado | Entrada directa; USD0 | Declara permiso; no autoriza cargo. |
| 16 | Pulsar «Continuar a la carga» | Fuente propia; Primary brand | Observación76.681s después; USD0 | Intervalo de observación, no latencia exacta. |
| 17 | Seleccionar `load1.csv` en «Archivo CSV» | 1,000 filas/47 columnas | Entrada directa; USD0 | Chrome selector nativo no habilitó Open; cancelado sin POST. Orquestador usó IAB una vez. |
| 18 | Marcar «Voy a importar este archivo sin adjuntar su consulta de búsqueda.» | Marcado | Entrada directa; USD0 | Sin query adjunta. |
| 19 | Completar «Cobertura del archivo desde» | 2026-01-01 | Entrada directa; USD0 | — |
| 20 | Completar «Cobertura del archivo hasta» | 2026-08-23 | Entrada directa; USD0 | America/Mexico_City. |
| 21 | Pulsar «Importar CSV» | 1,000 filas:901 incluidas/17excluidas/82duplicadas | IAB terminal100%; USD0 | Un único envío; job creado02:35:03.882Z. Datos1archivo/918únicas/con texto. |
| 22 | Pulsar «Preparar texto» | 901preparadas/17excluidas;4,048fragmentos | UI<17.967s; worker2.371s; USD0 | Sin import adicional. |
| 23 | Pulsar «Calcular costo» | USD1.814885;901menciones/4,048fragmentos;0reutilizables | Cotización visible antes de autorización; USD0 | Estimación orientativa. |
| 24 | Pulsar «Crear vectores · estimación USD1.814885» | 901/901;4,048/4,048 | Terminal<56.552s; USD0.132160 real | Sin máximo estricto configurado. |
| 25 | Pulsar «Completar fichas pendientes» | CotizaciónUSD3.1952;901raíces; reservaUSD23.2034 | Worker17m23.532s; USD2.838194 real | Run4573aba2… único;791válidas (740labeled/51abstained),9invalid_facets+101DNC. |
| 26 | Esperar actualización automática | Resumen791/901 | TerminalPG02:54:54.333Z/UI02:55:50.478Z | Tabla y poblaciones dependientes siguieron obsoletas; fix local invalida GET, no intención pagada. Checkpoint histórico; actualización automática acreditada después en31 y45. |
| 27 | Pulsar «Completar fichas pendientes» para recuperación focal | EstimaciónUSD0.4016;110raíces exactas;0válidas reenviadas | Worker83.427s; USD0 real | Autorizado una vez03:05:59.494Z; runc6a28ab8…:39callsfailed/110DNC;791válidas intactas. |
| 28 | Esperar resultado automático | 791válidas/110errores; reserva activa0 | Terminal03:07:23.986Z; USD0 | No tercer intento. Cuerpo/códigoHTTP histórico no preservado. Checkpoint histórico; superado por el pin y replay gratuito del 18-oct. |
| 29 | Pin Studio+Runner y 0268; reaplicar nueve respuestas almacenadas mediante escritor de producto | 800/901 semánticas;101errores | 18-oct 08:54:43Z; USD0 adicional | Las791 anteriores y ledger intactos; replay posterior sin efecto. Operación interna gratuita, no es un control UI self-service. |
| 30 | Consultar Topics autenticado sobre pin nuevo | 800/901; cotización recuperación101 USD0.3483 | Lectura gratuita | No se pulsó en este checkpoint; ejecutada después en31 con saldo actual. |
| 31 | «Completar fichas pendientes», tras saldo Claude USD32.54 | 101 pendientes →901/901 (831 labeled/70 abstained) | 15:44:52.777→15:55:51.361Z; 658.584s; USD0.391729 | 31 calls; las800 previas intactas, sin reenvío. |
| 32 | «Analizar conversaciones», tras saldo Claude USD32.15 | QuoteUSD2.042448;527raíces/~61grupos estimados →23grupos reales/26tópicos técnicos incluidos3manuales | 15:56:37.213→16:05:04.720Z;507.507s;USD0.809574 | Un clic; no sustituye revisión editorial. |
| 33 | «Calcular pertenencia completa», tras saldo Claude USD31.34 | QuoteUSD0.445842;54raíces×3conceptos=162pares | 16:06:43.680→16:24:44.626Z;1080.946s;USD0.336086 | 35calls/2batches;3errores de una raíz por rationale33/32palabras, reparados gratis en37. |
| 34 | «Preparar revisión de Topics» | 23/23dossiers | 16:14:40.593→16:14:46.203Z;5.610s;USD0 | Gratis, en paralelo a33; no autorización editorial. |
| 35 | Cotizar, marcar confirmación y «Iniciar revisión editorial», tras saldo Claude USD31.00 | QuoteUSD1.347187/23grupos | 16:33:41.525→16:39:54.835Z;373.310s;USD0.304142 | 23screening+1shard global. Screening17Noise/6insuficientes; finalglobal16Noise/7insuficientes,0conceptos y0errores. No hay adopción inventada. |
| 36 | Pin manual Studio+Runner del fix de recuperación | `5cfbd2d4`;38hashes comunes+2idiomas Studio;7variables;HTTP200 | Ambos SUCCESS verificados16:57Z;USD0 | CI521/PG256 verdes;backup/autodeployOFF;R4/R8 y901fichas intactos. |
| 37 | «Recuperar respuestas guardadas · sin costo» | 3errores→2belongs+1not_belongs;162pares sin errores | Verificado16:59:33Z;USD0 | Un clic; botón desaparece al no quedar candidatos; mismo run/calls/ledger, no proveedor. Replay no-op probado en PG. |
| 38 | Seleccionar «Mostrar este concepto en Signal» en los tres intereses | Atención12/Cobros6/Reserva12;3Topics;509relevantes sin concepto | Selección gratuita | Signal inicial, aún sin concepto descubierto adoptable. |
| 39 | Filtro plataforma «Reviews» en Menciones | 901→73; desaparece «Actualizando…» | 14.061s observados;USD0 | Incluye latencia CUA; cumple<15s en este caso, no SLO general. |
| 40 | Seleccionar sólo caso justificado y «Rechazar pertenencia» en Reserva | 12→11 resultados;Signal12/6/11 sin run nuevo | 3.668s observados;USD0 | PG17:07Z:override vigente/sourcehuman,0calls nuevos;ID/texto/cita sólo privados. |
| 41 | Importar `load2.csv` una vez, revisión IDs ON | 250filas/47columnas;220incluidas/1excluida/29duplicadas;20revisiones | 17:07:43.720→17:07:49.173Z;5.453s;worker3.522s;USD0 | 250observaciones+250membresías de procedencia;1chunk/8queries/0fallback. |
| 42 | Preparación automática de texto tras load2 | 1,101preparadas/18excluidas | Observación UI;USD0 | No nuevo clic manual de preparación. |
| 43 | «Calcular costo» de vectores delta y comprobar saldo Voyage | USD0.496863;840chunks faltantes;4,063cached;4,133,529tokens cota | Cotización gratuita | Saldo fresco149,892,300tokens gratuitos cubre cota; no compra. |
| 44 | «Crear vectores» una vez | 1,101/1,101;5,208refs/4,903asset-chunks | 17:11:13.964→17:11:31.563Z;17.599s;USD0.027357 | 840vectores nuevos/39calls;227,790tokens observados;0pending/reserva/unknown. |
| 45 | Cotizar y «Completar fichas pendientes», tras saldo Claude USD30.70 | QuoteUSD0.823287;201pendientes=181nuevas+20revisadas;900vigentes | 17:15:02.421→17:23:47.202Z;524.781s;USD0.865560 | Un clic.76calls/201raíces en1Batch;0inputs fuera del conjunto pendiente.900vigentes y901labels almacenadas conservan hashes;1,101/1,101=1,014labeled+87abstained,0errores. |
| 46 | Esperar delta numérico automático | 647/647raíces;3,182/3,182fragmentos | 17:24:05.503→17:26:45.954Z;160.451s;USD0 | Modelo congelado;sin nuevo proveedor ni clic de análisis. |
| 47 | Esperar proyección automática | 1,101/1,101raíces;5,208/5,208fragmentos | 17:27:01.307→17:31:58.800Z;297.493s;USD0 | Dispatch completado;sin errores;Signal conserva resultado previo hasta cierre. |
| 48 | «Preparar evidencia · sin costo Claude» una vez | 33grupos=23heredados+10nuevos;plan listo | 17:32:34.397→17:32:53.165Z;18.768s;USD0 | Sin proveedor,0claimed antes de interpretar;no solicitud duplicada. |
| 49 | Cotizar, marcar casilla y «Autorizar e interpretar temas nuevos», tras saldo Claude USD29.83 | QuoteUSD0.956970/10grupos/Sonnet4.6;modelo verificado porAPI200 | 17:33:44.807→17:37:38.076Z;233.269s;USD0.513519 | 5calls(3solicitudes+2reparaciones),123,088input/9,617output;10/10,0errores;5coherent/4mixed/1insufficient. |
| 50 | Esperar catálogo y segunda proyección automática | Catálogo36=33grupos+3manuales;9candidatos nuevos | Materializado17:37:57.620Z;proyección17:38:34.205→17:43:55.882Z;321.677s;USD0 | 1,101raíces/5,208fragmentos completos;sin nueva autorización/proveedor. |
| 51 | Revisar evidencia y «Adoptar concepto» únicamente en Mercado de renta, ámbito Categoría | 4conceptos;digest nuevo;no selección automática | ConfirmadoUIyPG17:46:15Z;USD0 | 11/11citas de dos propuestas exactas/SHA;se elige propuesta sectorial coherente,otra conCSR/patrocinio se pospone. |
| 52 | Consultar estimación del delta de pertenencia | 578pares=33delta previos+545concepto nuevo;quoteUSD2.816596 | DTOproductoREADONLY17:47:02Z;USD0 | Route estándar,stale0;sin autorizar aún mientras termina juez aislado;requiere nuevo saldo. |
| 53 | Saldo Claude USD27.12, cotización global y «Calcular pertenencia completa» una vez | 578pares pendientes en4conceptos;quoteUSD2.816596;147vigentes no reenviados | 18:15:39.780→18:33:54.060Z;1094.280s;USD2.393363 | 185calls/2Batches;547raíces;0fuera de selección;1error técnico de presentación. |
| 54 | Pin pareado del arreglo tras run terminal y CI/PG verdes | Studio+Runner0e84ddf6;fuentes40/38 y7vars cada uno | Verificado18:51:42Z;USD0 | AutodeployOFF/réplica1/HTTP200;R4/R8 y725pares/1101fichas/ledger pre-post idénticos;0268canónico. |
| 55 | «Recuperar respuestas guardadas · sin costo» una vez | 1schemaerror→belongs;37→30palabras;2citas intactas | Verificado18:52:21Z;USD0 | 725pares=259belongs/454not_belongs/12insufficient;0error/0pending;185calls/USD2.393363 sin cambio;repeticiónPGno-op. |
| 56 | Abrir concepto adoptado Categoría225positivos y marcar «Mostrar este concepto en Signal» | 4conceptos seleccionados;14/9/11/225asociaciones | VerificadoDTO18:53:49Z yUI final:Categoría225/20.4%,235únicas;USD0 | No elegir homónimo técnico51asignaciones;todos basis=concept_membership;235raíces únicas/1101;647relevantes,412sinconcepto;override humano intacto,sin otro run. |

Estado histórico antes de la recuperación101:472 relevantes/254ajenas/152indeterminadas/23spam =901. Son poblaciones completas de la tabla incluyendo errores, **no** 901 fichas válidas. No sustituirlo por el censo real748labeled/52abstained ni por un denominador de análisis todavía inexistente.

Censo histórico previo/post al pin integrado de las 10:43:39Z: 748 labeled + 52 abstained + 101 error. Los hashes de las 800 labels y las 101 raíces pendientes permanecen iguales; ledger247 calls settled/USD2.838194 y70 failed sin cambio. USD2.970354 incluye además USD0.132160 de vectores; no son cifras comparables de una misma etapa. 0269 ya constaba aplicada por su carril separado; no se repitió ni se llamó proveedor durante este despliegue.

## Tabla completa de controles y dinero

Las estimaciones preceden al proveedor; son orientativas. Reserva temporal y gasto liquidado son valores diferentes. Máximo estricto sólo cuando se configura expresamente. La siguiente tabla combina controles observados con contrato de código de la build; una fila «sin ejecutar R10» no acredita su coste ni resultado.

| Control | Qué muestra antes de autorizar | Confirmación | Uso R10 / condición |
|---|---|---|---|
| «Preparar texto» | Preparación gratuita, sin proveedor | Clic; sin casilla pagada | Ejecutado:USD0. |
| «Calcular costo» | Cotiza vectores/fragmentos reutilizables | Lectura gratuita | Lectura gratuitaUSD0;quote load1USD1.814885 ydeltaUSD0.496863, no cargos. |
| «Crear vectores · estimación …» | Importe estimado dentro del botón; máximo sólo si configurado | Clic; sin casilla específica | Load1:USD0.132160;deltaUSD0.027357;840chunks nuevos. |
| «Completar fichas pendientes» | «Estimación de la próxima ejecución», reserva temporal y máximo separados | Clic; sin casilla específica | Load1 y recuperaciones registradas arriba; delta201 terminado porUSD0.865560,900vigentes sin repetir. |
| «Recalcular ficha completa» | «Estimación del recálculo completo» | Clic; si cambia CE puede exigir confirmación ulterior | Sin ejecutar R10; no usar para recuperar101. |
| «Confirmar recálculo completo» | Recálculo pendiente y estimación completa vinculados al contexto actual | Clic de segunda confirmación, mismo run | Sólo aparece si el run requiere confirmación; sin ejecutar R10. |
| «Analizar conversaciones» | Interpretación orientativa por menciones/grupos; no incluye consolidación ni fija límite | Clic; sin casilla editorial en este inicio | Ejecutado:USD0.809574;527raíces/23grupos. |
| «Probar definición · 30 raíces» | «Estimación de prueba · 30 raíces» | Clic; sin casilla específica | Sin ejecutar R10; prueba no publica pertenencias ni cambia Signal. |
| «Calcular pertenencia completa» | «Estimación de la próxima ejecución», relevante/pendiente y reserva separados | Clic; sin casilla específica | InicialUSD0.336086/162pares;deltaUSD2.393363/578pares;cotización global de4conceptos, no sólo panel abierto;147vigentes no repetidos. |
| «Ver estimación editorial» | Quote, importe/grupos y vencimiento | Lectura gratuita | Ejecutado:quoteUSD1.347187/23grupos. |
| «Iniciar revisión editorial» | Quote vigente | «Confirmo iniciar la revisión editorial pagada con esta estimación.» | Ejecutado:USD0.304142;quote+casilla antes del único inicio. |
| «Ver estimación de temas nuevos» | Quote sólo de unidades nuevas, importe/reserva/vencimiento | Lectura gratuita | Ejecutado:quoteUSD0.956970/10grupos nuevos,tras evidencia gratis. |
| «Autorizar e interpretar temas nuevos» | Quote vigente sólo de unidades pendientes | «Confirmo iniciar la interpretación pagada de los temas nuevos con esta estimación.» | Ejecutado:USD0.513519/10grupos;quote+casilla+saldoUSD29.83antes del clic. |
| «Recuperar respuestas guardadas · sin costo» | Respuestas pagadas recuperables; no estimación de proveedor | Clic gratuito | Inicial3errores→2positivos+1negativo;delta1error→belongs;USD0,mismosruns/calls/ledger,repeticiónPGno-op. |
| «Guardar correcciones» / «Rechazar pertenencia» | Corrección gratuita, sin proveedor | Clic con selección concreta | Ejecutado:3.668s ySignal inmediato sin otro run, caso justificado privado. |
| «Mostrar este concepto en Signal» | Selección gratuita | Checkbox de selección; no casilla de gasto | Cuatro seleccionados;14/9/11/225asociaciones finales,235raíces únicas;sin proveedor. |

## Conciliación y continuación

CSV load2 original conserva 200 IDs nuevos/30 filas exactas/20 modificadas. De los200 nuevos, uno se excluye por `text_under_30_chars` y199 son elegibles. De las30 exactas,29 son duplicadas y una se instancia como canónica propia: su texto ya existía bajo otro providerID; `revise_existing` resuelve por identidad de fuente y no por text_hash. Resultado del recibo:220incluidas=199nuevas+1exacta ahora canónica+20revisadas;1excluida+29duplicadas=250. No se regeneró la selección ni se cambió el CSV.

Las20 revisiones cambiaron texto. El delta de fichas no es220:19raíces nuevas reutilizan entrada semántica idéntica. Se procesaron201pendientes=181nuevas+20revisadas conservando900vigentes=881previas+19reusadas. Las901labels físicas anteriores mantienen SHA; las900lecturas vigentes tienen su propio hash. Con pertenencia delta el gasto observado total esUSD8.611684;fichasdeltaUSD0.865560 real frente a quoteUSD0.823287. La reserva del Batch no se suma como consumo. El rechazo histórico de saldo en otro workspace no se atribuye retrospectivamente a110DNC sin body/status; las nuevas etapas sí tuvieron lectura de saldo antes del clic.

Diez unidades nuevas interpretadas y23heredadas reutilizadas;9candidatos editables,uno sectorial adoptado con ámbito Categoría y citas verificadas. Los578pares pendientes terminaron;725vigentes=259belongs/454not_belongs/12insufficient,0error/0pending después del replay gratuito. Se conservaron162decisiones máquina anteriores,147pares que ya estaban vigentes,1override humano y1101fichas;ninguna llamada nueva para reparar. Signal final actual/no processing:Atención14,Cobros9,Reserva11,Categoría225,235raíces únicas/1101;647relevantes,343ajenas,85unknown,26spam,412sin concepto. Los466abstained/43unresolved del resumen legacy no son las87fichas abstained y no se suman como poblaciones MFP.

El editorial inicial no produjo conceptos adoptables; no se confunden los26tópicos técnicos previos con su revisión final. La adopción sectorial sólo se hizo tras load2. Las mediciones3.668s/14.061s son casos cliente de este corte sobre5cfbd2d4, conservado funcionalmente en0e84ddf6, no SLO general; R8 no se usa como aceptación R10. La ruta estándar sigue por defecto y calidad no calibrada. #57 permanece draft/sin fusionar; la QA final del fundador y la revisión del auditor siguen pendientes. El auditor conserva la autoría de la guía.

Última pertenencia:1,822,929input/42,401output/556,467cache_read/165,282cache_creation;quoteUSD2.816596 frenteUSD2.393363 settled. Ledger etiquetadoUSD6.824932 más otros motoresUSD1.786752=totalUSD8.611684. Vectores deltaUSD0.027357 es valoración de uso cubierta por franquicia Voyage; no se compraron créditos. Antes de cada etapa pagada se leyó saldo vigente; las reservas temporales no se suman al consumo. CI527/PG262 verdes sobre el código desplegado, incluida aceptación PostgreSQL17 real (25PASS/0skip) y build Studio; prueba primero RED PG261 para37palabras, luegoGREEN.
