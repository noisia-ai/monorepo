# Signal 10C.2 — Preregistración multi-scope Amazon Alexa

| Campo | Valor |
|---|---|
| Estado | `preregistered_not_executed` |
| Registrado | `2026-08-20T09:38:00-06:00` (`America/Mexico_City`) |
| Evidencia | Noisia Preview/UAT + `noisia-staging` |
| Preregistro conceptual firmado | `tools/signal-semantic-lab/config/benchmark-plan-10c2.json` |
| SHA-256 del preregistro original | `8f557769af29f87e89996fd6bc8db3e4fd20e73b96ed21464517eb73244bd736` |
| Normalización ejecutable | `tools/signal-semantic-lab/config/benchmark-plan-10c2-v3.json` |
| SHA-256 del archivo V3 | `53d1e16852bf85bebe93ddb122037d8db0e23cab6b584daa1b160a55c994c462` |
| Digest contractual V3 | `sha256:325e0af8098c9eb1df2bc183f80c90227fbeadc94fbd9b319f7a2b64b902a5b4` |
| 10C.2 ejecutado | `false` |
| 10D listo | `false` |

Este documento congela la pregunta, el corpus, los candidatos y los criterios antes de
observar un resultado 10C.2. No adopta un modelo y no autoriza clustering, embeddings,
providers, serving, readers, pointers, bindings o 10D. El preregistro JSON original es
la fuente firmada de decisiones; el contrato V3 lo normaliza de forma ejecutable sin
cambiar corpus, candidatos, thresholds, seeds o stop conditions.

## 1. Pregunta y resultados permitidos

La pregunta es si un stack local multilingual, reproducible y licenciado puede descubrir
clusters técnicamente coherentes en cuatro particiones gobernadas —marca primaria,
categoría, Google Nest y Apple HomePod— sin permitir que la partición mayor domine la
decisión.

Los únicos resultados válidos son `adopt`, `no_adoption` o `rerun`. Un finalista técnico
no es adopción: requiere review ciego de operador y un ADR separado. Claude, Advisor o
Backend no sustituyen la evaluación humana.

## 2. Corpus congelado

La identidad del corpus es
`signal-acquisition-multiscope-amazon-alexa-2026-08-20-v1`. La referencia pseudónima del
workspace es
`sha256:778a48919d2437fa57549cfd948ea3a8a175b0a68dfa5a6f6b162e211aa98113`.

| Autoridad | Digest |
|---|---|
| Population de Acquisition, 23,296 roots | `sha256:067fe82f4b8010c0207ef5be17ad62dae0e98b70bdc3bb11971b8038af11c149` |
| Contenido normalizado | `sha256:76c232dadc63a2f1da659efbdfaed67fdda23bea6308d93e6283bbed60c5e71c` |
| Provenance import/slot/rights | `sha256:8f4902ef5aca4c049c2655e364dcf6ad38e2fb577d74a690f4cf2607f877b4d8` |
| Watermark aceptado | `sha256:974107099028dda1694b1d6d761220aa636353bf01516d867d6fb9e83a807da1` |
| Semantic projection generation 6 | `sha256:09b2c0222a3fbab2cc2afca5ad11bd793bc0b22ad17b4e00b0e78f95861cfa95` |
| Population incluida de Review, 21,195 roots | `sha256:7f346532145060f8fcb4148c66c964667745cc0d5bdc1e607603b2d19cad1be8` |
| Identity catalog de Review | `sha256:e05d8858434e6c8a2ef6583d8a93925c5d0ba075d8b9947af7c43fb0f9430c1f` |
| Governance de Review | `sha256:7f1e8f46757cdb8c33a5ecaf0fcad756d0d129217bd6996c6ed9ce8ef84bf8f1` |

El denominator de Acquisition es `23,296`: `21,195` roots incluidos y `2,101`
excluidos por quality. La exclusión no borra roots de denominator o lineage. El futuro
export read-only vuelve a comprobar provenance, retention y licensing.

### 2.1 Particiones exactas

| Scope/entity | Total | Incluidos | Excluidos | Population digest | Modeling digest | Mercado declarado |
|---|---:|---:|---:|---|---|---|
| `primary_brand` | 4,193 | 3,277 | 916 | `sha256:51565dfd8acb63f3799efa2d9b8d0cc727c475c0d2091fb4564f9509fc2b13c9` | `sha256:c3610f9b05c80f04591296bf9d804f5a86a5fc7232cf5c83cbd33bf0f67509bc` | MX |
| `category` / Asistentes de voz y bocinas inteligentes | 2,242 | 2,195 | 47 | `sha256:53606249457ef862796013b63a45a6a44e6d5c2c3a6ca2930c010ebec93fa067` | `sha256:eafb71336b3f18018db266e64f848d22f8a0a29f3f1a7728059329420794434c` | MX |
| `competitor` / Google Nest | 2,870 | 2,662 | 208 | `sha256:c934b156f4a55adae3182a3abe2077cfdac9342a8cbb286581365104ee9452c9` | `sha256:9b056b9b48922cc30015cd7a73f3ffd0d8b95fae64b43fe72b4df0f51b35fab8` | US |
| `competitor` / Apple HomePod | 14,678 | 13,686 | 992 | `sha256:e8baccc4eeb7c331fdd4cded9731b6e9753e6a98c016a894e3d4ffdc5770895b` | `sha256:ef94244a56ea08654829f01e40cb52a258575e02d52a46cada92b553a3de2e6f` | US |

Las particiones se solapan en canonical roots. Sus totales no se suman para producir el
denominator global. Un root se cuenta una vez globalmente y conserva el mismo split en
todas sus particiones. El smoke category histórico de 408 filas permanece aceptado; sus
389 memberships son subset de los 2,242 roots category finales.

### 2.2 Periodo, idiomas y mercados

- Timezone sellada: `America/Mexico_City`.
- Periodo observado local: `2025-12-31`–`2026-08-11`.
- Idiomas observados: `en=17,243`, `es=6,053`.
- Mercados declarados por operador: MX para primary/category y US para competitors.
- País observado no es mercado declarado: `unknown=10,577`, `US=7,794`, `ES=1,333`,
  `MX=1,124`, `IN=452`, `GB=401`, otros `1,615`.
- El filename no acredita scope o mercado; plan, slot, batch y provenance son autoridad.

El `31 dic 2025` es un observado local válido: timestamps UTC de las primeras menciones
caen en el día anterior al proyectarse a `America/Mexico_City`. El periodo declarado
continúa comenzando el `1 ene 2026`; se conservan ambos hechos sin reescribir datos.

## 3. Invariantes de adquisición

Los cinco batches aceptados —cuatro del corpus autorizado y el smoke category previo—
tienen exactamente un sync run, una invalidación de aceptación y un outbox completed sin
lease. Los cuatro imports nuevos cumplen:

- `records = included + excluded + duplicates`;
- typed observations y memberships reconciliados;
- incomplete-only y unknown source intent iguales a cero;
- Query Evidence V2 `unavailable/historical_export`, query nula;
- rights, provenance binding y retention sellados;
- source intent derivado del slot, `pending/not_eligible`;
- cero contaminación cross-slot y cero roots inexplicadas.

No se fabricó `provider_verified`, no se generó query y query evidence no otorgó semantic
approval.

## 4. Sampling, splits y gold

La calibración estratifica por scope, entity, language, mercado declarado, mes y
plataforma, con hasta 3,000 roots por partición. Una partición menor usa todos sus roots
elegibles. La decisión principal usa macro-promedio con peso `0.25` por partición;
micro-métricas son complementarias. Ninguna muestra se presenta como population count.

El split se hace sobre familia canónica con seed `104729` y proporción 60/20/20 para
train, calibration y blind holdout. Canonical family, content hash, aliases y roots
compartidos no cruzan splits. El holdout se abre una sola vez, después de congelar
finalistas y parámetros efectivos.

Gold sólo puede provenir de la autoridad append-only 10B, con actor humano, provenance y
split. Hoy no existe gold comparable suficiente: precision, recall y F1 parten como
`not_available`, no cero.

## 5. Candidatos pinneados

| Pieza | Versión/revisión | Licencia | Rol |
|---|---|---|---|
| multilingual-e5-small | `614241f622f53c4eeff9890bdc4f31cfecc418b3` | MIT | embedding 384d |
| BGE-M3 ONNX | `5617a9f61b028005a4858fdac845db406aefb181` | MIT | embedding 1024d |
| BERTopic | `0.17.4` / `75f2910562f0e372beee29acbbd2a2835ba72cf2` | MIT | discovery |
| scikit-learn NMF | `1.9.0` | BSD-3-Clause | referencia lexical |
| UMAP | `0.5.12` | BSD-3-Clause | reducción |
| HDBSCAN | `0.8.44` | BSD-3-Clause | clustering |

El grid incluye NMF locale-aware y cuatro combinaciones BERTopic
(`E5|BGE × balanced|detail`). FASTopic 1.0.1/revisión
`51150f1ac22c4599ab0e390b14c031a98cffed68` queda excluido antes del run: su lower
bound 10C.1 excedió ocho horas sin producir evidencia de calidad. Los parámetros
declarados deben ser iguales a los efectivos. No hay clamps silenciosos, revisiones
flotantes ni probability/confidence fabricada; ausencia se guarda `not_available`.

## 6. Métricas y hard gates

Se miden denominator, coverage, outliers/abstention, topics efectivos, distribución de
tamaños, separación al vecino, coherence `c_npmi`, diversity, redundancia, stopword
dominance, estabilidad por seeds, sensibilidad, estabilidad temporal, slices por
scope/locale/mercado/plataforma, runtime, peak RAM, artifact size, incrementalidad,
licencia y supply chain.

Antes de ranking, un finalista debe cumplir simultáneamente:

- denominator reconciliado, zero leakage y zero unexplained roots;
- runtime full ≤ 8 horas y peak RAM ≤ 14,495,514,624 bytes;
- coverage global y de cada partición ≥ 0.55; gap entre particiones ≤ 0.20;
- diversity ≥ 0.55;
- adjusted Rand full ≥ 0.25 y matched assignment consistency ≥ 0.50;
- 8–120 topics efectivos;
- majority-stopword topic rate = 0;
- largest cluster share ≤ 0.40;
- nearest-cluster separation mean ≥ 0.005;
- revisión humana obligatoria para adopción.

Un label bonito no rescata un cluster incoherente. Una representación lexical pobre no
prueba por sí sola que document clustering sea malo. Clustering, representación y naming
se evalúan por separado.

## 7. Semantic Review actual

La projection generation 6 está `ready`: 21,195 roots, dirty roots 0 e incomplete
provenance 0. Hay 5,610 candidate roots, 15,585 unresolved, 0 approved, 0 rejected,
abstained `not_available` y 0 technical errors. `llm-processing` está denegado para la
población; no hubo resolución provider. Source intent no es gold.

## 8. Claude contextual posterior

Claude no participa en 10C.2. Sólo tras adopción técnica, en Gate 10E, podría recibir
clusters sellados y representative packets seleccionados server-side, nunca la población
completa. Brand OS, Study OS cuando aplique, Knowledge Base y locale aportarían contexto
gobernado. Claude no calcula counts, decide memberships, clasifica full-pop, genera SQL o
reglas ejecutables, autoaprueba ni promueve Topic Contracts. Toda propuesta inicia
`pending`; naming manual sigue disponible.

## 9. Stop conditions y handoff

La futura ejecución se detiene ante digest/denominator mismatch, parameter drift,
confidence fabricada, root inexplicada, leakage, omisión de una partición requerida,
runtime > 8h, provider call, remote write o serving write.

El siguiente paso permitido es la revisión de esta preregistración. Ejecutar 10C.2
requiere autorización separada. 10D permanece bloqueado.

```text
NOISIA_PREVIEW_UAT_OPERATOR_QA_COMPLETE=true
AMAZON_ALEXA_GREENFIELD_ACQUISITION_READY=true
SIGNAL_10C2_PREREGISTRATION_READY=true
SIGNAL_10C2_EXECUTED=false
SIGNAL_10D_READY=false
```

Durante este cierre: producción no fue accedida; provider calls y jobs pagados fueron
cero; read mode permaneció `legacy`; readers, pointers y bindings no cambiaron.

## 10. Checkpoint de operabilidad del harness

**Registrado:** 2026-08-20T11:42:43-06:00 (`America/Mexico_City`)

La auditoría contractual reprodujo seis incompatibilidades antes de ejecutar modelos:
el loader 10C.1 rechazaba la versión del preregistro, esperaba otro shape para hardware,
stages, candidates y hard gates, el exportador V1 tomaba Semantic Review y
`llm_eligible_count` como autoridad, mientras este freeze declara Acquisition, y el
runner no aplicaba completamente macro-promedio igual por partición, mínimo/gap de
coverage, mercado declarado, roots multi-scope, sampling estratificado ni métricas por
locale/market. Contract tests, no resultados de candidatos, prueban ese diagnóstico.

El preregistro firmado se preservó byte-for-byte. La normalización
`signal-local-modeling-benchmark-plan-v3` declara que supersede su digest sólo por
operabilidad/schema y valida las cuatro particiones, pesos `0.25`, digests congelados,
revisiones/artifacts/licencias, presupuestos, etapas, métricas, hard gates y stop
conditions. Mantiene `execution_authorized=false`, `ten_d_authorized=false` y el holdout
sellado.

El nuevo `signal-semantic-benchmark-export-v2` usa exclusivamente batches Acquisition
completed, seals inmutables, typed observations, canonical roots, accepted provenance y
rights vigentes. Requiere `strategic-analysis`, no `llm-processing`, y una root física
conserva todas sus memberships. El preflight real read-only reconcilió
`23,296 = 21,195 + 2,101`, los cuatro partition counts y `21,820` memberships sobre
`21,195` roots, pero
terminó fail-closed por `strategic_analysis_denied`. No se cambió governance dentro de
esta misión.

El fixture sintético multi-scope cerró `440 = 400 + 40`, con 510 memberships y 100 roots
compartidas; demostró splits sin leakage, macro/micro, slices locale/market, baja
coverage, gap entre particiones, inestabilidad, stopword dominance, parameter drift,
artefactos parciales y cero writes/providers. Ningún modelo del corpus real fue
descargado o ejecutado.

```text
SIGNAL_10C2_PREREGISTRATION_READY=true
SIGNAL_10C2_HARNESS_READY=true
SIGNAL_10C2_REAL_EXPORT_PREFLIGHT_READY=false
SIGNAL_10C2_EXECUTION_AUTHORIZED=false
SIGNAL_10C2_EXECUTED=false
SIGNAL_10D_READY=false
```

La siguiente autorización necesaria no es de modelado: el operador debe resolver de
forma explícita `strategic-analysis` para los imports actuales del corpus congelado y
después repetir el preflight V2 read-only. La ejecución de candidatos requiere otra
autorización separada.
