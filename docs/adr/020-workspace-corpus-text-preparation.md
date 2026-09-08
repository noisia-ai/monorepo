# ADR 020 — Preparación íntegra del texto de un workspace

Fecha: 2026-09-08. Estado: aceptado; validación local completa y SQL0132 aplicado en UAT. Despliegue de código y aceptación de National se registran en el recibo operativo.

## Contexto

Las importaciones self-service escriben menciones, membresías y observaciones del workspace sin crear un corpus de estudio. El catálogo legacy todavía requiere ese corpus. Además, la preparación semántica anterior tiene límites de población/texto incompatibles con afirmar cobertura completa. La recepción de archivos ya está comprobada; falta un camino recuperable para preparar toda la entrada antes de calcular embeddings, clasificación y descubrimiento.

El Compass exige población completa e incrementalidad. No permite presentar una muestra o un trabajo sin proveedor como análisis terminado. Este corte prepara texto almacenado y registra su cobertura; no ejecuta modelos.

## Decisión

Mantener la autoridad workspace-owned de ADR 014. Una solicitud durable se procesa en la cola Data OS y el Worker existentes. No crear un corpus de estudio artificial, una cola por Topic ni un nuevo framework de ejecución.

Separar la ejecución mutable de su manifiesto sellado. El Worker fija las raíces canónicas de importaciones aceptadas, su disposición, procedencia, derechos y texto. Los textos se conservan como activos por workspace/hash/política, reutilizables entre generaciones. Páginas posteriores recorren el manifiesto con un cursor propio del run. La lectura agrupa hasta 100 raíces y 6 MiB de texto pendiente por lote, permitiendo íntegro un documento mayor; no es un límite de memoria RSS. Tras materializar se actualizan estadísticas sólo de llaves y disposición en las dos tablas derivadas, una vez por generación. No releen texto mutable para completar un snapshot antiguo.

La fragmentación registra límites contiguos y hashes sobre el texto exacto. No normaliza whitespace ni impone un máximo global de documentos o fragmentos. La unidad de offset es explícita. Cambiar la política invalida la reutilización incompatible. Una política futura del proveedor puede requerir otra segmentación; este contrato no afirma equivalencia con tokens ni embeddings.

PostgreSQL conserva solicitud, estado de despacho, lease y checkpoint. El checkpoint y los resultados de una página se confirman juntos. Redis transporta el trabajo y puede recuperarse a partir del registro durable. El identificador de entrega impide que un job antiguo sobrescriba una ejecución recuperada.

La revisión de entrada pertenece al workspace. Importaciones completadas, cambios de texto/población y de derechos hacen pendiente una nueva preparación. Las fechas de publicación no sirven como cursor de ingesta. Cambios durante una ejecución no se mezclan silenciosamente con su snapshot. La última ejecución completa conserva su identidad y su estado de vigencia mientras se prepara otra.

La lectura exige permiso scoped `can_view`; solicitar preparación local exige `can_import_mentions`, revalidado en la operación. No se amplían permisos de ejecutar modelos, atribuir entidades o publicar Signal. Un ámbito de adquisición no se transforma en atribución semántica.

## Consecuencias

La UI puede presentar avance y recuperación reales sin bloquearse en un POST largo. Nueva carga, replay y reinicio se prueban contra el mismo contrato que el primer corpus. La reutilización evita fragmentar otra vez textos idénticos; aun así, la generación nueva debe reconciliar toda su población.

Se añade persistencia focal para una responsabilidad que los ledgers legacy no cubren: éstos congelan sus resultados completados y tienen relaciones con corpora/ejecuciones diferentes. No se debilitan sus invariantes para reutilizarlos por nombre.

Este corte no cierra clasificación, BERTopic, interpretación, excepciones ni Signal incremental. Tampoco prueba capacidad para dos millones de menciones. Esas etapas deben consumir la autoridad vigente, revalidar derechos y aportar sus propios recibos de cobertura, calidad y costo.

Bloquear un uso tras la expiración de derechos no elimina copias almacenadas. Antes del lanzamiento se requiere un ciclo autorizado de retención/retirada de activos y derivados compartidos, con recibo mínimo y recuperación. La protección de inmutabilidad ordinaria debe tener una excepción interna específica para esa operación; no se habilita borrado general ni se ejecuta limpieza histórica en este corte.

La migración es aditiva y manualmente revisada. La retirada del código conserva sus tablas y resultados; no exige borrar datos históricos. La aplicación en UAT y el cambio de código requieren primero prueba PostgreSQL y Worker locales. Producción es una acción de lanzamiento separada.
