# H1 · revisión 10 · recibo

[PR58](https://github.com/noisia-ai/monorepo/pull/58), base `develop` `50fd0ecd`. **Comparación terminada; propuesta: conservar estándar y pausar H1 hasta una idea nueva.** No fusionado ni desplegado; default global intacto. Workspace de evaluación restaurado a estándar, guard temporal retirado tras aceptación PostgreSQL con rollback/preimagen; censos leases/transportes/incertidumbre/liquidación pendiente=0, ledger intacto. Los 12 pares antes abstained cerraron `not_belongs`, con mismos IDs/key y respuesta liquidada/aplicada.

Aceptación primero, cambio mínimo: cuatro P2 cubren reuso C y retry sólo V técnico, reservas compuestas, conciliación raw antes de liberar y visibilidad ES/EN. SQL0267 aplicado una vez; ventanas de oraciones conservan offsets absolutos y tres intentos por ventana. `hybrid_settled_receipt_required` detuvo aplicación de 78 C ya pagados: writer obtiene procedencia JEV compatible de DB sin debilitar fences. PG172 reprodujo rojo; PG173/174 corrigieron únicamente fixtures de span y desacuerdo JEV+/C− (`review_required`). Reaplicación RAW conservó requests/usage/ledger, **sin repetir C**. V30 → reparación C20 → V final6 terminaron.

1,086 raíces, mismas definiciones v3 confirmadas; Reserva/entrega v2 y dos conceptos ajenos preservados. **Costo siete conceptos; calidad cinco; gold tres**, dev90/test60 previamente expuesto. Barrido gratuito dev `.30/.35/.40`: F1 .90625/.920635/.885246; elegido `.35` sólo en dev. Test JEV TP30/FP1/FN1, P/R/F1=.967742, Wilson inferior=.838059; no acredita calibración.

Revisor nuevo ciego: 60 positivos por ruta, estratificados; raíces distintas dentro de cada ruta, exclusión de 57 raíces R7/R9, 31 coincidencias entre rutas tratadas como correlacionadas. Insufficient permanece abstención; precisión primaria usa todos los casos, ambigüedad separada.

| Muestra | Estándar correcto / citas | H1 correcto / citas |
|---|---:|---:|
| Gold tres | 36/50 / 36/50 | 47/51 / 47/51 |
| Discovery dos | 7/10 / 6/10 | 9/9 / 9/9 |
| Calidad cinco | 43/60 / 42/60 | 56/60 / 56/60 |

Gold precisión Wilson95%: estándar72.0% [58.3,82.5]; H1 **92.2% [81.5,96.9]**, punto≥90 pasa. Recall test H1 **77.8% vs90.3%**, −12.54pp: falla tolerancia3pp; exención review §10.4, publicación21/31 vs28/31. Review H1 **137/1,086=126.2/1,000**, falla≤50. H112 errores técnicos (evidence_invalid5/schema_invalid6/incomplete_single_root1), todos en raíces largas; no negativas ni pending. Estándar25 errores. Ventanas no eliminaron fallos de salida.

| USD observados | Estándar ledger / revalorado | H1 ledger / revalorado |
|---|---:|---:|
| Marginal nuevo | 2.296867 / 2.247372 | .515050 / .515050 |
| Fuentes únicas utilizadas | 3.998970 / 3.923556 | 1.654968 / 1.639798 |

Costo revalorado/1,000: **3.612851 vs1.509943**, H1=41.79%: pasa≤50%. Ambas rutas reutilizan las mismas facetas JEV; reconstrucción de fuente observada, sin acreditar benchmark nuevo frío. Ledger histórico sin reescribir; [tarifa Sonnet5.5](https://platform.claude.com/docs/en/about-claude/pricing) cache-hit5%, Batch50%. CompraUSD20/saldo inicial17.43 separado del consumo.

Implementador configurado GPT-6.1-sol/high; estándar Sonnet5.5/medium, H1 Sonnet5.5/low + JEV1.13.0. Revisor configurado GPT-6.1-sol/medium, seis ejecuciones aisladas: IDs y usage en [evidencia agregada](EVIDENCE_MFP_H1_R10_2026-10-12.json), incluidos tres vistas gold, tokens/costo por etapa, intervalos por concepto, hashes y revisiones focales Astra/medium. Modelo backend no acreditado independientemente; costo monetario Codex no observable, usage registrado aparte. [CI429](https://github.com/noisia-ai/monorepo/actions/runs/38226138771)/[PG175](https://github.com/noisia-ai/monorepo/actions/runs/38226138748) verdes sobre producto `b2a4c4e`; [checks finales](https://github.com/noisia-ai/monorepo/pull/58/checks). PG acredita semántica/ledger; estática no lo sustituye. Evidencia fallida conservada sin inflar cobertura.
