# Recibo §13.3 — H1 · 11 octubre 2026

[PR #53](https://github.com/noisia-ai/monorepo/pull/53), `feat/mfp-ws2-citation-quality` → `develop`; sin fusión. Citas por oración, hasta tres fragmentos, soporte JEV y una reparación; errores técnicos separados. **#48–#52** resueltos, V2 intacto. Resultado experimental; sin decisión de ruta por defecto, UAT ni producción.

**Datos y denominadores.** Cuatro v3 confirmadas (§14.2), SHA `312969d1…3e2e2`, cargadas tras aceptación PostgreSQL con rollback/replay. Origen adoptado `9a695132`; equivalentes manuales en evaluación `ba454146`, sin adopción cruzada. Reserva/entrega v2 y dos conceptos ajenos intactos. Ruta `sha256:de2ce272bceebd278253bb3badf19f62199eb66ef050d5eaa092ac998a13284b`: coste **7 conceptos / 1,086 raíces**, calidad **5**, gold **3**. Discovery no integra gold. [Evidencia agregada](EVIDENCE_MFP_H1_R8_2026-10-11.json): identidades, métricas, hashes e historial; material/recibos privados (0700/0600).

**Revisión ciega nueva.** 30 raíces distintas, seis por concepto, solapamiento **0** con las 27 raíces anteriores. Material congelado `4099e41e…07481`; revisión independiente `3536c8fd…89c36`, contexto vacío, sólo material ciego. Pertenencia **27/30 = 90.0%** (1 negativa, 2 insuficientes); cita sustentada y resultado conjunto **26/30 = 86.7%** (1 cita no sustentada, 3 insuficientes); 8 ambigüedades/abstenciones separadas. Reserva 5/6 pertenencia y 5/6 soporte; Cobros 5/6 y 4/6; Atención 5/6 y 5/6; cada discovery 6/6 y 6/6. Son tasas de muestra con asignación igual, sin ponderación poblacional ni recall.

**Gold congelado:** 150 raíces, dev 90 / test 60. Tres vistas JEV/Claude/H1: mismas raíces Claude, pipeline completo y binarios comunes; P/R/F1, estados y denominadores en JSON. Pipeline H1: **TP 42 / FP 0 / FN 15**, siete positivos en revisión excluidos de acierto/error (§10.4); publica **42/64 positivos gold = 65.6%**. Pendientes/errores positivos cuentan FN (§§8.5/9.5).

| Concepto | Recall pipeline dev/test | N Claude dev/test | N binarios comunes dev/test |
|---|---:|---:|---:|
| Reserva/entrega | 73.3% / 75.0% | 14 / 11 | 12 / 11 |
| Cobros | 77.8% / 55.6% | 8 / 5 | 8 / 5 |
| Atención | 100% / 75.0% | 7 / 7 | 5 / 7 |

**Operación.** Cinco conceptos: 182 positivos publicados, literalidad 182/182; revisión **109/2,589 pares = 4.21%**, **96/1,086 raíces = 8.84%**. Total siete: 184 positivos, **111/2,757 revisiones = 4.03%**, 97 raíces. Ocho errores técnicos y 12 pendientes por tres fichas `abstained` fuera de admisión; ninguna llamada omitida. Cobertura de los 1,884 pares gold elegibles, sin cobertura integral del catálogo.

**Coste observado**, sin máximo estricto configurado; presupuesto orientativo. USD **0.989744 nuevo**, **1.173075 incluyendo facets reutilizados**, **1.080180/1,000 raíces**. Caché Claude: 317,856 tokens leídos y 7,392 creados (1 h). Tokens por 1,000 y caché por etapa en el JSON.

| Etapa | Llamadas | Tokens entrada/salida | USD |
|---|---:|---:|---:|
| Facets reutilizados | 1,096 | 4,351,476 / 374,525 | 0.183331 |
| JEV pertenencia | 2,745 | 6,113,242 / 54,900 | 0.258113 |
| Claude confirmación | 41 | 420,868 / 35,413 | 0.642317 |
| JEV cita inicial | 225 | 286,792 / 4,500 | 0.012156 |
| Claude reparación | 3 | 43,176 / 5,872 | 0.074756 |
| JEV cita final | 44 | 56,629 / 880 | 0.002402 |

**Cierre y aceptación.** 3,058 llamadas nuevas liquidadas/aplicadas, exposición **0**, duplicados de solicitud/decisión válida **0**. Cuatro continuaciones de transporte y una reparación. Fallo genérico inicial recuperado con misma clave; aceleración 2→8 con lease nulo/cero transportes, preservando 1,291 recibos. PG probó exclusión exacta y lease/idempotencia; trigger retirado **22:02:46Z**, sin flags/reinicios/despliegue. SQL0262: aplicación única con guard/hash y censos intactos.

Aceptación primero: 45 pruebas focales y 41 eval; typecheck/lint verdes. [PG133](https://github.com/noisia-ai/monorepo/actions/runs/38167517777) y [CI387](https://github.com/noisia-ai/monorepo/actions/runs/38167517670) verdes en `da8d8510`; [checks del HEAD final](https://github.com/noisia-ai/monorepo/pull/53/checks) distinguen PostgreSQL real y CI completo. Estático no sustituye PG. Historial en JSON: PG110 sin `root_id`, PG111 replay NULL, PG116 fixture consumía intentos, CI370 selector; PG117 conservado, límite intacto. Recall: roja FN 1/4, corregida. Lector: PG57014 a 20 s; misma consulta pasó en 108 s con límite 5 min, cero proveedor.

**Procedencia real:** implementador configurado **GPT-6.1-sol/high**; escalamiento focal Astra/medium y revisor nuevo **GPT-6.1-sol/low** heredado, sin ID runtime independiente devuelto. Proveedor: **JEV 1.13.0 / Claude Sonnet 5.5**, esfuerzo low; 45 recibos crudos verificaron modelos (1 JEV + 44 Claude). Driver congelado `c9e7429f`; informe `da8d8510`, lector separado. Juez/gold intactos tras revisión; uso del agente ciego no medido en ledger.
