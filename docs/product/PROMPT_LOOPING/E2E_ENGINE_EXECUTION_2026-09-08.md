# Ejecución completa genérica — 8 septiembre 2026

El operador reafirmó que el resultado debe servir a cualquier marca. National es un caso descartable para probar el recorrido; no hay un objetivo de recuperar o especializar sus datos. El Compass original continúa vigente.

## Autorización y presupuesto actuales

Claude API: hasta USD 30 durante el 8 de septiembre de 2026, zona America/Mexico_City, compartidos entre Advisor y producto en esta operación. Voyage: consumo necesario para conectar y probar el flujo, sin límite impuesto por el operador. Son autorizaciones de gasto, no constancias de crédito depositado. Las restricciones financieras anteriores de USD5/providerfalse no se vuelven a presentar como falta de autorización para este trabajo. Se conservan caché, recibos, reservas y control de reintentos para no duplicar cargos.

Al comenzar este corte se han ejecutado cero llamadas nuevas. Las credenciales actuales de producto Anthropic/Voyage están configuradas; la credencial dedicada de Advisor no está disponible en el entorno actual. No reutilizar claves históricas ni mezclar carriles para suplirla. Esa ausencia no bloquea código ni pruebas independientes. El consumo real se registra en el recibo de este corte, separando proveedores y respuestas de costo incierto. La autorización de Claude vence al terminar el día; la de Voyage está ligada al trabajo necesario solicitado.

## Resultado y trabajo concreto

Marca nueva → Brand OS/intereses opcionales → importación → preparación/cómputo completos → Topics descubiertos e interpretados/editables → selección para Signal → otra carga que actualice temas existentes y descubra nuevos. La aceptación se hace desde el producto; una prueba local de un componente no cierra el recorrido.

El primer cambio conecta el laboratorio real a la entrada workspace. Se reutilizan BERTopic/UMAP/HDBSCAN; FASTopic/NMF permanecen disponibles sin correr otro benchmark general. Dos vías recorren todos los fragmentos: abierta con vectores originales y guiada con prototipos y límites explícitos. La guía no excluye registros de la vía abierta. Cero intereses debe funcionar, sin Topic de relleno. Las pertenencias computacionales por fragmento se reconcilian a menciones únicas y pueden ser multilabel; no se cuentan fragmentos como menciones.

Se persisten modelos/artefactos en el almacenamiento existente. La siguiente carga predice temas conocidos y vuelve a detectar novedad en la población completa, incluidas conversaciones ya asignadas. La identidad estable de Topics se distingue del número de cluster y conserva cambios/ambigüedades de merge/split. No se presenta coseno o cluster membership como precisión semántica medida.

Backend implementa snapshot con cero intereses, texto/vectores/guías paginados, leases y artefactos/registro compatible en ejecución existente. Python implementa adapter y prueba real de dos cargas. Frontend conecta la acción del corpus en Topics y reutiliza catálogo/editor/evidencia/selección. Root integra contratos, orquestación, proveedores, API, presupuesto y aceptación. Sin nuevas tablas o frameworks por defecto, sin otro orquestador ni recuperar Laika/Alexa.

Se empieza sobre el commit local92d5d0a, con UATae3e36c. Preservar tres contract-drafts ajenos. No repetir gates de recepción, preparación, embeddings, búsqueda o persistencia cerrados. La zona SentiOne ya preguntada sigue pendiente; no inferirla ni modificar fechas para hacer pasar pruebas. No producción ni limpieza destructiva. La selección de Topics nuevos para Signal permanece como acción explícita; las etapas rutinarias deben resolverse sin rúbrica por cluster.

## Prueba de salida

Primera carga desde UI sin intereses obligatorios; todas las menciones reconciliadas; nombre y evidencia generados a partir de una corrida nueva; edición y selección con efecto real en Signal. Segunda carga desde UI con un tema ausente en la primera, recuperación ante interrupción, reutilización de entradas sin cambios y novedad comprobable; sin scripts por cliente. Medir memoria/tiempo/costo y declarar volumen realmente probado. No reclamar2M/1000 por una fixture pequeña.

Estado: implementación del recorrido en curso. Este documento amplía el plan y el contexto original, no reemplaza sus entregas ni convierte el hito local92d5d0a en un producto terminado.

## Operación Voyage iniciada desde UI

8 septiembre, después de las17:03UTC: activación real en Railway UAT sobre el código existente ae3e36c, sin subir el trabajo local sucio. Studio deployment f350f738-20d4-4ab7-984a-3392ccbdab7c y Worker6fe5eccb-a8fd-40fb-a408-7edfb28f856c observados successful. Se añadió PROVIDER_ENABLED=true a ambos y MAX_COST_MICRO_USD=100000000 a Studio como techo operativo por solicitud; no representa gasto ni un nuevo límite del operador. No se revelaron ni cambiaron las claves existentes.

En Datos del workspace National se renovó la cotización y se pulsó una sola vez Preparar para analizar con el máximo cotizadoUSD8.328543:6826raíces/20821fragmentos. La UI confirmó envío en curso. **Pendiente reconciliar run/consumo y verificar finalización**: no repetir POST por pérdida de respuesta. Los16CSV no se reimportaron. El estado cero llamadas del inicio de este documento ya no describe una operación segura de asumir; consultar el ledger/estado vigente antes de reintentar.

Python Linux offline y dos snapshots completos pasaron; Node→Python, multipart privado y recuperación después del checkpoint también tienen pruebas locales. SQL0137 y0138 siguen locales y el nuevo motor no está desplegado. La revisión independiente detectó cinco P2 de recuperación (claim stale, alias de retry, parent automático, limpieza scratch, transitorios storage); se están cerrando con pruebas específicas. Interpretación Claude y conexión final a Signal continúan pendientes; no presentar el fit como entrega E2E cerrada.

## Voyage cerrado; motor sigue en integración

Voyage terminó17:12:56UTC con6826raíces/20821fragmentos yUSD0.594321 liquidados,195recibos; reservas/incertidumbre0. [Recibo](DELIVERY_VOYAGE_REAL_CORPUS_2026-09-08.md). No repetir la solicitud. La prueba PG→Worker/Python real pasó con recuperación de checkpoint; el HTTP privado de objetos fue simulado. Los cinco P2 iniciales se corrigieron, pero una revisión posterior encontró despacho inicial sin outbox y recuperación de running engine fuera del scheduler. Backend cierra ambos antes de entregar; no confundir la prueba queue.add con API→cola. Clasificación semántica/interpretación/Signal siguen pendientes.

## Corte local cerrado5f5ca24

Outbox/leases y dinero corregidos y probados; engine en commit5f5ca24, sin push ni SQLremoto. [Recibo y siguiente unión](DELIVERY_WORKSPACE_ENGINE_LOCAL_2026-09-08.md). La entrega visible real de hoy es Voyage completoUSD0.594321; interpretación/Topics/Signal pendientes. Retomar exactamente la unión descrita, sin otrobenchmark ni repetir preparación/pagos.
