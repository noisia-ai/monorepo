# Juez estándar v3 — revisión 12

**Estado:** ambos brazos medidos; revisión ciega pendiente del auditor. **Ninguno se adopta:** ambos pierden más de dos positivos verdaderos del gold. #66 sigue draft; default estándar v1 y serving intactos.

**Contrato y aceptación.** AUDIT §§17.5–17.7: identidades low/medium nuevas, contexto propio ampliado, salvaguardas restauradas, promociones y cashback conforme al fundador. Cobros v5 instalado por funciones de producto con SHA `c6784f2b…aaa8817`, replay y catálogo ajeno intactos. PostgreSQL real verificó admisión, preview, rollback y las mismas **1,086 raíces / 2,757 pares por brazo**, hash `957de70e…0cb2eea`, partición fija y selectores/contextos sin cambios. Seis pruebas focales PASS; código validado por CI486/PG221 y CI525/PG260. Source experimental aislado; runtime compartido sin reemplazo.

| Brazo | Solicitudes / batches | USD observado | USD / 1,000 raíces | USD sin caché, revalorado | Gold TP dev / test |
|---|---:|---:|---:|---:|---:|
| low | 142 / 7 | 1.873591 | 1.725222 | 2.938157 | 24 / 22 |
| medium | 138 / 4 | 2.201052 | 2.026751 | 2.917047 | 25 / 25 |

**Consumo total: USD4.074643**, frente a USD9.373564 estimados. Lecturas de saldo antes de etapas: USD29.32, USD24.73 y USD22.91 al recuperar low; sin compras. La revaloración usa las tarifas existentes verificadas el 12 de octubre; no es gasto observado ni factura. El orden favoreció la caché de low: no se atribuye su menor consumo al esfuerzo.

Tokens entrada / salida / lectura caché / creación caché: low **1,532,829 / 39,038 / 1,166,547 / 43,591**; medium **1,530,558 / 41,999 / 970,534 / 205,960**.

| Brazo | belongs | not_belongs | insufficient | error técnico |
|---|---:|---:|---:|---:|
| low | 240 | 2,492 | 18 | 7 |
| medium | 265 | 2,455 | 19 | 18 |

**Calidad y recuperación.** La actual conserva 55 TP: low pierde nueve y medium cinco; falla la regla ≤2. No se declara precisión ciega. Los errores son salidas inválidas reales, no negativos: low, justificación de 34 palabras; medium, 38 palabras, cuatro citas o concepto no suministrado. No se alteraron prompt, identidad ni parser. Los 280 raw verifican SHA/tamaño y reparse idéntico. Low sufrió una excepción no tipada del driver: se recuperaron 49 respuestas ya emitidas desde raw capturado mediante aceptación PostgreSQL con rollback, liquidación/replay y cero POST; después se enviaron únicamente pendientes. El subtipo original no quedó acreditado. Quedaron cero reservas o llamadas inciertas y procesos terminados. Pared: medium 30m32s más 14m previos; low 74m42s, incluida recuperación operativa.

**Entrega ciega.** 60 positivos y 60 desacuerdos por brazo, excluidos los 120 casos anteriores; 339 citas literales verificadas. ZIP privado en checkout principal, SHA `2d4b44d5…755414a`, sin clave. Traza, IDs, métricas por concepto/intervalos y recuperación quedan bajo `.data/`. Comparación contra v1 histórica con definiciones anteriores: no aísla causalmente el prompt. El auditor revisa; no se hicieron llamadas de revisión.

**Agente:** `mfp_critico`, configuración gpt-6.1-sol/high; backend efectivo y coste Codex sin telemetría independiente.
