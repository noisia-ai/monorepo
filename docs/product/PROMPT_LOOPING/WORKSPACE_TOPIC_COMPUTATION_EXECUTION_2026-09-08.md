# Topics sobre el corpus preparado — ejecución, 8 septiembre 2026

> Resultado posterior: búsqueda entregada en Studio/Worker UAT `919fd35`, SQL0134 verificado y proveedores apagados. [Recibo final](./DELIVERY_WORKSPACE_TOPIC_SEARCH_2026-09-08.md). El plan original siguiente explica el corte; clasificación, descubrimiento e incrementalidad no están cerrados.

Estado: implementación local después de embeddings entregados en Studio UAT `561ecc3` y Worker `67569e9`. Proveedores deshabilitados, cero gasto nuevo. Este corte no reabre imports, preparación ni SQL0131/0132/0133. Compass y plan completos conservan autoridad.

## Resultado y secuencia

Conectar los vectores íntegros del workspace al catálogo existente. El primer tramo produce candidatos por afinidad con evidencia y cobertura verificables; después se conectan descubrimiento abierto, interpretación con Claude y asignación con calidad medida a la autoridad existente de Signal. No confundir ese tramo de recuperación con clasificación final o lanzamiento.

La inspección confirmó dos límites concretos: el clasificador legado lee sólo chunk 0 / 900 caracteres y exige un corpus de estudio; BERTopic, UMAP/HDBSCAN, FASTopic y TF-IDF/NMF existen en el laboratorio Python, sin integración actual al Worker ni guía semántica de Brand OS en el fit. Se reutilizan estos métodos, sin inventar un corpus de estudio ni llamar descubrimiento a nombres generados desde una muestra.

## Implementación acordada

- SQL0134 extiende el ledger y la evidencia de búsqueda de SQL0127 con un contrato workspace, snapshot completo, manifiesto/embedding run, lease y cursor. No crea otro catálogo ni otra autoridad de asignaciones. SQL0087 conserva la autoridad final y no se modifica su publicación en este tramo.
- Compilador puro de intereses: definición, inclusión/ejemplos, negativos y contexto por ámbito mantienen roles separados, fuentes y hashes completos. La política existente de fragmentos de 1400 unidades UTF-16 se comparte sin cambio. No cortar Brand OS a 24/16/64/80 elementos o 4000 caracteres en el nuevo camino.
- Los prototipos requieren perfil completo `document / Voyage 4 large / 1024`. Los antiguos prototipos `query` y su caché identificada sólo por modelo no se reutilizan como compatibles. No se hacen llamadas a `embedTexts` ni pagos desde el nuevo search; la preparación pagada de prototipos necesita integración con reservas/recibos antes de habilitarla.
- Worker recorre todas las raíces, todos sus fragmentos y todos los intereses aplicables. Memoria acotada en ambos ejes: hasta 128 fragmentos, 32 metadatos de Topics y 128 prototipos por página. Un contexto grande tampoco se carga entero como vectores. Checkpoint atómico al completar una raíz; un reinicio repite sólo la raíz no confirmada y no genera gasto.
- Ranking por contraste local: conservar coseno positivo, negativo del mismo fragmento, margen y fragmento recuperable. El contexto de ámbito permanece como evidencia separada; vocabulario genérico no aumenta artificialmente el score de un Topic. Ningún threshold/calibración del espacio legado se traslada al perfil nuevo.
- Retener hasta 32 candidatos por raíz es una lista de recuperación, no el conjunto completo de pertenencias. Se registran explícitamente todos los Topics evaluados, candidatos retenidos y omitidos. Ninguna raíz, fragmento o Topic se omite del cómputo por ese límite. La recuperación y su recall todavía necesitan medición; este tramo no satisface por sí solo el etiquetado masivo del Compass.
- Si falta atribución semántica autorizada, el ámbito queda desconocido y se evalúan los intereses sin convertir el origen del CSV en identidad mencionada. No hay aprobación automática ni publicación de estos scores; el resultado conserva incertidumbre.
- La UI reutiliza Buscar/progreso/resultados dentro de Topics. Nada de otra sección en Brand OS ni formularios obligatorios. Modo workspace explícito, sin fallback pagado legacy; último resultado terminado visible mientras corre otro, procedencia y vigencia claras.

## Integración posterior obligatoria

El descubrimiento abierto debe consumir todas las conversaciones y partes nuevas, incluidas las menciones que ya tengan candidatos guiados. `approximate_predict` no crea clusters nuevos. El laboratorio admite embeddings precomputados, pero aún faltan ejecución desde producto, persistencia/versiones, guía efectiva de Brand OS/intereses, estrategia de crecimiento y medición de memoria para la población objetivo. Referencias: [BERTopic guiado](https://maartengr.github.io/BERTopic/getting_started/guided/guided.html), [modelado incremental](https://maartengr.github.io/BERTopic/getting_started/online/online.html). Estas capacidades de la biblioteca no son evidencia de entrega en Noisia.

Después, Claude interpreta evidencia paginada y candidatos, resuelve controles rutinarios y mantiene citas. Asignaciones persistentes y Signal requieren completar la entrada workspace a SQL0087, resolver estados mixtos y conservar la última generación completa durante otra abierta. Nada de rúbrica manual obligatoria por Topic. NOI-31/78 y P1/P2 continúan abiertos hasta comprobar todo el recorrido inicial e incremental.

## Verificación y operación

Root posee contrato de scoring, API/management, revisión e integración. Backend posee SQL/readers/snapshot/lease/commit/PG. Worker posee handler/routing/outbox y prueba PG/BullMQ. Frontend posee compilador compartido y adaptación del catálogo existente. Nadie despliega ni paga por separado.

Pruebas nuevas: evidencia posterior al fragmento 128, más de 64 intereses, prototipos/contexto con múltiples páginas, falsos espacios compatibles, falta de un fragmento/prototipo, scopes desconocidos, recuperación de raíz sin confirmación parcial, última búsqueda completa y revocación/revisión. No repetir benchmarks cerrados de embeddings. Escala 2M/1000 Topics y calidad semántica no se declaran por pruebas de contrato.

National conserva 16 CSV / 9,131 filas y su preparación de texto. La pregunta de zona SentiOne ya hecha sigue pendiente; no repetirla ni reparar/analizar National por intuición. Código independiente y pruebas locales pueden continuar. Saldo producto USD 11.362961 y Advisor USD 1.343826 intactos. NOI-81, NOI-19 y NOI-80 conservan sus pendientes; no producción ni limpieza.
