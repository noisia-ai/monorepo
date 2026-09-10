# Recuperar entrega incremental desde Topics

9 septiembre 2026, 12:28 UTC. Corte `0a80532e58efbb4de6a9387fb72524a95fbe9256`, verificado en Studio y Worker UAT. Amplía el Compass y las entregas incrementales previas sin repetir el cómputo pagado.

Una entrega interrumpida después de completar el cálculo conserva su salida numérica, catálogo, cursor y selección. Topics ofrece reintentar la entrega exacta cuando el servidor comprueba que el fallo admite recuperación. La solicitud repetida conserva su recibo; no abre otra clasificación ni concede gasto Claude. Fallos permanentes, fuentes obsoletas, permisos cambiados y ausencia de una primera entrega siguen sin admitir ese reintento.

El servidor elige la etapa pendiente desde la evidencia durable. Derivación conserva el trabajo sellado; proyección puede recuperar la misma generación y prefijo guardado con un nuevo despacho. Sólo dos causas de transporte comprobadas admiten recuperación. Las respuestas inciertas no se convierten en permiso para duplicar trabajo.

## Comprobación

13 archivos focales, sin SQL nuevo. Composición desde72fe142: typecheck/lint11/11, DB236PASS80SKIP, Worker514PASS5SKIP, Studio777PASS6SKIP, build87.911s. Query Engine sin cambios conserva460PASS. PostgreSQL focal1/1PASS7.824s, rollback exterior y ACK perdido simulado después de savepoint local; no se presenta como desconexión real ni prueba de concurrencia paralela. Frontend71 pruebas focales/22 interacciones de componente real, ES390/EN1280. Revisión Root/Backend independiente sin P0/P1/P2.

Worker UAT `8208c405-b888-4761-8a0a-24a5b5607f32` y Studio `e3ec5e8b-2c98-4728-8ffe-4ed4a2a8bf99` ejecutan0a80532. Lectura real: cero ejecuciones/llamadas/outbox activos, SQL0145–0147 intacto, cero permisos creados. Se conservan32Topics,32/357unidades y el Topic seleccionado con63asociaciones. El caso de falla incremental nuevo se probó localmente; no hay un hijo numérico real UAT ni se fabricó una segunda importación para mostrar el botón.

Claude permanece USD1.918865 confirmado +USD1.6818 reserva terminal, VoyageUSD0.594449. Cero envíos nuevos. La autorización de gasto sigue pendiente de respuesta; no pulsar Autorizar y continuar ni renovar variables por loop.

Evidencia privada focal: `.data/workspace-delivery-recovery-2026-09-09/check-receipt.json`, recibos runtime Studio/Worker, `uat-delivery-receipt.json`, `uat-topics-ui.txt` y pruebas/revisiones referidas. Los tres drafts ajenos permanecen fuera del corte. La interpretación de nuevas unidades incrementales sigue LOCAL incompleta, y la aceptación con otra carga real por UI queda pendiente.
