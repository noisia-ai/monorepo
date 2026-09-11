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

Entrega cerrada en el orden DB → Worker → Studio:

- Preflight `2026-09-11T23:36:19.668415Z`: SQL0159 ausente; cero políticas activas, admisiones,
  ejecuciones semánticas o de embeddings, outbox y llamadas inciertas.
- SQL0159 aplicado una sola vez a las `2026-09-11T23:37:34.014928Z`, con SHA exacto
  `0be97f5bc9dfe4c0b20e7347a828807bd6fb95a96582f7e97e5b158007bfc8e7`. La tabla y sus funciones
  quedaron sin lectura o ejecución pública. No se reaplican SQL0156–0158.
- Worker `de80d999-58d0-4a45-b902-9ea464c6070d` sirve el corte `f77a316`; la réplica anterior fue
  retirada antes de habilitar Studio.
- Studio `bf40d8a3-0345-4cae-8a23-17dac3c0e67d` sirve el marcador `4f4b62c`; la versión anterior
  quedó retirada y el autodeploy restaurado.
- Recibo posterior `2026-09-11T23:48:01.517536Z`: SQL0159 presente; privilegios públicos de tabla y
  funciones en cero; cero políticas, acciones, admisiones, reconciliaciones, ejecuciones semánticas o
  de embeddings activas, llamadas inciertas y outbox activo.

QA real autenticado comprobó Marcas → National → Brand OS → Topics. National conserva 7,396
menciones únicas, 16 archivos aceptados y 9,131 filas recibidas. Brand OS expone la preparación
semántica según el permiso efectivo, permite múltiples bases de conocimiento y no muestra la
referencia opaca de la cotización. Topics conserva 32 tópicos activos de 357 grupos, costos y trabajo
histórico; comunica que la fuente vigente aún debe prepararse. No se importaron datos, no se creó una
política y no hubo llamadas a Claude o Voyage durante la entrega.

## Gate antes de producción

Stage 1 no tiene todavía una renovación autoservicio cuando su ejecución fue definitivamente no
enviada y la admisión original ya venció. La UI debe dejar de ofrecer una cotización imposible y la
renovación debe conservar ejecución, recibo y presupuesto sin crear una segunda llamada. Los procesos
largos también deben recuperar el polling sin depender de una actualización manual. Estos puntos no
se presentan como recorrido completo de producción.
