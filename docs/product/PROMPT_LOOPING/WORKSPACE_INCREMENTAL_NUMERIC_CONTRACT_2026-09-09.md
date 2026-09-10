> **Contrato aprobado para implementación LOCAL por Root, 9 septiembre 07:47 UTC.** El frente computacional implementa adapter y pruebas en los cuatro archivos indicados. No hay entrega SQL/Worker/UAT incremental todavía. Preservar el full-fit existente; este documento amplía el Compass y el plan de monitorización, no los sustituye.

# Corte propuesto: delta numérico reconciliado, 9 septiembre 2026

Estado: propuesta para decisión de Root. Sin cambios de runtime, SQL, Worker, proveedores o UAT. Complementa `INCREMENTAL_NEXT_CUT.md`; no modifica 0144 ni declara terminado el monitoreo.

## Decisión recomendada

Implementar un adapter Python incremental junto al adapter full-fit actual, con un contrato nuevo y cerrado. Conservar íntegros los bytes/perfiles/recibos de `workspace-topic-engine-*-v1`.

El adapter hará tres operaciones diferentes:

1. Comparar el universo completo de raíces autorizado por el servidor con el manifiesto padre. Copiar resultados numéricos compatibles de las raíces sin cambios y transformar **todos** los fragmentos de raíces nuevas o con texto cambiado mediante los modelos congelados conocidos.
2. Descubrir en un cohort de **todas** las raíces nuevas/con texto cambiado, incluidas las que predicen pertenencia conocida. El cohort se acumula; no se ajusta otra vez toda la historia por cada CSV. Contexto y guías siguen afectando sólo la vía guiada; la abierta conserva los vectores originales.
3. Producir un manifiesto reconciliado del universo actual completo, con procedencia real de cada modelo/membresía. Cuando nace un modelo de cohort, transformar también el histórico elegible fuera del cohort para recuperar una narrativa nueva en conversaciones antiguas, aunque ya estuvieran asignadas. Eso es inferencia con caché existente, no un full-fit histórico ni embeddings nuevos.

La inferencia produce membresía computacional con calidad no calibrada. La interpretación, la relación editorial con Topics existentes y la selección en Signal siguen siendo contratos separados. No usar el coseno ni el overlap para aprobar automáticamente una relación semántica.

## Reutilización exacta

- `workspace_engine.py:184–301`: validación de NPY f32/1024, hashes, orden, SHA de cada fragmento, cobertura UTF16 y SHA del texto completo. El primer corte local puede recibir el spool completo actual, sin exigir todavía un exportador DB nuevo.
- `workspace_engine.py:369–452`: `_guide_matrix`, incluyendo todos los prototipos, veto negativo y centro congelado del modelo al transformar. No recalcular ese centro con la nueva carga al predecir con un modelo anterior.
- `workspace_engine.py:455`: `_fit`, BERTopic/UMAP/HDBSCAN con perfil existente, `prediction_data=True`, sin descargador/modelo de embeddings.
- `workspace_engine.py:655–750`: verificación del padre antes de deserializar y transformación de páginas 128. La implementación nueva emitirá referencias completas de evidencia; no convertirá el JSONL diagnóstico viejo en contrato de serving.
- `workspace_engine.py:516`: representantes deterministas de raíces distintas con frontera de afiliación, máximo 10. Sus límites no recortan membresías ni grupos.
- `workspace_engine.py:575`: overlap/lineage como **evidencia de relación propuesta**, sin usarlo para renombrar los grupos conocidos congelados.
- Manifiestos/almacenamiento privados y patrón stage→rename existentes. Sin nuevo algoritmo, dependencia, cola o base de datos local auxiliar.

## Inputs cerrados

Nombre propuesto: `workspace-topic-incremental-input-v1`. Configuración del servidor, nunca JSON libre del navegador.

```ts
type IncrementalInput = {
  contract_version: 'workspace-topic-incremental-input-v1';
  workspace_id: string;
  execution_id: string;
  mode: 'frozen-model-delta';
  policy_version: 'workspace-frozen-model-cohort-v1';
  current_input_manifest: FileRef; // spool actual existente, completo y verificado
  current_roots: FileRef;         // JSONL metadata, una fila por raíz elegible actual
  parent: { execution_id: string; output_manifest: FileRef };
  compatibility: {
    embedding_config_digest: string;
    chunk_policy_version: 'corpus-text-chunks-v1';
    context_digest: string;
    input_interest_catalog_digest: string;
    guides_digest: string;
    fit_config_digest: string;
    runtime_digest: string;
  };
  discovery: {
    cohort_key: string;           // digest de política + membresía completa del cohort
    pending_cohort: FileRef | null;
    close_requested: boolean;     // decisión sellada del coordinador; no reloj Python
  };
};
type FileRef = { file: string; sha256: string; bytes: number; rows?: number };
type CurrentRoot = {
  root_id: string;
  root_fingerprint: string;       // identidad completa suministrada por servidor
  asset_sha256: string;
  expected_chunks: number;
  chunk_coverage_digest: string;  // SHA de [index,start,end,sha] + '\n', contrato 0134
  correction_digest: string;      // evidencia de correcciones; Python no las aplica
};
```

`current_roots` tiene orden UUID canónico, no duplicados. El conjunto de raíces y el número de fragmentos deben coincidir exactamente con el spool. Una ausencia del padre significa `removed_or_ineligible`; Python no inventa el motivo de derechos. El servidor puede adjuntar después el motivo autorizado. Los UUIDs de ejecución/procedencia no son parte de la identidad semántica del modelo.

La compatibilidad de modelos excluye el catálogo de Topics generados/editados. Incluye **los intereses de entrada** y sus guías, Brand OS, perfil de embeddings/chunks y runtime exacto. La semántica actual de cada Topic seguirá siendo una precondición de la proyección, no se altera para heredar clusters viejos.

Si cambian runtime, contexto, guías o política, el modo delta devuelve `rebuild_required` antes de cargar pickle o publicar resultados. El coordinador decide un full-fit explícito mediante el camino existente. No se presenta ese refit como delta ni se mezcla su población con predicciones incompatibles.

## Plan de raíces y cohort

Python reconstruye el plan con un join ordenado padre/actual; no confía en una lista cliente que omita raíces.

| Transición | Acción numérica | Acción de autoridad/proyección posterior |
|---|---|---|
| `unchanged` | Copia referencias de membresías y comprobante de evaluación anterior. | Revalida derechos y correcciones vigentes. |
| `metadata_changed` | Si asset+partición+perfil son idénticos, reutiliza el resultado numérico. | Nueva huella; no copia ciegamente la decisión SQL/humana anterior. |
| `added` / `content_changed` | Invalida la membresía anterior de esa raíz y transforma todos sus chunks, en páginas 128. Todos entran al cohort. | Evidencia con nueva huella y referencias exactas. |
| `removed_or_ineligible` | Sin membresías en el resultado actual; tombstone metadata. | Nunca reaparece por copiar el padre o por backfill. |

El cohort pendiente es una unión por `(root_id, root_fingerprint, chunk_index, chunk_sha256)`. Antes de usarlo se une al universo actual: se retiran raíces eliminadas/no elegibles y se sustituye la versión anterior de una raíz editada. Contiene todos los chunks de cada raíz añadida/editada, no sólo los que acabaron outlier.

Se ejecuta discovery sólo si `close_requested` y el cohort supera el mínimo que ya impone el perfil: más de `max(hdbscan_min_cluster_size, hdbscan_min_samples, umap_n_neighbors)` ocurrencias. Con el perfil actual son más de 40 **fragmentos**, no 40 menciones ni garantía de un cluster. Una raíz larga no cuenta como muchas menciones. Si no alcanza el mínimo, se conserva `pending_insufficient_population` con cobertura exacta; la predicción de conocidos sí puede completarse. El cierre de cohort/cadencia monetaria no lo programa este adapter.

## Output reconciliado

Nombre: `workspace-topic-incremental-output-v1`. Un manifest de autoridad computacional para la generación hija, sin atribuirle archivos del padre como si los hubiera creado.

Artefactos requeridos:

- `root-transitions.jsonl`: join completo, huellas previas/actuales y acción elegida.
- `population.jsonl` y `roots.jsonl`: universo actual completo, ordenado, SHA/cobertura/estado por raíz. Cero filas activas para eliminadas.
- `memberships.jsonl`: membresías positivas dispersas ordenadas por raíz/chunk/modelo/unidad. No filas vacías por cada Topic y no Top32.
- `model-components.json`: lista aplanada de modelos activos, origen real (`execution_id`, artifact/ref SHA), lane, config/runtime/guías/centro y mapa label→unit_key. No cadena recursiva ilimitada de manifiestos para encontrar un modelo.
- `component-coverage.json`: por componente, digest del universo actual evaluado, ocurrencias copiadas/transformadas/ajustadas y sus totales. La validación reconstruye la población esperada; el comprobante no acepta un contador sin universo sellado.
- `candidate-groups.json` y `relations.json`: todos los grupos del nuevo cohort, censo y digest de membresía completa, representantes acotados y relaciones propuestas con conocidos.
- `pending-cohort.jsonl`: entradas todavía no cerradas, completas y enlazadas al snapshot actual.
- Modelos nuevos/centro guiado sólo cuando realmente hubo fit, con hashes/versiones verificados antes de cualquier carga posterior.

Una membresía conserva al menos:

```ts
type NumericMembership = {
  root_id: string; root_fingerprint: string;
  chunk_index: number; start: number; end: number; chunk_sha256: string;
  lane: 'open' | 'guided'; unit_key: string; model_component_key: string;
  strength: number; // finita, sin renombrarla confianza semántica
  model_origin: { execution_id: string; model_artifact_sha256: string };
  evaluation_origin: {
    execution_id: string; input_population_digest: string;
    evaluation_key: string; basis: 'fitted_member' | 'predicted_member';
  };
  carried_from: { output_manifest_sha256: string; membership_digest: string } | null;
};
```

`model_origin` identifica el modelo real; `evaluation_origin` identifica el fit/transform que midió esa ocurrencia. Por ejemplo, un transform de la segunda oleada cita modelo de la primera y evaluación de la segunda. `evaluation_key` sella ejecución+componente+universo evaluado+método, sin referencia circular al SHA del output que lo contiene. `carried_from` describe copia de una observación vigente; nunca la convierte en una nueva medición ni copia autoridad de una raíz cambiada. Los modelos antiguos conservan su mapa label→unit_key: el transform no vuelve a ejecutar la heurística de stableIDs.

El resolver futuro de almacenamiento recibirá referencias de origen, artifact_key y SHA; todos los archivos se ubican en scratch del servidor y se verifican antes de abrirse. Los paths nunca proceden de los textos importados, ni se ejecuta pickle sin resolver/verificar su cadena de autoridad. Los IDs DB se resolverán al persistir; Python no los fabrica.

La agregación por raíz es unión de unit_keys; un mismo root/chunk puede pertenecer a varios modelos/grupos. Los outliers se representan mediante cobertura completa y estado de raíz, sin inventar una unidad. El manifest distingue `known_prediction_complete`, `discovery_pending`, `discovery_complete` y `relations_pending`; no llama completa a la interpretación editorial.

## Novedad, identidad y prevención de Topics duplicados

La nueva ejecución no modifica los modelos conocidos. Los modelos de cohort se añaden como componentes inmutables; se procesan de uno en uno. Cada grupo nuevo nace con ID determinista ligado al workspace, lane, digest del cohort, label y digest de su membresía completa. Su ID queda congelado para futuras predicciones.

Un fit del cohort puede redescubrir A mientras descubre C. **A' no se convierte automáticamente en otro Topic ni se funde con A sólo por overlap.** El output conserva A' como candidato y emite las intersecciones completas entre raíces, predicciones de A y membresía de A'; la relación es propuesta `continuation / novel / split / merge / ambiguous`. Las cifras las calcula código. El paso editorial posterior decide un vínculo versionado con evidencia, bajo sus recibos/cap, y el writer lo valida. En este corte local no se inventa esa decisión ni se cambia el catálogo.

Por ello, `known` significa conocido numéricamente, no aprobado/interpretado. C puede ser un componente conocido en la tercera oleada aunque su nombre todavía esté pendiente. Sólo una relación explícita podrá reutilizar el Topic A para A'; lo no resuelto queda visible y no crea selección automática en Signal. Las correcciones humanas y Topics editados/archivados se resuelven después con los guards actuales; Python no los invalida ni los aprueba.

Un componente nuevo evalúa cohort + histórico elegible restante. Los componentes anteriores sólo evalúan added/content_changed y reutilizan las raíces sin cambio. Esto evita full-fit histórico rutinario y permite detectar C en una conversación antigua asignada a A. Tiene costo de inferencia sobre el histórico al crear un componente; no debe ocultarse como trabajo proporcional sólo al delta.

## Archivos de implementación del siguiente subcorte

Sólo cuatro archivos nuevos inicialmente:

1. `packages/query-engine/src/signal-workspace-engine-incremental-v1.ts`: tipos cerrados, parser, identidad/manifest/delta/cobertura y referencias de origen. No altera el shared full-fit v1 ni sus digests.
2. `packages/query-engine/src/signal-workspace-engine-incremental-v1.test.ts`: partición de universos, origen, invariantes, replay y alteraciones rechazadas.
3. `tools/signal-semantic-lab/src/signal_semantic_lab/workspace_incremental_engine.py`: CLI con los mismos argumentos privados actuales; reutiliza validadores, `_fit`, `_guide_matrix`, representantes y serializers existentes. Verificación explícita tanto de bootstrap v1 como de output incremental nuevo antes de deserializar.
4. `tools/signal-semantic-lab/tests/test_workspace_incremental_engine.py`: tres oleadas reales con embeddings sintéticos f32 y cero red; tests negativos pequeños y contadores de operaciones.

Si conviene extraer una función común de transform desde `workspace_engine.py`, sería un único refactor mecánico con prueba de igualdad del JSONL v1; no es necesario para arrancar el contrato nuevo. No tocar `discovery.py`, requirements o Docker.

Interfaces Python mínimas: `describe_contract()`, `build_root_delta(parent,current)`, `transform_component_pages(...)`, `discover_cohort(...)`, `reconcile_outputs(...)`, `run_workspace_incremental_engine(...)`. El CLI publica manifest sólo al cerrar todos los archivos/verificaciones; replay exacto devuelve el mismo resultado sin fit/transform. Un fallo conserva los artefactos padre y no publica manifest hijo parcial.

Los archivos DB/Worker/Signal compartidos quedan fuera de este subcorte. Para consumo real posterior necesitarán aceptar el **nuevo** source reconciliado y sus orígenes, en lugar de relajar 0140/0144. El exportador actual puede servir al primer harness local; la futura optimización de exportar sólo texto/vectores delta no es condición para comprobar el algoritmo.

## Prueba local de tres oleadas

Fixture determinista antes de ejecutar; sin tuning posterior, nombres/textos sintéticos y ejes f32 separados. Reutilizar el perfil BERTopic actual y el bloqueo de red del test existente.

| Oleada | Población y eventos | Aserciones obligatorias |
|---|---|---|
| 1 | 240 raíces A/B, con una raíz de 133 fragmentos que participa en ambas narrativas. 372 chunks. Bootstrap full-fit real una vez. | Todos los chunks cubiertos, roots=240, A/B numéricos, cero intereses permite open; configuración guiada separada conserva positivos/negativos. |
| 2 | Retirar 10 raíces de un chunk; añadir 160 (80 próximas a A,80 a C); cambiar4 existentes, incluyendo añadir C al final de la raíz larga ya asignada. Universo390 raíces/523chunks. | Copy de unchanged, transform de los297chunks de164 raíces added/changed; el nuevo fit recibe todo ese cohort, incluso los que predicen A/B. Ningún fit recibe las523 ocurrencias históricas completas. C incluye el fragmento134 (índice133) de la raíz ya conocida. Inferencia del componente nuevo cubre también todo el resto elegible. Tombstones sin membresías activas. A/B mantienen IDs de sus componentes congelados. |
| 3 | Retirar una raíz C; cambiar una C hacia A; añadir12 raíces C. Universo401raíces/534chunks; cohort nuevo13chunks, por debajo del mínimo. | El modelo de C persistido en oleada2 transforma las nuevas C con el mismo unit_key; no nuevo fit en esta oleada, cohort13 queda pending explícito. La raíz editada no arrastra membresía anterior; retirada ausente. Los133+fragmentos sin cambio se copian con cobertura exacta. |

La fixture tendrá también contenido repetido legítimo en distintas ocurrencias: reutilizar vector/hash no elimina raíces ni posiciones. Repetir el mismo input/parent/output produce replay con0fits/0transforms y el mismo manifest. Inyectar una fila root/chunk duplicada en el input se rechaza; no se deduplica silenciosamente para hacer pasar la cobertura. Esto prueba el contrato incremental frente a duplicados canónicos/replay, **no** vuelve a probar el upload CSV ni pretende una segunda importación UAT.

Pruebas negativas pequeñas: padre/modelo/hash alterado falla antes de joblib.load; mezcla de workspace/perfil/runtime devuelve error/rebuild_required; omitir una raíz sin tombstone, saltar el último chunk o cambiar partición sin cambiar texto falla; cohort pendiente que contiene una versión retirada/editada se reconcilia contra el snapshot actual; metadata/correction_digest cambiado conserva como mucho resultado numérico, nunca receipt de autoridad anterior. Reanudación antes del rename final no publica una generación parcial. Relaciones con continuidad/merge/split ambiguos no asignan alias automáticamente.

Instrumentación: llamadas fit y su censo real, páginas transform por componente, copied/transformed/fitted chunks, coverage digests, bytes de modelos, RSS/tiempo por fase, red=0. No afirmar precisión por esta geometría sintética, ni cobertura de selección/correcciones SQL, ni automatización por CSV/permiso monetario: pertenecen al siguiente consumidor PG/Worker.

## Límites explícitos para decidir

- Primer harness reutiliza `_load_input`, que hidrata textos/records globales. NPY es memmap pero eso no vuelve constante la memoria del adapter actual. El guard4GiB es un límite de admisión, no prueba2M; no hace falta reescribir todo el spool en este corte.
- El fit del cohort mantiene el costo de UMAP/HDBSCAN sobre ese cohort. Su tamaño debe tener control de capacidad, nunca muestreo oculto. Rebasarlo produce `capacity_exceeded` y conserva la última generación.
- El número y peso de componentes puede crecer entre consolidaciones. Cargar uno por vez evita RAM proporcional al banco completo, pero tiempo/disco e inferencia crecen. No inventar un límite de Topics ni truncar componentes; una política posterior de consolidación explícita puede reemplazarlos con linaje.
- La cobertura se prueba con manifests y recibos del universo; el agrupamiento/relación semántica puede seguir dudoso. La etapa de interpretación de relaciones aún necesita contrato propio y autorización vigente. Este subcorte no renueva grants ni envía prompts.
- Nueva narrativa sobre textos históricos sin ninguna señal en el delta requiere una revisión de discovery/consolidación programada explícita. La vía propuesta sí encuentra señal nueva de cohort y la busca en todo el histórico mediante inferencia, incluidos asignados.

**Resultado de este subcorte:** componente Python real que entrega delta y universo reconciliado verificables, con conocidas estables, emergencia sobre todos los nuevos/cambiados y recovery de artefactos. **Aún pendiente para monitoreo entregado:** consumo SQL del nuevo source, relaciones editoriales deduplicadas y política self-service durable que admita etapas/costos automáticamente.
