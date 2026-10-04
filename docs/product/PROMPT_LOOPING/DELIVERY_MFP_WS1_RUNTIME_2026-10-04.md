# WS1 — runtime remoto para discovery y el recorrido UI

Estado: imagen verificada en CI; activación Railway y consumo de cola pendientes.
Continúa WS1 sobre el entorno aislado existente, sin crear otro entorno ni clonar bases.

El runner inicial permitía importar y ejecutar las etapas explícitamente por SSH,
pero no incluía Python/BERTopic ni consumía trabajos enviados por la UI. Su imagen
ahora incorpora las versiones fijadas del Worker CPU-only y el módulo incremental,
sin instalar encoders ni descargar modelos. Conserva el modo inactivo por defecto.
Con `NOISIA_MFP_WORKER_ENABLED=true`, el arranque verifica IDs, DNS privado,
base/rol y system identifier antes de reutilizar los pools en el Worker existente.
Se mantienen los flags de etapa/proveedor y la autoridad del producto.

Verificación ligera: 7 pruebas del harness pasan, incluyendo proceso inactivo y
rechazo de inicio fuera del destino autorizado. Sintaxis de runtime y diff válidos.
CI remoto `37200808956` construyó la imagen, importó BERTopic y los módulos
numéricos completo/incremental y pasó las siete pruebas del harness. CI general
`37200808849` pasó todos los checks de `9f1d2c6`. Un build todavía no acredita
consumo de cola ni recorrido UI. No hubo Docker, Worker, PG ni Redis en la Mac.

La revisión posterior corrigió dos fallos del pool inyectado: ahora recibe el
mismo manejo saneado de errores de conexión inactiva y se cierra una sola vez
cuando ambos carriles comparten la instancia. Dos regresiones focales pasaron
en el runner remoto, incluyendo reevaluación del módulo sin duplicar listeners.
El CI del commit final vuelve a verificar la integración antes de merge.

Despliegue previsto: cerrar/reconciliar ejecuciones explícitas, conservar el volumen,
verificar las migraciones del corte, construir en Railway y comprobar Python e
identidad del runtime. Activar una única réplica con las colas privadas de Studio y
credenciales mínimas; verificar heartbeat y un trabajo del recorrido. La recuperación
es volver al modo inactivo después de reconciliar el trabajo aceptado, conservando
base, volumen y recibos. UAT/producción no forman parte de este cambio de runtime.
