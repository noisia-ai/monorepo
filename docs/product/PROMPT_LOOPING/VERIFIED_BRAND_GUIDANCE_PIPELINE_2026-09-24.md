# Brand OS e intereses: conexión computacional comprobada en código

Fecha: 24 septiembre2026, ciclo posterior a entrega UIa42b9b4. Base examinada: a881d21. Tarea acotada de Root y revisión independiente Backend. No se ejecutaron tests cerrados, SQL, fit, imports, embeddings ni proveedores. No se inspeccionaron secretos. Esta evidencia es de implementación, no una evaluación de precisión ni una nueva corrida UAT. Amplía Compass e historia.

## Qué sí está conectado

Los intereses manuales guían por defecto; un Topic descubierto permanece como salida hasta seleccionarlo explícitamente como interés (`signalTopicGuidesDiscoveryV1`, packages/query-engine/src/signal-topic-catalog-v1.ts:65). Así se evita convertir automáticamente cada descubrimiento en una nueva semilla.

1. `packages/query-engine/src/signal-workspace-topic-inputs-v1.ts:108` compila definición/inclusiones/ejemplos como positivos y exclusiones/ejemplos negativos como negativos; incorpora el contexto del ámbito.
2. `infrastructure/db/signal-workspace-topic-prototype-inputs.ts:33` añade guías Brand OS positivas/negativas para primary_brand, competitor y category, con digests de contexto. Exige autoridad semántica vigente y consistencia de contexto.
3. `services/workers/src/workers/signal-workspace-embeddings.ts:91` usa el proveedor de embeddings, persiste recibo y vincula cada vector al hash de entrada; un recibo previo puede reutilizarse. Esto describe el código existente, no una llamada realizada en este ciclo.
4. `infrastructure/db/signal-workspace-engine.ts:274` construye guías topic:<term_key> y guías por ámbito; :582 recupera vectores con workspace/configuración/hash.
5. `services/workers/src/workers/signal-workspace-engine-files.ts:128` mantiene clave, rol, digest y orden vectorial al pasar los archivos a Python.
6. `tools/signal-semantic-lab/src/signal_semantic_lab/workspace_engine.py:360` compara positivos/negativos de cada guía contra cada bloque. Para un ganador mezcla 75% vector de la mención y25% del prototipo, asignando una etiqueta para orientar UMAP.
7. El mismo archivo :487 invoca BERTopic.fit_transform con embeddings=matrix e y=labels, con UMAP/HDBSCAN y representación lexical. Existe también recorrido abierto.

No se encontró una desconexión reproducible de Brand OS/intereses hacia la entrada guiada. No corresponde rehacer esa integración ni afirmar que Voyage sólo vectoriza el corpus.

## Qué no significa esa conexión

El veto negativo es local a cada guía. Un límite de marca no es un filtro global que borre menciones de todo el corpus; otra guía o el recorrido abierto puede conservar esa conversación. La guía ganadora tampoco convierte el cluster resultante directamente en el interés original. Los grupos computacionales y los Topics editoriales tienen identidades distintas. Se conserva el censo y la trazabilidad; la reducción de1,652 grupos a una organización manejable corresponde a consolidación/ranking editorial, no a destruir grupos originales.

La búsqueda específica de un interés es una ruta distinta: `packages/query-engine/src/signal-workspace-topic-search-v1.ts:210` calcula contraste positivo/negativo por fragmento y conserva puntuaciones de ámbito como evidencia. Su contrato declara quality=uncalibrated y approval_policy=none. `infrastructure/db/signal-workspace-topic-computation.ts:346` guarda sus candidatos como doubt. Ese resultado es recuperación semántica persistente; por sí solo no acredita clasificación automática aprobada ni publicación en Signal. Esto no describe ni invalida el resto de rutas de clasificación incremental/reglas/descubrimiento ya existentes.

## Evidencia y siguiente decisión de producto

Se inspeccionaron las pruebas existentes `tools/signal-semantic-lab/tests/test_workspace_engine.py:305` (geometría real distinta entre open/guided) y :369 (veto negativo/prototipos). No se repitieron ni se reportan como tests ejecutados hoy. Root contrastó compilador, lector y Python con el mapa independiente.

El próximo corte sobre intereses debe seguir un resultado concreto desde la búsqueda semántica hasta su pertenencia persistente y visibilidad en Signal, distinguiendo reglas, resultados editoriales y excepciones. Antes de implementar, comprobar qué camino ya resuelve esa transición para no duplicarlo. No introducir un umbral de similitud arbitrario ni exigir al usuario revisar todas las menciones. La aceptación real de calidad tendrá que comprobar interés conocido, falsos positivos, negativos de ámbito, tema emergente y segunda carga; esta revisión no reemplaza ese experimento ni autoriza gasto.

## Continuidad

UATa42b9b4 y Worker0b68b3e0 intactos. Signal desde primera importación permanece LOCAL y respaldado, pendiente de PGprivado28P01; no se reintentó conexión. Linear requiere reconexión: pendiente sincronizar esta distinción, sin ticket cerrado ni update remoto inventado.
