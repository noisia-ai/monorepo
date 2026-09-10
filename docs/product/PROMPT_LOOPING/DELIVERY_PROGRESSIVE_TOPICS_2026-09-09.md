# Topics progresivos desde evidencia pagada — 9 septiembre 2026

Este corte continúa el Compass y el recorrido self-service. No sustituye la historia ni el análisis inicial: resuelve la distancia entre interpretaciones verificadas guardadas y Topics utilizables. Base UAT `d419d656f2cb6567403b89c0bc1fdc1cd3d2d050`; integración local de 28 archivos. SQL0144 aún no aplicado a este corte documental; verificar las actualizaciones inferiores antes de actuar.

## Resultado de producto

Los checkpoints editoriales ya pagados se incorporan al catálogo principal de la marca con un recibo de cobertura parcial explícito. La clasificación recorre todas las raíces y fragmentos del fit existente: las unidades sin interpretación permanecen pendientes, sin convertirlas en irrelevantes. El usuario puede editar o archivar Topics y regenerar esa proyección con la misma evidencia; también después del cierre final del análisis. El seguimiento en Signal continúa siendo una selección individual explícita.

Una falla de guardado tiene recuperación propia desde Topics, conservando la intención y su recibo. Ese reintento no reanuda interpretación ni necesita nuevo presupuesto Claude. Ediciones y borradores de la UI sobreviven a refrescos del catálogo; los errores de autorización retiran la vista afectada.

El trabajo usa la cola y outbox existentes con un tipo de entrega separado. Su heartbeat, límite de intentos y errores no cambian estado, token o dinero del análisis. Un único análisis con evidencia pagada es dueño de la derivación por workspace; perfil actual y cobertura determinan cuándo hace falta otra proyección. El análisis finalizado conserva su recibo histórico inmutable.

## Verificación local

- PostgreSQL compuesto con stores, drainer y Workers reales: parcial 1/2, censo de tres raíces y 133 fragmentos, edición/archivo, convergencia 2/2, regeneración tras ready, selección explícita, pérdida de respuesta, aislamiento de errores, heartbeat y concurrencia. Transporte de objetos, recibos del proveedor y pertenencias numéricas son simulados; todo quedó en rollback. No prueba calidad semántica ni escala de millones.
- DB: 236 PASS / 70 SKIP. Worker: 364 PASS / 5 SKIP. Studio: 731 PASS / 6 SKIP. Typecheck y lint: 11/11; 13 avisos previos de lint. Los primeros intentos detectaron una unión TypeScript no discriminada (corregida) y dos tests Studio sin DATABASE_URL local (repetidos con valor local, sin acceso remoto).
- Frontend: 33 pruebas focales y 36 comprobaciones de navegador con componentes reales, ES/EN y móvil; transporte local simulado. Incluye respuesta perdida, replay, 403/409/503, borradores, archivo, refresco al cerrar y edición posterior al cierre. Capturas revisadas.
- Revisión independiente cerrada sin P0/P1/P2. Construcción del corte exacto en worktree limpio en curso a este registro; no incluir los tres drafts ajenos.

Evidencia privada en el worktree focal: `.data/workspace-engine-2026-09-08/progress-backend-receipt.md`, `progress-postgres-receipt.json`; `.data/topics-progress-ui-2026-09-09/frontend-receipt.md`; `.data/workspace-engine-progress-2026-09-09/`.

## Orden de entrega UAT

1. Terminar build/checks y commit focal de los 28 archivos, preservando los tres drafts ajenos.
2. Preflight de sólo lectura y SQL0144 una vez, con hash `71b4b2dfb33d75299f6123ee123de58dec54755653dca40fb9d4a1f3788b0827`. Conservar hashes de ledger, ejecuciones, artefactos y outbox existente. No repetir SQL0131–0143.
3. Desplegar commit focal a la rama UAT y verificar Studio y Worker; esperar retiro de réplicas antiguas antes de habilitar `NOISIA_WORKSPACE_TOPIC_PROGRESS_ENABLED=true` sólo en Worker. El flag está false por defecto para evitar que un drainer antiguo tome una entrega derivada como análisis.
4. Observar derivación automática de la ejecución existente, catálogo, clasificación y elección desde UI; comprobar conteos y evidencia en Signal. No hacer otro POST de análisis ni repetir imports, embeddings, fit o Claude.

## Límites y siguiente tramo

La ejecución existente conserva 32/357 unidades al inicio; no existe permiso Claude nuevo y el costo adicional de esta entrega es cero. Confirmado USD 1.918865 + reserva terminal USD 1.6818; Voyage USD 0.594449 intacto. No hay renovación por loop ni Opus.

La cola usa concurrencia configurable (por defecto uno): una entrega derivada no corre mientras otro trabajo ocupa ese único slot. Este corte no demuestra refresco entre todos los lotes de una interpretación larga en curso. No alterar concurrencia o introducir otro motor sin comprobar sus efectos.

La revisión de Signal encontró el siguiente trabajo concreto: Resumen todavía consume el circuito anterior; Topics nativo necesita mostrar cobertura editorial de la misma generación, aprovechar `is_processing` para refresco y retirar citas ante errores de autoridad aunque la respuesta no sea JSON. Se abordará en el siguiente corte de producto usando el mismo reader y endpoint nativos. No declarar el recorrido Signal completo antes de esa aceptación.

La asignación incremental con modelos congelados y descubrimiento de todas las nuevas/cambiadas sigue siendo obligatoria. Su contrato se concreta por separado: la predicción anterior sólo era diagnóstica y no alimentaba las pertenencias publicadas. No confundir automatizar full-fit con cerrar monitorización incremental.

## Corte local cerrado — 07:47 UTC

Commit `8b143835c586edf61b01dc44bdb5f1c21830492c`: 28 archivos focales, build del snapshot exacto PASS. Los tres drafts ajenos conservan sus hashes y quedaron sin commit. Cero proveedores, SQL0144 todavía local; driver UAT en preparación. Frontend continúa Resumen/Topics Signal sobre el mismo reader; el frente computacional comienza el adapter incremental aprobado en cuatro archivos nuevos, separado de esta entrega. No repetir gates del corte cerrado.

## SQL0144 aplicado y verificado — 07:52:37.767 UTC

Preflight readonly y aplicación focal en Studio UAT d419d65; 8 funciones y 3 triggers nuevos, 5 bindings existentes y UNIQUE por tipo de entrega verificados. Hashes globales conservados: 77 filas de ledger, 15 ejecuciones, 475 artefactos y 15 outbox. Verificación readonly posterior al COMMIT PASS; no reaplicar. Misma ejecución failed/dispatch6/32 de357/0Topics, costos USD1.918865+reservaUSD1.6818 y ninguna llamada activa. Productor de progreso todavía deshabilitado. Commit8b14383 enviado para construcción UAT; verificar despliegues antes de habilitarlo. Recibo privado `uat-0144-migration-receipt.json`.

## Primer catálogo real visible — 08:09 UTC

Studio y Worker UAT8b14383 verificados. Activación exclusiva de `NOISIA_WORKSPACE_TOPIC_PROGRESS_ENABLED=true` en Worker, con admisión Claude aún vencida a06:00UTC y concurrencia1. El primer intento de desplegar la variable falló por transporte; la UI recargada confirmó que seguía pendiente y no había despliegue nuevo. Un reintento de ese mismo cambio dejó activo Worker23a6f2c7. SQL0144 no se repitió.

La misma ejecución produjo **32 Topics editables**, visibles en el catálogo autenticado de National. Conserva interpretación32/357, ocho checkpoints pagados y fit original. Incluyen conversaciones coherentes, mixtas e insuficientes; no se afirman32tópicos validados semánticamente. Se inspeccionó «Quejas de servicio al cliente en renta de autos». No se seleccionó ninguno todavía porque la proyección completa de menciones sigue corriendo.

Proyección `dc8758ed-9223-4563-af24-1a58c7bc6ea4`, generación `8de2a60d-4106-4e27-9604-fb4032940638`:76/6826raíces a08:09:06.796UTC,18pertenencias/18raíces a12Topics. El guardado progresivo cerró; asociar el censo completo sigue pendiente. La tasa observada (24raíces08:07:42→7608:09:06) revela un costo serial inadecuado para corpus grandes; Backend investiga perfil local y contrato de páginas durables sin interrumpir esta ejecución ni quitar autorizaciones/censo. Es trabajo de producto pendiente, no prueba de escala completada.

Claude sigue USD1.918865 confirmado +USD1.6818reserva,15recibos y0llamadasinciertas; gasto nuevo0. Recibo privado focal `uat-first-topics-receipt.json`. Resumen Signal nativo y UX de preparación por origen son los siguientes cortes; monitorización incremental permanece abierta.
