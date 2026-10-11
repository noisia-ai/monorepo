# Lista factual MFP · revisión 9 (B2 todavía abierto)

Este documento alimenta al auditor; no sustituye ni modifica `QA_FUNDADOR_MFP.md`. Cada fila contiene una acción. Las esperas indicarán medición de la vista completa; los tiempos de SQL aislada no acreditan tiempos de UI.

## Prerrequisitos

- Entorno: https://mfp-studio-dev-test.up.railway.app. Build `371c74a717926598eafc4a26c32300301624bee3`, deployment `36376c82-f6e5-45c5-9e50-5d964c6ca63f` SUCCESS; autodeploy OFF y una réplica verificados en Railway UI antes del pin. Los cambios TS `09cb2016` / `8c7e8a32` y SQL0265 todavía no están desplegados/aplicados. CI y PG de `43405e1a` SUCCESS (13 tests PG); el conjunto con SQL0266 espera validación.
- Cuenta: sesión Admin Noisia existente en dev-test, autorización propia del workspace. Sin cambios de roles ni copia de cookies.
- Resultados existentes: «Marca QA MFP Oct07 R4», brand `38c31650-7512-497d-9836-2f39e1659fc8`, workspace `9a695132-238b-4ce4-aa97-73c6a02da9d8`, slug Signal `mfp-qa-front5-20261007`.
- Continuación pagada: «Marca QA MFP Oct11R8», workspace `2f1c193a-df0c-4fc7-973e-8e311d59c746`; completó 25/25 unidades interpretadas: conserva las 18 anteriores y agregó 7/7 con cotización y confirmación. No repetir esta admisión.
- Recorrido nuevo: marca propia R9 y estos CSV privados: `/Users/brandhon_o/.codex/worktrees/742b/noisia-website/.data/dev-corpus/r9/load1.csv` y `load2.csv`. 1,000 y 250 filas; 47 columnas, IDs únicos dentro de cada archivo. Segunda carga: 200 IDs nuevos, 30 duplicados exactos y 20 revisiones designadas. No se usa copia reconciliada.
- Fixture nuevo excluye 344 IDs contradictorios / 1,230 filas fuente. Manifest privado `.data/dev-corpus/r9/sampling-manifest.json` contiene cada ID, archivo, número de fila y motivo, todos los hashes fuente/output y conteos; SHA256 `86cfde3bda7aa9fa9f4c1eea3fd52b60009d7a2f7db80031436f186e61881c0f`. Preflight `.data/front5-qa/r9/fixture-preflight.json` acredita fuentes intactas y validación del ingestor. Los CSV/IDs/fuentes no se versionan. Es una muestra limpia de QA, no la fuente íntegra. Originales preservados.
- Runner dev-test: `NOISIA_WORKSPACE_NUMERIC_PRODUCER_ENABLED=true`, gate worker e incremental-projection verificados; sin pasos de operador en el recorrido. Runner conserva SHA `f20209e209e48483ea3dbc9da076e319d1c0c66f`, deployment `76acfe00-70bc-4c5b-ba53-6edc31425e21`; flags numeric producer, topic progress e incremental projection verificados true, sin cambios ni reinicio de Runner. No se activa H1 en el recorrido estándar.
- Coste histórico R8: USD 5.553529 liquidado (≈ USD 5.6), separado de la continuación R9. Coste incremental R9 USD 0.164070 liquidado; forecast USD 0.65142; reserva activa USD 0. El total histórico R8 más esta continuación es USD 5.717599; imports, lecturas y corrección humana USD 0 proveedor. Las estimaciones son orientativas; reserva temporal y gasto liquidado se muestran separados. Un máximo sólo es estricto si se configura.
- Duración: Batch histórico 7–19 minutos por etapa; imports aceptados 19:01:17Z y 19:01:42Z; ambos completos 19:01:46Z. Lecturas HTTP de Datos 34–96 ms, preparación/readiness 39–93 ms; UI completa no instrumentada. Signal R8 36.111 s y detalle/evidencia 90.482 s abortados al salir: B2 no cerrado.

## Resultados existentes

| Paso | Control exacto / una acción | Número visible | Espera medida | Incidencia o parada |
|---|---|---|---|---|
| 1 | Abrir «Marca QA MFP Oct07 R4» en Dashboard | 1,176 menciones / 3 archivos / 1,273 filas | Tiempo UI no medido | Observado en IAB por root antes del nuevo pin. |
| 2 | Pulsar «Revisar tópicos para Signal» | 13/13 interpretados | Tiempo UI no medido | No inicia proveedor. |
| 3 | Pulsar «Ver resultados guardados» | 5 Topics / 0 Narrativas / 4 Noise / 4 insuficientes | Tiempo UI no medido | Censo histórico; revalidar visible. |
| 4 | Seleccionar «Cobros y depósitos en la renta» (Borrador) | «Guardar cambios» deshabilitado; «Usar como interés en próximos análisis» marcado; «Marca principal» | Tiempo UI no medido | Control exacto que reemplaza el paso 7 ambiguo: selección del tópico guardado; no guardar de nuevo si no hay edición. Observado por root en R4. |
| 5 | Abrir «Abrir mención» en su evidencia | Un original íntegro | Tiempo UI no medido | No usar «Abrir fuente original» como sustituto del original interno. |
| 6 | Abrir URL Signal R8 `/signal/mfp-qa-r8-20261011/topics-narratives` | 2 Topics seleccionados; Atención 7 / Cobros 2; 8 únicas; 25/25 grupos | HTTP 36.111 s | Sin recarga manual; B2 abierto. 1,086 únicas, 616 relevantes, 300 ajenas, 35 spam, 135 indeterminadas; 608 relevantes sin concepto. |
| 7 | Abrir `/studio/settings` | Control «Idioma» | UI observada | No hay selector equivalente en Configuración de Signal. |
| 8 | Elegir English en «Idioma» | Studio «Settings/Brands/Data» | Recarga automática de la app | Preferencia de idioma; no cambia análisis. |
| 9 | Esperar la recarga automática | Studio en inglés | UI observada | Paso propio de recarga automática, sin recarga manual. |
| 10 | Abrir URL Signal R8 | «Brand monitoring/Mentions/Topics and narratives» | UI observada | Cambio ES/EN comprobado. |
| 11 | Abrir `/studio/settings` | «Language» | UI observada | — |
| 12 | Elegir Español en «Language» | Preferencia española | Recarga automática | — |
| 13 | Esperar la recarga automática | Settings restaurada en español | UI observada | Idioma ES confirmado; proveedor USD 0. |

El workspace R4 contiene dos conceptos manuales activos de pertenencia: «Cobros y depósitos en la renta» y «Atención durante la entrega y devolución»; dos conceptos discovery adoptados: «Programa Emerald Aisle y beneficios de estatus élite» e «Integración de renta de autos en plataformas de viaje». UI R4 muestra 29 entradas del catálogo editorial: ese total no es el número de conceptos activos de pertenencia. «Mostrar este concepto en Signal» de Cobros está marcado; resultado visible 2.

Los tres conceptos del gold son «Cobros», «Atención» y «Reserva y entrega» en el workspace de medición de §14.2, separado de R4. Prerrequisito para el auditor: marca «National», slug `national-46da487b`, brand `46da487b-b73b-4864-8c69-d5243001c348`, workspace `ba454146-8c92-4f38-83f3-fea9827b7e31`; URL de Topics `/studio/brands/46da487b-b73b-4864-8c69-d5243001c348/topics`. Tres definiciones: «Cobros, depósitos y devoluciones» v4, «Atención y resolución de reclamaciones» v4, «Reserva y entrega del vehículo» v3. El catálogo completo tiene siete conceptos y H1 de medición activo; inspección sólo lectura durante JEV, sin cambiar selección de ruta, definiciones ni cola. R4 no contiene un tercer manual activo. No atribuir la cobertura del gold al recorrido R4.

| Paso | Control exacto / una acción | Número visible esperado | Espera / evidencia | Incidencia o parada |
|---|---|---|---|---|
| C1 | Seleccionar «Cobros y depósitos en la renta» en R4 | Manual activo v2 | UI/PG verificados | «Mostrar este concepto en Signal» marcado, 2 resultados. |
| C2 | Seleccionar «Atención durante la entrega y devolución» en R4 | Manual activo v1 | UI/PG verificados | Segundo manual; no inventar tercero R4. |
| C3 | Seleccionar «Programa Emerald Aisle y beneficios de estatus élite» en R4 | Adoptado discovery v2 | UI/PG verificados | No volver a adoptar ni evaluar. |
| C4 | Seleccionar «Integración de renta de autos en plataformas de viaje» en R4 | Adoptado discovery v2 | UI/PG verificados | Ámbito categoría. |
| G1 | Abrir URL Topics de National indicada arriba | Catálogo de medición, 7 conceptos | Sólo lectura; tiempo no medido | No modificar durante H1/JEV. |
| G2 | Seleccionar «Cobros, depósitos y devoluciones» | Gold v4 | PG, UI pendiente | Workspace distinto a R4/R8. |
| G3 | Seleccionar «Atención y resolución de reclamaciones» | Gold v4 | PG, UI pendiente | No editar ni recalcular. |
| G4 | Seleccionar «Reserva y entrega del vehículo» | Gold v3 | PG, UI pendiente | No editar ni recalcular. |

### Corrección por UI estándar R8 (QA asistida, ejecutada una vez)

| Paso | Control exacto / una acción | Número visible esperado | Espera / evidencia | Incidencia o parada |
|---|---|---|---|---|
| E1 | Abrir Topics R8, brand `7f853d28-c6bf-4ec2-b678-d72750ff7a44` | Dos conceptos manuales | UI observada | NO workspace gold. |
| E2 | Seleccionar «Cobros y depósitos en la renta» | Definición atribuible a National | UI observada | Leer criterio antes de decidir. |
| E3 | Elegir «Evidencia insuficiente» en «Filtrar» | 3 resultados antes de corrección | Consulta pesada | Root `79a73fc6-5a30-4b56-b067-dfb4c228590b` comienza «@jjdemo18 Thank you for the message…». |
| E4 | Pulsar «Abrir mención» del root `79a73fc6…` | Texto íntegro interno | Ancla dentro de Topics | Respuesta genérica de National solicitando datos de contacto; sin cobro ni depósito. No confundir con fuente externa. |
| E5 | Marcar sólo su «Seleccionar mención» | 1 seleccionada | Inmediato | NO «Seleccionar esta página». |
| E6 | Pulsar «Rechazar pertenencia» | Override humano «No pertenece» | PATCH HTTP 12.451 s | Ejecutado una vez por el orquestador; PG `not_belongs`, 19:11:10.535Z, vigente; USD 0 proveedor. La UI fija `decided_via=human_ui`; esta ejecución asistida no acredita revisión humana independiente y no se usa como gold. |
| E7 | Esperar la actualización automática | Insuficientes 3→2 | UI observada | No reenviar corrección. |
| E8 | Elegir «No pertenece» en «Filtrar» | Fila corregida | GET 16.647 s | B2 abierto. Caso ambiguo `6fbd1c27…` sigue insuficiente; no se corrigió. |

## Continuación de interpretación: siete unidades nuevas

| Paso | Control exacto / una acción | Número visible esperado | Espera medida | Incidencia o parada |
|---|---|---|---|---|
| 1 | Abrir «Marca QA MFP Oct11R8» | 18/25 antes de esta admisión | UI observada | Proyección numérica generación 12 vigente, 1,086/1,086. |
| 2 | Pulsar «Ver estimación de temas nuevos» | Siete unidades; USD 0.65142; vencimiento 11 Oct 1:02 pm | Tiempo UI no medido | GET gratuito; ninguna reserva. |
| 3 | Marcar «Confirmo iniciar la interpretación pagada de los temas nuevos con esta estimación.» | Confirmación marcada | Inmediato | «Autorizar e interpretar temas nuevos» deshabilitado antes de quote y checkbox. |
| 4 | Pulsar «Autorizar e interpretar temas nuevos» | Una admisión para siete unidades nuevas | POST HTTP 19.364 s | Cotización ligada al actor, workspace, evidencia y corte histórico; no repite las 18 previas. |
| 5 | Esperar resultado por actualización automática | 7/7 nuevas; total 25/25; USD 0.164070 settled, reserva activa 0 | UI/PG observados; último checkpoint 2 min 19 s después de admisión | Run único `fb4b13d1-dde5-485a-802a-17c6218bfb64`, dos llamadas settled. UI confirmó por polling tras respuesta pendiente; no repetir autorización. |

**Paradas:** si adopción automática queda vacía, registrar 0 Topics y conservar selección manual, sin forzar Noise. Si falta cotización visible o checkbox, no pulsar «Autorizar» y reportar #56. Si cambió la fuente o venció la cotización, obtener otra y volver a confirmar. Cualquier recarga necesaria se registrará como fila independiente y como incidencia del objetivo sin recarga manual.

## Marca nueva: importación directa

Recorrido UI observado por el orquestador sobre build `371c74a7`. No repetir imports ya terminados. Las etapas de cómputo de esta marca nueva no se ejecutaron; el circuito segunda carga → delta numérico → interpretación → Signal está acreditado en R8, con esa procedencia explícita.


| Paso | Control exacto / una acción | Número visible esperado | Espera medida | Incidencia o parada |
|---|---|---|---|---|
| 1 | Abrir `/studio/brands/new` | Formulario vacío | Tiempo UI no medido | Sesión Admin Noisia existente. |
| 2 | Completar «Marca» | Marca QA MFP Oct11 R9 | Inmediato | Nueva marca desechable, separada de medición. |
| 3 | Completar «Nombre visible» | Marca QA MFP Oct11 R9 | Inmediato | No reutiliza R4 ni R8. |
| 4 | Completar «Organización» | Noisia | Inmediato | Registrar valor observado. |
| 5 | Completar «Slug» | mfp-qa-r9-20261011 | Inmediato | Registrar valor observado. |
| 6 | Seleccionar «Travel & Hospitality» en Industria | Una industria | Inmediato | Catálogo buscable. |
| 7 | Completar «Aliases / handles» | National Car Rental, Emerald Club | Inmediato | Observado: valores separados por comas; el control rechazó saltos de línea. |
| 8 | Completar «Competidores» | Hertz, Avis, Enterprise | Inmediato | Observado: valores separados por comas. |
| 9 | Marcar «Activar ficha por mención, descubrimiento y pertenencia para este workspace» | Marcado | Inmediato | Opt-in propio; H1 no se activa. |
| 10 | Pulsar «Crear marca y continuar» | Brand OS y workspace nuevos | Tiempo UI no medido | Cero menciones iniciales. |
| 11 | Abrir «Datos y fuentes» | 0 archivos / 0 menciones | Tiempo UI no medido | No inicia proveedor. |
| 12 | Marcar confirmación de permiso para almacenar y analizar datos | Marcado | Inmediato | Registrar texto completo visible. |
| 13 | Marcar permiso de procesamiento con proveedores de IA | Marcado | Inmediato | No inicia proveedor. |
| 14 | Pulsar «Continuar a la carga» | Fuente Exportaciones de SentiOne | Tiempo UI no medido | — |
| 15 | Pulsar «Importar» de Primary brand | Formulario de importación | Inmediato | Mantener mismo ámbito en ambas cargas. |
| 16 | Seleccionar `r9/load1.csv` en «Archivo CSV» | 1,000 filas / 47 columnas | Inmediato | 1,000 IDs internos únicos comprobados en preflight. |
| 17 | Marcar «Voy a importar este archivo sin adjuntar su consulta de búsqueda.» | Marcado | Inmediato | Registrar variante exacta de formulario si cambia. |
| 18 | Completar «Cobertura del archivo desde» | 2026-01-01 | Inmediato | Verificar cobertura del manifest. |
| 19 | Completar «Cobertura del archivo hasta» | 2026-08-23 | Inmediato | America/Mexico_City. |
| 20 | Pulsar «Importar CSV» | 1,000 filas: 901 incluidas / 17 excluidas / 82 duplicadas | Tiempo UI no medido | No conciliar archivo; capturar censo real. |
| 21 | Marcar «Actualizar contenido de IDs existentes» | Marcado | Inmediato | Permite 20 revisiones designadas, sin cambiar ingestor. |
| 22 | Seleccionar `r9/load2.csv` en «Archivo CSV» | 250 filas / 47 columnas | Inmediato | 250 IDs internos únicos; 200 nuevos + 30 duplicados exactos + 20 revisados. |
| 23 | Confirmar ausencia de query en el control visible | Marcado | Inmediato | Una acción; texto exacto se recoge en UI. |
| 24 | Completar «Cobertura del archivo desde» | 2026-01-01 | Inmediato | — |
| 25 | Completar «Cobertura del archivo hasta» | 2026-08-23 | Inmediato | America/Mexico_City. |
| 26 | Pulsar «Importar CSV» | 250 filas: 220 incluidas / 1 excluida / 29 duplicadas | Tiempo UI no medido | Importación directa del fixture, sin copia reconciliada. |
| 27 | Pulsar «Actualizar» en «Datos recibidos» | 2 archivos / 1,250 filas / 1,119 únicas / 1,119 con texto | UI observada; lecturas HTTP 34–96 ms | Fue botón interno, no recarga completa. |
| 28 | Consultar estado de preparación | Texto pendiente de preparación | UI observada | No se pulsó preparación ni procesamiento nuevo. Detener recorrido nuevo aquí; las siguientes etapas se acreditan en R8, no en R9. |

Observado: el modal de Primary brand permaneció abierto tras load1; load2 se seleccionó en el mismo formulario, con revisión de IDs ON. No se pulsó «Cerrar» entre las cargas ni después. No hubo recarga completa. Los pasos del alta/import son observados salvo controles expresamente marcados como reproducción sugerida.

Marca creada por UI: brand `465d6cb8-abed-43f4-8f1c-45f425d4207d`, workspace `9832687c-a24d-4864-8868-aa1d61be351f`; URL `/studio/brands/465d6cb8-abed-43f4-8f1c-45f425d4207d/data`. Fuente «SentiOne QA MFP R9», ámbito Primary brand, sin query, cobertura 2026-01-01→2026-08-23, America/Mexico_City; revisión IDs OFF en load1 y ON en load2. La prueba de importación directa terminó sin copia reconciliada, errores ni reintentos.

Censo PG: load1 918 raíces (901 incluidas +17 excluidas); los 82 duplicados internos no añaden raíz. Load2 conserva 29 raíces existentes duplicadas y aplica 20 revisiones (20 IDs, 20 digests cambiados); 199 IDs CSV nuevos quedan incluidos y 1 nuevo excluido. Un ID repetido del fixture no tenía raíz tras la deduplicación inicial y entra incluido como raíz nueva. Por eso load2 aporta 200 raíces incluidas +1 excluida y el acumulado es 1,119, mientras la composición por IDs CSV sigue 200 nuevos +30 exactos +20 revisiones. No equiparar IDs CSV con raíces.

### Controles pagados y puntos de parada

| Control | Estimación / confirmación visible | Uso en este recorrido | Parada |
|---|---|---|---|
| «Completar fichas pendientes» / «Calcular pertenencia completa» | «Estimación de la próxima ejecución», reserva temporal y máximo separados; no casilla específica en estos controles. «Confirmar recálculo completo» sólo si la ejecución solicita esa segunda confirmación. | No pulsados en R9; resultados históricos R8 conservados. | No repetir cálculos completos para probar un control. |
| «Ver estimación editorial» → «Autorizar revisión editorial» | Cotización firmada, casilla, vencimiento; estimación no concede permiso. | Cubierto en #40; no repetido R9. | Sin quote/casilla vigente, detener. |
| «Ver estimación de temas nuevos» → «Autorizar e interpretar temas nuevos» | USD 0.65142 y casilla exacta arriba; botón inicialmente deshabilitado. | Una autorización R9 de siete grupos sobre R8. | Mientras falte este patrón de #56, NO pulsar Autorizar; quote vencida/fuente cambiada exige cotizar y confirmar otra vez. |
| «Adoptar concepto» | Gratuito; guarda concepto editable, no llama proveedor. | Dos adoptados existentes R4. | Si corte automático no ofrece Topics adoptables, registrar adopción vacía y NO forzar Noise ni fabricar adopciones. |

B2 pendiente: las rutas Signal, detalle/evidencia, memberships y análisis completo aún excedieron 15 s durante esta QA. «Actualizar» de Datos y las recargas automáticas de idioma están separados; no hubo recarga manual para finalizar Signal ni segunda autorización. El auditor redacta la guía a partir de esta lista; `QA_FUNDADOR_MFP.md` queda intacta.
