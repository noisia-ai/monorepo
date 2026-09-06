# Topic Rule Drafts y pruebas léxicas

Referencia de los cortes LAB-2Y/2Z, 6 de septiembre de 2026. Motor local auditado;
integración de pantalla en revisión local. Esto
no implica que la migración 0123 o una nueva UI estén desplegadas. Los diez candidatos
y sus citas ya visibles en UAT pertenecen al corte anterior LAB-2X.

## Qué resuelve

Un candidato explica **de qué trata** un tópico. Un borrador de regla especifica
**qué palabras o frases probar** para encontrar menciones relacionadas. La prueba
calcula resultados sobre las membresías congeladas, incluidas las no agrupadas por
BERTopic; no vuelve a ejecutar BERTopic ni llama a un modelo.

El borrador no adopta el tópico. Una coincidencia de palabras tampoco demuestra por
sí sola relevancia semántica, sentimiento, atribución de campaña, precisión o recall.
La explicación de esta separación y el siguiente paso están en [ADR 019](../adr/019-candidate-bound-topic-rule-drafts.md).

## Contrato de regla

El schema público `signalTopicRuleSpecSchemaV1` vive en
[`signal-topic-rule-spec-v1.ts`](../../packages/query-engine/src/signal-topic-rule-spec-v1.ts).
Todos los objetos son cerrados: campos desconocidos se rechazan. Ejemplo válido,
redactado explícitamente para una prueba; no es una regla aprobada de Alexa:

```json
{
  "contract_version": "signal-topic-rule-spec-v1",
  "kind": "topic",
  "label": "Alexa y fútbol en México",
  "definition": "Coocurrencia léxica; no establece atribución de campaña.",
  "lexical": {
    "any": ["fútbol", "futbol", "mundial"],
    "all": ["alexa"],
    "not": []
  },
  "filters": { "languages": [], "markets": ["MX"], "scopes": [] }
}
```

| Campo | Significado y límite |
|---|---|
| `label` | Nombre; 1–160 caracteres, sin extremos vacíos. |
| `definition` | Descripción; 1–1,500 caracteres. No se convierte automáticamente en matcher. |
| `lexical.any` | Debe coincidir al menos una frase, cuando la lista no está vacía. |
| `lexical.all` | Deben coincidir todas las frases de esta lista. |
| `lexical.not` | No debe coincidir ninguna frase de esta lista. |
| Listas léxicas | Hasta 16 frases por lista, 32 en total y 160 caracteres por frase; al menos una en `any` o `all`. |
| `filters.languages` | Hasta 16 códigos de dos letras minúsculas, por ejemplo `es`. |
| `filters.markets` | Hasta 16 códigos de dos letras mayúsculas, por ejemplo `MX`. |
| `filters.scopes` | Hasta 16 valores: `primary_brand`, `same_entity`, `competitor`, `category`, `other`. |

Los filtros operan sobre metadatos congelados; no deciden disponibilidad comercial
ni autoridad de locale. Una lista vacía no restringe ese campo, incluso si su valor
es desconocido (`NULL`). Una lista no vacía exige un valor coincidente. Dentro de
cada filtro se usa OR; entre filtros se usa AND.

Las listas se ordenan y deduplican. Se compactan espacios ASCII dentro de frases;
la grafía Unicode y los acentos se conservan. Cada frase pasa como **parámetro** a
`phraseto_tsquery('simple', ...)`: no es SQL, regex ni un programa `tsquery`.
PostgreSQL tokeniza y compara posiciones de palabras. No es comparación byte a byte,
substring, traducción ni similitud semántica; conviene probar variantes explícitas.

## Funciones públicas

En `@noisia/query-engine`, sin I/O:

- `parseSignalTopicRuleSpecV1(value)`: valida y devuelve la forma canónica.
- `signalTopicRuleSpecDigestV1(value)`: SHA-256 de esa forma canónica.
- `compileSignalTopicRuleSpecV1(value, { placeholderOffset? })`: devuelve `spec`,
  `spec_digest`, `compiler_version`, `predicate`, `filter_predicate`,
  `lexical_predicate`, `values` y `plan_hash`.

`placeholderOffset` acepta enteros 0–1,000. Los predicados usan el alias fijo
`eligible` y sus columnas `text_clean`, `language`, `market`, `scope`. Cambiar la
posición de parámetros no cambia `plan_hash`. El compilador no ejecuta la consulta
ni elige población, credenciales o permisos.

En [`@noisia/db`](../../infrastructure/db/signal-topic-contract-drafts.ts):

| Función | Entrada específica |
|---|---|
| `createSignalTopicContractDraftV1` | `client`, workspace/actor, run/candidate keys, CAS del candidato, revisión/digest anteriores del borrador, `idempotency_key`, `rule_spec`. |
| `loadSignalTopicContractDraftV1` | `queryable`, workspace/actor, run/candidate keys. Devuelve el último borrador o `null`; no ejecuta una prueba. |
| `loadSignalTopicContractDraftLatestTrialV1` | La misma identidad. Devuelve la última prueba del último borrador, o `null` si ese borrador aún no se probó. |
| `runSignalTopicContractDraftTrialV1` | `client`, workspace/actor, `draft_id`, CAS de candidato y borrador, `idempotency_key`, límites opcionales. |

CAS significa comprobar que la versión que se leyó sigue vigente. Para el candidato
se envían `expected_candidate_revision` y `expected_candidate_state_token`; para
el borrador, `expected_draft_revision` y `expected_draft_digest`. El primer borrador
usa revisión `0` y digest `null` como predecessor esperado. El servidor resuelve
los IDs internos a partir del candidato y snapshot existentes.

El caller posee la transacción: abre `BEGIN` en un cliente PostgreSQL reservado,
invoca el writer y hace `COMMIT` o `ROLLBACK`. El writer usa un savepoint, no un
`pool.query` desconectado de la transacción. El wrapper de producto debe usar
`SERIALIZABLE`, no reintentar ciegamente una escritura y liberar el cliente al terminar.
No se toman credenciales ni URLs de la petición del navegador.

Solo un actor interno activo y autorizado para el workspace puede operar. La misma
clave idempotente y petición del mismo actor recuperan el resultado persistido;
cambiar actor o petición produce conflicto. No hay autoejecución de pruebas en GET.

El GET de producto lee candidato, borrador y prueba dentro de una sola transacción
`REPEATABLE READ READ ONLY`. Nunca devuelve una prueba del borrador anterior como
si correspondiera al nuevo. Revalida únicamente la disponibilidad actual de los
ejemplos del recibo; no vuelve a calcular conteos ni crea recibos.

## Uso en el editor de candidatos

En el drawer existente, **Probar una regla del candidato** usa el nombre y descripción
ya guardados. Si la edición editorial tiene cambios pendientes, se guardan primero.
Las frases de `Cualquiera`, `Todas` y `Excluir` se escriben una por línea; una coma no
divide una frase. Los filtros de idiomas y países son opcionales.

**Guardar borrador** añade una versión sin sobrescribir la anterior. **Probar borrador** mide
exactamente esa versión, con cap de 25,000 y timeout de 15 segundos. **Actualizar**
solo consulta lo guardado. No se piden motivo, comentario justificativo ni una
segunda confirmación; tampoco se llama a un proveedor.

Si se pierde una respuesta, la pantalla conserva la misma petición y clave en la
sesión del navegador. Primero se actualiza el estado y luego puede recuperarse esa
misma solicitud, sin crear otra prueba. Un conflicto de versiones requiere releer
el candidato/borrador; no sobrescribe el trabajo de otro operador.

## Resultado y denominadores

La prueba tiene límites explícitos: `max_memberships=25000` por defecto, rango
1–50,000; `example_limit=10`, rango 0–10; `timeout_ms=15000`, rango 1–15,000 ms.
No llega a filas fuera del snapshot. El orden del cap es `assignment_index, member_ref`,
no una muestra aleatoria ni representativa.

Antes de comparar texto se verifica workspace, fuente activa, mención incluida,
raíz canónica e integridad del contenido respecto de la membresía original. Un
contenido que ya no cumple esas comprobaciones no se presenta como evidencia válida.

| Contador | Qué mide |
|---|---|
| `total` | Todas las membresías del snapshot congelado. |
| `considered` | Membresías alcanzadas por el cap, antes de disponibilidad y filtros. |
| `not_tested` | Las que quedaron fuera por el cap. |
| `unavailable` | Alcanzadas, pero ya no disponibles o íntegras para esta prueba. |
| `filter_excluded` | Disponibles pero fuera de los filtros explícitos. |
| `matched` | Disponibles, dentro de filtros y con coincidencia léxica. |
| `abstained` | Disponibles y dentro de filtros, sin coincidencia léxica. No significa tópico negativo confirmado. |

Siempre deben reconciliar:

```text
total = considered + not_tested
considered = unavailable + filter_excluded + matched + abstained
```

La respuesta conserva versión/digests de borrador, regla, compilador, plan, snapshot,
población y filas consideradas. Los ejemplos tienen referencia opaca, resultado,
excerpt sanitizado de hasta 600 caracteres y metadatos acotados. Son ejemplos
determinísticos de filas disponibles, primero coincidencias y después abstenciones
—no una muestra para estimar precisión— y
no se devuelve el corpus completo ni IDs de menciones arbitrarias.

En un replay se conservan conteos/digests históricos, pero se comprueba otra vez la
disponibilidad de los ejemplos sin repetir el matching. `example_availability`
contiene `stored`, `available` y `unavailable`; los excerpts no disponibles se omiten.
Esta proyección no reescribe el recibo. Un excerpt de los primeros 600 caracteres
puede no mostrar la palabra que coincidió más adelante en un artículo largo.

## Persistencia y vigencia

La [migración 0123](../../infrastructure/db/migrations/0123_signal_topic_contract_drafts.sql)
añade solo `signal_topic_contract_draft_versions` y
`signal_topic_contract_draft_trial_receipts`. No modifica membresías, candidatos,
modelos, taxonomías activas, assignments ni `record_tags`.

Guardar otra regla añade una revisión; no sobrescribe la anterior. Un cambio en
la revisión editorial del candidato vuelve obsoleto su borrador. `is_stale` lo
expresa y una nueva prueba de ese borrador se rechaza. Un replay histórico puede
devolver su recibo anterior marcado con la vigencia actual, sin medir otra vez.

El resultado declara siempre `topic_adoption=false`, `publication=false` y
`serving=false`. Para convertirlo después en clasificación real hace falta el
catálogo/cohort, política y registro de resultados que ya existen en
[0087](../../infrastructure/db/migrations/0087_signal_classification_authority.sql),
además de validar la calidad de las reglas. Este corte no implementa esa adopción.

## Verificación

El compilador tiene pruebas focales y está incluido en la suite de Query Engine.
El DB writer requiere pruebas con PostgreSQL real: aplicación local de 0123,
reglas con frases/filtros, denominadores, permisos, CAS y replay, dentro de rollback.
Los resultados reales y el estado de despliegue se registran en Prompt Looping;
pasar TypeScript o unit tests no equivale a haber clasificado menciones en UAT.

La prueba local de este corte recorrió 21,195 membresías, incluidas 10,009 fuera de
clusters. Con filtro MX, 5,121 quedaron dentro del filtro: una regla amplia de Alexa
y fútbol produjo 517 coincidencias; una de nombre/hashtag de campaña produjo 8.
Una ejecución limitada a 100 registró 21,095 como no probadas. Las tres se ejecutaron
con PostgreSQL real y rollback; no son assignments ni un despliegue UAT.
Las ocho coincidencias específicas incluyen copias de contenido promocional: no se
presentan como ocho consumidores únicos ni evidencia de reacción orgánica.
