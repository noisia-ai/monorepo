# Diagnóstico por fase del inicio editorial — LOCAL

Fecha: 2026-09-27

## Evidencia que lo motivó

En UAT, el inicio editorial V2 terminó en HTTP 502 después de 300 segundos. El estado consultado después respondió `not_requested`, así que esa repetición no dejó una admisión durable visible y no confirma que el Worker haya recibido un manifiesto. Los GET del estado habían tardado entre 6 y 13 segundos. Los dos flags del Worker para Message Batches estaban activos; no se modificaron.

## Cambio

El inicio ahora emite eventos seguros `started`, `ok` y `error` para las fases de idempotencia, validación del origen, carga de evidencia/contexto, construcción del plan, cotización de política, admisión durable, reutilización de recibos anteriores y preparación del manifiesto. Sólo registra nombres de fase, duración, conteos enteros y códigos de error de una allowlist. Nunca escribe mensajes de excepción, claves idempotentes, evidencia, contexto, URI o cuerpos de proveedor.

La cotización sigue siendo un control interno del servidor. Revalida que exista una política activa y liga el máximo de ejecución y la exposición diaria al mismo plan/origen. No debe requerir otra confirmación al usuario. El código actual calcula la cotización y vuelve a verificar el plan dentro de la admisión; la segunda comprobación es una protección de concurrencia/frescura, pero el costo de validar dos veces un plan con 1,652 grupos debe medirse antes de rediseñarla.

## Verificación local

- Prueba focal de redacción/allowlist: 2/2 PASS.
- Typecheck Studio: PASS.
- ESLint focal: PASS.
- `workspace-topic-editorial.test.ts`: los 28 casos reportaron PASS, pero el proceso dejó un handle abierto después del último caso y se interrumpió; no se cuenta como suite completamente cerrada.
- No hubo SQL, envío de proveedor ni cambio de configuración.

## Pendiente

1. Instalar este diagnóstico sólo en Studio UAT y confirmar el hash/deployment.
2. Recuperar con la misma clave que sigue en memoria de la pestaña Topics; no crear otro intento.
3. Leer los tiempos de fase. Si la admisión síncrona excede el límite HTTP, mover la preparación al proceso durable existente de Worker y devolver un recibo de progreso antes del trabajo pesado, preservando el ledger y la política.
4. No declarar progreso o gasto hasta observar la admisión y el manifiesto en estado durable; después verificar recibo real de Message Batches y su progreso.
