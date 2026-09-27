# Inicio editorial V2: diagnóstico y corte focal (27 septiembre 2026)

## Evidencia del fallo

En UAT, POST `start_editorial` para Alexa+ se quedaba en `quote_policy` y el proxy devolvía 502 tras 300 s; GET seguía en `not_requested`. La prueba de sólo lectura con la misma entrada de 1,652 grupos produjo un plan de **80,924,308 bytes**. De ellos, 25,706,772 bytes eran contexto de marca repetido y 42,640,808 bytes mensajes de proveedor. Studio enviaba el JSON completo y su representación canónica a una cotización que volvía a validar grupo por grupo. PostgreSQL canceló esa validación con `57014` bajo un plazo de 25 s. Además, dos columnas imponían 64 MiB al plan, de modo que mover solamente el trabajo al Worker tampoco habría permitido admitirlo.

## Cambio

- POST guarda una intención pequeña en PostgreSQL y responde sin reconstruir el corpus. GET muestra `preparing` o una falla de inicio con causa segura; la UI consulta hasta ver la ejecución.
- El Worker existente reclama la intención, carga el corpus, arma el plan y usa la misma clave idempotente para la admisión V2. El Worker no lee la clave de Claude en este paso. La cola lleva sólo un UUID; PostgreSQL guarda el estado y recupera leases vencidos.
- La cotización no pagada envía sólo digest y cantidad de grupos. La admisión continúa comprobando plan canónico, fuente, evidencia por grupo, política, presupuesto y ledger bajo sus locks. El límite de almacenamiento sube a 256 MiB sin recortar respuestas de Claude.
- La autorización de la cotización dura hasta una hora para dar margen al Worker. La política y la fuente se vuelven a comprobar al admitir y enviar.

## Recibo de base de datos

SQL0198 `0198_signal_topic_editorial_async_start_v2.sql` se ensayó primero en una transacción con rollback sobre UAT. Se aplicó **una sola vez** a UAT el `2026-09-27T21:15:01.483Z`, SHA-256 `62c242da7454d5b80bacd8eb653d8bc9cebfbb506a78bae70b3fe8a19083d123`. Pre/post: seis admisiones, dos ejecuciones editoriales, 32 llamadas y 15 claves; cantidades idénticas. Verificados tabla de intenciones, función de cotización rápida y nueva capacidad de plan. SQL0197 ya estaba presente en UAT y **no se reaplicó**. La cotización rápida real con una entrada sin gasto devolvió `policy_required` en 959 ms.

## Entrega y comprobación UAT

El corte de producto `b3d8241` se integró con la rama UAT en `a477ff0` y se envió a `codex/noisia-topic-results-uat-2026-09-06`. Worker `781c13b3-929f-40c1-a14d-ac7c131c63dd` y Studio `9a38e7fe-9922-48e8-82b3-fe9fe70ea1cb` quedaron ACTIVE; Worker arrancó su cola Data OS y Studio respondió a `/api/health`. Tras la integración, typecheck/lint 11/11 y pruebas focales Worker/DB 26/26 PASS; las 45 pruebas Studio habían pasado antes del merge sin conflictos.

La prueba real desde Topics de Alexa+ en una pestaña nueva de UAT guardó la solicitud de inmediato, mostró «Se está validando todo el corpus y preparando la revisión» y después «Se necesita una política de gasto vigente». La intención pasó por el Worker en **3.620 s** (`attempt_count=1`, `error_code=policy_required`), en lugar del 502 a los 300 s. El Worker comprobó la vigencia de la política **antes de construir el plan**, por lo que esta prueba sólo acredita el arranque durable y la falla recuperable; no acredita una lectura completa del corpus en el Worker. La verificación posterior de sólo lectura mantuvo **6 admisiones, 2 ejecuciones editoriales, 32 llamadas y 15 claves**: ningún cargo ni envío nuevo. Los 1,652 grupos originales y los resultados previos permanecen consultables. El loop continúa pausado.

## Límite de esta comprobación y siguiente acción

La política UAT de Alexa+ expiró en `2026-09-27T05:59:00Z`; tenía máximo diario y por ejecución de USD 30. Esta prueba **no** certifica la admisión del plan de 80.9 MB ni el envío de Message Batches. Una medición posterior de sólo lectura reconstruyó los 1,652 grupos en 14.6 s y el plan en 1.9 s; transferirlo y parsearlo como JSONB ocupó 7.7 s. La validación SQL completa `signal_topic_editorial_plan_valid_v2` siguió sin respuesta tras aproximadamente dos minutos y se canceló desde el cliente; **no hay resultado de aceptación ni rechazo**. La función recalcula dentro del bucle el digest canónico del mismo contexto: una llamada aislada tardó 89 ms, y 1,652 repeticiones podrían consumir ~147 s. Se ensayó aisladamente mover ese cálculo fuera del bucle, pero la validación real tampoco devolvió resultado durante el plazo observado; el SQL experimental no se aplicó ni quedó en el checkout. Antes de gastar en Batch debe acotarse/medirse la admisión completa y comprobar que termina dentro del lease del Worker. Después se necesita una política nueva y vigente con tope explícito, conservando el ledger y el modelo Sonnet 4.6; reanudar la misma revisión desde Topics y comprobar admisión, envío, importación, cobertura de 1,652 grupos, consolidación y Signal. No declarar la consolidación completa por haber reparado el arranque.
