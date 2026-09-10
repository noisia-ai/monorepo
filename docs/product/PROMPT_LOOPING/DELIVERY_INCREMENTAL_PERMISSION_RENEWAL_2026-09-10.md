> **ENTREGADO EN UAT — 10 septiembre 2026, 02:59 UTC / 9 septiembre México.** NOI-82 cerrado en `1a609cb0cd1b24c661818e37bc65dcdfb3303b59`. Studio y Worker activos con ese commit, una réplica cada uno y despliegues anteriores retirados. SQL0152 aplicado una sola vez y verificado; no reaplicar. UI real conserva 32 Topics, 32/357 unidades y costos; no se activó permiso ni se hizo una nueva llamada. El recibo remoto de 02:52:42.201Z confirma selección/generación/costos intactos y cero actividad/permisos. La renovación completa se comprobó en PostgreSQL/Worker local con HTTP simulado; sigue pendiente una segunda carga real por UI y permiso vigente para el nuevo ciclo remoto. No declarar E2E completo.

## Recibo final de entrega

- Studio: `350c503b-905f-4478-bfd6-6a087dd1331f` activo; anterior `2c074f2a-d8ac-4d19-a207-04904506e749` retirado, verificado en una página nueva de Railway.
- Worker: `cbccd9dc-b558-44c1-8c7f-a60a8193d7e1` activo; anterior `31f68d74-2418-4522-8465-36e231432390` retirado. Arranque `recovery`, preflight aprobado, cero trabajos Redis ejecutables y cero candidatos DB.
- SQL0152: cuatro funciones, sin tablas/columnas/triggers nuevos. Quince tablas completas, ACL y otras funciones intactas. Recibo íntegro de 223650 bytes, SHA `44dd6564613da2ca0f9d6ebcda8afaeafe7037cacb1fc9cc45d94645bb7e23f5`.
- Comparación final con d4cd78e: costos, selección revisión 2, generación y vencimiento anterior intactos; cero ejecuciones activas, permisos, hijos numéricos, dueños editoriales o preparaciones nuevas. Dos Topics seleccionados/98 asociaciones y 6,826 raíces conservados.
- Evidencia privada en `.data/incremental-renewal-2026-09-10/` del checkout focal: `runtime-release.json`, `uat-final-receipt.json`, `uat-final-comparison.json`, `uat-ui-smoke-receipt.json` y `release/uat-0152-migration-receipt.json`.
- Siguiente desarrollo: NOI-19, entrada cliente a una marca asignada, Topics/Datos reutilizados y selección de Signal separada de ejecutar/gastar. Plan `PLAN_CLIENT_WORKSPACE_ENTRY_2026-09-10.md`; aún no implementado. No abre Admin global ni concede roles reales. Alta, Brand OS y política de presupuesto siguen en el Compass.

Los cortes siguientes son historia del mismo trabajo y explican su secuencia; no revierten la entrega comprobada arriba.

> SQL0152 aplicado una vez y verificado en UAT el 2026-09-10T02:43:26.351Z. Paquete exacto b0caca78…4fa828; recibo íntegro privado `uat-0152-migration-receipt.json`,223650 bytes,SHA44dd6564…e23f5. Cuatro funciones verificadas;15 tablas,ACL y demás funciones intactas. Cero permiso/gasto nuevos. No reaplicar SQL. El commit1a609cb está cerrado; despliegues nuevos pendientes de comprobar.

# Renovación de interpretación incremental desde Topics — NOI-82

Historia del cierre local, 10 septiembre de 2026, 02:36 UTC: corte LOCAL cerrado en `1a609cb0cd1b24c661818e37bc65dcdfb3303b59`, checkout limpio. UAT continúa en `d4cd78e0bbbee30895580a820404f6d5d3e8d46b`, con SQL0148–0151 ya instalado. SQL0152 todavía no aplicado. Este documento complementa el Compass y el historial; no declara terminado el flujo E2E.

## Comportamiento

Cuando una actualización se detiene por vencimiento o revocación, Topics permite confirmar un importe y fecha límite nuevos para la misma actualización. Conserva el resultado computacional, las respuestas guardadas, los Topics editados y la selección de Signal. El control usa el mismo bloque de autorización; no agrega una sección ni un formulario por grupo.

Recuperar una respuesta ya pagada tiene prioridad y no requiere un permiso nuevo. Los límites originales del análisis y del día siguen vigentes; una renovación no aumenta esos límites. Las respuestas inciertas o en vuelo impiden nuevos envíos. Sólo una reserva demostrablemente nunca enviada se puede retirar, conservando su historia.

La aceptación del permiso y la reanudación del trabajo se confirman juntas. La repetición de una solicitud aceptada devuelve su recibo sin volver a encolar, incluso si después cambia la fuente o se deshabilita el proveedor.

## Evidencia del corte

- Checkout: `/Users/brandhon_o/Downloads/noisia-incremental-permission-renewal-2026-09-10`, rama `codex/noisia-incremental-permission-renewal-2026-09-10`, base `d4cd78e`.
- Servicio Studio: 29/29 pruebas focales aprobadas.
- Interfaz: 24 pruebas focales y 13 comprobaciones DOM aprobadas; ES390/EN1280 inspeccionados. Edición/selección y recuperación de solicitud conservadas.
- PostgreSQL y Worker real: prueba compuesta aprobada (29.12 s), nueve unidades/tres lotes. Primer resultado 4/9 → vencimiento → renovación → sólo cinco pendientes → nueve Topics sin seleccionar y proyección de tres raíces/133 fragmentos. Transporte HTTP simulado; cero proveedor externo. Casos de permisos, límites, reserva nunca enviada, llamadas inciertas/en vuelo, reserva terminal, tokens antiguos y pérdida de ACK aprobados.
- Typecheck/lint 11/11 y build Studio 106.6 s aprobados. Suites: DB238 PASS/88 omitidas; Studio846 PASS/7 omitidas; Worker558 PASS/42 omitidas. La prueba PostgreSQL nueva sí se ejecutó, por separado. Revisión independiente: cero P0/P1/P2.
- 16 archivos en el commit focal. El ensayo local y la entrega UAT de SQL0152 quedaron cerrados; ver recibos finales arriba.
- Recibos privados: `.data/incremental-renewal-2026-09-10/ROOT_FREEZE.json`, `../incremental-permission-renewal-2026-09-10/WORKER_RECEIPT.md` y `../incremental-permission-renewal-ui-2026-09-10/RECEIPT.md`, bajo el checkout focal.
- Preflight UAT de 02:31:22.264 UTC: d4cd78e, SQL0152 ausente, cero actividad, candidatos, permisos y dueños editoriales incrementales. La UI conserva 32 Topics/32 de 357 y los costos anteriores.

## Continuidad y límites

No se creó permiso ni se envió una llamada remota. Claude conserva USD 1.918865 confirmado y USD 1.6818 de reserva terminal; Voyage USD 0.594449. Sonnet 4.6, sin Opus. La autorización anterior vencida no se amplía mediante el loop.

Se preservan 7,396 menciones recibidas en 16 CSV, 32 Topics de 32/357 unidades interpretadas, dos Topics seleccionados con 98 asociaciones en Signal y 6,826 conversaciones consultables en Menciones. Sigue pendiente una segunda carga real por UI y permiso vigente para comprobar un nuevo ciclo remoto; derechos cliente y calidad también siguen pendientes.

Plan: `PLAN_INCREMENTAL_PERMISSION_RENEWAL_2026-09-10.md`. Seguimiento: https://linear.app/noisia/issue/NOI-82/ss-e2e-renovar-desde-topics-un-permiso-editorial-incremental-vencido
