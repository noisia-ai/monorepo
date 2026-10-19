# Studio UAT: recuperación de lectura y consultas acotadas

## Problema comprobado

Marcas/Overview fallaban durante autorización con `timeout exceeded when trying to connect`. El driver lo emite al vencer una adquisición en cola con el pool lleno. Los logs del 20 y 24 de septiembre lo confirman; todavía no se conoce por qué quedaron ocupadas las conexiones originales.

PostgreSQL conservaba los datos. Una consulta de sólo lectura verificó Alexa+: 47,285 raíces recibidas, nueve archivos, 43,159 incluidas y 4,126 excluidas. El agregado tardó 5.183s. La fotografía de actividad no encontró consultas activas largas, pero no explica por sí sola el estado previo del proceso Node.

Reinicio autorizado exclusivamente de Studio UAT, mismo deployment `f43be9b5-6c93-4316-842f-3ca6f62b5760`/commit `477dc20`, a las 06:23:05 UTC. Marcas en carga nueva, Overview, Topics, Signal y Menciones volvieron a mostrar sus datos. No se modificaron Worker, DB, permisos, imports ni análisis; cero llamadas nuevas a proveedores.

## Cambio entregable

El pool compartido conserva tres conexiones, espera de adquisición de diez segundos y política SSL existente. Activa TCP keepalive y limita a sesenta segundos la respuesta de `pool.query`, que controla adquisición/liberación y descarta el cliente al recibir error. Conserva consultas parametrizadas, objetos de configuración y callbacks; no reenvía escrituras.

El deadline no se propaga a clientes obtenidos con `connect()`, incluidas transacciones Drizzle. Un timeout global fue descartado en revisión: una respuesta tardía podía dejar una transacción sin rollback y devolverla al siguiente consumidor. Las transacciones manuales conservan su comportamiento; sus retenciones todavía requieren diagnóstico específico. El timeout tampoco demuestra cancelación SQL ni permite inferir el resultado de una escritura.

No se presenta esto como prueba de la causa original ni como garantía de ausencia de saturación futura.

## Verificación

- Cinco pruebas con `pg`/`pg-pool` reales y servidor TCP sintético: tres escrituras sin respuesta expulsan sus conexiones; se recuperan tres conexiones; cada escritura se envía una sola vez. Respuesta tardía en checkout explícito conserva rollback antes de reutilización. Configuración congelada y overloads de valores/callback quedan intactos.
- La suite general descubrió fixtures anteriores desactualizados: digest de KB vacía y texto de catálogo parcial recuperable. Se corrigieron únicamente los fixtures/expectativas. En Node20+tsx, `assert.ok(false)` sin mensaje consumía CPU generando diagnóstico Acorn; se añadieron mensajes explícitos en esas aserciones. No se modificó el comportamiento de la UI para satisfacer las pruebas.
- Typecheck y lint raíz: 11/11 tareas PASS. Studio: 1,085 PASS, cero fallos, siete skips que requieren entorno de integración. Build Studio PASS con variables sintéticas sin proveedores ni DB remota. `git diff --check` limpio. Ejecutar build antes de typecheck: Next regenera `.next/types`, por lo que correr ambos simultáneamente produjo archivos ausentes; el chequeo secuencial final pasó.
- Revisión independiente bloqueó el timeout global; alternativa final revisada por Root y comprobada con los cinco casos de protocolo. Entrega UAT todavía pendiente al cerrar este recibo local.

## Estado preservado y próximo resultado

UI previa al nuevo código: Marcas 47,285/9; Signal y Menciones 43,159; Topic elegido con 67 asociaciones. Editorial 2/42 lotes, USD1.585632 confirmado, reserva e incertidumbre cero. Interpretación inicial 36/1,652, USD1.310931 confirmado y reserva cero. No se autorizaron reanudaciones pagadas.

Siguiente corte: Signal desde importación aceptada sin esperar generación Engine, con población y derechos compartidos por Resumen/Menciones. Preservar datos y presentación legacy de Laika. Plan canónico en repo de documentación: `PLAN_SIGNAL_FROM_IMPORT_2026-09-24.md`. Linear requiere reconexión; sincronización pendiente, sin tickets cerrados ficticiamente.
