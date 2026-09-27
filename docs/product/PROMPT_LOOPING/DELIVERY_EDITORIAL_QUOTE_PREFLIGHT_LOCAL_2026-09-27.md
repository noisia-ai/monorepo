# Cotización editorial V2 sin revalidar 1,652 grupos en la fase provisional

**Estado:** cambio local en revisión; pendiente ensayo PostgreSQL privado. No es una entrega UAT.

## Hallazgo

La UI confirmaba que la solicitud seguía antes del despacho a Message Batches: el último evento de inicio no tenía recibo y la fase abierta era `quote_policy`. El código ejecutaba la validación íntegra de cada grupo en la cotización provisional; luego la admisión repite esa cotización y el trigger de la ejecución vuelve a validar el manifiesto antes de que la transacción pueda persistir. El test PostgreSQL anterior sólo usa dos grupos, por lo que no prueba el tiempo de esta ruta con el censo de Alexa+.

La cotización no es una aprobación separada para el usuario. Debe sellar la política activa, el importe máximo configurado, la exposición diaria, el deadline, el workspace, el corpus y el digest del plan. No se debe quitar el control presupuestario ni heredar el tope experimental de USD 30.

## Cambio local

`0197_signal_topic_editorial_quote_preflight.sql` reemplaza el trabajo de la cotización: verifica acceso, fuente vigente, identidad, digest del cuerpo y cantidad de grupos; deja la validación grupo por grupo al trigger de admisión durable, que corre antes de que ejecución, reserva, solicitudes o manifiesto puedan confirmarse. La admisión sigue comparando cuerpo canónico y digest y conserva el mismo quote firmado y la misma clave idempotente. La migración no crea tablas ni toca datos, costos o permisos.

El runner privado Message Batches se amplió para ensayar 0197 dentro de su transacción sintética y rollback físico. El test guard confirma que no se omitió la validación de procedencia del trigger ni se incluyó SQL fuera de la imagen privada.

## Verificación

- Test focal SQL de cotización/admisión/replay: 3/3 PASS.
- Guards del runner privado: 18/18 PASS.
- Typecheck `@noisia/db`: PASS.
- `git diff --check`: PASS.
- Cero llamadas a Claude/JEV y cero gasto.

## Pendiente

Ejecutar el runner PostgreSQL privado con el gate dedicado, verificar rollback físico y censo vacío. El fixture actual de dos grupos acredita el contrato, pero no el rendimiento a escala. Después instalar 0197 una sola vez en UAT mediante su ruta aprobada, recuperar la misma acción/idempotency key y medir tiempos separados de cotización y admisión. No volver a pulsar “Iniciar” con una clave nueva ni declarar que el bloqueo de minutos ya está resuelto antes de ver esas mediciones.
