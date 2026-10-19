# Backend 10C.0 + 10C.1 — Canon repair and corrective local discovery benchmark

> **Tipo:** handoff ejecutable completo
> **Estado inicial:** Gate 10C terminó en `technical_no_adoption`; 10D permanece bloqueado
> **Fecha:** 2026-08-16
> **Autoridad:** este prompt no autoriza 10D, serving, providers de producto ni writes remotos

## Goal sugerido

Corregir el canon 10C/10D y ejecutar un benchmark 10C.1 reproducible, locale-aware y
operator-meaningful que determine si un stack local multilingual puede descubrir clusters
sobre poblaciones grandes, preservando denominador y lineage completo. Diseñar —sin
ejecutar providers— el contrato futuro de naming contextual con Claude mediante Brand OS,
Study OS cuando aplique y RAG gobernado. No avanzar a 10D sin decisión de modelado válida.

---

## Prompt completo para Backend

Trabaja en el producto greenfield de Noisia. No rescates Alexa, Laika ni otro workspace
como objetivo de producto; pueden utilizarse únicamente como evidencia o fixture sin
lógica específica. No ejecutes 10D.

### 1. Contexto y veredicto vigente

Gate 10B está cerrado localmente con autoridad append-only y el worker full-pop de
Voyage/Claude bloqueado.

Gate 10C ejecutó un benchmark reproducible sobre 109,056 raíces y terminó en
`technical_no_adoption`. Ese resultado es válido sólo para las configuraciones congeladas
que se ejecutaron. No demuestra que local topic modeling sea inviable.

La auditoría posterior encontró:

- representaciones BERTopic dominadas por stopwords;
- ausencia de `vectorizer_model` multilingual apropiado;
- una sola configuración UMAP/HDBSCAN;
- parámetros efectivos modificados silenciosamente por tamaño de corpus;
- strength `1.0` fabricada cuando no había probabilidades;
- fixture completamente `primary_brand`, incapaz de validar category/competitor;
- contradicción entre documentos 55 y 56 acerca de qué es Gate 10D.

La calidad visible de Laika —por ejemplo `Promociones y descuentos`, `Experiencia de
compra digital`, `Salud integral de la mascota`, `Entrega y logística` y `Costo y
sensibilidad al precio`— es un piso cualitativo para el rubric, no un fixture productivo ni
una autorización para introducir lógica Laika-specific.

### 2. North Star no negociable

La arquitectura objetivo es:

```text
eligible canonical roots
  -> local normalization/features/embeddings
  -> local clusters + outliers + memberships
  -> sealed representative packets
  -> optional bounded Claude proposal with governed RAG context
  -> operator approval/correction
  -> versioned Topic Contracts
  -> local full-pop and incremental propagation
```

La autoridad full-population permanece local y server-owned.

Claude nunca:

- clasifica cada mención;
- calcula counts, denominator, coverage o confidence;
- modifica clusters o memberships;
- escribe SQL, regex o policy expressions ejecutables;
- autoaprueba una propuesta;
- promueve un contrato;
- renombra silenciosamente un término vigente.

La muestra representativa usada para naming nunca se presenta como conteo poblacional.

Trazabilidad del 100% no significa certeza semántica del 100%. Cada raíz elegible debe
quedar contabilizada como una o varias de:

- `assigned`;
- `multi_assigned`;
- `outlier`;
- `pending`;
- `abstained`;
- `technical_error`.

Unknown/not-available nunca se convierte en cero, approved o confidence `1.0`.

### 3. Límites de esta misión

Autorizado:

- documentación y ADR;
- cambios al laboratorio reproducible `tools/signal-semantic-lab`;
- tests locales;
- export read-only de staging si el target se verifica previamente;
- procesamiento local sobre artefactos privados;
- simulación offline de packets, token counts y presupuesto;
- creación de evidence privado/sanitizado.

No autorizado:

- 10D;
- llamadas de producto a Claude, Voyage u otro provider;
- naming real con provider;
- writes remotos;
- cambios a frontend, readers, pointers, bindings o Signal visible;
- migraciones de base de datos salvo contradicción estructural demostrada y autorización
  nueva; este gate debe poder cerrarse sin migration;
- servicio Python permanente;
- SQL generado por modelo;
- commit o push;
- producción.

No vuelvas a usar Advisor: esta arquitectura ya fue auditada y el presupuesto agregado
vigente debe preservarse.

### 4. Gate 10C.0 — reparar el canon

Crear ADR 016 o el siguiente ordinal disponible y hacer canónica una sola secuencia:

1. 10A — Acquisition Plan;
2. 10B — Semantic Authority;
3. 10C/10C.1 — Local Modeling Benchmark;
4. 10D — Local Semantic Cascade Shadow;
5. 10E — Topic Contract Control Plane y bounded contextual naming;
6. 10F — Propagation, incremental y drift;
7. 10G — Signal prepublish;
8. 10H — Production readiness y retiro de bridges.

Documentar expresamente que:

- 10C.1 no ejecuta 10D;
- 10E no abre sin una decisión 10C.1 válida;
- el naming contextual con Claude pertenece a 10E, aunque su contrato se diseña en 10C.1;
- 10D continúa bloqueado hasta cerrar la decisión de 10C.1 y el gate operator aplicable;
- una representación lexical pobre no prueba que los document clusters sean malos;
- clustering, representation y human naming se evalúan por separado.

Actualizar, sin borrar historia:

- `31_SIGNAL_PRODUCT_NORTH_STAR.md`;
- `55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md`;
- `56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md`;
- `58_SIGNAL_LOCAL_MODELING_BENCHMARK.md`;
- `00_README.md` si cambia el índice documental.

### 5. Contexto gobernado: Brand OS, Study OS y Acquisition Plan

Antes de cambiar schema o inventar campos, audita y reutiliza los contratos actuales de
Brand OS, Study OS, workspace y Acquisition Plan.

No crees otro store de contexto, locale, marca, estudio o competidores.

Diseña un resolver server-owned que produzca un `Governed Analysis Context Snapshot`
sellado para cada future discovery/naming run.

#### 5.1 Brand OS

Brand OS es obligatorio para un workspace de marca. El snapshot puede proyectar sólo los
campos operator-safe y relevantes:

- identidad y aliases;
- categoría, productos y competidores vigentes;
- mercado(s), lenguaje(s) y posicionamiento;
- atributos aprobados relevantes;
- versión y digest de la identidad utilizada.

No enviar dumps JSON completos ni datos no necesarios.

#### 5.2 Study OS

Study OS es obligatorio cuando la corrida pertenece a un estudio. Debe aportar, según el
contrato real existente:

- objetivo;
- preguntas de investigación;
- metodología;
- audiencia;
- periodo y scope;
- output language/market si están declarados.

Para Signal always-on sin estudio, `study_context` es `not_applicable`. No fabricar un
`study_id`, un Study OS sintético ni un objeto vacío que parezca gobernado.

#### 5.3 Acquisition Plan

El snapshot debe conservar:

- plan/version;
- slot y scope (`primary_brand`, `category`, competitor exacto o reference explícito);
- entidad;
- query/import provenance;
- periodo y timezone sellados.

#### 5.4 Locale Context

No hardcodear `es-MX`.

Audita la precedencia real y canonízala. Como regla de intención:

1. un Study OS explícito gobierna la corrida study-scoped;
2. Brand OS aporta defaults de la marca para Signal always-on;
3. Acquisition Plan conserva el scope, periodo y timezone efectivos;
4. configuración gobernada del workspace sólo puede ser fallback explícito.

El resolver debe producir:

- primary language;
- country/market;
- language variant (`es-MX`, `en-GB`, etc.);
- secondary languages permitidos;
- code-switching esperado;
- timezone;
- source authority por campo;
- versiones y digests de todas las fuentes.

Si la información falta o se contradice y el contrato no permite resolverlo, devolver
`unknown/requires_operator_decision`. Nunca asumir México, español o inglés.

El hecho de que aproximadamente 85% de los estudios esperados sean es-MX define prioridad
de benchmark y producto, no una regla universal de runtime.

### 6. Benchmark preregistrado 10C.1

Congela el plan, thresholds, seeds, datasets/splits, hardware y stop conditions antes de
observar resultados nuevos.

Separar tres capas de evaluación:

1. embedding y document clustering;
2. representación lexical/semantic del cluster;
3. calidad humana del nombre/definición.

Una capa no puede sustituir la evidencia de otra.

#### 6.1 Preprocessing locale-aware

Implementar derivados reproducibles sin destruir el texto original:

- NFKC/whitespace controlado;
- URLs, boilerplate y tokens técnicos tratados explícitamente;
- stopwords y normalización seleccionadas desde `Locale Context`;
- ES/EN como mínimo, con pruebas es-MX y en-GB;
- n-grams y frases;
- conservar negación;
- conservar y evaluar brands, products, slang, emoji, profanity, accent omission,
  misspellings y code-switching;
- no eliminar automáticamente modismos mexicanos o términos de categoría por frecuencia.

Aplicar la misma disciplina al vocabulario NMF y al `vectorizer_model`/c-TF-IDF de
BERTopic.

#### 6.2 Candidatos

Preregistrar un grid acotado total de 3–6 configuraciones, no una búsqueda ilimitada:

- TF-IDF + NMF como referencia lexical, no ganador automático;
- BERTopic con al menos los embeddings multilingual ya pinneados si continúan siendo
  legal y operacionalmente aptos;
- representación c-TF-IDF locale-aware;
- una representación refinada local como KeyBERT-inspired/MMR si el benchmark justifica
  su inclusión;
- FASTopic sólo si un lower bound realista permite terminar dentro del presupuesto de
  ocho horas.

No inventar un framework propio antes de medir estas bases.

Registrar tanto parámetros declarados como parámetros efectivos. Prohibido cambiar o
clamp-ear silenciosamente UMAP, HDBSCAN, sample size o thresholds. Si una adaptación es
necesaria, debe estar preregistrada, emitirse en evidence y formar parte del config hash.

Cuando una probabilidad no existe, persistir `not_available`; nunca un array de unos.

#### 6.3 Secuencia

1. smoke reproducible;
2. calibration sin holdout;
3. detener candidatos que fallen gates congelados;
4. full-pop sólo para finalistas operables;
5. múltiples seeds para estabilidad;
6. abrir holdout una sola vez cuando el plan lo autorice;
7. blind operator packet;
8. decisión posterior del operador; Backend no puede fingir esa decisión.

El límite full-pop continúa siendo ocho horas sobre el hardware declarado. Medir por
separado export, preprocessing, embeddings, dimensionality reduction, clustering,
representation, packet selection y serialization.

### 7. Dataset y slices

El export Alexa actual de 109,056 raíces puede reutilizarse como prueba de escala/ruido
single-scope. No puede demostrar calidad multi-scope ni convertirse en lógica Alexa-specific.

Para una decisión de adopción general se requieren slices con provenance verificable:

- `primary_brand`;
- `category`;
- al menos dos competidores distintos o los disponibles bajo el Acquisition Plan;
- short/noisy social mentions;
- long-form/news;
- es-MX;
- en-GB;
- code-switching cuando el contexto lo permita;
- slang, spelling/accent variation, abbreviations, emoji, negation, sarcasm y profanity;
- brand/product/category jargon;
- temporal slices.

No fabriques que un corpus single-scope es multi-scope. Si no existe todavía evidencia
real suficiente, el resultado debe limitar explícitamente el adoption scope y mantener un
gate posterior para multi-scope.

No inventar gold metrics. Reutilizar la autoridad 10B para cualquier gold set real y
preservar actor, provenance y split.

### 8. Métricas y rubric

Medir, como mínimo:

- denominator y roots accounted-for;
- cluster-size distribution;
- effective topics;
- outlier/abstention rate;
- coherence y diversity, sin permitir que stopwords dominen la métrica;
- estabilidad entre seeds y sensibilidad de configuración;
- nearest-cluster separation;
- multi-scope/language distributions;
- runtime, peak RAM y tamaño de artifacts;
- incremental feasibility;
- licencia y supply chain.

La revisión ciega de operador debe evaluar por separado:

- faithfulness a la evidencia;
- specificity;
- non-overlap;
- coherencia interna;
- capacidad de distinguir clusters vecinos;
- utilidad comercial/analítica;
- calidad de español o inglés según `Locale Context`;
- comparación contra el piso cualitativo de Laika sin revelar source/model/config.

Un nombre bonito no rescata un cluster incoherente. Un cluster coherente no debe ser
rechazado únicamente porque su label lexical default sea feo.

### 9. Sealed Representative Packet

Diseñar e implementar offline un selector server-owned determinista. No ejecutar Claude.

El packet no usa tres menciones fijas. Utiliza una policy versionada, adaptativa y acotada.
Para el benchmark, preregistra y evalúa un rango máximo; default propuesto:

- hasta 2 medoids/central representatives;
- hasta 3 diversity representatives por language/scope/source/time/subregion;
- al menos 1 near-boundary example o counterexample cuando exista;
- máximo inicial de 8 excerpts por cluster;
- hard cap de caracteres/tokens por cluster y por corrida.

Clusters pequeños pueden usar menos. Si un cluster no puede representarse fielmente
dentro del máximo, marcar `too_broad/split_candidate`; no crecer el packet sin límite.

Cada packet debe incluir:

- run/cluster stable keys sin exponer raw IDs al provider;
- cluster content digest;
- size, stability y outlier information;
- representative refs y selection reason;
- redacted excerpts permitidos;
- c-TF-IDF/local keywords y phrases;
- language/scope/source/time distributions;
- neighboring clusters;
- positive, boundary y counterexample roles;
- packet policy version y digest;
- coverage/limitations;
- sin population counts derivados de la muestra.

Probar selección determinista, diversidad, redacción, rights y token budgets.

### 10. Governed Context Envelope y RAG futuro

Toda futura llamada de producto a Claude debe exigir un `Governed Context Envelope`
server-owned y sellado. No existe una llamada de producto sin contexto.

El RAG recupera sólo contexto relevante desde:

- snapshot de Brand OS;
- Study OS cuando aplica;
- Acquisition Plan;
- Knowledge Base/metodología Noisia vigente;
- sealed cluster packet;
- taxonomy/contracts aprobados relevantes.

El retrieval debe ser:

- task-specific;
- workspace-safe;
- rights/licensing-aware;
- reproducible;
- limitado por tokens;
- con source refs, version y hashes;
- libre de secretos y PII no necesaria;
- ejecutado server-side;
- imposible de controlar mediante IDs, population o policies enviados por browser.

El permiso de enviar excerpts a provider debe fallar cerrado si provenance/licensing no
autoriza `llm-processing`. En ese caso el operador puede nombrar manualmente; Signal no
queda dependiente de uptime o permisos del provider.

No enviar dumps completos de Brand OS/Study OS ni hacer retrieval por “más contexto es
mejor”. El packet debe demostrar por qué cada fragmento es relevante.

Persistir en la futura proposal:

- Brand OS version/digest;
- Study OS version/digest o `not_applicable`;
- Acquisition Plan version/digest;
- KB/methodology version;
- locale context digest;
- retrieval policy version;
- context envelope digest;
- evidence refs;
- cluster packet digest;
- model, prompt y pricing version.

### 11. Closed Claude proposal contract futuro

Diseñar schema y fixtures sin provider calls. La propuesta debe contener, como mínimo:

- `proposed_display_name` en el idioma/variante efectivos;
- `definition`;
- `inclusion_summary`;
- `exclusion_summary`;
- `evidence_refs` limitadas al envelope;
- `merge_candidate`;
- `split_candidate`;
- `too_broad`;
- `too_thin`;
- `positive_example_refs`;
- `negative_example_refs`;
- `insufficient_evidence`;
- `narrative_hypothesis` opcional y siempre no aprobada.

El schema no acepta counts, memberships, SQL, regex, confidence poblacional, promotion ni
policy expressions.

La cache/idempotencia futura debe usar:

```text
(cluster_content_digest,
 packet_digest,
 context_envelope_digest,
 retrieval_policy_version,
 model_version,
 prompt_digest)
```

Un cluster sin cambios reutiliza proposal y no vuelve a pagar. Rename, merge, split,
drift o cambio de contexto crean proposal versionada append-only con lineage y
supersession; nunca mutación silenciosa.

Diseñar un preflight de coste O(clusters), no O(mentions), con:

- número real de clusters, no supuesto fijo de 56;
- input/output token upper bounds;
- modelo/pricing pinneados;
- máximo de llamadas;
- estimated/max USD;
- hard cap explícito;
- cero provider call si el cap no alcanza.

Transport batching puede agrupar requests, pero accounting, schema, retry e idempotencia
permanecen por cluster.

### 12. Topics versus Narratives

Un cluster puede producir un `topic_candidate`.

Una Narrative no puede aprobarse desde keywords o un cluster aislado. Requiere contrato
de evidencia más fuerte:

- relación entre múltiples clusters/topics;
- evidencia semántica;
- distribución temporal o cambio;
- vínculos entre scopes/segments cuando aplique;
- representative evidence;
- contraejemplos;
- revisión explícita del operador.

Claude sólo puede devolver `narrative_hypothesis` con incertidumbre. Nunca promover una
Narrative desde 10C.1.

### 13. Publicación y dependencia de provider

Claude naming es opcional. La disponibilidad de Signal no puede depender de provider
uptime.

La policy de producto puede exigir al menos un Topic Contract gobernado antes de un
release T&N, pero ese contrato puede ser nombrado/corregido manualmente por operador.

Si no existe propuesta Claude:

- conservar local/machine label únicamente como draft;
- permitir naming manual;
- declarar limitations;
- nunca fabricar nombre aprobado.

### 14. Gates de adopción

Un candidato sólo puede convertirse en finalista técnico si:

- pasa thresholds congelados;
- no produce majority-stopword representations en topics aprobables;
- pasa slices del locale objetivo, con es-MX como slice prioritario;
- pasa coherencia/estabilidad/outlier gates;
- conserva denominator y lineage;
- no contamina holdout;
- full-pop termina dentro de ocho horas;
- artifacts y supply chain son reproducibles;
- no requiere provider por raíz.

La adopción final además requiere blind operator review. Backend no puede completar esa
decisión por proxy.

Stop conditions:

- gates modificados después de observar resultados;
- silent parameter changes;
- fabricated probability/confidence;
- unexplained roots;
- sample count presentado como population count;
- es-MX evaluado sólo mediante una declaración genérica de modelo multilingual;
- raw text o PII sin rights en un packet;
- naming packet controlado por browser;
- runtime > 8 horas;
- arquitectura Python paralela/permanente;
- intento de abrir 10D durante esta misión.

### 15. Validación requerida

Como mínimo:

- tests del laboratorio y lint Python;
- notebook top-to-bottom sin errores;
- typecheck/tests de cualquier package TS tocado;
- locale resolver fixtures para es-MX, en-GB, study-scoped y Signal `not_applicable`;
- deterministic context/packet digest tests;
- packet diversity/counterexample tests;
- licensing/rights fail-closed tests;
- zero-provider-call assertion;
- zero-remote-write assertion;
- denominator/content digest reconciliation;
- secret/PII scan focal;
- links locales;
- `git diff --check`.

No declares un modelo adoptado sólo porque técnicamente corrió.

### 16. Entregables

1. ADR de secuencia 10C–10H y authority boundaries.
2. Docs 31, 55, 56 y 58 reconciliados, conservando historia.
3. Plan 10C.1 preregistrado y sellado.
4. Harness/notebook reproducible.
5. Evidence técnico por candidate/config/seed.
6. Slices y rubric locale-aware, prioritizando es-MX.
7. Blind operator review packet y score sheet.
8. Governed Analysis Context Snapshot contract.
9. Sealed Representative Packet schema/policy y fixtures.
10. Governed Context Envelope/RAG contract y fixtures.
11. Closed Claude Proposal schema y cost simulation, sin provider calls.
12. Evidence manifest con hashes y permisos `0600` para artefactos privados.

### 17. Resultado permitido

Si ningún candidato técnico pasa:

```text
SIGNAL_10C0_CANON_RECONCILED=true
SIGNAL_10C1_TECHNICAL_RESULT=no_adoption
SIGNAL_10C1_READY_FOR_OPERATOR_REVIEW=true
SIGNAL_10C1_READY_FOR_10D=false
```

Si existe uno o más finalistas técnicos:

```text
SIGNAL_10C0_CANON_RECONCILED=true
SIGNAL_10C1_TECHNICAL_RESULT=finalist_available
SIGNAL_10C1_READY_FOR_OPERATOR_REVIEW=true
SIGNAL_10C1_READY_FOR_10D=false
```

`READY_FOR_10D` permanece false hasta que el operador complete la revisión ciega, exista
una decisión/adoption ADR separada y se autorice explícitamente el siguiente gate.

Reporta además:

- población y denominator exactos;
- locale/scope coverage real;
- configuraciones ejecutadas;
- candidatos detenidos y razón;
- runtime/RAM por etapa;
- clusters/outliers/abstentions sin contenido privado;
- estado del operator packet;
- remote reads/writes;
- provider calls/jobs/cost;
- archivos principales y hashes;
- tests ejecutados;
- confirmación de producción, pointers, readers y frontend intactos.

No hacer commit ni push.

---

## Auditoría previa de este handoff

Claude Fable 5 auditó la arquitectura de full-pop local + bounded contextual cluster
naming el 2026-08-16. Veredicto: el diseño preserva el North Star, pero 10D no puede
avanzar hasta cerrar 10C.1. Los P1 incorporados en este handoff son:

1. no existe todavía artifact local adoptado;
2. fixed-three representatives es insuficiente;
3. fabricated confidence, silent clamps, stopwords y single-scope deben corregirse;
4. Claude naming no puede ser dependencia obligatoria de publicación.

La auditoría privada/sanitizada está en:

`../../.data/signal-semantic-lab/backend-10c/advisor-cluster-naming/review/advisor-review.sanitized.json`
