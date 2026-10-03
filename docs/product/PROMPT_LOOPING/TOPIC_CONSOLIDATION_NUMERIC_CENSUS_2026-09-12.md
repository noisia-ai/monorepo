# C2 — censo numérico para consolidación de Topics

Fecha: 2026-09-12
Estado: implementación local, sin proveedor, sin UAT

## Resultado

El Worker puede descargar el bundle numérico inmutable de una ejecución
`workspace-topic-engine-v1`, verificar sus recibos SHA-256 y reconstruir el
censo completo de grupos atómicos. Para cada grupo conserva:

- identidad estable, lane, label local, términos y digest de todas las
  asignaciones;
- todas las raíces y chunks asignados, con fuerza media y digest por raíz;
- hasta diez referencias de evidencia selladas, con locale, plataforma y fecha;
- distribución de scope, locale, plataforma y mes;
- referencias al output y al modelo originales, sin copiar texto ni vectores.

El caso sintético obligatorio reconstruye **1,652 de 1,652 grupos**. Una
asignación modificada fuera del recibo es rechazada antes de materializar.

## Ensayo PostgreSQL real

La migración `0174` se aplicó desde cero sobre una copia aislada del esquema
completo con PostgreSQL 17 y pgvector 0.8.2. Se verificaron las diez tablas, la
vista y las funciones privadas, incluidos entornos que no crean los roles
Supabase `anon` y `authenticated`. Un ensayo con 1,652 centroides de 1,024
dimensiones produjo los diez vecinos exactos de cada grupo en **10.398 s** en
el contenedor local. Es trabajo asíncrono de preparación, no latencia de una
pantalla ni una llamada a proveedor.

## Centroides exactos para la ejecución actual

El output actual exporta `assignments.<lane>.jsonl`, `clusters.<lane>.json`,
`population.jsonl`, `roots.jsonl`, modelos `.joblib`, guías y, para el lane
guiado, `guide-center.npy`. No exporta un centroide verificable por
`stable_cluster_id`, y tampoco conserva `vectors.npy` en el bundle de salida.

`guide-center.npy` es un único centro global utilizado para la transformación
guiada. No representa centroides de los grupos. `topic_embeddings_` dentro del
joblib es estado interno de BERTopic y no tiene hoy un contrato sellado que lo
vincule uno a uno con `stable_cluster_id`; además puede representar el espacio
c-TF-IDF y no el espacio Voyage de 1,024 dimensiones.

Para la ejecución actual existe un fallback exacto y gratuito: la ejecución
conserva `embedding_run_id` y `embedding_config_digest`, `population.jsonl`
conserva `chunk_sha256`, y PostgreSQL conserva
`signal_workspace_chunk_embeddings`. El Worker carga la membresía exacta en una
tabla temporal, exige cobertura completa, calcula `avg(vector(1024))` por grupo,
normaliza cada promedio y ejecuta kNN coseno exacto. Los centroides se sellan en
`centroids.consolidation.<digest>.json` y cada grupo referencia ese artefacto.
Las comunidades son componentes deterministas de los vecinos que superan el
umbral versionado. No se usan términos o labels como proxy.

Si falta una sola embedding del config original, el proceso falla con
`topic_consolidation_embedding_coverage_incomplete`; no degrada a coincidencia
léxica. Las afinidades individuales de Brand OS permanecen vacías porque el fit
actual tampoco exportó scores por guía.

## Siguiente contrato numérico

El fit debe exportar un artefacto explícito por lane, por ejemplo
`centroids.open.npy` más un índice JSON canónico que vincule cada fila a
`stable_cluster_id`, dimensión, espacio/modelo de embeddings, normalización y
SHA-256. Con ese recibo se puede construir kNN/comunidades sin Voyage ni Claude.

La función del Worker queda disponible para una cola, pero el dispatch del
outbox se mantiene para el siguiente subcorte, junto con lease, heartbeat y
recuperación. El censo, el artefacto de centroides y el plan de comunidades son
idempotentes.
