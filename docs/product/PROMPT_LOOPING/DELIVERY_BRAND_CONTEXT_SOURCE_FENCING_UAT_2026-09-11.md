# Brand Context: reconciliación de fuente y recuperación segura · 11 septiembre 2026

## Resultado de producto

El recorrido autoservicio ya trata Brand OS, la base de conocimiento y los competidores como fuentes
versionadas. Una edición cliente reconcilia gratuitamente el contexto de la marca, conserva la última
versión publicada y prepara una generación sucesora sólo cuando no existe trabajo pagado o incierto
que deba conciliarse primero.

La confirmación pública está ligada a una referencia opaca de la cotización exacta. Cambiar una fuente
rota esa referencia; repetir la misma solicitud conserva su identidad. PostgreSQL vuelve a comparar la
fuente justo antes de cualquier envío y cierra como obsoleto el trabajo que perdió vigencia, liberando
una reserva que nunca salió y sin tocar respuestas pagadas.

Las recuperaciones `definitely_not_sent` quedaron conectadas en las dos etapas. Claude rearma la misma
ejecución, recibo, admisión y reserva. Voyage usa un sucesor con cotización nueva; cuando la caché está
completa continúa sin otra confirmación ni llamada. Si la caché no alcanza, muestra el costo nuevo y
espera al usuario.

## Validación local cerrada

- SQL0159 exacto: `0be97f5bc9dfe4c0b20e7347a828807bd6fb95a96582f7e97e5b158007bfc8e7`.
- PostgreSQL sintético: 28/28; guardas 4/4; rollback, 269 tablas y huella intactos; base temporal
  eliminada; cero transportes o proveedores reales. Recibo:
  `.data/brand-context-source-fencing-2026-09-11/RECEIPT.md`.
- Studio: 978 aprobadas, 7 omitidas, 0 fallidas; 34/34 focales; typecheck, lint y build PASS.
- Worker: 564 aprobadas, 42 omitidas, 0 fallidas; typecheck PASS.
- DB: 502 aprobadas, 93 omitidas, 0 fallidas; 39/39 focales; typecheck PASS.
- Interfaz: 60/60 compuestas; reconciliación acotada 0/2/8 s, polling 4/8/16/30/60 s y ningún
  identificador de cotización renderizado.
- Revisión adversarial: cero P0/P1 que bloqueen la entrega UAT focal.

## Entrega UAT

Pendiente de registrar en este mismo documento después de aplicar SQL0159 una sola vez y desplegar el
mismo commit en Worker y Studio. No se reaplican SQL0156–0158 y los proveedores permanecen inactivos.

## Gate antes de producción

Stage 1 no tiene todavía una renovación autoservicio cuando su ejecución fue definitivamente no
enviada y la admisión original ya venció. La UI debe dejar de ofrecer una cotización imposible y la
renovación debe conservar ejecución, recibo y presupuesto sin crear una segunda llamada. Los procesos
largos también deben recuperar el polling sin depender de una actualización manual. Estos puntos no
se presentan como recorrido completo de producción.
