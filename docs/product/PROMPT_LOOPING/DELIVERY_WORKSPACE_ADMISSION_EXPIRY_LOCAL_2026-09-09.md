# Diagnóstico de permiso de gasto vencido — corte local, 9 septiembre 2026

Sonnet 4.6 sigue activo en UAT en `948d781`. Este cambio local explica una interrupción por vencimiento de gasto y conserva la recuperación de respuestas pagadas. No renueva permisos ni modifica UAT. El recibo real de Sonnet y el Compass siguen vigentes.

## Cambio comprobado

Antes, una nueva reserva posterior al vencimiento llegaba a la guardia SQL0143 y podía aparecer como `workspace_engine_worker_failed`. Ahora el store comprueba el reloj PostgreSQL, la fecha y la zona del permiso sellado bajo la transacción existente, antes de una nueva reserva o envío. Si demuestra vencimiento devuelve el código existente `workspace_engine_interpretation_daily_authority_expired`.

El Worker reconoce únicamente la clase de error DB con ese código y estado 409 como rechazo anterior al envío. El proveedor exige admisión explícita `true`; un rechazo por vencimiento no envía y conserva el diagnóstico. Un error genérico, una confirmación de COMMIT incierta o un valor malformado siguen siendo incertidumbre: no liberan su reserva por inferencia. La revisión independiente encontró esta frontera entre DB y proveedor y quedó corregida antes del cierre.

La UI ES/EN muestra «permiso de gasto vencido», conserva progreso, recibos y solicitud pendiente, y no ofrece reintento ni otra ejecución para eludir la condición. La disponibilidad de nuevas llamadas también respeta la fecha configurada. Leer y liquidar respuestas ya admitidas sigue permitido, incluso después del vencimiento; no hay llamadas duplicadas. Un fallo histórico genérico no se reclasifica como vencimiento por intuición.

## Validación local

- PostgreSQL focal real: 1 prueba correcta; 12 casos ajenos excluidos. Rechazo de reserva/envío, conservación exacta de ledger/ejecución/presupuesto, recibos recuperables y respuesta admitida que llega después del vencimiento. SQL0143 intacto.
- Studio: 39 pruebas focales y 719 correctas / 6 omitidas en la suite. El primer intento de suite carecía de `DATABASE_URL` y dos módulos no cargaron; repetir con URL de inicialización a localhost:1 corrigió el entorno, sin conexión ni cambio de código ajeno.
- Worker: 356 correctas / 5 omitidas. Incluye DB tipado frente a excepción/clon genérico, valores de admisión malformados y recuperación de recibos pagados con permiso vencido.
- DB: 231 correctas / 68 omitidas. Typecheck y lint raíz: 11/11 tareas correctas cada uno. Lint conserva advertencias anteriores, sin errores.
- Componente real en navegador local: 11 comprobaciones correctas, ES móvil de 390 px y EN escritorio; 7 GET y 0 POST. Progreso 32/357, USD 1.918865 confirmado y USD 1.6818 reservado permanecen visibles. Revisión independiente final: 0 P0/P1/P2 abiertos.

Evidencia privada: `.data/workspace-engine-2026-09-08/admission-expiry-backend-receipt-2026-09-09.md`, `admission-expiry-postgres.log`, `frontend-spending-permission-expired.md` y `.data/workspace-authorization-expired-ui-2026-09-09/`. Los logs finales del orquestador se conservan junto al recibo privado de este corte.

## Límites y continuidad

SQL0143 sigue siendo la última defensa ante la carrera entre comprobar el reloj y escribir; si se cruza el límite en esa ventana, puede permanecer un error genérico. No se convierte todo SQL23514 en vencimiento, porque también puede indicar otros desajustes. No existe una renovación de permiso en este corte y no se reescribe la revisión editorial inmutable.

La ejecución UAT `4c55af5c-e17f-430a-b17d-6771e94bd30e`, dispatch 6, conserva 32/357 unidades, ocho artefactos de interpretación y 15 numéricos, con cero Topics materializados. Claude confirmado USD 1.918865 + reserva terminal histórica USD 1.6818 = exposición USD 3.600665. Voyage USD 0.594449 intacto. El permiso del 8 septiembre México venció a `2026-09-09T06:00:00.000Z`; no hay permiso para nuevos envíos del 9 septiembre.

Sigue pendiente la continuidad autorizada en esta misma ejecución para terminar interpretación, catálogo editable, clasificación, selección y Signal; el incremental automático también sigue abierto. Este diagnóstico está cerrado localmente, pendiente de entrega focal UAT. No repetir imports, embeddings, fit ni SQL/gates cerrados. Los tres drafts de contratos ajenos no forman parte del corte.
