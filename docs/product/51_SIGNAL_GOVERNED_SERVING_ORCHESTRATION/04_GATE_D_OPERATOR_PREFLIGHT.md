# Gate D · Preflight para corrida T&B desde la interfaz

## Propósito

Gate D no es sólo “picar un botón”: la interfaz debe congelar una population gobernada,
encolar una corrida workspace-native, pasar Review y publicar una revisión del mismo
reporte. Esta flight card deja ese flujo listo; el operador conserva la decisión de
presupuesto y el lanzamiento pagado.

## 1. Auditar el camino real

Revisa el flujo existente desde Admin/Signal hasta:

- selección de workspace y periodo;
- resolución server-side de la view/policy estratégica;
- freeze de snapshot V2 reproducible modulo erasures;
- dispatch durable e idempotente;
- Workers y recuperación de leases/fallos;
- T&B artifacts/evidence;
- Review y publicación de release;
- navegación al reporte current del workspace;
- segunda corrida como nueva revisión, no otra página.

No uses output/corpus legacy como autoridad. Pueden permanecer únicamente como lineage
de ejecución mientras dure el bridge.

## 2. Corregir únicamente bloqueos reales

Si el flujo no puede consumir la population gobernada, implementa el delta mínimo
forward-only y pruébalo local/staging sin ejecutar LLM. No fabriques un snapshot JSON ni
conectes el frontend a `published_outputs.payload`.

Confirma que los usos requeridos por la corrida (`llm-processing` y
`strategic-analysis`) están autorizados por policy/provenance. Unknown falla cerrado.

## 3. Dry-run sin costo

Ejecuta un preflight que compruebe:

- Workers/config/queues disponibles;
- snapshot candidato y digest;
- denominator, coverage y periodo;
- evidence roots y aliases;
- prompt/model identity prevista;
- presupuesto estimado y hard cap requeridos;
- idempotency key y retry policy;
- Review/release destinations;
- rollback/cancel path antes del dispatch.

No llames Claude, Voyage ni encoles una corrida real. No cambies un release current.

## 4. QA de interfaz

Comprueba que el operador puede iniciar el flujo desde la interfaz canónica y que ésta:

- muestra workspace, view, periodo, denominator y coverage;
- muestra modelo, estimación y hard cap antes de confirmar;
- distingue preflight, queued, running, Review, failed y published;
- no permite doble submit;
- enlaza después evidence a menciones canónicas;
- conserva navegación y loading canónicos.

Si falta polish visual, regístralo para Gate E. No rediseñes el producto desde backend.

## 5. Handoff al operador

Genera una flight card compacta con:

- URL exacta de la interfaz;
- workspace/view/periodo elegibles;
- snapshot y denominator esperados, sanitizados;
- workers que deben estar online;
- cap que el operador debe introducir/autorizar;
- pasos de confirmación;
- señales de éxito/fallo;
- cómo volver a Review y publicar;
- cómo comprobar que una segunda corrida crea una revisión.

## Checkpoint Gate D

- `gate_05b`, `gate_05c` y `gate_06` verdes;
- preflight gratuito completo;
- no existe bloqueo backend conocido;
- Advisor review sin P0/P1;
- `allow_paid_tb_run` sigue en `false`;
- cero jobs pagados creados;
- `READY_FOR_GATE_D_OPERATOR=true`.

Detente y devuelve control al usuario. El usuario ejecutará la corrida desde la interfaz.
