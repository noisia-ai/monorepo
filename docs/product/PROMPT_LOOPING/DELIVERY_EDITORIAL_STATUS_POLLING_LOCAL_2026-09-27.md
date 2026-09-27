# Polling de estado editorial adaptable — corte LOCAL, 27 septiembre 2026

## Resultado

La tarjeta de Topics deja de consultar el estado editorial cada cinco segundos de forma indefinida. Mientras la pestaña está visible, espera cinco segundos entre lecturas sanas; tras errores de conexión espera progresivamente 10, 20 y hasta 30 segundos. Al recuperarse la lectura, vuelve al intervalo normal. Si el usuario oculta la pestaña, cancela la siguiente consulta; al regresar, hace una lectura inmediata. No inicia ejecuciones, reintentos, manifiestos ni solicitudes al proveedor.

La vista conserva el último estado conocido durante una falla de lectura y presenta el aviso existente de datos desactualizados. Las acciones dependientes de un estado vigente siguen bloqueadas hasta que la lectura vuelva a funcionar. La implementación es independiente de una marca o una ejecución concreta.

## Verificación

- Prueba focal `workspace-topic-editorial.test.ts`: 45/45 PASS; incluye backoff, recuperación, pausa por pestaña oculta, reanudación inmediata, exclusión mientras hay otra lectura y límite de 30 segundos.
- Typecheck Studio: PASS.
- ESLint en los tres archivos cambiados: PASS.
- `git diff --check`: PASS.

## Alcance pendiente

Este corte aún es LOCAL; no se entregó en UAT. Reduce carga repetitiva desde esta tarjeta, pero no corrige timeouts de autenticación/conexión de PostgreSQL observados en Railway. La última lectura de UAT registró fallos de conexión antes de alcanzar la consulta editorial; no se repitió ni modificó la solicitud POST incierta.

El ensayo privado del fixture 0197 se detuvo por una referencia inválida del propio fixture (`provider_batch_id` estaba consultándose en `signal_topic_editorial_calls`). La consulta ya se corrigió para comprobar estados reales de las dos tablas; el ensayo anterior sí confirmó rollback físico y base vacía. Antes de repetirlo, deben pasar los checks focales y efectuarse la habilitación temporal y específica del runner privado.

## Siguiente corte

Entregar este ajuste sólo a Studio UAT desde la rama UAT, verificar el polling y el estado desactualizado sin repetir el POST incierto; después completar un único ensayo rollback-only 0197 con recibo físico y restaurar el runner a solo lectura. Sólo entonces evaluar la migración 0197 y su recuperación desde UI.
