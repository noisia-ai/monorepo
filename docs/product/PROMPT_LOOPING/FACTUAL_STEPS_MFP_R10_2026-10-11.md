# Lista factual R10 · §15.1 · checkpoint en fichas

Esta lista alimenta al auditor; `QA_FUNDADOR_MFP.md` permanece intacta. **No es todavía un recorrido integral acreditado.** Alta, Brand OS, intereses, load1, preparación y vectores ocurrieron por UI; fichas conserva 791 válidas y110 errores. Descubrimiento, pertenencia, editorial, Signal inicial y load2 no se han ejecutado. No usar los resultados R4/R8 para completar números de R10.

## Destino y custodia

- Build fijada `44a2e1becebed896d68608678d24ece827b97c63`; deployment `0566a994-0df6-4aa5-b782-1945eedcd50f` SUCCESS, 22 hashes runtime verificados. No redeploy/restart hasta cierre explícito QA-1 del fundador.
- Marca «Marca QA MFP Oct11 R10»; brand `20c7d12a-57fd-49d9-a97b-7b19bf5f2d8f`, workspace `b466a888-c3f6-4b53-babe-e076be9e82d1`, slug `mfp-qa-r10-20261011`.
- URL Topics: https://mfp-studio-dev-test.up.railway.app/studio/brands/20c7d12a-57fd-49d9-a97b-7b19bf5f2d8f/topics. Signal propio: `/signal/mfp-qa-r10-20261011/topics-narratives`; aún no servido por este recorrido.
- CSV: `/Users/brandhon_o/Downloads/noisia-website/.data/dev-corpus/r10/load1.csv` y `load2.csv`; 47 columnas/1,000 y250 filas. Load1 SHA256 `4773f7ff553419422163d89c688cfa86227736844f4c9d5e02d0de3a4fb41d86`; load2 `8817c1fa4a055a807198582f449265d01a38821f6b1b2ecf0fb0e93cf2c213ea`.
- Muestra QA limpia: excluye344 IDs/1,230 filas contradictorias. Manifest privado enumera todos los IDs/filas/motivos y hashes originales/nuevos, SHA256 `86cfde3bda7aa9fa9f4c1eea3fd52b60009d7a2f7db80031436f186e61881c0f`. No representa la fuente íntegra; originales preservados, sin reconciliar durante importación.
- Fuente «SentiOne QA MFP R10», Primary brand, cobertura 2026-01-01→2026-08-23, America/Mexico_City. Revisión IDs OFF en load1; load2 queda reservado y sólo se importará después de Signal inicial, con revisión ON.

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
| 26 | Esperar actualización automática | Resumen791/901 | TerminalPG02:54:54.333Z/UI02:55:50.478Z | Tabla y poblaciones dependientes siguieron obsoletas; fix local invalida GET, no intención pagada. E2E pendiente de build nueva. |
| 27 | Pulsar «Completar fichas pendientes» para recuperación focal | EstimaciónUSD0.4016;110raíces exactas;0válidas reenviadas | Worker83.427s; USD0 real | Autorizado una vez03:05:59.494Z; runc6a28ab8…:39callsfailed/110DNC;791válidas intactas. |
| 28 | Esperar resultado automático | 791válidas/110errores; reserva activa0 | Terminal03:07:23.986Z; USD0 | No tercer intento. Cuerpo/códigoHTTP histórico no preservado. Detener aquí hasta QA-1 y build reparada. |

Estado visible al último refresco ya ejecutado:464 relevantes/254ajenas/160indeterminadas/23spam =901. Son poblaciones completas de la tabla incluyendo errores, **no** 901 fichas válidas. No sustituirlo por el resumen740labeled/51abstained ni por un denominador de análisis todavía inexistente.

## Tabla completa de controles y dinero

Las estimaciones preceden al proveedor; son orientativas. Reserva temporal y gasto liquidado son valores diferentes. Máximo estricto sólo cuando se configura expresamente. La siguiente tabla combina controles observados con contrato de código de la build; una fila «sin ejecutar R10» no acredita su coste ni resultado.

| Control | Qué muestra antes de autorizar | Confirmación | Uso R10 / condición |
|---|---|---|---|
| «Preparar texto» | Preparación gratuita, sin proveedor | Clic; sin casilla pagada | Ejecutado:USD0. |
| «Calcular costo» | Cotiza vectores/fragmentos reutilizables | Lectura gratuita | Ejecutado:USD1.814885. |
| «Crear vectores · estimación …» | Importe estimado dentro del botón; máximo sólo si configurado | Clic; sin casilla específica | Ejecutado:USD0.132160 real. |
| «Completar fichas pendientes» | «Estimación de la próxima ejecución», reserva temporal y máximo separados | Clic; sin casilla específica | Dos admisiones registradas arriba; no repetir ahora. |
| «Recalcular ficha completa» | «Estimación del recálculo completo» | Clic; si cambia CE puede exigir confirmación ulterior | Sin ejecutar R10; no usar para recuperar110. |
| «Confirmar recálculo completo» | Recálculo pendiente y estimación completa vinculados al contexto actual | Clic de segunda confirmación, mismo run | Sólo aparece si el run requiere confirmación; sin ejecutar R10. |
| «Analizar conversaciones» | Interpretación orientativa por menciones/grupos; no incluye consolidación ni fija límite | Clic; sin casilla editorial en este inicio | Descubrimiento aún sin ejecutar R10; esperar fichas completas. |
| «Probar definición · 30 raíces» | «Estimación de prueba · 30 raíces» | Clic; sin casilla específica | Sin ejecutar R10; prueba no publica pertenencias ni cambia Signal. |
| «Calcular pertenencia completa» | «Estimación de la próxima ejecución», relevante/pendiente y reserva separados | Clic; sin casilla específica | Sin ejecutar R10; definición debe estar guardada. |
| «Ver estimación editorial» | Quote, importe/grupos y vencimiento | Lectura gratuita | Sin ejecutar R10. |
| «Autorizar revisión editorial» | Quote vigente | «Confirmo iniciar la revisión editorial pagada con esta estimación.» | Sin ejecutar R10; botón exige quote+casilla. |
| «Ver estimación de temas nuevos» | Quote sólo de unidades nuevas, importe/reserva/vencimiento | Lectura gratuita | Sin ejecutar R10; requiere load2 y delta después del primer Signal. |
| «Autorizar e interpretar temas nuevos» | Quote vigente sólo de unidades pendientes | «Confirmo iniciar la interpretación pagada de los temas nuevos con esta estimación.» | Sin ejecutar R10; botón exige quote+casilla. |
| «Guardar correcciones» / «Rechazar pertenencia» | Corrección gratuita, sin proveedor | Clic con selección concreta | R10 aún sin corrección; objetivoPATCH<5s y Signal inmediato pendientes de nueva build. |
| «Mostrar este concepto en Signal» | Selección gratuita | Checkbox de selección; no casilla de gasto | R10 aún sin seleccionar; no llama proveedor. |

## Continuación no ejecutada

Después de QA-1 y pin reparado verificado: cerrar fichas mediante recuperación focal autorizada, medir terminal sin refresco manual; descubrir grupos; evaluar pertenencia de los tres intereses; cotizar/confirmar revisión editorial; revisar/adoptar sólo Topics reales y seleccionar en Signal; verificar original y denominadores. **Sólo entonces** importar `load2.csv` una vez con revisión IDs ON, preparar delta, vectores reutilizados/nuevos, fichas afectadas, proyección numérica e interpretación cotizada de unidades nuevas; comparar Signal actualizado. Ninguno de esos resultados existe aún en R10; no se mezclan con R9/R8 ni se rellenan números de otra marca.

R9 queda exclusivamente como anexo histórico de importación directa. La medición vigente pin44 R8 fue Topics<9.3s/Signal completo<9s/cambioTopic<9.2s en reposo; la corrección humana12.451s y filtro16.647s continúan como incidencias históricas que esta nueva ronda debe corregir y medir. No hay acreditación nueva de esos límites en R10. CSV y recibos privados se conservan; el auditor redacta la guía final cuando cierre el recorrido.
