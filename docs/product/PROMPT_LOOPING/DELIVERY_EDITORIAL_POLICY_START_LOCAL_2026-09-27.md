# Inicio editorial desde la política vigente — corte LOCAL

Fecha: 2026-09-27

## Decisión de producto

La cotización por corrida no es un estimado de precio: SQL devuelve el máximo de ejecución configurado en la política activa. Ese sello enlaza fuente, política, límite, exposición diaria y caducidad; SQL lo vuelve a validar dentro de la admisión atómica.

Una vez configurada la política del workspace, el usuario inicia la revisión con una sola acción. No tiene que pedir una cotización ni aceptar el mismo límite en cada corrida. Se mantienen los topes configurados por cliente, la reserva y conciliación, los importes reales durante el progreso, la autorización para renovar una ejecución vencida y la reanudación idempotente. Esta ruta V2 no hereda el tope experimental de USD 30.

## Cambio local

- Topics envía sólo `start_editorial`, el ID del control numérico y una clave de idempotencia.
- El servidor recupera primero un recibo V2 existente por workspace/actor/clave. Una respuesta perdida vuelve al mismo dueño y no abre una segunda admisión.
- Para una ejecución nueva, el servidor valida acceso y origen, lee una sola vez el input completo, crea el sello de política internamente y lo presenta a la función SQL que revalida fuente/política/exposición y admite atómicamente.
- La misma petición prepara/reutiliza los manifiestos Message Batches. La política del workspace sigue decidiendo el máximo y el ledger existente registra las reservas/costos.
- La tarjeta Topics ya no solicita cotización ni muestra un checkbox por corrida. Al iniciar, explica que aplica la política de gasto del workspace; el avance sigue mostrando confirmado, reservado, ambiguo y errores.
- Los comandos antiguos de autorización explícita siguen siendo compatibles con ejecuciones V1 guardadas. No se cambió SQL ni se ejecutó proveedor.

## Evidencia y límites

El código anterior exponía dos llamadas web: `GET ?quote=1` cargaba y reconstruía el input; al autorizar, POST volvía a leer el censo/evidencia antes de solicitar la admisión. Para Alexa+ eso vuelve a recorrer hasta 1,652 grupos. La entrada usa hasta dos citas por grupo y el lector consulta referencias en bloques de 128. El nuevo inicio construye input y plan una vez por intento nuevo; una repetición después de una admisión recupera el dueño durable antes de leer evidencia.

Checks locales: typecheck de Studio PASS; lint de Studio PASS con 13 advertencias existentes fuera del cambio; pruebas focales de contrato, clave idempotente, botón ES/EN y ruta start PASS; `git diff --check` PASS. La suite completa no se declaró PASS: una ejecución dejó procesos de test abiertos después de reportar resultados parciales, se interrumpió y luego se ejecutaron las pruebas focales aisladas.

UAT aún no está verificado con este cambio. La sesión anterior de UAT mostró error de conexión PostgreSQL al consultar el estado y la causa del cierre del socket no está establecida. No se hizo un nuevo intento de proveedor, gasto, migración o despliegue en este corte. Próximo paso: resolver/confirmar salud de la conexión, desplegar el corte, comprobar desde Topics que el único CTA inicia la revisión, verificar admisión/manifiestos y recuperación con la misma clave, y sólo entonces dejar que el Worker envíe la ejecución autorizada por la política activa.

## Ensayo privado PostgreSQL — 2026-09-27

El runner privado de `dev-test` ejecutó el fixture positivo rollback-only del contrato Message Batches V2. Recibo: deployment `16527d60-0d22-4090-8bf2-44771b958ccd`, `editorial-message-batches-private-receipt-v2`, `status=passed`, `stage=rollback_verification`, `remote_connected=true`. Pasaron las ocho aserciones: autorización atómica y replay con misma clave; aislamiento de esquema/admisión V1; prosa larga, alias e ítems independientes con precio exacto; materialización completa con evidencia original; acuse de envío perdido, recibo tardío y recolección tras revocación; uso desconocido preserva reserva sin bloquear otro ítem; rechazo HTTP conocido liquida cero y exige intento manual nuevo; y reutilización de checkpoint V1 pagado sin llamadas V2 nuevas. Cero transportes a proveedores. El rollback físico y la verificación posterior de base vacía pasaron. La prueba usó tres raíces y dos grupos sintéticos; no ejercitó concurrencia ni datos reales.

Después del ensayo, el runner volvió al comando `bootstrap-readonly.mjs`, con `NOISIA_EDITORIAL_BATCH_PRIVATE_TEST_APPROVED=false`. Deployment de restauración `4a1d0ad4-8f69-4b22-8a73-7ecf7f8c0f9d` completó y emitió `noi19-private-bootstrap-v1`: sistema esperado, hash de esquema `ff26cd9ba6c0cbe2b8c6e7178b85463a3fa67ecea0f0f91ef672213b0cc3f94b`, 299 tablas, cero tablas con filas, `empty=true`, `read_only=true`. Así queda cerrado el ensayo de contrato privado, no la entrega UAT.

## Recuperación de conexión UAT y siguiente corte

Los reinicios controlados de Studio y Worker en Railway devolvieron lectura de DB. Studio vuelve a consultar Alexa+ desde Topics y conserva los datos anteriores: 1,652 grupos preparados, interpretación antigua parcial de 36/1,652, USD 1.310931 confirmado y USD 0 reservado; sigue mostrando que esa ejecución antigua no terminó. No se inició ninguna corrida nueva. Worker reinició con `Worker runtime preflight passed` y reportó cero unidades reclamables en sus colas de inicio; después del reinicio no aparecieron fallos nuevos en el intervalo observado. Los errores repetidos de conexión registrados antes del reinicio quedan como evidencia histórica. El reinicio recuperó el acceso, pero no demuestra la causa del fallo.

El servicio Studio de Railway está conectado a `codex/noisia-topic-results-uat-2026-09-06`, auto deploy activo. El HEAD local previo coincide con esa rama remota (`7f04771ea8a0d29f738bd27fc44254a025444e4b`). El cambio de inicio V2 sigue sin desplegar. El siguiente corte debe integrar el diff focal, publicar ese avance en la rama UAT ya configurada, confirmar el deployment de Studio y verificar desde Topics el botón único, la respuesta V2, el progreso/recibos durables y la selección de catálogo sin alterar el Signal vigente. No aplicar SQL: este corte no añade migraciones. No iniciar Claude ni Message Batches hasta que la ruta nueva confirme en servidor que la política y su tope están activos; registrar cualquier rechazo con el estado legible en UI. El ensayo sintético no acredita concurrencia, volumen, servicio Claude real ni aceptación semántica en Alexa+.
