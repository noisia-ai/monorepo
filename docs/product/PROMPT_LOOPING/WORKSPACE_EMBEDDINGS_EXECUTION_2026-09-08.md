# Embeddings del corpus preparado — ejecución, 8 septiembre 2026

Estado: entregado y comprobado en UAT, Studio `561ecc3` y Worker `67569e9`, SQL0133 aplicado. [Recibo final](./DELIVERY_WORKSPACE_EMBEDDINGS_FOUNDATION_2026-09-08.md). Proveedor deshabilitado, cero llamadas pagadas. El contrato siguiente conserva el diseño y sus límites; añade evidencia al Compass sin reabrir recepción, SQL0131/0132 ni preparación de National.

El resultado de este corte es consumir todos los fragmentos del manifiesto vigente, reutilizar vectores compatibles y conservar progreso y costo incluso ante recarga, pérdida de Redis o respuesta incierta. Todavía no produce clasificación, BERTopic, nombres de Claude ni Signal. No se llama a un proveedor real durante la implementación o las pruebas.

## Contrato y reutilización

- La población es el manifiesto inmutable de `signal_corpus_preparation_items` y sus activos originales. No se copia a `study_corpus`, no se muestrea ni se recorta a 50k menciones, 900 inputs u 80 fragmentos.
- Se recorre cada fragmento con offsets UTF-16 y SHA del texto exacto. Los lotes limitan memoria/transporte, nunca la población.
- Se mantiene la cola Data OS y su Worker. SQL0133 implementa sólo ejecución/presupuesto, recibos de llamada y caché por workspace/configuración/SHA del fragmento; un índice añade acceso ordenado al manifiesto existente.
- La identidad del vector incluye proveedor/modelo/dimensión/input_type/output_dtype/truncation/política de fragmentos/tokenizador/contrato. La tarifa se sella en el perfil de ejecución, separada de la identidad reutilizable.
- Preparación vigente, autorización `can_execute_topics`, revisión de inputs y vigencia de derechos se comprueban de nuevo durante el procesamiento. La capacidad de importar por sí sola no autoriza llamadas pagadas.

## Costo y recuperación

Se fija Voyage `voyage-4-large`, 1024 dimensiones, `input_type=document`, `output_dtype=float`, `truncation=false`. La cotización local conservadora usa bytes originales y cantidad pendiente de fragmentos. El límite se expresa en microUSD enteros y se muestra antes del POST. No se presume crédito gratuito ni se incrusta el saldo de esta conversación en el producto.

El tokenizador público oficial, revisión `bb931c2635a93efe400c24741363d8ff61d7bb32`, aplica NFC y ByteLevel BPE sin prefijo de espacio. La reserva por lote usa bytes UTF-8 normalizados sólo para contar más margen de 64 tokens por input; el texto enviado conserva su forma original. La cotización agregada usa una cota de expansión UTF-8 de 3 y margen por fragmento, además de redondeo por llamada. No se presenta como tokenización exacta ni consumo facturado. La evidencia pública y la comprobación Unicode están en `.data/workspace-embeddings-2026-09-08` del worktree focal.

Una llamada reserva presupuesto durable y cambia a enviada antes del transporte. El adapter hace una sola solicitud, sin reintentos implícitos. Guarda la respuesta cruda privada antes de validarla; exige cardinalidad/índices/dimensiones/valores finitos/uso de tokens coherentes. Modelo ausente en la respuesta oficial usa la identidad de la petición; modelo distinto se rechaza. Una respuesta perdida conserva reserva y bloquea un reenvío automático, incluso bajo otra intención. Una respuesta ya guardada se reconcilia sin nueva llamada. Fallo local recuperable reanuda la misma ejecución, presupuesto y cursor.

El gasto observado que exceda la reserva se conserva como excepción y bloquea nuevos envíos. Nunca se descarta ni se transforma en costo cero para hacer pasar el límite.

Única bandera: `NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED=true` y credencial vigente habilitan transporte. Desactivada por defecto. El drainer puede reconciliar recibos existentes estando desactivada. Tope máximo del servidor por ejecución: microUSD configurable, USD5 por defecto. No se habilita gasto real en este corte.

## Interfaz y aceptación

Dentro del panel de preparación existente: estado, cobertura reutilizada/pendiente, cotización sin proveedor y máximo visible. La solicitud/idempotencia se conserva por workspace y actor. Un GET recupera la intención propia; no se infiere éxito desde la última ejecución de otro usuario. Al reanudar se conserva el presupuesto original. Preparar vectores no se etiqueta como análisis terminado.

Pruebas requeridas: PostgreSQL/BullMQ reales locales con proveedor simulado, consumo de manifiesto completo, respuesta persistida y crash, doble entrega, reserva incierta sin reenvío, error previo al envío recuperable, revisión/derechos revocados, caché incremental y aislamiento de workspace. Checks de paquetes tocados y build de Studio antes de cualquier commit focal.

## Hilos que siguen abiertos

- NOI-81: la resolución self-service de una llamada cuyo resultado/costo se desconoce requiere evidencia del proveedor; no se ofrece un botón que vuelva a cobrar a ciegas. Debe cerrarse antes de habilitar este mecanismo en producción.
- Clasificación masiva, guía de intereses/Brand OS, BERTopic y otros métodos sobre el residual completo, interpretación Claude, incrementalidad y Signal multiámbito siguen en NOI-31/78 y el plan del Compass.
- Acceso integral cliente: NOI-19. Retención/retirada física de derivados: NOI-80. No ejecutar limpieza.
- Zona de exportación SentiOne ya preguntada: pendiente; no repetir pregunta, reparar fechas ni analizar National por intuición.
- Saldo sin cambios: producto USD11.362961; Advisor USD1.343826. Cero llamadas nuevas.

Fuentes oficiales consultadas: [embeddings API](https://docs.voyageai.com/reference/embeddings-api), [precios](https://docs.voyageai.com/docs/pricing), [tokenización](https://docs.voyageai.com/docs/tokenization), [tokenizador publicado](https://huggingface.co/voyageai/voyage-4-large/tree/main), [tipo de respuesta SDK oficial](https://github.com/voyage-ai/typescript-sdk/blob/main/src/api/types/EmbedResponse.ts).
