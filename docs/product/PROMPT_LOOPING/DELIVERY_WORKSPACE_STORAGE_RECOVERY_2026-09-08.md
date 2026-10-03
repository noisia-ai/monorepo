# Persistencia y recuperación del primer análisis completo

Fecha operativa: 8 septiembre 2026, America/Mexico_City. Base e030a26.

## Hallazgo real y cambio

La solicitud UAT `4c55af5c-e17f-430a-b17d-6771e94bd30e` procesó 6,826 raíces/20,821 fragmentos y cuatro guías. Su manifiesto recuperado registra dos vías de cálculo, abierta y guiada, con 178 grupos cada una, 124.055 segundos y RSS final 1.633 GB. Son grupos computacionales sobre el mismo corpus, no 356 Topics únicos validados ni evidencia de precisión semántica.

Al guardar el resultado falló `workspace_engine_storage_verification_failed`: el bucket privado corpus-files admite application/octet-stream y tipos CSV, pero el adaptador subía su envelope como application/json. Sólo quedó la parte del manifiesto, 4,527 bytes con SHA correcto; el envelope estaba ausente. PostgreSQL confirmó cero artefactos registrados, checkpoints y llamadas Claude. La preparación de contexto ya había terminado por UI con una llamada Voyage/USD0.000128. El corpus Voyage original conserva USD0.594321 sin recomputación.

El adaptador guarda el envelope JSON con transporte application/octet-stream. Conserva sus bytes, tipo lógico, claves inmutables, límites, lectura autenticada y verificación SHA. No cambia permisos ni configuración del bucket. Una prueba aplica exactamente los MIME permitidos y falla antes del cambio, pasando después.

El endpoint existente permite reintentar esta falla sólo cuando no existen checkpoint de fit/análisis, modelo, artefactos ni llamadas al proveedor. PostgreSQL deriva y vuelve a comprobar esa elegibilidad bajo el bloqueo de la ejecución. El cliente no puede otorgarla. Se conservan actor original, derechos, identidad actual de inputs, clave, cap y outbox idempotente. La falla de verificación no entra en la lista global de reintentos. Cada subida y hash vuelven a comprobarse. En este caso hay que repetir el cálculo numérico porque no llegó a guardarse un checkpoint; se reutilizan los embeddings ya pagados.

La UI usa el botón de reintento existente y deja de mostrar como pendiente la cotización original cuando su preparación ya está completada. Mantiene visible el recibo real y permite ver cotizaciones de planes nuevos.

## Verificación

- Transporte: tres pruebas correctas, incluyendo política MIME real, roundtrip con SHA/bytes, replay inmutable, multipart49MiB y límites de ámbito/bucket privado.
- PostgreSQL focal: recuperación de la misma ejecución y replay con una outbox; rechaza artefacto/checkpoint/modelo/reserva/resultado incierto, actor revocado y contexto obsoleto. Tope e inputs idénticos, sin llamadas nuevas.
- Studio: 27 pruebas focales correctas; no nuevo formulario, acción de gasto ni reintento automático.
- Typecheck/lint del monorepo11/11. Revisión independiente cero P0/P1/P2.

Recibos privados en `.data/workspace-engine-2026-09-08/`, incluyendo `uat-storage-failure-receipt.json`. No SQL nuevo, producción, imports, cambios de bucket ni modificación de los tres drafts ajenos. El reintento real y Signal se comprobarán después del despliegue; esta nota no los declara completos.

Suites estándar posteriores al cambio: DB231 PASS/63 SKIP (PG focal aparte), Studio704 PASS/6 SKIP, Worker309 PASS/5 SKIP. Studio usó URL de loopback inactivo únicamente para imports, sin conexión/proveedor.
