# H1 experimental — revisión 5 (2026-10-08)

**PR #39; experimental, sin aprobación ni merge.** Base aprobada `develop b2667fc5bec37a66414f23b6e6b275ff82dadbeb`. Runner y Studio compartidos permanecen fijados a esa base, con autodeploy apagado. La evaluación nueva se ejecutará aislada. #40 conserva ownership de UI, filtro de revisión y procedencia humana.

## Cambio verificable

H1 mantiene JEV `noul ≥ 0.4`, seguido del juez Claude batch existente para los positivos: todos los conceptos positivos de cada raíz juntos, hasta 16 raíces por solicitud, sistema en caché 1 h, Sonnet 5.5 y esfuerzo `low`. El desacuerdo queda `review_required` con fuentes y rationale; las correcciones humanas prevalecen. La selección es explícita, por workspace, sin invocar proveedores. Volver a standard exige digest vigente y confirmación de JEV incierto; libera ese estado con motivo terminal, manteniendo exposición ambigua y sin inventar settlement.

0259 permanece inmutable. 0261 agrega exposición terminal separada y permite nuevas decisiones sin stamp derivado; es independiente de 0260/#40. Se retiraron del producto los reparadores de incidentes, policy de fixture, transporte Claude síncrono y endpoint híbrido propio.

## Evidencia y coste

- Typecheck Query Engine, DB y Worker: verde. Pruebas focales de reducer, juez compartido, almacenamiento y errores HTTP 429/529: verdes; éstos conservan raw y no cobran la reserva como gasto observado.
- PostgreSQL migrado real y CI general: pendientes en el HEAD de revisión 5. El gate comprueba selección, aislamiento, derechos, revisión, prioridad humana, CAS, rollback, exposición y replay en tablas de producción, sin tablas temporales.
- Nuevo experimento de 1,086 raíces, tokens/caché, coste observado y USD/1,000: pendiente. Presupuesto orientativo; máximo estricto sólo si se configura explícitamente.
- Muestra ciega de 30 positivos con concepto, contexto y cita: pendiente de nueva ejecución. Paquete y trace privados, selección reproducible y SHA; revisión independiente sin verdict, gold ni rationale.

## Límites

Las métricas previas corresponden al transporte síncrono histórico y no acreditan esta revisión. Sus fuentes se recuperan en `da6158bcf154ed2834ef70444aac0e965be5ad00` (rama local preservada `codex/h1-r5-preserved-da6158bc`). La verificación literal de spans no demuestra soporte semántico. No se declara 260/260 soporte, aceptación de calidad, publicación UAT/producción ni cambio del default.
