# H1 experimental — revisión 5 (2026-10-08)

**PR #39; experimental, sin aprobación ni merge.** Base aprobada `develop b2667fc5bec37a66414f23b6e6b275ff82dadbeb`; código evaluado `3ba50f0507c3b71eea0739570daa385f4bb8a633`. Runner y Studio compartidos permanecen fijados a esa base, con autodeploy apagado. La evaluación nueva corre en un paquete aislado; #40 conserva ownership de UI, filtro de revisión y procedencia humana.

## Cambio verificable

H1 mantiene JEV `noul ≥ 0.4`, seguido del juez Claude batch existente para los positivos: todos los conceptos positivos de cada raíz juntos, hasta 16 raíces por solicitud, sistema en caché 1 h, Sonnet 5.5 y esfuerzo `low`. El desacuerdo queda `review_required` con fuentes y rationale; las correcciones humanas prevalecen. La selección es explícita, por workspace, sin invocar proveedores. Volver a standard exige digest vigente y confirmación de JEV incierto; libera ese estado con motivo terminal, manteniendo exposición ambigua y sin inventar settlement.

0259 permanece inmutable. 0261 agrega exposición terminal separada y permite nuevas decisiones sin stamp derivado; es independiente de 0260/#40 y se aplicó una vez al destino MFP. Se retiraron los reparadores de incidentes, policy de fixture, transporte Claude síncrono y endpoint híbrido propio. Núcleo H1: 753 líneas de producción; los ~110 hooks compartidos mantienen derechos, admisión, replay, exposición y procedencia de resultados. JEV Ficha y H1 comparten el transporte por página de 200 calls, raw durable, settlement y aplicación agrupados; el provider conserva solicitudes individuales y su limitador existente.

## Evidencia y coste

- Typecheck Query Engine, DB y Worker: verde. Pruebas focales de reducer, juez compartido, almacenamiento y errores HTTP 429/529: verdes; éstos conservan raw y no cobran la reserva como gasto observado.
- [CI general](https://github.com/noisia-ai/monorepo/actions/runs/37879797539) y [PostgreSQL migrado](https://github.com/noisia-ai/monorepo/actions/runs/37879797524): verdes en el código evaluado. El gate comprueba selección, aislamiento, derechos, revisión, prioridad humana, CAS, rollback, exposición y replay en tablas reales, sin tablas temporales. Se corrigieron flags del fixture y una expectativa de verdict anterior; no se debilitaron controles.
- Rollback real: standard restaurado antes de la nueva selección H1; dos JEV históricos liberados con motivo terminal, USD 0.000144 de exposición reservada ambigua y cero settlement inventado. El gasto histórico permaneció USD 2.705168 y queda fuera del gasto nuevo.
- El primer tramo se pausó durablemente por escrituras JEV individuales que contradecían §6.3.4: **36 min 52 s, USD 0.035094, 831,420 tokens input / 6,800 output**, 340 settled/raw/applied, 322 reserved y cero unknown. Se conservan run/key y recibos; la continuación espera CI/PG de la corrección por página, incluida prueba real 340+322, interrupción antes de apply, replay sin reenvío y pérdida de lease/unknown.
- Ejecución aislada sobre 1,086 raíces iniciada `2026-10-09T03:41:45Z`; informe final de tokens/caché, coste observado y USD/1,000 pendiente. Presupuesto orientativo; máximo estricto sólo si se configura explícitamente.
- Muestra ciega de 30 positivos con concepto, contexto y cita: pendiente de nueva ejecución. Paquete y trace privados, selección reproducible y SHA; revisión independiente sin verdict, gold ni rationale.

## Límites

Las métricas previas corresponden al transporte síncrono histórico y no acreditan esta revisión. Sus fuentes se recuperan en `da6158bcf154ed2834ef70444aac0e965be5ad00` (rama local preservada `codex/h1-r5-preserved-da6158bc`). La verificación literal de spans no demuestra soporte semántico. No se declara 260/260 soporte, aceptación de calidad, publicación UAT/producción ni cambio del default.
