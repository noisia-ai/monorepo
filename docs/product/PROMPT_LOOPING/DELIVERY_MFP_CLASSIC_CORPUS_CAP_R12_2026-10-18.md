# Vectores clásicos sin máximo heredado — revisión 12

PR #69 elimina el máximo implícito de USD5 que bloqueaba la cotización de vectores de «Estudio real A (cerveza, Brasil)». Si no hay máximo configurado, el recorrido clásico conserva `NULL`; no activa fichas ni MFP. Una estimación superior a USD5 puede admitirse con los mismos permisos de ejecución de Topics.

La cotización refleja el mínimo entre los máximos explícitos del servidor y de la política vigente. La admisión clásica usa esa política cuando existe, tanto para importes finitos como para `NULL`, y revalida la capacidad al recuperar un propietario admitido. Así, enviar `NULL` o una cifra mayor no permite quitar un máximo de política. No se modifica el código de reserva, transporte, liquidación, conciliación ni caché; tampoco la ruta estándar por defecto. No requiere migración.

**Aceptación.** Prueba escrita primero: el runtime clásico devolvió `5000000` cuando debía conservar `NULL`. El test PostgreSQL usa un corpus sintético preparado cuya cotización supera USD5, sin features MFP, y exige admisión con máximo NULL y cero llamadas. Cubre además un máximo explícito de política y otro de entorno. La UI prueba USD33.232724 con ejecución habilitada sin máximo inventado y conserva el bloqueo de un máximo explícito. CI y PostgreSQL finales se acreditan en el PR; el recibo no sustituye sus resultados.

**Entrega real.** Código y pruebas únicamente; no se desplegó, no se solicitó trabajo del estudio, no se llamó proveedores y no se modificaron datos en dev-test. Costo proveedor USD0. El recorrido real sigue esperando la build coordinada y la lectura de saldo antes del paso pagado. Modelo del rol configurado `gpt-6.1-sol/high`; backend efectivo y costo Codex no acreditados independientemente.
