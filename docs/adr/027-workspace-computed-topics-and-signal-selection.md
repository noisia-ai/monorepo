# ADR027 — Pertenencias computadas y selección individual en Signal

Fecha: 8 septiembre 2026 (America/Mexico_City).
Estado: implementación local, pendiente de entrega y comprobación UAT.

## Decisión

El análisis workspace-native existente termina creando, en la misma transacción,
una ejecución de clasificación y su outbox durable. El Worker consume todos los
archivos de asignaciones de las vías abierta y guiada, verifica sus hashes y censos,
y agrega pertenencias por mención canónica y Topic. No vuelve a ejecutar embeddings,
BERTopic ni Claude para guardar las pertenencias que el análisis ya calculó.

Se reutilizan las generaciones, items y assignments de0087/0136. SQL0140 distingue
`membership_basis=computed_cluster` de una decisión ordinaria. Esta base sólo admite
`pending/model` sin política de aprobación. El modelo registrado corresponde al
catálogo resultante y conserva referencias al modelo, output e interpretación de
origen. Publicar una etiqueta no convierte una pertenencia numérica en precisión
semántica calibrada.

La propuesta de interpretación se compara con el significado materializado del
Topic. Una definición editada no hereda pertenencias bajo otro significado. Se
mantiene la evidencia numérica y se declara incertidumbre. Los Topics archivados se
verifican como parte del censo, pero no bloquean la clasificación restante.

## Selección y edición

La selección de Signal pertenece al workspace, fuera del contexto de Brand OS y del
catálogo semántico. Cada acción usa autoridad de ejecución ya existente, revisión
esperada y un recibo idempotente en las operaciones del catálogo. Inicialmente no
hay Topics seleccionados. Se exige al menos una pertenencia vigente para añadir un
Topic; no se interpreta cero assignments como una evaluación semántica válida.

La generación que se eligió queda en el recibo. La preferencia persiste entre
generaciones compatibles, para que importar un mes nuevo no obligue a volver a
seleccionar cada Topic. Una definición incompatible invalida su selección efectiva.
Archivar elimina la selección; restaurar no la recupera. Cambiar sólo el nombre puede
conservar cifras si permanecen iguales todas las identidades semánticas, de contexto,
embeddings y correcciones, aunque cambie el identificador físico del perfil.

## Lectura de Signal

El resolver reconoce la fuente nativa antes de exigir un corpus operacional antiguo.
Reutiliza la navegación, header, gráficos y drawer de Signal con un contrato
discriminado. No adapta un perfil draft a un tipo active ni usa published_outputs.

El alcance es explícitamente `all_conversations`: corpus recibido y preparado de
la marca, sin inferir atribución semántica de los nombres de los archivos. SQL calcula
conteos por raíz y la unión de las menciones de Topics seleccionados. La suma de los
Topics puede superar el denominador porque una mención puede pertenecer a varios.
Las menciones sin resolver provienen del resultado guardado, no de la decisión de
ocultar un Topic.

Cada lectura verifica permisos actuales de métricas derivadas. La evidencia requiere
además lista y texto en una misma ruta de procedencia autorizada; permiso de
procesamiento LLM no sustituye ninguno de ellos. La precedencia del binding por
importación sobre el binding por fuente se conserva. Se reevalúan retención y vigencia.

La evidencia usa paginación por ID canónico, texto acotado sin romper Unicode y cursor
ligado a workspace, actor, generación, selección, periodo y derechos. Un resultado
desactualizado puede mostrar cifras históricas identificadas como tales; no devuelve
texto desactualizado. La interfaz retira el texto ante403/404/409.

## Consecuencias y límites

- Se agrega una proyección relacional a la cola existente, sin un motor ni framework nuevo.
- Clasificación, selección, aprobación semántica y derechos son hechos distintos.
- El final de análisis y su siguiente trabajo son atómicos; no hay enqueue efímero
  después del commit. La recuperación conserva cursor y evita duplicados.
- Mostrar resultados sigue siendo una selección del operador. Refrescar un Topic
  previamente seleccionado y compatible es parte de su monitoreo.
- Este corte aún no acredita precisión semántica, capacidad medida sobre millones
  de menciones, todos los roles self-service ni el monitoreo incremental completo.
- La siguiente carga incremental, novedades, excepciones y autorización cliente
  continúan en el Compass y backlog. No se recuperan datos antiguos de producción.

La evidencia local, límites de simulación y recibos de entrega se mantienen en
`docs/product/PROMPT_LOOPING/WORKSPACE_TOPICS_SIGNAL_INTEGRATION_2026-09-08.md` y su
recibo de cierre. Este ADR no autoriza ni declara un despliegue de producción.
