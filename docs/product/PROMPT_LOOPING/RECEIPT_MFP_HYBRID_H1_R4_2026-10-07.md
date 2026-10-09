# H1 experimental — revisión 5 (2026-10-09)

**PR #39, draft, sin aprobación ni merge.** Base `develop b2667fc5bec37a66414f23b6e6b275ff82dadbeb`; proveedor evaluado `6f96547d45133daaafd77f88875d4db013e56e14`, export de lectura `c3282a994ad88d44ef1036362f561ccb49c6b232`. Runner/Studio siguen fijados a develop, autodeploy apagado; paquetes aislados. #40 conserva UI, filtro de revisión y procedencia humana.

## Cambio y aceptación técnica

JEV `noul ≥ 0.4` seguido del juez Claude batch existente: todos los conceptos positivos de cada raíz juntos, ≤16 raíces/request, sistema cacheado 1 h y esfuerzo `low`. Desacuerdos → `review_required`, con fuentes/rationale; overrides prevalecen. Selección por workspace y rollback standard requieren CAS; liberar JEV incierto exige confirmación y motivo terminal, mantiene exposición ambigua y no inventa settlement. 0259 inmutable; 0261 independiente de 0260, aplicada una vez. Se retiraron reparadores de incidentes, stamp, fixture policy y transporte Claude propio. **Núcleo H1: 759 líneas**; ~110 hooks compartidos de derechos/admisión/replay/exposición. JEV Ficha/H1 reutilizan transporte de páginas de 200 calls, heartbeat, raw durable y escrituras agrupadas; limitador existente, concurrencia 2.

[CI proveedor](https://github.com/noisia-ai/monorepo/actions/runs/37885654280) y [PG real](https://github.com/noisia-ai/monorepo/actions/runs/37885654192) verdes antes de reanudar. PG: cinco pruebas, cero skips; selección/aislamiento/derechos/revisión/override/CAS/rollback, 340+322, interrupción, replay sin reenvío ni gasto duplicado, lease/unknown, tablas migradas reales. Dos fallos previos (300 s; SQL57014 a 20 s) llevaron a **gpt-6-astra / medium**, sólo aceptación PG: vistas materializadas una vez/page, mismas condiciones. Apply de 340 **1.385 s**, probe **12.204 s**, timeout 20 s. Typecheck 11/11 y focales 14/14 verdes. [PG export](https://github.com/noisia-ai/monorepo/actions/runs/37891739412) verde; [CI export](https://github.com/noisia-ai/monorepo/actions/runs/37891739174) verde.

## Ejecución y costo observado

Corpus completo **1,086 raíces**; proveedor cubrió catálogo de **5 conceptos**, calidad congelada usa **3**. JEV envió 628 raíces; Claude 157 raíces con positivos, 22 requests iniciales + un retry del juez compartido (input íntegro, un concepto, padre con raw y ningún resultado previo para ese par). Todo raw/settled/applied, cero unknown nuevos. Censo final: runs activos/pending/unknown **0/0/0**, tres overrides intactos.

| Proveedor/modelo real | Calls | Input | Output | Cache read | Cache creación 1h | USD nuevo |
|---|---:|---:|---:|---:|---:|---:|
| JEV 1.13.0 | 2,047 | 4,883,750 | 40,940 | 0 | 0 | 0.206153 |
| Sonnet 5.5 batch | 23 | 228,760 | 22,496 | 51,424 | 100,648 | 0.547683 |

**Nuevo: USD 0.753836 / USD 0.694140 por 1,000 raíces**, denominador 1,086, sin prorratear costo a los tres conceptos gold. Cache creación 5m=0. Modelos comprobados en raw (JEV: 1 muestra; Claude: 23), `low`/TTL1h comprobados. Ficha JEV reutilizada **USD 0.183331**, sin llamadas nuevas: contabilidad conjunta **USD 0.937167 / USD 0.862953 por 1,000**. Gasto histórico de membership **USD 2.705168** separado. Dos JEV históricos liberados por rollback dejan **USD 0.000144 de exposición reservada ambigua**, nunca gasto inventado ni cap. Presupuesto orientativo, sin máximo estricto configurado.

Primer tramo ineficiente `3ba50f05`: **36m52s / USD 0.035094 / 831,420 input + 6,800 output**, pausado con 340 settled/raw/applied + 322 reserved. Continuó el mismo run/key a 05:01:56.677Z; JEV cerró 05:37:08.768Z (**35m12s**, pausa 43m18s separada). Ventana de calls 03:42:13–05:51:14Z. Los 340 recibos originales siguen idénticos: SHA completo `c23e7552c46d6754715e5122d6399acaae30104c55dc99158edb1fd2b34a5b03`. Export original de lectura cancelado a 400 s; recuperación blind+censo **6.464 s**, con vistas materializadas y timeout 20 s, conservó filtros/selección. Wrappers privados fallaron antes de consultar por sintaxis y rechazo de PGOPTIONS; guard intacto, recuperación sin overrides ni proveedor.

## Calidad y muestra independiente

Tres conceptos gold: **209 belongs  / 1,620 not_belongs  / 50 review_required**, dos pares históricos sin resolución y tres `agent_assisted` excluidos de denominadores/aciertos. 219/219 spans emitidos son literales; esto **no acredita soporte semántico**. Informe conserva estado `experimental_incomplete_not_approved`.

Muestra privada reproducible de **30 positivos actuales** de 211 candidatos del catálogo 5: orden SHA dentro de concepto y rotación entre conceptos, definición/texto completo/contexto/cita, sin verdict/gold/probabilidad/rationale/aciertos/secretos; permisos 0700/0600. SHA review `0992af28c80fa807f3db59bf958b7a071b9274bad005b5f4ee4a945a7304b714`; trace separado `a0154f33d15c5752e4cf000be0092b1b9eb36fe9acdd5d3cbade6cd107f72a1f`. **Agente independiente nuevo sin historia, sólo ese archivo: 20 supported  / 9 unsupported  / 1 insufficient; cinco casos fronterizos.** Informe privado SHA `01fe270959bcc7d673dce3274c8ff005406c07924f4bd8bfba0dfedd2041290f`. Resultado limitado a esta muestra, no extrapolable a los 211 positivos ni al corpus; no autoevaluación H1 ni nuevas llamadas por el hallazgo. No aprobación de calidad, default ni publicación UAT/producción. Fuentes previas recuperables en `da6158bc` / rama local `codex/h1-r5-preserved-da6158bc`; sus métricas no acreditan esta revisión.
