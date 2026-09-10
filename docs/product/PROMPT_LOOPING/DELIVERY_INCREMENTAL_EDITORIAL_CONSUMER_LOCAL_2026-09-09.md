# Consumidor editorial incremental — entrega LOCAL, 9 septiembre 2026

Commit `f35d78ce4b4cf756539b7a867a98579ba7e57eb9` sobre `b6da353`, en `/Users/brandhon_o/Downloads/noisia-incremental-editorial-runtime-2026-09-09`. Diecisiete archivos de DB/Worker, sin publicación ni despliegue. UAT permanece Studio/Worker `c8f05b9` y SQL0147. SQL0148 y SQL0149 son únicamente locales.

## Qué conecta

Una ejecución editorial admitida explícitamente ya puede entrar por la cola existente, recuperar su contexto y evidencia, guardar el plan completo de solicitudes Sonnet y procesarlo con el ledger único de costos. Conserva la ejecución numérica, el origen del modelo y los permisos de cada llamada. No vuelve a calcular el corpus ni usa el presupuesto cero de la ejecución numérica para interpretar.

El consumidor verifica todas las unidades y todos los checkpoints antes de una nueva reserva. Las solicitudes tienen bytes, offsets, SHA, costos y límites de lote estables. Una recuperación lee ese plan, sin cambiar los lotes. La respuesta original y una eventual reparación editorial única quedan registradas; una incertidumbre de transporte no se convierte en permiso para repetir el envío.

La cola valida el nombre y la identidad exacta del trabajo. El payload sólo identifica la ejecución; actor, contexto y gasto se leen de DB. Un fallo editorial no se vuelve a despachar automáticamente: la recuperación existente debe devolver el mismo owner y job al estado admisible. El agotamiento de entrega anterior al primer claim tiene una transición comprobada y conserva su causa. Los contadores de entrega se restablecen sólo en la recuperación explícita, manteniendo el límite global de recuperaciones.

Una revocación entre claim y lectura de contexto puede actualizar el permiso leído sin alterar plan, token o identidad. Los recibos pagados conservan su propio permiso original y siguen siendo recuperables sin nuevos envíos. Los errores de setup, claim y ejecución se convierten en códigos seguros antes de persistirse en BullMQ.

## Validación final

- Typecheck y lint 11/11. DB 236 PASS / 82 SKIP. Worker 624 PASS / 7 SKIP.
- Consumidor: 43 pruebas focales; reader de solicitudes: 25. Incluye 513 unidades en 129 lotes, recuperación completa, reparación única y heartbeat durante espera del proveedor simulado.
- PostgreSQL del contrato0149: 1/1 PASS, 9.98 s. Se reutiliza la prueba local con rollback externo; el último ajuste de lectura idempotente elimina una inversión de locks y tiene revisión/TC. No es una prueba de carrera con dos conexiones independientes.
- PostgreSQL de composición: 1/1 PASS con DB real local, archivos reales locales y sender/decoder reales con fetch falso. Una rama recupera un raw settled tras revocación entre claim/context con provider=false y sender que falla si se invoca; conserva call y permiso originales. Otra pierde el ACK después de persistir plan, checkpoint y finish. Son dos envíos HTTP falsos en total, uno por rama independiente; cero proveedores reales. Las ramas y la fixture completa revierten sus mutaciones.
- PostgreSQL del drainer: 1/1 PASS en 0.583 s. Ejecuta el SQL real sobre tablas TEMP de la sesión, con broker Redis falso: recupera ACK perdido sin agregar otro job, excluye owners failed/unknown/ready y conserva fallos de entrega agotados.
- Revisión independiente de Backend/Import y composición Root sin P0/P1/P2 pendientes. Sin cambios de Studio en este corte ni build de UI necesario.

Evidencia privada: `.data/editorial-consumer-2026-09-09/check-receipt.json`, `cut-files.json`, logs PG y suites; `.data/workspace-incremental-editorial-consumer-2026-09-09/RECEIPT.md`, revisiones y freeze. Recibos originales de Backend/Import permanecen en sus worktrees. SQL0149 SHA `a5aa0fa86f77ffb1f1b15cc2d711c39be32235ad94bc0e9876def1eb00966f54`; módulo de ejecución SHA `29f1cbbc7bf84a3be3517100b717803d55de5a54d0ff3cb7614d028c5e5caf82`.

## Límite de entrega y siguiente resultado

Este commit no permite todavía que un usuario termine toda la interpretación incremental. Falta el productor de evidencia desde una revisión numérica real, su preparación y autorización desde Topics, y convertir los nuevos resultados en Topics y una nueva proyección de Signal conservando ediciones/selección. El consumidor termina con editorial_complete:true y analysis_complete:false. No debe desplegarse como un recorrido completo ni abrir una admisión UAT por consola para simularlo.

Las dos conexiones se están delimitando sobre los materializadores, contratos y cola existentes, sin formularios de rúbrica por tópico ni framework adicional. Después deberá comprobarse una segunda carga real por UI. La escala de dos millones y la precisión semántica siguen sin certificarse. Los archivos existentes de National no se repiten.

Claude real permanece USD 1.918865 confirmado + USD 1.6818 de reserva terminal histórica; Voyage USD 0.594449. Cero gasto nuevo y cero permisos UAT. La solicitud de presupuesto sigue sin respuesta; no autorizar por UI ni renovar fechas/env automáticamente.
