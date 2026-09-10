# Recuperar actualizaciones y reutilizar vectores existentes

Corte local `4de84e5c7735d9ef18e66ca66b72f96c0360f2b6`, 23 archivos. Entrega focal UAT enviada el 9 septiembre a las 11:20 UTC aproximadamente; verificar runtime posterior antes de afirmar que está activa. Sin SQL nuevo.

La misma pantalla de Topics permite reintentar una actualización numérica interrumpida usando su ejecución y checkpoints. No dirige esa acción al análisis editorial anterior ni renueva permisos Claude. Una clave aceptada representa un solo despacho incluso si después falla o cambian los datos. GET recupera el recibo perdido, incluidos UUID equivalentes con distintas mayúsculas. Los errores de integridad siguen cerrados; sólo causas explícitas de transporte/almacenamiento habilitan la recuperación.

Datos y fuentes permite reutilizar embeddings cuando la cotización comprobada está completamente cubierta por caché, con importe máximo cero. Funciona con el proveedor desactivado. El servidor vuelve a comprobar plan, derechos, revisión y pasivos bajo los locks existentes; un precio redondeado a cero no basta. No recupera mediante este camino una ejecución pagada antigua con cap mayor que cero.

## Evidencia y revisión

El checkout aislado exacto pasó typecheck y lint 11/11, DB 236 PASS/78 SKIP, Worker 506 PASS/5 SKIP, Studio 758 PASS/6 SKIP y build de Studio (89.99 s). Query no cambió; se conserva su gate previo de 460 pruebas. Los primeros checks Worker omitieron los artefactos numéricos retenidos por faltar los enlaces de fixtures en el checkout: se enlazaron los bytes ya calculados y se repitió únicamente esa suite. No hubo refit.

Los dos gates PostgreSQL nuevos se ejecutaron por separado: recuperación 1/1 y caché 4/4, rollback externo y cero proveedores. Recuperación prueba COMMIT ACK perdido, key ya aceptada después de fallo/cambio de revisión, actor/rights/cap, índice/checkpoint durable y cero IO/proceso al cerrar un checkpoint completo. Caché recorre Worker real con 3 raíces/133 referencias, cap cero, cero fetch/calls y hashes de costos/cache intactos.

Frontend verificó 17 casos de navegador sobre componentes reales con transporte local simulado: doble clic, refresh, ACK perdido antes/después, 403 no JSON, replay, borrador y selección. ES 390 px y EN 1280 px revisados sin desbordamiento. Corrección posterior de UUID equivalente cubre confirmación/replay con prueba focal. Revisión independiente de Backend/Worker y de caché UI; el P2 de UUID se corrigió sin cambiar la identidad editorial legacy. Sin P0/P1/P2 pendientes del corte.

Recibo privado `.data/workspace-incremental-2026-09-09/recovery-cut-check-receipt.json` identifica hashes y pruebas. Se excluyeron los tres drafts ajenos. No se creó ningún child UAT ni carga artificial.

## Límites y siguiente resultado

Recuperar sin repetir Python requiere que el índice de salida sea durable. Un fallo antes de ese índice puede repetir cálculo numérico sin proveedores; la implementación no promete recuperar scratch perdido. La segunda carga real desde la UI sigue pendiente del operador.

La recuperación manual de derivación/proyección incremental agotada aún requiere una acción específica; está descrita en `INCREMENTAL_DELIVERY_NEXT_CUT.md` y no se confunde con retry_numeric. El siguiente corte prioriza renovar un permiso de interpretación desde la misma ejecución en la UI, sin editar Railway cada fecha. Su implementación local no concede un permiso real. Las unidades nacidas en modelos incrementales también requieren un adaptador editorial propio; contrato separado en `INCREMENTAL_EDITORIAL_ADMISSION_CONTRACT_2026-09-09.md`.

Cero proveedores nuevos. Claude USD 1.918865 confirmado + USD 1.6818 de reserva terminal; Voyage USD 0.594449 intacto. Sonnet 4.6, no Opus. Renovación preguntada sin respuesta. Fin de autonomía 14:47:24 UTC, luego parada segura. Compass e historia conservados.

## Entrega UAT verificada — 9 septiembre 11:26 UTC

Studio `f7619694-1640-43e5-9af2-d16081b60eb9` y Worker `fc2f2875-f4c2-42b9-8a7d-c695f607cfd5` ejecutan `4de84e5`. El Worker conserva recovery aprobado, productor/proyección activos y el permiso Claude anterior vencido. SQL0145–0146 intacto. La consulta de sólo lectura posterior confirma cero actividad/candidatos/hijos, 15 recibos y los mismos costos/selección.

Refresh real de Signal confirma 6,826 menciones, 63 en el Topic seleccionado, 1,283 sin grupo estable, 5,333 con conversaciones pendientes y etiqueta de interpretación parcial. La navegación real a Topics confirma el catálogo editable de 32 y progreso de 32/357. No se ejecutó un reintento ni una carga artificial sólo para probar controles. Evidencia privada: `uat-recovery-runtime-receipt.json`.
