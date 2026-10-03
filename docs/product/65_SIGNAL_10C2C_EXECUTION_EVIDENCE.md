# Signal 10C.2C — evidencia de ejecución técnica multi-scope

| Campo | Valor |
|---|---|
| Estado | `technical_no_adoption` |
| Registrado | 2026-08-21T03:43:52-06:00 (`America/Mexico_City`) |
| Gate | 10C.2C, hasta `freeze-finalists` |
| Holdout | `sealed` |
| 10D | bloqueado |
| Canon de preregistración | [doc 62](./62_SIGNAL_10C2_MULTISCOPE_PREREGISTRATION.md) |

Este checkpoint conserva la ejecución local reproducible del plan
`signal-local-modeling-benchmark-plan-v3`. No es una adopción de modelo, no abre el
holdout y no autoriza 10D.

## 1. Corpus y autoridad reconciliados

El preflight y el export se ejecutaron una sola vez contra `noisia-staging` dentro de
`REPEATABLE READ READ ONLY`. La transacción no asignó transaction ID de escritura y el
snapshot protegido permaneció igual.

| Invariante | Resultado |
|---|---:|
| Acquisition denominator | 23,296 |
| Modeling roots físicas | 21,195 |
| Quality excluded | 2,101 |
| Memberships | 21,820 |
| Roots multi-scope | 625 |
| Particiones | 4 |
| Roots inexplicadas | 0 |
| Leakage canonical/content | 0 / 0 |

La reconciliación cerró `23,296 = 21,195 + 2,101`. Los digests congelados no
cambiaron:

- population: `sha256:067fe82f4b8010c0207ef5be17ad62dae0e98b70bdc3bb11971b8038af11c149`;
- content: `sha256:76c232dadc63a2f1da659efbdfaed67fdda23bea6308d93e6283bbed60c5e71c`;
- provenance: `sha256:8f4902ef5aca4c049c2655e364dcf6ad38e2fb577d74a690f4cf2607f877b4d8`;
- watermark: `sha256:974107099028dda1694b1d6d761220aa636353bf01516d867d6fb9e83a807da1`;
- rights authority: `sha256:816ded59d915696b7fbe554f34e93e8d8e937cb5f81cbafc9f995a18e79b00b5`.

La distribución física incluida fue 16,074 roots `en` y 5,121 `es`. Las memberships
por mercado declarado fueron 16,348 US y 5,472 MX. El país observado contiene 8,643
valores provider-invalid; se conservan como limitación observada y nunca se sustituyen
por el mercado declarado.

## 2. Autorización y lineage de ejecución

La autorización externa
`signal-local-modeling-execution-authorization-v1` quedó ligada al plan y al export
exactos. Autorizó sólo `smoke`, `calibration` y `full`; declaró provider, remote y
serving writes no autorizados, y mantuvo 10D cerrado. Su replay exacto fue idempotente.

| Artifact | Digest |
|---|---|
| Plan v3 contractual | `sha256:325e0af8098c9eb1df2bc183f80c90227fbeadc94fbd9b319f7a2b64b902a5b4` |
| Plan v3 file | `sha256:53d1e16852bf85bebe93ddb122037d8db0e23cab6b584daa1b160a55c994c462` |
| Plan conceptual original | `sha256:8f557769af29f87e89996fd6bc8db3e4fd20e73b96ed21464517eb73244bd736` |
| Export manifest | `sha256:4244d4227087f28c93ca72946205b9e40cd69c3edd5df118599b1e233d868720` |
| Export JSONL | `sha256:3cf49523ebe80a0044eaac6f03de47c787f62e5908a696519d54288de6c4afd9` |
| Execution authorization | `sha256:004377ed828a36f1518cf2948f8a446ef6edc91e83eb26fd25350b698ee4396d` |
| Modeling harness | `sha256:7cdf30aac6ca5fe138fccd2010c813f67afadec2842b213952e5a21772502bf1` |
| Finalist freeze | `sha256:eaa82c86184171867bd850f3608da59943cb522d1d68cefd95ceb8e7c3b67642` |

El postprocesamiento del reporte quedó sellado por separado después de corregir la
explicación del descarte. No alteró assignments, métricas, stability ni el freeze.

## 3. Resultado por etapa

### Smoke

Smoke usó 1,189 roots. Los cinco candidates terminaron. No hubo parameter drift,
confidence fabricada ni stopword dominance. Sus resultados fueron diagnósticos; no
decidieron adopción.

### Calibration

Calibration usó 4,230 roots sin abrir holdout. Sólo `bertopic-bge-detail` pasó todos los
hard gates:

| Candidate | Macro coverage | Coverage mínima de partición | Topics efectivos | Diversity | Resultado |
|---|---:|---:|---:|---:|---|
| lexical-locale-nmf | 1.0000 | 1.0000 | 32.79 | 0.8383 | referencia; separación no comparable |
| bertopic-e5-balanced | 0.9874 | 0.9585 | 2.28 | 1.0000 | rechazado: topics/largest cluster |
| bertopic-e5-detail | 0.6114 | 0.5225 | 23.35 | 0.6321 | rechazado: Apple HomePod coverage |
| bertopic-bge-balanced | `not_available` | `not_available` | `not_available` | `not_available` | rechazo técnico tipado de representation |
| bertopic-bge-detail | 0.6309 | 0.5993 | 30.18 | 0.5765 | finalista de calibration |

El rechazo técnico de `bertopic-bge-balanced` ocurrió porque c-TF-IDF recibió menos
documentos agregados por topic que el `min_df` preregistrado. El harness no cambió
parámetros: selló un rechazo tipado y reanudable, y continuó la matriz.

### Full multi-seed

Full ejecutó únicamente `bertopic-bge-detail` sobre las 21,195 roots y las seeds
17/43/71.

| Seed | Global coverage | Macro coverage | Coverage mínima de partición | Diversity | Topics efectivos | Largest cluster | Separation | Resultado |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 17 | 0.5278 | 0.5358 | 0.4992 | 0.5241 | 97.36 | 0.0319 | 0.0581 | falla coverage/diversity |
| 43 | 0.5079 | 0.5171 | 0.4309 | 0.5262 | 108.53 | 0.0246 | 0.0596 | falla coverage/diversity/gap |
| 71 | 0.5231 | 0.5171 | 0.4632 | 0.5301 | 107.23 | 0.0287 | 0.0579 | falla coverage/diversity |

La estabilidad sí pasó: frente a seed 17, ARI fue 0.5697/0.5274 y matched assignment
consistency 0.6515/0.6253. Eso no compensa fallar coverage global, coverage por
partición y diversity en las tres seeds.

El embedding full tardó 3,289.93 segundos. Discovery por seed tardó 72.08, 58.03 y
54.20 segundos. El peak RSS observado máximo fue 1,910,226,944 bytes, muy por debajo
del hard cap de 14,495,514,624 bytes. Los artifacts de smoke y calibration fueron cache
hits content-addressed; full produjo un embedding nuevo de 86,814,848 bytes.

## 4. Freeze y decisión

`freeze-finalists` volvió a aplicar gates full por seed y stability. La lista técnica
quedó vacía:

```text
SIGNAL_10C2C_TECHNICAL_RESULT=no_adoption
SIGNAL_10C2_EXECUTION_AUTHORIZED=true
SIGNAL_10C2_EXECUTED=true
SIGNAL_10C2_HOLDOUT_AUTHORIZATION_REQUIRED=false
SIGNAL_10C2_HOLDOUT_OPENED=false
SIGNAL_10D_READY=false
```

No se generó blind packet, no existe ganador y no procede una autorización de holdout.
El siguiente paso de producto es decidir si se preregistra 10C.3 con otros candidates o
representaciones. No se permite llevar este candidate a 10D.

## 5. Correcciones genéricas del harness

La ejecución descubrió y corrigió tres gaps generales, con regresión:

1. un fallo reproducible de representation ahora rechaza sólo el candidate, queda
   tipado, sellado y es reanudable;
2. `freeze-finalists` conserva calibration lineage, pero sólo congela candidates que
   pasan todos los gates full y stability;
3. el reporte técnico pre-holdout ya no exige fabricar un packet; conserva por separado
   los digests del modeling harness y del postprocesamiento.

No cambiaron corpus, candidates, thresholds, seeds, UMAP/HDBSCAN, stop conditions ni
los planes firmados.

## 6. Validación y seguridad

- laboratorio: Ruff green y 59 tests green;
- exporter Studio: 5 tests focales green;
- Studio typecheck: green;
- notebook: ejecutado top-to-bottom desde artifacts guardados;
- holdout: `sealed`;
- provider calls / paid jobs: 0 / 0;
- remote writes / serving writes: 0 / 0;
- production reads/writes: 0 / 0;
- readers, pointers, bindings y read mode: intactos; `legacy` permanece vigente.

El evidence privado permanece gitignored y en modo `0600`; no contiene raw text en
documentación o logs sanitizados.
