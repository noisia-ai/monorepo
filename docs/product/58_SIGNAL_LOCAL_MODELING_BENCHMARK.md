# Signal Local Modeling Benchmark

> **Gate:** 10C
> **Timestamp:** 2026-08-16 (`America/Mexico_City`)
> **Estado:** 10C.0 reconciliado; benchmark correctivo 10C.1 cerrado con
> `no_adoption`; packet diagnóstico pendiente de revisión humana; 10D bloqueado

## tl;dr

Gate 10C evalúa topic discovery local sin convertir el benchmark en runtime ni escribir
en serving. El corpus canónico se exporta desde `noisia-staging` dentro de una transacción
`REPEATABLE READ READ ONLY`, con rights de `llm-processing` revaluados por raíz, aliases
deduplicados y todos los identificadores remotos pseudonimizados. Los textos y embeddings
permanecen en `.data/`, gitignored y con permisos `0600`.

El primer benchmark comparó una referencia TF-IDF+NMF, BERTopic 0.17.4 y FASTopic 1.0.1
sobre dos embeddings multilingual pinneados. Su `no_adoption` sigue siendo válido para
esa matriz: no produjo una pareja de finalistas y por ello no ejecutó full-pop.

10C.1 corrigió representación locale-aware, parámetros efectivos, probability ausente,
telemetría y packets. En el run oficial, BGE-M3 produjo dos finalistas en calibration y
ambos se ejecutaron sobre las 109,056 raíces con seeds 17/43/71. Ninguno pasó los gates
full-seed congelados: balanced incumplió coverage o máximo de topics efectivos en dos
seeds; detail incumplió ambos en los tres. El resultado correctivo también es
`no_adoption`. El packet ciego es diagnóstico, permite `none acceptable`, no permite
adoptar un ganador y no autoriza 10D.

> Los apartados siguientes hasta “Corrective benchmark 10C.0 / 10C.1” conservan la
> evidencia del run inicial. Sus métricas, conteos de tests y paths no deben confundirse
> con el cierre correctivo posterior.

## Context & Methods

### Export y reconciliación

- target exclusivo: `noisia-staging`; producción no fue leída;
- population: canonical roots incluidos, una sola fila por familia canónica;
- provenance: sólo batches `completed` y bindings vigentes;
- rights: quality, retention y licensing vigentes con `llm-processing=allowed`;
- source intent se conserva como lineage y nunca como semantic truth;
- campos privados del provider, URLs, perfiles, autores y `raw_metadata` quedan fuera;
- la identidad de contenido es SHA-256 del UTF-8 exacto exportado;
- el preprocessing de modelado es un contrato separado
  `unicode-nfkc-whitespace-v1`.

La proyección de Semantic Review tenía counts, selección y population idénticos al audit
vivo, pero un digest de governance anterior. El export no reutiliza ese digest: reevalúa
rights por raíz en el mismo snapshot, usa el governance digest vivo y falla si falta
authority. No se reconcilió ni escribió la proyección.

### Datos sellados

| Hecho | Valor |
|---|---:|
| Denominator | 109,056 |
| Exported | 109,056 |
| Excluded | 0 |
| Periodo | 2026-01-01 → 2026-08-13 |
| Timezone | America/Mexico_City |
| Population digest | `sha256:46dcc771…12d03` |
| Watermark digest | `sha256:6a241137…dd8be` |
| Governance digest vivo | `sha256:e8325816…29707` |
| Content digest | `sha256:32af0a79…c3d1` |
| Export file SHA-256 | `sha256:3a9d73a2…9cf07` |

La reconciliación es exacta: `109,056 = 109,056 + 0`. El snapshot protegido fue idéntico
antes y después; `transaction_read_only=on`, no se asignó transaction ID y los receipts
declaran `writes=0`, `jobs=0`, `provider_calls=0`.

### Environment y supply chain

Hardware: Apple M3 Pro arm64, 12 CPU cores y 19,327,352,832 bytes de RAM. El límite
preregistrado es 14,495,514,624 bytes (75%). Python 3.12.13 y `uv.lock` fijan el entorno.
El cache de modelos vive fuera del repo.

| Componente | Revisión/versión | Licencia | Artifact principal |
|---|---|---|---|
| multilingual-e5-small | `614241f622f53c4eeff9890bdc4f31cfecc418b3` | MIT | safetensors `sha256:1a55775f…98477` |
| BGE-M3 | `5617a9f61b028005a4858fdac845db406aefb181` | MIT | ONNX data `sha256:1eebfb28…16b4` |
| BERTopic | 0.17.4 / `75f29105…2cf2` | MIT | source pinneado |
| FASTopic | 1.0.1 / `51150f1a…ed68` | Apache-2.0 | source pinneado |
| UMAP | 0.5.12 | BSD-3-Clause | lockfile |
| HDBSCAN | 0.8.44 | BSD-3-Clause | lockfile |

No se habilita `trust_remote_code`, no se usa revisión flotante y no se descarga código
o datos hacia un servicio externo.

### Preregistration y anti-leakage

La matriz, seeds, hiperparámetros, métricas, gates y orden de selección están en
`tools/signal-semantic-lab/config/benchmark-plan.json`. Smoke usa sólo `train`;
calibration sólo `calibration`; holdout no participa antes de congelar finalistas. Los
splits agrupan por canonical family y content hash, y se verifican programáticamente.

Smoke y la auditoría metodológica previa a calibration produjeron tres enmiendas:

1. el threshold FASTopic 0.35 era incompatible con una simplex de 50 topics y generaba
   abstención artificial de 100%; se fijó en 0.0 y se declara que FASTopic no tiene el
   outlier nativo de densidad de BERTopic;
2. BGE-M3 a 512 tokens excedía el gate de ocho horas en CPU y CoreML terminó con
   `exit 137`; ambos embeddings usan por justicia el mismo envelope de 128 tokens y CPU.
3. la selección por stage usa cuotas proporcionales por mes/scope/idioma/plataforma y
   los gates multi-seed quedaron numéricos antes de observar calibration.

Ninguna enmienda cambió ranking, coverage/diversity gates ni se tomó después de observar
resultados finales. El cache queda ligado a digest de configuración y contenido para que
un artefacto 512-token nunca pueda reutilizarse como 128-token.

## Results

Calibration usó 12,000 registros de su split sellado; holdout no fue tocado. Los gates
exigían coverage ≥ 0.50, diversity ≥ 0.50, 10–200 topics efectivos, RAM ≤ 14.50 GB y
proyección full-pop ≤ 8 h. La baseline lexical es referencia y no candidata automática.

| Candidate | Coverage | Topics efectivos | Diversity | c_npmi | Proyección full | Gate |
|---|---:|---:|---:|---:|---:|---|
| TF-IDF + NMF | 1.0000 | 35.44 | 0.6707 | 0.0803 | 216 s | referencia; pasa |
| BERTopic + E5-small | 0.9935 | 1.17 | 0.7333 | 0.0145 | 1,065 s | falla topics efectivos |
| BERTopic + BGE-M3 | 0.6607 | 24.57 | 0.3756 | 0.0518 | 19,697 s | falla diversity |
| FASTopic + E5-small | `not_available` | `not_available` | `not_available` | `not_available` | > 29,214 s | rejected: runtime lower bound |
| FASTopic + BGE-M3 | `not_available` | `not_available` | `not_available` | `not_available` | > 28,943 s | rejected: runtime lower bound |

FASTopic+E5 fue detenido en época 41/100 después de 3,120 s de discovery; aun suponiendo
cero coste restante, embedding + discovery escalaban a 29,214.49 s. FASTopic+BGE se
detuvo en época 21/100 tras 1,027 s; con su embedding de 2,157.72 s, el lower bound era
28,942.77 s. Ambos exceden 28,800 s. No se observaron métricas de calidad incompletas ni
se usaron para la decisión.

`finalists.state=no_adoption`, `candidate_keys=[]` y `passing_candidate_keys` contiene
únicamente la referencia lexical. Full-pop y estabilidad multi-seed son correctamente
`not_available`: ejecutar full no podía producir la pareja preregistrada y habría gastado
horas sin cambiar el gate. Gold metrics también permanecen `not_available`; no existe un
gold humano comparable para convertir outputs no supervisados en precision/recall/F1.

## Validation

El laboratorio vive en `tools/signal-semantic-lab/` y contiene CLI reproducible,
schemas estrictos, telemetry, métricas, cluster matching, packet ciego, manifest y un
notebook reader-facing. El notebook ejecutó top-to-bottom leyendo métricas guardadas; no
recalcula modelos ni persiste raw text en outputs. El packet ciego usa únicamente el
subset calibration y lo declara explícitamente: sus tamaños no son population counts y
`modeling_decision_allowed=false`.

Validación final:

- entorno creado con `uv sync --frozen --extra dev`; Python 3.12.13 y `uv.lock`;
- Ruff: 0 errores; laboratorio: 12/12 tests;
- exportador Studio: 3/3 tests focales; suite Studio: 363 pass, 1 skip, 0 fail;
- Studio typecheck, build y lint: pass; lint conserva 13 warnings preexistentes y 0
  errores;
- Query Engine: typecheck pass y 285/285 tests;
- DB: typecheck pass, 76 pass y 26 opt-in skips;
- notebook ejecutado top-to-bottom con `nbclient`;
- 23 links locales comprobados, secret scan focal sin hallazgos y
  `git diff --check` pass.

No hubo migración, cambio de schema ni contrato HTTP: PostgreSQL integration y OpenAPI
no aplican a este cambio. El packet privado, score sheet, notebook ejecutado y manifest
viven bajo `.data/signal-semantic-lab/backend-10c/staging-run/`, están gitignored y sus
archivos tienen permisos `0600`. El manifest contiene 47 artefactos y tiene SHA-256
`cab7c79ce…a30b`.

## Takeaways

- Hecho: el export canónico y rights reconciliation son read-only y completos.
- Hecho: el benchmark corre localmente con modelos/artifacts pinneados y sin providers.
- Hecho: ningún candidate elegible produjo una pareja de finalistas operable.
- Inferencia pendiente: el operador puede revisar el packet ciego de diagnóstico y
  aceptar `none acceptable` o solicitar un benchmark nuevo, preregistrado y acotado.
- Decisión: no adoption en este benchmark; ningún modelo queda `approved` ni habilita
  10D. Una review humana no puede convertir este packet de calibration en un ganador.
- 10A.4 permanece pendiente e independiente.

Estados de gate:

- `SIGNAL_10C_TECHNICAL_BENCHMARK_READY_FOR_OPERATOR_REVIEW=true`;
- `SIGNAL_10C_MODELING_DECISION_READY_FOR_10D=false`.

## Safety declaration

- remote writes: `0`;
- production reads/writes: `0`;
- provider calls: `0`;
- paid jobs: `0`;
- serving/classification/record_tags/assertions/populations/bindings/pointers writes: `0`;
- frontend/readers: unchanged;
- commit/push: `0`.

---

## Corrective benchmark 10C.0 / 10C.1

> **Preregistrado:** 2026-08-16T19:49:57-06:00 (`America/Mexico_City`)
> **Plan:** `tools/signal-semantic-lab/config/benchmark-plan-10c1.json`
> **Plan digest:** `sha256:998adb5039c2a4176a6edab3c79b70802cd2c39db4277ff62874178513a34812`
> **Estado final:** `no_adoption`; revisión operator diagnóstica disponible; 10D bloqueado

El resultado anterior permanece íntegro y `technical_no_adoption` sigue siendo correcto
para su matriz. [ADR 016](../adr/016-signal-local-modeling-gate-sequence-and-contextual-naming.md)
corrige la inferencia y el orden de gates: una representación lexical pobre no prueba
que los memberships sean malos; clustering, representación y naming humano se miden por
separado. 10D es Local Semantic Cascade Shadow y 10E contiene Topic Contracts y naming
contextual bounded.

### Preregistration correctiva

El plan se selló antes de ejecutar resultados nuevos. Declara parámetros y parámetros
efectivos idénticos o falla, y declara probability ausente como `not_available`, nunca
`1.0`. La matriz total queda acotada a cinco configuraciones:

| Configuración | Rol | Perfil congelado |
|---|---|---|
| locale-aware TF-IDF + NMF | referencia | 40 topics, ES/EN, 1–3 grams |
| BERTopic + E5-small balanced | candidate | UMAP 30/8, HDBSCAN 80/8 `eom` |
| BERTopic + E5-small detail | candidate | UMAP 15/8, HDBSCAN 40/5 `leaf` |
| BERTopic + BGE-M3 balanced | candidate | UMAP 30/8, HDBSCAN 80/8 `eom` |
| BERTopic + BGE-M3 detail | candidate | UMAP 15/8, HDBSCAN 40/5 `leaf` |

El analyzer y c-TF-IDF comparten `signal-locale-aware-preprocessing-v3`: NFKC,
whitespace y URL controlados, stopwords ES/EN, negación preservada, símbolos/emoji,
comparación de stopwords diacritic-aware, frases 1–3 grams y cero hardcode de `es-MX`.
FASTopic fue excluido antes de observar
10C.1 porque su lower bound medido anterior excede ocho horas; no se reinterpretan sus
métricas incompletas.

Gates: coverage ≥ 0.55; diversity ≥ 0.55; 8–120 effective topics; majority-stopword
topic rate = 0; largest cluster share ≤ 0.40; mean nearest-cluster separation ≥ 0.005;
RAM ≤ 14.50 GB; full-pop ≤ 28,800 s. Full-seed exige ARI ≥ 0.25 y matched assignment
consistency ≥ 0.50 para cada comparación contra seed 17.

### Corpus y alcance real

10C.1 reutiliza por SHA el export gobernado anterior: 109,056/109,056 raíces, content
digest `sha256:32af0a79…c3d1`. No hubo una segunda lectura remota. La evidencia es
single-scope: 109,056 `primary_brand`; por idioma observado contiene 54,801 `es`, 53,786
`en` y 469 en otros códigos, además de 21 plataformas/provider source types. Sirve para
escala, ruido y el slice primary-brand; no prueba category, competitors, reference,
en-GB gobernado ni adopción multi-scope general.

### Calibration v2 invalidada antes de full discovery

La primera calibration correctiva usó 12,000 raíces del split sellado y no abrió
holdout. La auditoría de cierre detectó dos defectos antes de iniciar full discovery:
formas españolas con diacríticos no se comparaban contra sus stopwords normalizadas, y
el content digest escrito en el plan no coincidía con el manifest validado. Por ello el
plan `sha256:45e21889…6ec83` y todos sus resultados son diagnóstico invalidado, no evidencia
de selección. La tabla se conserva para explicar por qué no se reutiliza el veredicto:

| Candidate | Coverage | Effective topics | Diversity | Largest share | Separation | Full estimate | Gate |
|---|---:|---:|---:|---:|---:|---:|---|
| NMF locale-aware | 1.0000 | 28.97 | 0.8567 | 0.1047 | `not_available` | 541 s | reference |
| E5 balanced | 0.9946 | 1.17 | 0.9778 | 0.9697 | 0.0458 | 1,232 s | stopped: collapse |
| E5 detail | 0.5406 | 57.56 | 0.6856 | 0.0404 | 0.0189 | 1,110 s | stopped: coverage |
| BGE balanced | 0.5857 | 24.73 | 0.7556 | 0.0941 | 0.0756 | 19,888 s | finalist |
| BGE detail | 0.5817 | 47.54 | 0.7322 | 0.0814 | 0.0699 | 19,863 s | finalist |

Ningún threshold, candidate, seed, population o embedding cambió. La revisión v3 corrigió
únicamente el contrato de stopwords y selló el content digest exacto
`sha256:32af0a79…c3d1`; cada stage vuelve a comprobarlo. El embedding full-pop BGE es
independiente de la representación lexical y puede reutilizarse por identidad de
contenido, pero los finalistas debían emerger nuevamente de smoke/calibration v3 antes
de ejecutar seeds full-pop.

Una ejecución diagnóstica posterior se detuvo antes de seleccionar finalistas porque
compartía CPU con la materialización del embedding full-pop. Sus tiempos tampoco son
evidencia. El run oficial reejecutó smoke y calibration sin esa contención y selló
además el digest del source del harness; cualquier cambio de código o diferencia
entre parámetros declarados y efectivos falla cerrado.

El lower bound BGE inicial también mostró padding patológico: batches en orden de input
se rellenaban al texto más largo. Antes del run oficial se preregistró batch size 32 y
orden estable por longitud de texto normalizado; los embeddings se restauran a su índice
canónico antes de guardar. La equivalencia numérica contra el cache calibration anterior
es un gate explícito antes de aceptar el full-pop optimizado.

La comparación completa de 12,000 filas confirmó equivalencia dentro de tolerancia
(`cosine min=0.9999998456`, media `1.0000000490`, error absoluto máximo `2.98e-7`) y
redujo embedding de 2,157.72 a 1,554.45 segundos y RSS de 3.609 a 2.254 GB. No cambió
ningún embedding guardado fuera de la tolerancia preregistrada.

### Run oficial 10C.1

Smoke completó 5/5 configuraciones. Calibration v3 usó 12,000 raíces, sin abrir holdout:

| Candidate | Coverage | Topics efectivos | Diversity | c_npmi | Full estimado | Disposición |
|---|---:|---:|---:|---:|---:|---|
| NMF locale-aware | 1.0000 | 28.50 | 0.8533 | 0.0174 | 801 s | referencia |
| E5 balanced | 0.9946 | 1.17 | 0.9778 | -0.1384 | 1,526 s | collapse |
| E5 detail | 0.5406 | 57.56 | 0.6856 | 0.0347 | 1,473 s | coverage |
| BGE balanced | 0.5943 | 24.04 | 0.7402 | 0.0612 | 14,742 s | finalista técnico |
| BGE detail | 0.5831 | 48.14 | 0.7075 | 0.0239 | 14,746 s | finalista técnico |

Los dos finalistas BGE reutilizaron el mismo embedding full-pop sellado de 109,056 ×
1,024 (`sha256:9d6536ec…04ae`). Embedding tardó 13,144.64 s; RSS pico 3.20 GB. Cada
discovery adicional tardó 344–423 s y alcanzó como máximo 6.16 GB, debajo de 14.50 GB y
ocho horas. No hubo stopword-majority topics ni parámetros declarados/efectivos distintos.

| Config / seed | Coverage | Topics efectivos | Topics | Outliers | Diversity | Gate |
|---|---:|---:|---:|---:|---:|---|
| BGE balanced / 17 | 0.5794 | 108.00 | 202 | 45,866 | 0.6449 | pasa individual |
| BGE balanced / 43 | 0.5414 | 132.27 | 211 | 50,014 | 0.6262 | falla coverage y topics |
| BGE balanced / 71 | 0.5871 | 122.63 | 206 | 45,031 | 0.6379 | falla topics |
| BGE detail / 17 | 0.4706 | 383.53 | 478 | 57,729 | 0.5688 | falla coverage y topics |
| BGE detail / 43 | 0.4717 | 398.43 | 493 | 57,610 | 0.5636 | falla coverage y topics |
| BGE detail / 71 | 0.4776 | 392.68 | 492 | 56,972 | 0.5652 | falla coverage y topics |

La estabilidad no rescata los failures: balanced obtuvo ARI 0.6251/0.6372 y assignment
consistency 0.7035/0.7299 contra seed 17; detail obtuvo 0.5841/0.5999 y
0.6458/0.6597. Esas métricas pasan sus mínimos, pero ningún candidato satisface a la vez
los gates de calidad por seed. `denominator=assigned+outlier+technical_error` reconcilia
en las seis ejecuciones; `abstained=0` fue medido y no fabricado.

Antes de selección se detectó y descartó un run que sumaba bytes de artefacto como si
fueran segundos. El contrato ahora suma únicamente campos `*_seconds`, rechaza valores
negativos/no finitos y tiene regression test. El run inválido permanece auditable como
`discarded_before_selection`; no fue reescrito ni usado para decidir.

### Packet ciego y decisión

El packet privado usa un subset determinístico acotado de clusters porque representar
los 680 clusters de ambos candidatos excedía el hard cap de 120,000 tokens. Conserva los
totales reales y declara 91/478 y 86/202 clusters revisados, con 119,871/120,000 tokens;
no presenta el subset como population count. El cambio de packet ocurrió después del
modelado y su lineage sella ambos source digests por separado.

El contrato v3 elimina el nombre ambiguo `reviewed_record_count`: declara
`modeling_scope=full_population`, `modeling_record_count=109056`,
`review_scope=bounded_cluster_subset` y los conteos/porcentajes realmente cubiertos por
candidato. Así, el tamaño de la población modelada nunca se presenta como tamaño del
packet revisado.

El packet y score sheet viven en
`.data/signal-semantic-lab/backend-10c1/staging-run-official-final/operator-review/`.
La revisión permitida es diagnóstica: completar el score sheet sin abrir la key, marcar
`none acceptable` cuando corresponda y, sólo si se solicita otra evaluación, crear un
nuevo benchmark preregistrado. Un resultado humano no puede convertir estos candidatos
que fallaron hard gates en artifact adoptado.

El decision sheet separado usa
`signal-topic-discovery-blind-decision-sheet-v1`, enumera explícitamente
`candidate_preferred|none_acceptable` y conserva reviewer/timestamp sin exponer la key.

### Contexto gobernado y naming futuro

El laboratorio implementa contratos offline estrictos, sin provider:

- `signal-governed-analysis-context-snapshot-v1` proyecta Brand OS, Study OS cuando
  aplica, Acquisition Plan, KB/metodología y Locale Context mediante versiones/digests;
- Signal always-on representa Study OS como `not_applicable`; study-scoped exige Study
  OS real; locale ausente queda `requires_operator_decision`; identity-catalog drift o
  un scope/periodo de Study OS fuera del Acquisition Plan fallan cerrado;
- `signal-adaptive-representative-packet-v1` selecciona determinísticamente hasta dos
  medoids, tres ejemplos diversos, un boundary y un counterexample, máximo ocho y 1,200
  tokens por cluster;
- `signal-governed-context-envelope-v1` exige rights `llm-processing`, evaluación de
  privacidad/PII `passed`, source refs, relevance reason, token budget y digest sellado,
  y compara los digests exactos de Brand OS, Study OS, Acquisition Plan, KB y
  metodología contra el snapshot;
- `signal-closed-claude-topic-proposal-v1` admite nombre, definición, inclusiones,
  exclusiones, refs y flags merge/split/broad/thin, pero rechaza counts, memberships,
  SQL, regex, confidence, promoción o policy expressions;
- la cache futura usa cluster/packet/context/retrieval/model/prompt digests y el preflight
  entero simula costo O(clusters) con model/pricing pinneados, hard cap, calls=0 y
  writes=0.

La proposal Claude pertenece a 10E, es opcional y no se ejecuta en este gate. Un Topic
Contract puede nombrarse manualmente; provider uptime o permiso no son dependencia de
publicación. Narrative sólo puede quedar como hypothesis no aprobada.

El resolver no crea stores nuevos. Reutiliza el Acquisition Brief y sus digests
definidos en
[`query-composer-core.ts`](../../packages/query-engine/src/query-composer-core.ts),
la resolución workspace-owned de
[`signal-acquisition-brief.ts`](../../apps/studio/src/lib/data-os/signal-acquisition-brief.ts)
y las autoridades Brand OS/Study OS/Acquisition Plan existentes en
[`schema/index.ts`](../../infrastructure/db/schema/index.ts). El snapshot es una
proyección contractual del run, no otra base de Brand, Study o Knowledge.

### Evidence final y safety

- report sanitizado: `sha256:6560b60a…3038`;
- notebook ejecutado top-to-bottom: `sha256:57527717…18ea`;
- packet ciego privado: `sha256:b4090a7a…c48d`;
- decision sheet privado: `sha256:f830bca6…5840`;
- manifest sanitizado: 58 archivos privados y 10 artifacts de cache externos,
  `sha256:00042905…02ff`;
- harness de modelado: `sha256:c2f8e123…783e`; postprocesamiento/packet:
  `sha256:d03b1496…ca4e`.

Validación de cierre: `uv sync --frozen --extra dev` verde; Ruff verde; 33/33 tests del
laboratorio; notebook ejecutado top-to-bottom; 19 links locales del canon verificados;
manifest recalculado y sus 58 archivos locales reconciliados por SHA-256/permisos;
secret/PII scan focal sin hallazgos y `git diff --check` verde.

El export sellado se reutilizó sin una nueva lectura de Noisia. Hubo sólo descargas de
artifacts open-source pinneados; `remote_writes=0`, `production_reads_writes=0`,
`provider_calls=0`, `paid_jobs=0`, `serving_writes=0`. No se ejecutó 10D, no se adoptó
un servicio Python y frontend/readers/pointers/bindings permanecieron intactos.

Estados finales:

- `SIGNAL_10C0_CANON_RECONCILED=true`;
- `SIGNAL_10C1_TECHNICAL_RESULT=no_adoption`;
- `SIGNAL_10C1_READY_FOR_OPERATOR_REVIEW=true`;
- `SIGNAL_10C1_READY_FOR_10D=false`.
