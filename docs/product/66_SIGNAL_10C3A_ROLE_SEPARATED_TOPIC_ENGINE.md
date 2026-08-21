# Signal 10C.3A — Role-Separated Topic Engine

| Campo | Valor |
|---|---|
| Estado | `operator_diagnostic_review_required` |
| Registrado | `2026-08-21T10:02:00-06:00` (`America/Mexico_City`) |
| Resultado 10C.2C | `no_adoption`, inmutable |
| Holdout | `sealed`, no abierto |
| 10D | bloqueado |
| Providers / remote writes / serving writes | `0 / 0 / 0` |

## Veredicto

10C.3A separa formalmente discovery de propagation y entrega un workbench diagnóstico
reproducible. El candidato `bertopic-bge-detail` sigue siendo **no apto para assignment
full-population** bajo los gates congelados de 10C.2C. Su posible utilidad como generador
de proposals continúa `unknown_for_discovery_proposal_generation` hasta que el operador
complete el packet diagnóstico. Backend no convirtió métricas, similarity, strength o
coherence en autoridad humana.

El resultado anterior no se reinterpretó: hubo cero finalistas congelados, el holdout
sigue sellado y 10D no se abrió. El diagnóstico leyó únicamente el export y los
embeddings/assignments ya abiertos de las seeds 17, 43 y 71. No reexportó datos, no creó
embeddings, no ejecutó candidatos y no escribió bases o serving.

## Autoridad y data flow

```text
Acquisition + ETL
        |
        v
corpus tipado y gobernado
        |
        v
Discovery Engine --------------------> discovery_proposal (pending)
        |                                      |
        | clusters + outliers                  v
        |                              Operator Diagnostic Review
        |                              coherence / distinction /
        |                              merge / split / utility
        |                                      |
        |                                      v
        |                              topic_contract_candidate
        |                                      |
        |                              explicit human/policy authority
        |                                      v
        |                              approved_topic_contract
        |                                      |
        |                                      v
        +----------------------------> Propagation Engine
                                               |
                                      exact / rules / vectors /
                                      calibrated local classifier
                                               |
                                               v
                                      propagation_assignment
                                      resolved / abstained /
                                      exception, append-only
```

| Rol | Estado inicial | Autoridad | Puede crear assignment |
|---|---|---|---|
| `discovery_proposal` | `pending` | evidencia del cluster | no |
| `topic_contract_candidate` | `pending` | acción explícita del operador | no |
| `approved_topic_contract` | `approved` | humano o policy versionada | no por sí solo |
| `propagation_assignment` | `pending/approved/rejected/abstained` | generation de propagation separada | sí, bajo autoridad explícita |

Un cluster ID nunca es un Topic Contract ID. Un outlier es `unassigned` dentro del run de
discovery; no significa `rejected`, `abstained` ni technical error. Las propuestas y los
assignments usan generations distintas. 10C.3A no materializó Topic Contracts o
propagation assignments reales.

## Lineage preservado

El manifest fuente 10C.2C fue verificado antes de leer artifacts:

- manifest 10C.2C: `sha256:9300ea7a0e50870bf2b4dffe58e3e186628b2577692dccf27f5137177bdaed8b`;
- plan conceptual 10C.2: `sha256:8f557769af29f87e89996fd6bc8db3e4fd20e73b96ed21464517eb73244bd736`;
- plan V3 ejecutable: `sha256:53d1e16852bf85bebe93ddb122037d8db0e23cab6b584daa1b160a55c994c462`;
- holdout: `sealed` y `holdout_open_once=not_started`;
- source results, assignment NPZ y embedding NPY: verificados contra result, summary y
  manifest sellados;
- dense matrix `N x N`: no creada.

La reconciliación permanece:

```text
23,296 acquisition roots
= 21,195 modeling roots
+ 2,101 quality excluded roots

21,820 partition memberships
21,195 physical roots
625 shared roots
4 partitions
0 unexplained roots
```

## Diagnóstico de clusters y outliers

### Resultado por seed

| Seed | Clusters | Assigned | Outliers | Coverage | Outlier rate |
|---:|---:|---:|---:|---:|---:|
| 17 | 115 | 11,186 | 10,009 | 0.5278 | 0.4722 |
| 43 | 122 | 10,765 | 10,430 | 0.5079 | 0.4921 |
| 71 | 123 | 11,088 | 10,107 | 0.5231 | 0.4769 |

La estabilidad entre seeds se conserva en el rango ARI `0.5274–0.5697`. El diagnóstico
no presenta stability como aceptación humana.

### Qué explica el outlier rate

El diagnóstico muestra dos hechos, y una hipótesis que 10C.3B deberá contrastar:

1. Los outliers no son uniformemente lejanos. Su similarity mediana al centroide más
   próximo fue `0.7445–0.7459`, mientras el margen mediano entre los dos centroides más
   cercanos fue sólo `0.0169–0.0172`. Parte material del reservoir está cerca de más de
   una región y queda fuera de los density cores.
2. Existe también una cola distante: el p10 de nearest-centroid similarity fue
   `0.6320–0.6323` y los mínimos fueron `0.3811–0.4022`. No es honesto reclasificar todo
   outlier como recuperable.
3. El efecto es desigual. Category observó `35.95–43.69%` outlier; Google Nest
   `50.08–56.91%`; primary `48.79–50.87%`; Apple HomePod `47.01–49.42%`. Las slices EN
   quedaron en `48.20–50.76%` y ES en `44.09–46.07%`.

La explicación causal plausible es la combinación preregistrada de UMAP 8D + HDBSCAN
`leaf`, `min_cluster_size=40` y `min_samples=5`: conserva density cores pero deja
fronteras ambiguas y cola dispersa sin assignment. Esto es una inferencia diagnóstica,
no una causalidad probada. No se introdujo un threshold posterior para etiquetar
outliers como `recoverable`, `noise` o `novel`; 10C.3B deberá preregistrarlo antes de
medir.

### Coherencia, distinción y contractability

La separación media entre cada centroide y su vecino fue `0.0989–0.0996`; los mínimos
fueron `0.0293–0.0391`. Se observaron `17–19` clusters por seed con un vecino cuyo
Jaccard lexical llegó a `>=0.5`, como indicador de posible merge, no como decisión.
Estos números muestran estructura y redundancia potencial, pero no responden si los
clusters son coherentes, distintos o útiles. Esas tres preguntas requieren leer evidencia
representativa y permanecen vacías en el score sheet humano.

El packet de seed 17 cubre los 115 clusters dentro del presupuesto existente, con hasta
ocho excerpts por cluster, medoids, diversidad, boundary y counterexample. Incluye una
muestra separada y acotada de outliers. Distingue counts de población, cluster y muestra;
el texto sólo vive en el artifact privado. Su estado es:

```ini
modeling_decision_allowed=false
adoption_allowed=false
holdout_opened=false
count_scope=full_population_diagnostic
operator_review_complete=false
```

## Métricas por función

| Discovery proposal | Propagation sobre Topic Contract aprobado |
|---|---|
| operator acceptance rate | denominator reconciliation |
| clusters convertibles a contracts | precision / recall / F1 / PR-AUC |
| coherence y neighbor distinction | risk-coverage y abstention |
| redundancy y merge/split burden | false-positive / false-negative rate |
| stability y proposal yield | slices language/scope/platform |
| distribución language/scope | incremental delta e invalidation |
| outlier transparency | supersession, throughput y RAM |

Coverage full-pop es un resultado de propagation. En discovery sirve para describir el
reservoir y el proposal yield, pero no puede decidir por sí sola si un cluster merece
convertirse en contrato.

## Complejidad y escala

El diagnóstico usa embeddings `float32` memory-mapped, lotes de 1,024 y matrices
`batch x K`. Su complejidad es `O(N*K*D + K²*D)` en tiempo y
`O(batch*(D+K) + K*D + N)` en memoria. Queda prohibida una matriz densa `N x N`.

Sobre 21,195 roots observó 3.59 s wall, 3.54 s CPU y 557,481,984 bytes RSS pico. El
target orientativo de 20 minutos / 4 GiB pasó. Las siguientes son extrapolaciones, no SLO:

| Roots | Embedding mmap | Scan con K fijo | Sensibilidad K~sqrt(N) |
|---:|---:|---:|---:|
| 100K | 409.6 MB | 16.95 s | 36.81 s |
| 500K | 2.05 GB | 84.74 s | 411.58 s |
| 2M | 8.19 GB | 338.96 s | 3,292.64 s |

La arquitectura para cientos de miles o millones no ejecuta un LLM por raíz. Discovery
puede operar offline con mmap/shards, candidatos graph o microclusters y un packet
acotado por cluster. Después de aprobación, propagation usa Rule Specs server-owned,
FTS/pg_trgm, búsqueda vectorial o un clasificador local calibrado; aplica incremental por
content/model hash y conserva abstención/exceptions. Los counts autoritativos se
reconcilian desde assignments append-only, no desde muestras de naming.

## Plan 10C.3B propuesto

El plan propuesto vive en
`tools/signal-semantic-lab/config/benchmark-plan-10c3b-proposed.json`, SHA-256
`c50c7336b8f3b0658b589d998f0ed651ac28190f36e329cc39f0be59d79c4eb8`. No está
autorizado y separa dos benchmarks.

### Discovery proposal benchmark

Máximo tres familias dirigidas al fallo observado:

1. BGE-M3 + BERTopic/HDBSCAN como referencia de seed discovery.
2. BGE-M3 + mutual-kNN/Leiden, condicional a decisión de licencia/supply chain.
   `leidenalg` publica GPL-3.0 y depende de igraph/C++; los repos oficiales documentan
   wheels principales y escalamiento, pero Noisia debe aprobar explícitamente esa
   dependencia antes de instalarla.
3. BGE-M3 + vectores L2-normalized + MiniBatchKMeans como challenger de coverage. Es una
   aproximación operable con scikit-learn pinneado, no una afirmación de implementar
   spherical k-means exacto.

El plan compara discovery global multi-scope, partition-aware con alineación posterior e
híbrido. La aceptación humana y todos los thresholds siguen
`operator_decision_required`. No se instaló o ejecutó ninguna dependencia o familia.

Referencias primarias: [leidenalg](https://github.com/vtraag/leidenalg),
[python-igraph installation](https://python.igraph.org/en/latest/install.html),
[MiniBatchKMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.MiniBatchKMeans.html),
[scikit-learn license](https://github.com/scikit-learn/scikit-learn/blob/1.9.0/COPYING) y
[BGE-M3 model card](https://huggingface.co/BAAI/bge-m3).

### Supply chain y operabilidad pendientes

| Familia | Revisión/licencia | Evidencia de plataforma y batch | Estado antes de 10C.3B |
|---|---|---|---|
| BGE-M3 + BERTopic/HDBSCAN | BGE-M3 `5617a9f…`; BERTopic `0.17.4`; HDBSCAN `0.8.44`; MIT/BSD-3 | macOS ARM64 y 21,195 roots observados en 10C.2C; Linux batch aún requiere smoke limpio | Dependencias existentes y pinneadas; ejecución no autorizada |
| BGE-M3 + mutual-kNN/Leiden | Revisión inmutable pendiente; `leidenalg` GPL-3.0 | upstream declara plataformas principales y grafos de millones si caben en memoria; macOS ARM64 específico y batch Linux no están probados por Noisia; compilar desde source exige C++/igraph/libleidenalg | Licencia, revisión y smoke operatorios obligatorios |
| BGE-M3 + MiniBatchKMeans normalizado | BGE-M3 `5617a9f…`; scikit-learn `1.9.0`; BSD-3 | dependencia importada en el entorno 10C.2C y API minibatch disponible; el challenger y Linux batch no fueron ejecutados | Pinneado, pero smoke separado obligatorio |

La presencia de una wheel o un claim upstream no equivale a compatibilidad probada. La
revisión propuesta conserva esos casos como `not_tested` o
`operator_decision_required`; no instaló dependencias, no ejecutó challengers y no
convierte capacidad upstream en un SLO de Noisia.

### Propagation benchmark posterior

No puede comenzar sin Topic Contracts aprobados. Deberá medir denominator,
precision/recall/F1/PR-AUC, risk-coverage, abstention, FP/FN, slices, incrementalidad,
invalidation, supersession y recursos a 100K/500K/2M. No hay thresholds comerciales
inventados: todos requieren decisión operatoria previa.

## Gold set y revisión humana

El contrato local `signal-topic-diagnostic-operator-review-item-v1` sólo acepta evidencia
de train/calibration ya abierta. Cada evento conserva reviewer pseudónimo, timestamp,
candidate/cluster/evidence digests y scores humanos. `merge`, `split` y
`none_acceptable` son first-class; `none_acceptable` no puede crear simultáneamente un
candidate. Un self-score nunca es gold.

La ingestión futura a la autoridad 10B será append-only. El mismo gold podrá evaluar un
clasificador local/SetFit posterior y priorización estilo Cleanlab, pero 10C.3A no escribió
PostgreSQL ni aprobó decisions.

## Implicaciones para gates posteriores

- **10D:** sigue bloqueado. Requiere una decisión técnica válida y autorización separada;
  el candidato rechazado no entra por una ruta lateral.
- **10E:** podrá convertir proposals revisadas en Topic Contract candidates y ofrecer
  naming contextual opcional. No puede convertir cluster IDs en contracts actuales.
- **10F:** será dueño de propagation full-pop/incremental, abstention, invalidation y
  supersession. Discovery no dual-writea assignments.

## Riesgos

| Severidad | Riesgo | Mitigación / gate |
|---|---|---|
| P0 | Confundir cluster con assignment aprobado | Contratos tipados y generation separada; tests negativos |
| P1 | Elegir challenger antes del review humano | Packet completo y 10C.3B sin autorización |
| P1 | Licencia GPL/igraph no aceptada | Challenger Leiden permanece condicional |
| P2 | Outlier reservoir heterogéneo | Preregistrar thresholds y slices antes de etiquetar |
| P2 | 2M embeddings exceden 4 GiB | mmap/sharding; medir el runner real antes de SLO |
| P3 | Representación lexical induce merges falsos | Revisar clusters y vecinos por evidencia, no sólo términos |

## Checklist de decisión del operador

1. Completar score sheet de clusters sin abrir la key hasta terminar el blind review.
2. Evaluar coherence, distinction, nameability, strategic utility, merge, split y
   conversión a contract; permitir `none acceptable`.
3. Revisar por separado la muestra de outliers y decidir si 10C.3B debe preregistrar
   thresholds de frontera o familias temáticas faltantes.
4. Aprobar o rechazar las tres familias, las estrategias global/partition-aware/hybrid y
   la evaluación de licencia Leiden.
5. Fijar thresholds de discovery y propagation antes de autorizar ejecución.
6. Mantener holdout y 10D cerrados durante 10C.3B salvo autorización nueva explícita.

## Anchors de reconciliación documental

Los siguientes archivos ya estaban modificados por otro workstream y 10C.3A no los
sobrescribió ni stageó. Una reconciliación posterior debe insertar, sin borrar historia:

- `31_SIGNAL_PRODUCT_NORTH_STAR.md`: después de **“Checkpoint 10C.2B · authority
  estratégica import-level lista”** (línea observada 1346) y refinar la sección
  **“Decisión De Producto · Cascada Semántica Y Topic Contracts”** (línea 747).
- `55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md`: refinar
  **“Topics & Narratives: Discovery → Contract → Propagation”** / **“Discovery sobre toda
  la población”** (líneas 236/238) y añadir el checkpoint tras Gate 10C (línea 414).
- `56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md`: reconciliar **8.3 Discovery y
  contracts** (línea 527), **10.3 Discovery metrics** (línea 608), Gate 10C/10D/10E/10F
  (líneas 809/842/862/882) y añadir el checkpoint después de 10C.2B (línea 1438).
- `63_NOISIA_V02_CANONICAL_PRODUCT_PROGRAM_AND_DELIVERY_LAYER.md`: refinar
  **Cadena De Inteligencia**, **Rol De BERT Y Modelos Locales** y **Siguiente Decisión**
  (líneas 83/98/261).
- `AGENTS.md` y `docs/product/00_README.md`: indexar este doc cuando el workstream dueño
  reconcilie sus cambios actuales.

## Linear-ready

Project sugerido: **Signal Topic Engine — Role-Separated Discovery & Propagation**.

Issues sugeridos:

1. `10C3-01` — Operator diagnostic review of 115 proposals and outlier reservoir.
2. `10C3-02` — Approve 10C.3B discovery strategies, thresholds and license matrix.
3. `10C3-03` — Implement partition-aware evaluation and cluster alignment challenger.
4. `10C3-04` — Evaluate normalized MiniBatchKMeans coverage challenger.
5. `10C3-05` — Security/license review for mutual-kNN + Leiden/igraph.
6. `10E-01` — Topic Contract candidate control plane from reviewed proposals.
7. `10F-01` — Preregister propagation benchmark from approved Topic Contracts.

## Evidence

Evidence privado:

`.data/signal-semantic-lab/backend-10c3a/run-2026-08-21T100838-0600/`

- manifest sanitizado SHA-256:
  `23e38d262e81132546c568addd0cd5f04079b6f80474f0b741003a8c3bff8360`;
- analytic digest reproducible:
  `sha256:49210fcc68a1ccf455756df0c8450a4e75e800091d0d4b5e83fdc647cce1c81e`;
- packet digest reproducible:
  `sha256:49115e8a14c23c09cb1aad84d2a78a070fb177a80bb4712e161c7161cab3119f`;
- directorio `0700`; siete archivos `0600`;
- replay exacto idempotente y una segunda ejecución limpia produjeron los mismos
  analytic/packet digests;
- Advisor no se ejecutó: `ADVISOR_REVIEWED=false`, coste USD 0.

```ini
SIGNAL_10C2C_TECHNICAL_RESULT=no_adoption
SIGNAL_10C3A_ROLE_SEPARATION_IMPLEMENTED=true
SIGNAL_10C3A_DIAGNOSTIC_PACKET_READY=true
SIGNAL_10C3A_OPERATOR_REVIEW_COMPLETE=false
SIGNAL_10C3B_PREREGISTRATION_READY_FOR_OPERATOR_APPROVAL=true
SIGNAL_10C3B_EXECUTION_AUTHORIZED=false
SIGNAL_10D_READY=false
HOLDOUT_OPENED=false
PRODUCT_PROVIDER_CALLS=0
REMOTE_WRITES=0
SERVING_WRITES=0
```
