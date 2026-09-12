# Auditoría histórica de Topics y Signal

Fecha: 12 septiembre 2026. Alcance: documentación, código e historial Git local. Estado:
**auditoría de evidencia; no acredita ejecución nueva, proveedor ni entrega UAT**.

## Propósito y límites

Esta auditoría responde una pregunta concreta: qué significaba históricamente que Noisia podía
analizar corpus de decenas de miles de menciones, y qué parte de esa capacidad se conserva en el
recorrido actual `corpus → BERTopic → consolidación editorial → Signal`.

Se revisaron documentos, código vigente y versiones históricas rastreables en Git. No se consultaron
producción, secretos, JSONL, datos privados ni salidas masivas de herramientas. Una constante o un
máximo declarado en código se registra como **capacidad**, no como prueba de una ejecución. Un número
se considera **comprobado** sólo cuando existe un recibo o nota de runtime que lo reconcilia.

## Veredicto

La frase «producción analizaba unas 30,000 menciones con Claude» mezcla al menos cuatro recorridos
distintos. No se encontró evidencia de una sola solicitud a Claude con 30,000 menciones crudas ni de
una ejecución completa de ese tamaño bajo un único pipeline:

1. **T&B estratégico** etiquetaba menciones por lotes y luego reducía los tags para producir
   findings. El recibo conservado procesó 1,500 menciones de un corpus aproximado de 40,000.
2. **Topics & Narratives de Laika** descubría términos con Brand OS, Knowledge Base y una muestra
   determinista de 100 menciones; después clasificaba menciones pendientes en lotes pequeños con
   evidencia y materialización SQL.
3. **El laboratorio BERTopic** sí trabajaba sobre la población computacional elegible mediante
   embeddings, UMAP y HDBSCAN/BERTopic. Claude interpretaba representantes, bordes y outliers, no
   cada mención cruda.
4. **Signal Pulse** tuvo un recorrido Claude-per-mention para Takis y otro diseño cluster-first con
   límites menores; ninguno acredita una corrida completa de 30,000 menciones.

La decisión vigente es coherente con la parte más escalable de esa historia: la población completa
se cubre con embeddings, clustering y propagación determinística; Claude decide sobre dossiers de
grupos y conceptos; Signal sirve métricas y evidencia materializadas con linaje.

## Evidencia e inferencias

**Comprobado por código o recibo:** tamaños de batch y límites; la corrida T&B de 1,500; el censo y
costo de Laika; el censo BERTopic de Alexa; los límites de Signal Pulse; y el contrato vigente de
42 screenings, objetivo 24–80 y hard cap 120. Esos hechos se describen abajo con su fuente.

**Inferencia de producto:** separar cómputo poblacional de juicio editorial es el camino más sensato
para 100K–2M menciones porque evita el costo lineal proveedor-por-mención y conserva cobertura. Esta
conclusión está apoyada por los recibos y contratos, pero todavía requiere una corrida editorial real,
QA semántico y validación incremental antes de considerarse probada en UAT.

## Matriz de evidencia

| Recorrido | Población o alcance | Batching real | Claude | Voyage / embeddings | Resultado | Calidad de evidencia |
|---|---:|---|---|---|---|---|
| T&B estratégico | Corpus reportado de ~40K; runtime de 1,500 | 30 menciones, concurrencia 4, 50 llamadas | Tags por mención; luego codificación y naming agregado | No era la autoridad de cobertura | Findings estratégicos | Runtime documentado para 1,500; el máximo posterior de 50K era capacidad de código |
| Laika Topics & Narratives | 723 menciones incluidas por perfil en el recibo auditado | Página 500; Claude por defecto 20, hard cap 50 | Descubrimiento de términos y clasificación exacta de IDs | Query/contexto embebido y top 8 chunks de KB por batch | Términos, assignments, evidencia, planes y series SQL | Recibos y censo persistido; el descubrimiento usó una muestra de 100 |
| Laboratorio BERTopic Alexa | 21,195 raíces de modeling | Computación local por población; interpretación sobre evidencia compacta | Nombró/rankeó candidatos de representantes, bordes y outliers | BGE-M3/UMAP/HDBSCAN/BERTopic | 115 propuestas; 10 candidatos interpretados | Censo y outliers documentados; no fue Claude-per-mention |
| Benchmark local Alexa | 109,056 × 1,024 embeddings | Multi-seed local | Sin proveedor para el benchmark | BGE + UMAP/HDBSCAN/BERTopic | Comparación de candidatos | Ningún finalista pasó todos los gates |
| Signal Pulse Takis | ~13K corpus; ~2,006 unidades por lens | ~18 por batch, ~112 batches por lens | Findings por mención/lens | No era el eje del recorrido registrado | 1,136 y 1,071 findings en dos lenses | Recibo de costo útil USD 17.11 / total USD 29.73; no Topics |
| Consolidación vigente Alexa+ | 1,652 grupos atómicos | 40 grupos por screening: 42 requests; 1 revisión global | Topic / Narrative / Noise / Unresolved y fusión global | Reutiliza embeddings y centroides existentes | Objetivo 24–80 conceptos; hard cap 120 | Implementación y pruebas locales; no acredita todavía corrida pagada ni UAT |

## Qué hacía cada runtime

### 1. T&B estratégico

El primer paso de T&B permitía batches de 30 menciones con concurrencia cuatro. Claude devolvía de
uno a tres tags emergentes por mención. El segundo paso codificaba aproximadamente 30–60 tags
agregados y el tercero nombraba y puntuaba clusters candidatos.

El recibo conservado de Seguros El Potosí documenta un corpus aproximado de 40,000, pero la corrida
real tomó 1,500 menciones, hizo 50 llamadas y duró unos 11 minutos. El límite original era 1,500; un
commit posterior elevó la constante declarada a 50,000. El worker actual permite un objetivo explícito
de hasta 100,000, pero usa un máximo seguro de 5,000 cuando no hay objetivo. Ninguno de esos topes
demuestra que se hubiera ejecutado esa población completa.

La reducción perdía señal: de 1,287 tags únicos, sólo los 60 principales llegaban al paso siguiente;
556 menciones quedaron flotantes. La vinculación final tomaba el primer cluster coincidente; 142
codificaciones se conectaron con 14 findings y unas 80 quedaron sin enlace. Este recorrido sirve como
antecedente de análisis estratégico, no como catálogo continuo y exhaustivo de Topics.

### 2. Laika Topics & Narratives

Laika separaba descubrimiento y clasificación. Para descubrir términos, el perfil combinaba Brand OS,
Knowledge Base y una muestra determinista de 100 menciones, cada una recortada a 1,200 caracteres.
Voyage embebía el query/contexto, recuperaba 12 chunks de conocimiento y Claude proponía entre 5 y
20 términos por tipo.

El worker histórico de enriquecimiento paginaba pendientes de 500 en 500. En cada batch de Claude
usaba 20 menciones por defecto, con hard cap 50 y texto máximo de 3,000 caracteres. Una consulta de
Voyage sobre los primeros 12,000 caracteres recuperaba ocho chunks de KB. El contrato exigía una
asignación para cada ID exacto y rechazaba omisiones, duplicados o IDs desconocidos; assignments,
evidencia, linaje y costo se persistían juntos.

El recibo auditado de Laika registra 723 menciones incluidas por perfil, 2,339 assignments aprobados,
USD 8.259545 totales y materialización de 528 planes, 14,953 filas, 11 métricas, 125 periodos de serie y
77 periodos de breakdown. Una importación posterior de seis menciones clasificó sólo esas seis,
evidencia de checkpoint incremental. El precio estimado para 109,056 menciones de Alexa era
USD 327.233340; por eso este modelo proveedor-por-mención no debe ser el default del producto masivo.

### 3. BERTopic y modelado local

El laboratorio Alexa tomó 21,195 raíces de modeling y generó embeddings BGE-M3, reducción UMAP y
clusters HDBSCAN/BERTopic. Produjo 115 propuestas —116 entradas de catálogo según el censo—, asignó
11,186 menciones y dejó 10,009 outliers. Claude recorrió representantes, bordes y outliers para
proponer diez candidatos con 30 citas; no recibió las 21,195 menciones completas.

Otro benchmark computó 109,056 embeddings de 1,024 dimensiones y comparó fits multi-seed sin
proveedor. Ningún finalista pasó todos los gates, por lo que ese benchmark prueba capacidad de
cómputo y evaluación, no calidad aprobada ni serving.

Éste es el antecedente directo que sí se debe conservar: población completa en la capa numérica,
identidades atómicas, outliers, representantes/bordes y linaje hasta evidencia.

### 4. Signal Pulse y corpus citados como «30K»

La especificación comparativa menciona corpus de Telefonía Móvil de ~160,000, Telcel de ~33,000 y
Movistar de ~30,000. Son tamaños de corpus por entidad, no conteos comprobados de menciones enviadas
a Claude.

El recibo real más claro es Takis: corpus de ~13,000, unas 2,006 unidades por lens, batches de ~18 y
alrededor de 112 batches por lens. Dos lenses entregaron 1,136 y 1,071 findings, con USD 17.11 útiles
y USD 29.73 totales. Era Claude-per-mention y no producía el catálogo de Topics.

La variante cluster-first de Signal Pulse limitaba el universo a 6,000 filas, 220 anchors, 12 signal
clusters y batches de naming de cuatro. Su revisión final sólo acredita smoke sintético; la validación
real sobre corpus grande seguía pendiente.

## Contrato vigente: 1,652 → screening completo → revisión global

El contrato editorial actual usa Sonnet 4.6 y admite como máximo 5,000 grupos por corrida. Para Alexa+
divide 1,652 dossiers en batches de 40, por lo que requiere 42 respuestas de screening. Cada dossier
incluye identidad estable, lane/comunidad, conteos, términos, scope, locale, plataforma, mes,
afinidades positivas/negativas/de abstención, vecinos, cohesión/outlier y referencias de evidencia.

Cada grupo recibe exactamente una disposición: `Topic`, `Narrative`, `Noise` o `Unresolved`. La
revisión global sólo puede fusionar candidatos elegibles; no puede promover grupos ya fijados como
Noise o Unresolved. El prompt pide **24–80 conceptos** y el schema/validador aplica un **hard cap de
120**. La cifra de 500 que aparecía en el plan era obsoleta y queda corregida.

La validación cubre todos los grupos exactamente una vez. El bridge conserva sucesión
`concepto → grupo atómico → raíz` y deja la activación en `not_activated`. El dossier puede sellar
hasta diez referencias; el bridge actual entrega dos extractos por grupo al modelo —un representante
de alta afinidad y un borde— y conserva las restantes para drill-down.

Esto mejora costo y cobertura estructural, pero no demuestra precisión semántica. Aún hacen falta QA
de sobre-fusión, sub-fusión, idioma, prioridad de marca, Noise y evidencia. La revisión global recibe
candidatos compactos de screening, no todas las menciones crudas ni las diez evidencias completas.

## Qué conservar y qué retirar del diseño histórico

Conservar:

- embeddings y clustering sobre la población completa;
- IDs atómicos, outliers, representantes, bordes y citas originales;
- perfiles y términos versionados;
- lineage append-only y readers SQL de conteos/materializaciones;
- checkpoints durables, límites de costo, recibos y recuperación por batch;
- clasificación multi-label cuando corresponda, con denominadores y cobertura explícitos;
- last-valid serving y admisión incremental de nuevas cargas.

No trasladar:

- el corte top 60 de tags ni la vinculación por primer match;
- Claude-per-mention como default para 100K–2M registros;
- Voyage por cada batch de 20 menciones cuando ya existen embeddings reutilizables;
- una muestra de 100 como prueba de descubrimiento exhaustivo;
- aprobación masiva sin edición/versionado explícitos;
- conteos o shares calculados por el LLM;
- los límites 6,000/220/12 de Signal Pulse como cobertura total;
- la mezcla de T&B, BERTopic, taxonomía de Laika y Signal como si fueran un solo runtime.

## Implicaciones para el Compass

La población completa debe quedar bajo una capa computacional reproducible. Claude se usa donde
agrega juicio editorial: nombres, definiciones, relevancia, disposición y fusión de grupos. Voyage o
el modelo de embeddings produce geometría semántica y retrieval; no decide por sí solo qué se publica.
Signal consume un catálogo versionado con cobertura, evidencia y linaje, y sólo cambia de generación
después de validación explícita.

La UI madura de Laika sigue siendo la referencia visual vendida. Sus componentes pueden reutilizarse
para series, sentimiento, relaciones y evidencia cuando exista cada dimensión real. Su pipeline
proveedor-por-mención no es el camino de escala para Alexa+.

## Texto listo para Linear — no aplicado

### NOI-35 · Signal: evidencia, responsive, i18n y rendimiento

> La auditoría histórica separa la UI madura de Laika de su runtime de taxonomía. Reutilizar el shell,
> series, sentimiento, relaciones y drawer de evidencia cuando cada dimensión tenga datos reales;
> mantener `not_available` en las ausentes. Validar Alexa+ a 1440/1280/375, ES/EN, navegación
> Topic/Narrative → evidencia original, Noise/Unresolved y sucesión de IDs. Perfilar el reader con el
> catálogo consolidado real; el objetivo vigente es primera página p95 caliente ≤2.5 s y p95 fría UAT
> ≤5 s. La paridad visual no implica reutilizar Claude-per-mention ni simular dimensiones.

### NOI-73 · Programa E2E de corpus a Signal

> Corregir el relato operativo: no existe recibo de una sola pasada de Claude sobre ~30K menciones.
> T&B procesó 1,500 de ~40K en el runtime conservado; 50K fue capacidad posterior de código. El E2E
> escalable es corpus completo → embeddings/BERTopic → grupos atómicos → dossiers → 42 screenings
> de 40 grupos + una revisión global → catálogo versionado → selección → Signal. Para 1,652 grupos el
> contrato busca 24–80 conceptos y aplica hard cap 120. La implementación local no acredita todavía
> corrida pagada ni activación UAT. Mantener import incremental, linaje, recibos, recuperación y
> last-valid serving como gates del programa.

### NOI-75 · Controles semánticos automáticos y excepciones útiles

> QA semántico del catálogo consolidado: revisar sobre-fusión, sub-fusión, locale, relevancia para la
> marca, distinción Topic/Narrative, Noise y Unresolved. El contrato garantiza cobertura exacta de
> grupos, no precisión. Cada decisión debe conservar grupo → raíz → evidencia; el bridge muestra dos
> extractos por grupo y mantiene hasta diez referencias selladas para drill-down. Claude resuelve lo
> rutinario; la UI escala sólo excepciones accionables y permite editar/eliminar/versionar sin obligar
> al usuario a aprobar cientos de prototipos.

## Fuentes auditadas

Las rutas siguientes pertenecen al checkout focal salvo las dos marcadas como repo documental.

- `packages/query-engine/src/tb.ts`
- `services/workers/src/workers/tb-step-1-open-pass.ts`
- `docs/product/tb-pipeline-runtime-notes.md`
- `infrastructure/db/signal-taxonomy-profile.ts`
- `services/workers/scripts/discover-signal-topics-narratives.ts`
- versión histórica `b2c9160^` de `services/workers/src/workers/signal-taxonomy-enrichment.ts`
- `docs/product/39_SIGNAL_TOPICS_NARRATIVES_BACKEND_AUDIT.md`
- `docs/product/55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md`
- repo documental `noisia-website`:
  `docs/product/PROMPT_LOOPING/AUDIT_ADMIN_AND_DISCOVERY_2026-09-07.md`
- `docs/product/58_SIGNAL_LOCAL_MODELING_BENCHMARK.md`
- repo documental `noisia-website`:
  `docs/product/73_TOPIC_EVALUATION_LAB_AND_RELEASE_BOUNDARIES.md`
- `docs/product/10_methodology_seeds/engine_comparative/97_SIGNAL_RENDER_AND_COMPOSER_SPEC.md`
- `docs/product/10_methodology_seeds/engine_comparative/98_PROD_READINESS_TRACKER.md`
- `docs/product/10_methodology_seeds/signal_pulse/47_CODEX_HANDOFF.md`
- `services/workers/src/workers/signal-pulse-steps.ts`
- `packages/query-engine/src/signal-topic-consolidation-editorial-v1.ts`
- `packages/query-engine/src/signal-topic-consolidation-bridge-v1.ts`
