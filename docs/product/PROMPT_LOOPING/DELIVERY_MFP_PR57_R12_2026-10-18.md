# PR #57 · revisión 12 · recorrido R10 en dev-test

**Resultado real, 18-oct 18:54 UTC.** R10 completó por UI load1 → fichas → descubrimiento → pertenencia → revisión editorial → Signal → load2 → delta → temas nuevos → adopción → Signal actualizado. Signal sirve cuatro conceptos con 14/9/11/225 asociaciones, 235 raíces únicas de 1,101; 647 relevantes y 412 sin concepto. La UI final confirmó Categoría225/20.4% y el panel de235 menciones únicas. Calidad `not_calibrated`: esto acredita funcionamiento, no aceptación del etiquetador ni producción. Rige spec v1.3 y auditoría §§16–18, opción B: queda la QA final del fundador. Agente `mfp_estandar`, configurado `gpt-6.1-sol`/`medium`; modelo efectivo no verificable desde la herramienta.

**Cambio y recuperación.** El escritor gratuito recuperó nueve raws pagados sin repetir 791 fichas. Dos replays UI repararon tres decisiones iniciales y una del delta sin llamadas ni liquidaciones nuevas. El último rationale tenía 37 palabras: V1 admite ahora hasta 60 de entrada y normaliza a 30 sólo la presentación, con hashes antes/después; V2 conserva su límite medido de 33. Identidad, prompt, veredicto y citas no cambian. El replay verifica autoridad/contexto/versión, ejecución terminal y recibo SHA/tamaño/custom_id; escritura por lotes y procedencia atómicas, sin capacidad de proveedor. Correcciones humanas prevalecen.

**Pruebas y entrega.** Aceptación escrita primero: [PG261 RED](https://github.com/noisia-ai/monorepo/actions/runs/39154736570), 24 PASS/1 FAIL, `membership_replay_target_invalid` con 37 palabras. Tras el cambio: [CI527 SUCCESS](https://github.com/noisia-ai/monorepo/actions/runs/39154951638), build Studio/suites/typecheck/lint; [PG262 SUCCESS](https://github.com/noisia-ai/monorepo/actions/runs/39154951655), PostgreSQL17 migrado, 25 PASS/0 FAIL/0 skip. Comprueba SELECT canónico 0268, decisiones/calls/vista, repetición no-op, rollback, drift, override y dinero intactos; parser rechaza >60 y semántica inválida. Pin pareado `0e84ddf6`, Studio/Runner SUCCESS, 40/38 hashes y siete variables por servicio, réplica1, autodeploy OFF, HTTP200. Respaldo `5cfbd2d4`; sin rollback ni SQL repetido. R4/R8 y censo pre/post idénticos; estándar sigue por defecto. #57 draft, sin fusionar; UAT/producción y guía del auditor intactos.

**Evidencia funcional.** Load1 terminó 901 fichas; descubrimiento 527 raíces/23 grupos. Editorial inicial produjo cero conceptos adoptables, coherente con respuestas: no se inventó adopción. Load2 recibió 250 filas: 220 incluidas, 29 duplicadas, una excluida y veinte revisiones. Vectores reutilizaron 4,063 asset/chunk y crearon 840; fichas procesaron 201 (181 nuevas +20 revisadas), conservaron 900 vigentes y hashes de 901 labels físicas previas. Total: 1,014 labeled +87 abstained. Delta y proyecciones gratuitos terminaron; diez grupos nuevos interpretados dieron nueve candidatos. Once citas verificadas contra assets/SHA sustentaron adoptar una propuesta sectorial como Categoría por UI. Pertenencia final procesó sólo 578 pares, conservando 147 vigentes: 185 calls/dos Batches, 18m14.280s; replay gratuito dejó 725 pares, 259 belongs/454 not_belongs/12 insufficient, cero errores/pendientes. Override y fichas intactos; Signal actualizado sin otra ejecución.

**Medición cliente.** Reviews 901→73: 14.061s. Rechazo humano justificado: 3.668s y Signal Reserva12→11 sin otro run. Medidos por CUA sobre `5cfbd2d4`; interfaz/SQL conservados en pin final, no SLO general. Duraciones y cada control pagado están en la lista factual.

| Etapa | USD observados/liquidados |
|---|---:|
| Vectores load1 | 0.132160 |
| Fichas anteriores, incluido replay9 gratuito | 2.838194 |
| Recuperación101 | 0.391729 |
| Descubrimiento | 0.809574 |
| Pertenencia inicial, incluido replay3 gratuito | 0.336086 |
| Editorial | 0.304142 |
| Vectores load2 | 0.027357 |
| Fichas delta201 | 0.865560 |
| Interpretación diez grupos nuevos | 0.513519 |
| Pertenencia delta, incluido replay1 gratuito | 2.393363 |
| **Total** | **8.611684** |

**Costo y límites.** Saldo leído antes de cada etapa: Claude32.54/32.15/31.34/31.00/30.70/29.83/27.12 USD; Voyage149,892,300 tokens gratuitos cubrieron la cota delta4,133,529. Tokens delta reales227,790; su USD0.027357 es valoración de uso cubierta por franquicia. Última pertenencia: 1,822,929 input/42,401 output/556,467 cache-read/165,282 cache-creation; quote2.816596 frente a real2.393363. Ledger etiquetado6.824932 es subalcance del total, no cifra alternativa. Reservas no son consumo; presupuestos orientativos, ninguna compra en este carril. Evidencia privada, hashes y recuperación en `.data/front5-qa/r10/`.
