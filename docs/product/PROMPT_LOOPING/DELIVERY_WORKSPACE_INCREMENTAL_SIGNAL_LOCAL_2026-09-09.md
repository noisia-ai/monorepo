# Actualización incremental hasta Signal — corte local cerrado

Fecha: 2026-09-09T10:33:05.507560+00:00. Commit focal `1c4f506d68bf34d91aed689d391e3f00bddd5496`, encima del consumidor numérico `6640dbb`. SQL0145–0146 siguen locales; UAT permanece147b0fb/SQL0144.

El resultado numérico incremental ahora puede reutilizar interpretaciones pagadas y tópicos editados, clasificar todas las raíces vigentes y reemplazar el resultado de Signal manteniendo la selección explícita. Los grupos emergentes sin interpretación siguen pendientes; no se inventan tópicos, aprobaciones ni precisión. Dos trabajos recuperables usan la cola existente: vinculación de evidencia y clasificación completa. No se repite fit del corpus ni proveedor; se leen seis archivos de metadatos verificados, no el banco numérico completo.

La UI ES/EN conserva el resultado anterior, muestra la actualización real y no sobrescribe borradores. Su polling termina ante errores permanentes, pérdida de acceso o ausencia de trabajo; sólo recupera fallos explícitos de transporte de forma acotada. El nuevo productor de proyección queda apagado hasta comprobar ambas réplicas nuevas.

## Evidencia cerrada

- Copia aislada exacta37 archivos: typecheck11/11, lint11/11, DB235 PASS/75 SKIP, Worker504 PASS/5 SKIP, Query460 PASS, Studio743 PASS/6 SKIP, build Studio PASS.
- PG focal1/1 sin skips, rollback: 3raíces133fragmentos, permisos/censo, edición/archivo, ACK perdido, recuperación acotada y ledger/padres intactos.
- Pruebas numéricas previamente ejecutadas se reutilizan, 62 pruebas focales Worker y16 casos reales del componente; recibos y hashes privados en `.data/workspace-incremental-2026-09-09/`. No P0/P1/P2 residuales.
- Tres drafts ajenos permanecen intactos y excluidos del commit.

## Límite y continuación

No existe aún prueba UAT con una nueva carga real incremental. El trabajo siguiente añade admisión automática sólo después de nuevos embeddings completos y compatibles; no crea un permiso de gasto ni hereda un cap gastado. Nueva carga y preparación pagada deben seguir una acción autorizada. No desplegar producción ni afirmar millones de menciones probadas. National conserva el caso real de32Topics, un tópico seleccionado/63asociaciones y denominador6826 en Signal.

Claude nuevo0; histórico USD1.918865 confirmado +USD1.6818 reserva terminal. Permiso del8sept vencido y sin respuesta a renovación preguntada; Sonnet4.6, no Opus. VoyageUSD0.594449 conservado. Ventana autónoma termina14:47:24UTC; pausar loop y estacionar seguro al final. Historia yCompass conservados.

## Entrega focal en curso

> 9 septiembre10:38:48UTC: SQL0145–0146 aplicado una vez enUAT,30funciones/7triggers verificados y9tablas de datos/costos/selección conhashintacto. Commit1c4f506 enviado sólo a ramaUAT; despliegues aúnporverificar. No repetirSQL. Recibo privado uat-0145-0146-migration-receipt.json. Proveedor nuevo0.
