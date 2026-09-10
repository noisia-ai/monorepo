# Trabajo de producto de extremo a extremo — ventana de ocho horas, 9 septiembre 2026

Esta ejecución extiende el Compass y el plan self-service. El operador pidió desarrollo continuo y delegación, con entregas focales UAT, entre 06:47:24 y 14:47:24 UTC (00:47–08:47 México). National es un caso de prueba desechable; las capacidades deben servir para cualquier marca desde la UI. Las capturas muestran que Marcas y Overview cuentan una población distinta al corpus recibido y que 32 interpretaciones válidas aún no producen ningún Topic visible. No se reinicia el proyecto ni se repiten gates cerrados.

## Entregas, en orden de valor para el usuario

1. **Ver lo recibido y saber qué falta.** Marcas, Overview y Datos comparten el significado de menciones únicas recibidas, cobertura temporal observada, fuentes/ámbitos de captura y estado de procesamiento. Filas CSV, duplicados, menciones elegibles y menciones ya clasificadas no se confunden. El listado no requiere una consulta pesada por marca y conserva aislamiento. Se eliminan contradicciones como «requiere acción» junto a «sin bloqueos» cuando derivan de ese desajuste de lectura.
2. **Usar los resultados disponibles.** Las interpretaciones verificadas deben incorporarse progresivamente al catálogo principal editable; el avance parcial no se presenta como ejecución completa. La continuidad conserva snapshot, evidencia, IDs, edición/archivo/selección del usuario y converge en el catálogo final. Se reutilizan los checkpoints pagados de la misma ejecución, sin refit ni llamadas adicionales para materializarlos. No se inventa un catálogo de prueba ni se exige una rúbrica por cluster.
3. **Elegir un Topic y comprobarlo en Signal.** La clasificación contabiliza todo el corpus computado; las unidades aún sin interpretación permanecen pendientes, no se convierten en irrelevantes. La selección de seguimiento sigue siendo explícita. Conteos y citas deben corresponder a las membresías reales, con cobertura parcial visible cuando aplique. Ningún descubrimiento nuevo se selecciona automáticamente.
4. **Actualizar con nuevas cargas.** Conectar los eventos, stores y colas existentes para preparación, embeddings sólo de SHA faltantes, análisis y refresco de la última selección dentro de una autorización vigente. Retener la generación anterior mientras hay trabajo y mostrar su vigencia. Las notas incrementales ya auditadas definen los huecos; no crear un orquestador alternativo en el navegador. La aceptación con otro archivo realmente nuevo requiere una carga real; no fabricar datos del prospecto ni repetir sus 16 CSV.

El orden se adapta a evidencia técnica, conservando el recorrido como unidad de entrega. Una mejora de lectura o un componente aislado no se declara E2E completo. No se promete capacidad de dos millones de menciones ni precisión semántica sin medición.

## Distribución y continuidad

Root integra, decide contratos, mantiene documentación/Linear, controla UAT y costos y desarrolla el productor Worker del avance progresivo cuando el contrato DB esté fijado. Backend trabaja el catálogo/proyección progresivos y persistencia. El frente de datos/QA trabaja el reader batch de corpus y su prueba DB. Frontend conecta el contrato a Marcas/Overview/Datos y después Topics/Signal, con QA real ES/EN y móvil. Archivos separados y revisión cruzada antes de cada corte; sólo Root despliega o inicia operaciones remotas.

Los agentes reciben tareas nuevas al cerrar un resultado útil, sin crear un segundo orquestador. El loop existente se mantiene en este chat con ejecución horaria y límite 14:47:24 UTC. Al terminar la ventana, parada segura y automatización pausada: no nuevos envíos/despliegues, preservar resultados y cerrar recibos ya admitidos. No se espera ocho horas sin trabajar ni se repiten diagnósticos ya cerrados.

## Base, permisos y evidencia

Base local `f6b3af186ed07f1fa0b56258f84421d9302c8a0e`; UAT `948d781` y SQL0143 verificados. El diagnóstico de permiso vencido está cerrado localmente y puede acompañar el siguiente corte focal UAT. Los tres archivos ajenos `signal-topic-contract-drafts*` no entran en la entrega. Producción/main, limpieza destructiva, Laika/Alexa y secretos históricos permanecen fuera del alcance.

Ejecución existente `4c55af5c-e17f-430a-b17d-6771e94bd30e`: 32/357 unidades, ocho artefactos de interpretación y 15 numéricos; 0 Topics al comienzo. Sonnet 4.6 es el modelo elegido. No Opus ni Advisor Opus. La consulta opcional a Advisor no exige gastar si no aporta a una decisión bloqueada. Claude confirmado USD 1.918865 + reserva terminal histórica USD 1.6818 = exposición USD 3.600665; Voyage USD 0.594449 intacto.

El permiso Claude del 8 septiembre venció. Se preguntó de forma asincrónica si autoriza hasta USD 30 para estas ocho horas; mientras no haya respuesta explícita se desarrolla, prueba y entrega sin nuevas llamadas Claude ni renovación de fechas/flags. Una respuesta posterior se documenta con fecha, tope y recibo antes de gastar. No modificar la revisión editorial inmutable ni abrir otra ejecución para eludirla. Una continuidad futura debe conservar costos y evidencia de la misma ejecución.

Cada entrega tendrá código focal, checks proporcionales y recibo de lo comprobado localmente/UAT, más limitaciones. Linear conserva el avance y los pendientes: NOI-31 recorrido inicial, NOI-37 selección/Signal, NOI-78 incremental y NOI-81 operación recuperable. La historia original sigue siendo accesible; este plan la nutre.

## Avance 07:16 UTC

Primer corte local cerrado y enviado UAT: [corpus y recorrido](DELIVERY_ADMIN_CORPUS_JOURNEY_2026-09-09.md), commitd419d65. Runtime pendiente de verificar. Segundo corte progresa sobre misma ejecución/catálogo: receipt derivado, outbox engine_progress, proyección del censo completo y pendientes explícitos. Sin gasto nuevo.

## Continuación 07:54 UTC

SQL0144 aplicado y verificado una vez; cut8b14383 construyéndose UAT. Véase DELIVERY_PROGRESSIVE_TOPICS_2026-09-09.md. Frontend implementa Resumen Signal nativo y cobertura desde la misma generación; Backend revisa su reader/contrato. El frente computacional implementa [adapter incremental numérico](WORKSPACE_INCREMENTAL_NUMERIC_CONTRACT_2026-09-09.md) con modelos congelados, inferencia de todo el delta y descubrimiento también entre ya asignadas. Este subcorte todavía no consume SQL/Signal ni autoriza gasto automático: no declarar monitorización entregada desde Python solamente. Root integra y comprueba UAT; cero proveedores nuevos.


## Criterio de cierre del monitoreo: continuidad posterior a esta noche

Actualización 9 septiembre, 13:14 UTC. Las entregas UAT ya permiten ver el corpus recibido, 32 Topics editables y una selección real en Signal. Su interpretación sigue siendo parcial: 32 de 357 unidades, no 32 temas semánticamente calibrados. Las recuperaciones y el productor numérico preservan el cálculo anterior, pero la segunda carga real aún no se ha hecho. SQL0148 y el consumidor editorial en desarrollo son trabajo local, no un nuevo producto entregado.

La siguiente aceptación debe realizarse con archivos reales adicionales mediante la UI, sin INSERT de ingeniería ni fixtures en el workspace. Importar uno o varios ámbitos es válido: la ausencia de un competidor o categoría no puede bloquear el análisis de los datos presentes. La UI debe distinguir archivos recibidos, raíces únicas, texto preparado, embeddings disponibles y resultado clasificado. «Ámbito de archivo» describe cómo se capturó; no significa que toda mención pertenezca semánticamente a esa marca.

La preparación y los embeddings de la nueva revisión deben mostrar su costo/permiso y conservar lo ya calculado. El productor debe detectar la nueva revisión completa y ejecutar el cambio numérico una sola vez. Se verificará que menciones nuevas entren a grupos existentes o queden en grupos emergentes/excepciones; no se repetirá el fit completo para simular continuidad.

La interpretación de grupos nuevos necesita un plan de evidencia y solicitudes persistido antes del envío, permiso propio y posibilidad de continuar con sus resultados ya guardados. Los Topics nacidos de ahí deben poder editarse, conservar selección y ediciones previas, y entrar a Signal por la decisión del usuario. La cobertura debe distinguir lo clasificado, lo pendiente y lo excluido; una respuesta de Claude no equivale a precisión calibrada.

La aceptación final compara antes/después desde Marcas → Overview/Datos → Topics → Signal, con los mismos denominadores verificables y enlaces a evidencia. Ninguna transición cotidiana debe requerir una consola SQL, una ejecución manual de Worker o un arreglo por marca. Lo pendiente se mantendrá explícito en NOI-78/NOI-81 y recibos de continuación. Reportes con agente y MCP quedan después de este recorrido de monitoreo completo, sin perderlos del Compass.


## Continuación concreta — 9 septiembre 2026

El [plan de cierre del monitoreo incremental](PLAN_COMPLETE_INCREMENTAL_MONITORING_2026-09-09.md) integra los recibos locales b6da353/f35d78c y delimita las conexiones que faltan antes de la segunda carga real. Complementa este plan y conserva su alcance; no declara entrega UAT de SQL0148/0149.
