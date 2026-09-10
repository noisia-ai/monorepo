# Continuidad de interpretación desde Topics

9 septiembre 2026, 11:56 UTC. Corte local `72fe14202183509d40f3aed415fb206334d4e901`. Complementa el Compass y el [plan de continuidad](PLAN_INTERPRETATION_CONTINUITY_2026-09-09.md); conserva historia y presupuestos anteriores.

El permiso vencido de una interpretación deja de depender de editar variables de Railway: Topics permite autorizar una continuación con importe máximo y vencimiento, o detener nuevos envíos. La autorización se aplica a la misma ejecución, con su cómputo, modelo Sonnet 4.6, respuestas y costos guardados. Repetir una solicitud aceptada recupera su recibo; no concede otro permiso ni vuelve a enviar trabajo.

## Alcance y límites de producto

- La interfaz muestra el importe disponible, los techos acumulado/diario existentes, la fecha del servidor y su zona. El importe no garantiza completar los grupos pendientes.
- Detener o vencer un permiso impide nuevas reservas/envíos; permite guardar y liquidar respuestas ya admitidas. Una respuesta incierta continúa bloqueando su solicitud, y la reserva terminal histórica conserva su importe.
- La recuperación conserva el error genérico histórico. El servidor comprueba vencimiento y evidencia antes de ofrecer continuación; no convierte cualquier fallo en reintentable.
- La autorización actual exige administrador interno activo y derechos del actor presupuestal original. La política para administradores de clientes sigue pendiente antes de un lanzamiento externo completamente self-service.
- Esta entrega no concede gasto por sí misma, no activa interpretación de unidades incrementales nuevas, no reentrena modelos ni aumenta los límites originales.

## Verificación local cerrada

22 archivos propios, revisión independiente Backend/Worker/Studio sin P0/P1/P2. Composición aislada desde `4de84e5`, dependencias offline con enlaces locales propios y SHA de cada archivo verificado. Typecheck y lint 11/11; DB 236 PASS/79 SKIP, Worker 513 PASS/5 SKIP, Studio 771 PASS/6 SKIP. Query Engine sin cambios conserva su recibo de 460 PASS. Build Studio 83.598 s. El paquete Worker no tiene ESLint configurado; no se presenta el no-op como auditoría ESLint.

PostgreSQL focal del contrato: 1/1 PASS en 3.66 s, con rollback exterior; concurrencia representada por intercalado controlado y savepoints, no por conexiones paralelas. Paquete DDL probado aparte con rollback: ocho funciones, tres triggers, constraint, UUID nullable y FK restrict correctos; diez tablas conservaron sus hashes completos y no se crearon permisos. Las dependencias SQL anteriores sólo se aplicaron dentro del rollback local, sin repetir migraciones UAT.

Frontend: 75 pruebas focales y 22 interacciones de componente real, ES móvil 390/EN escritorio 1280, sin overflow ni errores de consola; capturas inspeccionadas. Transporte y permisos de esas pruebas son locales simulados, no una autorización real.

## Entrega UAT

Al crear este recibo, UAT conserva `4de84e5`/SQL0146. SQL0147 se prepara con SHA `48f97e2faf14e831872142b304dde099f5c256e7d60d776c6f550ccd504de15b`; no debe reaplicarse después de un recibo posterior de instalación. El paquete exige proyecto/entorno/servicio/cut exactos, quiescencia y snapshots previos, bloquea diez tablas, verifica sus hashes y cero punteros de permiso antes del commit. Ante ACK incierto sólo permite inspección de lectura, no repetición automática.

La petición de gasto nuevo sigue sin respuesta. No activar permisos ni cambiar la fecha vencida del 8 septiembre. Claude permanece USD 1.918865 confirmado + USD 1.6818 reservado terminal; Voyage USD 0.594449. Cero envíos nuevos.

Evidencia privada focal: `.data/workspace-admission-2026-09-09/check-receipt.json`, `cut-files.json`, logs `admission-cut-*`, `migration-package-local-receipt.json` y cualquier recibo UAT posterior. Los tres drafts de contratos ajenos permanecen fuera del corte.

## SQL0147 instalado — 11:57 UTC

Paquete final SHA `1609c180c515cc58a68b16eb2a9a2a81f892ab03bfb6d451043707d952b54802`, revisión independiente confirmada. Preflight UAT sin ejecuciones/llamadas/outbox activos. SQL0147 aplicado **una sola vez a las 11:57:05.937 UTC**, ocho funciones/tres triggers y los diez hashes de filas completos comprobados. Cero permisos creados; 15 calls, USD 1.918865 confirmado y USD 1.6818 reservado terminal intactos. No repetir SQL0147.

Corte `72fe142` enviado sólo a la rama UAT; verificar Studio/Worker antes de afirmar runtime entregado. No hay autorización nueva de gasto. Recibos privados: `uat-migration-preflight.json`, `uat-migration-receipt.json` y `migration-package-review-receipt.json`.

## Runtime y UI comprobados — 12:08 UTC

Studio `b89bfcaf-b18a-4ff8-946b-0d8597effc40` y Worker `1f391ea7-4d97-4ecf-ae2d-1bd734e0c767` ejecutan `72fe142`. Ambos recibos reales confirman SQL0147, permiso requerido, fuente elegible, cero operaciones de permiso y cero actividad de ejecución/llamada. Productor numérico y proyección incremental del Worker siguen activos; el deadline antiguo de envío permanece vencido.

Topics muestra «Autorizar y continuar», máximo adicional USD 26.399335 y vencimiento de servidor 10 septiembre 00:00 America/Mexico_City; son la propuesta de autorización y su techo disponible, **no un permiso concedido**. No se hizo clic. Mantiene 32/357 grupos, 32 Topics, confirmados USD 1.918865 y reserva terminal USD 1.6818. La selección de Signal permanece byte a byte.

Navegación real Overview→Topics comprobada con el código nuevo; Overview conserva 7,396 recibidas y 16 archivos. La navegación iniciada durante el despliegue volvió una vez al Dashboard; el ingreso posterior desde National funcionó. Se observó allí que Dashboard todavía consumía totales/prioridades legacy, y se abrió su ajuste focal de coherencia, sin confundirlo con pérdida de datos. Recibo `uat-delivery-receipt.json` y texto privado `uat-topics-ui.txt`.
