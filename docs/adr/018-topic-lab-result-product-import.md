# 018 — Importar resultados de laboratorio como candidatos editables

Fecha: 2026-09-06. Estado: implementación local en revisión; aún no desplegado en UAT.

## Contexto

El laboratorio ya calculó diez candidatos útiles sobre el corpus congelado y produjo una propuesta
de refinamiento con citas. Repetir una llamada sólo para poblar UAT duplicaría costo sin probar una
hipótesis nueva. Copiar la base local completa tampoco es apropiado: contiene autoridad de ejecución,
sellos del host y pruebas que no describen el entorno de producto.

## Decisión

Reutilizar las tablas V2 de candidatos y el editor reversible de0115. Un importador exclusivamente
operado desde servidor incorpora un artefacto acotado con origen explícito `imported_result`:

- El recibo inmutable conserva snapshot, derechos, Brand OS, corrida, resultado y costo originales.
- El destino revalida workspace, snapshot y cada referencia contra las membresías que ya posee.
- Se conserva el conjunto completo de candidatos, revisiones de modelo, citas, ranking, turnos y
  lecturas. Sus tokens son telemetría histórica, no una llamada nueva.
- El run importado tiene cero llamadas, reserva y liquidación **locales al destino**. No tiene
  autorización de ejecución ni outbox y no puede disparar un worker. El gasto histórico sólo vive
  como procedencia en el recibo; no se vuelve a sumar al presupuesto.
- Los IDs de destino se derivan de la identidad del import. Los IDs y digests de origen se conservan
  explícitamente como origen; no se declara identidad de filas cuando hubo remapeo.
- Una propuesta histórica se conserva separada de las sesiones vivas. Importarla no renueva su
  sesión, no desactiva la caducidad y no habilita nuevas llamadas.

El reader existente muestra las propuestas importadas y su revisión fuente. “Usar propuesta” copia
nombre y descripción al formulario; guardar sigue usando concurrencia, idempotencia y revisiones
editoriales. Rechazar, restaurar y deshacer siguen siendo operaciones sobre el candidato.

## Consecuencias

No se necesita otra evaluación pagada ni otra copia de varios GB. La UI distingue el resultado
histórico de una ejecución del entorno. No se aplican0116–0121 en UAT;0122 es un corte de producto
separado y forward-only. El despliegue requiere su propia prueba real de target, ledger y health.

Este import **no crea ni adopta Topics**, no publica y no activa Signal serving. Es un puente de un
experimento válido a una superficie editable, no un reemplazo del pipeline computacional ni de la
futura ejecución acotada del refinamiento en producto.

## Comprobaciones del corte

Import repetido idempotente; divergencia del mismo idempotency key rechazada; workspace/digests/citas
reconciliados; atomicidad del cohort; ausencia de provider/outbox/activación; propuesta histórica
legible sin sesión viva; stale tras editar; save/undo preserva fuente; rollback de la prueba restaura
exactamente el estado original. La auditoría independiente y la prueba PostgreSQL se registran en
`docs/product/PROMPT_LOOPING` antes de afirmar que el corte está listo.
