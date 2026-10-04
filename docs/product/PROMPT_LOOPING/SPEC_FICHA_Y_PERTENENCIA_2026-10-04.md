# SPEC — Ficha por mención y Motor de pertenencia (Noisia) · v1.1

Fecha: 2026-10-04 · Autor: Claude Opus 5.5 (asesor) con el fundador · Destinatario: Codex (orquestador + sub-chats)
Base de código: rama `develop` = `f4fb0b1` (idéntica a la integración del PR #14). Todas las rutas son relativas a la raíz del repo.
**Ubicación canónica:** `docs/product/PROMPT_LOOPING/SPEC_FICHA_Y_PERTENENCIA_2026-10-04.md` (versionado en `develop`). Cualquier otra copia es histórica.

Cambios v1.1 (revisión de Codex antes de WS2):
- **Contexto de entidades e invalidación** (§4.2b): la validez de una ficha depende también del contexto de entidades del Brand OS; cambios en alias, productos o competidores invalidan sólo las menciones afectadas, de forma determinista.
- **Varias entidades por mención** (§4.1): `entity.role` único se sustituye por un conjunto `entities[]` con tipo y prominencia; la compatibilidad de conceptos (§9.5) se evalúa contra cualquier entidad del conjunto.

---

## 0. Cómo usar este documento

1. **Codex orquestador** lee el documento completo una vez y abre **un sub-chat por Workstream (WS)** usando el bloque «Prompt del sub-chat» de cada sección 9.x. No reparte trabajo fuera de esos WS.
2. Cada sub-chat lee sólo: §1–§6 de este spec + su sección 9.x + los archivos que esa sección enumera. No necesita leer historia, recibos viejos ni AGENTS banners anteriores.
3. Orden y paralelismo en §8. Cada WS trabaja en **su propia rama** desde `develop` y abre PR hacia `develop` (§7).
4. Al terminar, cada WS escribe un recibo de **una página máximo** en `docs/product/PROMPT_LOOPING/DELIVERY_MFP_WS<N>_<fecha>.md` con: qué cambió, comandos ejecutados con su resultado, coste real, qué quedó fuera. Sin ensayos.

---

## 1. Resumen ejecutivo

**Qué construimos:** un producto que, para **cualquier marca**, toma un corpus importado y produce, con un coste de Claude de ~USD 100 por estudio como techo de diseño:

1. una **ficha por mención** (de qué entidad habla, quién habla, qué hace, si es relevante, y un «asunto» corto);
2. **discovery** (BERTopic + consolidación Claude, ya existentes) corriendo **sólo sobre menciones relevantes**;
3. un **motor de pertenencia multi-concepto** que decide, mención por mención y con cita literal, a qué intereses/Topics pertenece cada mención relevante;
4. **Signal** alimentado por esas pertenencias, con corrección humana y **segunda carga incremental**.

**Qué NO es:** no es una solución para Alexa+. Alexa+ y cualquier corpus actual son **datos desechables de ejemplo**. No hay backfill ni compatibilidad con datos viejos. Se prueba con un corpus local de **~1,000 menciones**.

**Decisión clave:** no se extiende el pipeline «interest decision V2» (tablas, guardas y autoridad cableadas a un solo interés y al prompt V2). Se crea un **motor nuevo, aditivo**, que reutiliza transporte de Batches, cachés, preparación, embeddings, discovery y Signal.

---

## 2. Por qué (diagnóstico que originó este spec)

Hechos verificados en código (`develop`) y recibos; no repetir esta investigación:

| Hallazgo | Evidencia | Consecuencia de diseño |
|---|---|---|
| La «búsqueda» de 10.5 h no era IA: era coseno contra guías, sin umbral, que retuvo 43,159/43,159 raíces como `doubt` | `packages/query-engine/src/signal-workspace-topic-search-v1.ts:12-13`; `infrastructure/db/signal-workspace-topic-computation.ts:300` | El barrido deja de ser prerrequisito de nada. |
| El tiempo fue I/O: ~30 sentencias SQL por raíz con `FOR UPDATE` sobre una fila por workspace | `infrastructure/db/signal-workspace-topic-computation.ts:47-77, 284-361` | Escritura por lotes en todo trabajo nuevo. |
| Claude (Sonnet 4.6, thinking off, 64 raíces/solicitud) leyó 5,120 menciones y aprobó 46; ~la mitad o más eran falsas según revisión del fundador | `services/workers/src/workers/signal-workspace-interest-decision-batch-v2.ts:19-41, 83` | Juez con razonamiento y grupos pequeños. |
| El modelo **no recibía** nombre del interés, ámbito, ejemplos +/- ni contexto de marca | Esquema completo `packages/query-engine/src/signal-topic-catalog-v1.ts:38-59` vs. lo enviado `signal-workspace-interest-decision-v1.ts:22-26`, `-v2.ts:71` | El contrato del juez incluye todo el concepto + Brand OS. |
| V3 metió reglas de Alexa (consentimiento, opt-out) en el prompt genérico | `services/workers/src/workers/signal-workspace-interest-decision-batch-v3.ts:18-20` | Prompts genéricos; la frontera vive en la definición (datos). |
| 1,416 de 1,652 grupos BERTopic (86%) fueron Noise; 19,957/43,159 menciones Noise | `docs/product/PROMPT_LOOPING/DELIVERY_GLOBAL_CITATION_CONTINUATION_2026-09-28.md:51-53` | Falta filtrar relevancia **antes** de discovery: la ficha. |
| Elegibilidad sólo administrativa (excluida, derechos, texto vacío) | `infrastructure/db/signal-workspace-corpus-preparation.ts:342-345` | La ficha añade la relevancia semántica. |
| En Signal, la pertenencia de conceptos descubiertos se hereda del grupo en lectura (vistas SQL) | `infrastructure/db/migrations/0181_signal_topic_consolidation_activation.sql:205-219` | Los conceptos adoptados pasan al motor por mención. |

---

## 3. Arquitectura objetivo

```
Importación (existente)  →  Preparación + chunks (existente)  →  Embeddings Voyage (existente)
                                      │
                                      ▼
                         [NUEVO] FICHA POR MENCIÓN  (WS2 Claude · WS3 JEV)
                         entidad · voz · acto · relevancia · idioma · asunto
                                      │
                   ┌──────────────────┴───────────────────┐
                   ▼                                      ▼
   DISCOVERY sólo sobre relevantes (WS6)        [NUEVO] MOTOR DE PERTENENCIA (WS5)
   BERTopic + consolidación Claude              conceptos = intereses del usuario
   → propone conceptos con definición  ──adoptar──▶  + conceptos descubiertos adoptados
                                                 juez Claude multi-concepto con cita
                                                      │
                                                      ▼
                         SIGNAL (existente, + seam nuevo)  ←  correcciones humanas (WS7)
                                      ▲
                Segunda carga: sólo menciones nuevas/cambiadas y conceptos editados (WS8)
```

Principios:

- **Etiquetar hechos genéricos, no conceptos de negocio, en la ficha.** Lo específico de una marca vive en los conceptos (intereses), que el usuario edita.
- **Caché por contenido**: toda etiqueta se indexa por `input_digest` + versión del esquema + identidad del etiquetador + versión del contexto de entidades (§4.2b). Recalcular sólo lo que falta o lo que un cambio afectó.
- **Etiquetador intercambiable** detrás de una interfaz (Claude Batches, JEV, reglas, humano). El contrato es la pregunta y su esquema.
- **Corrección humana como capa aparte que siempre gana** y sobrevive a recálculos.
- **Abstención explícita**: nunca forzar una respuesta; una negativa del proveedor o un error técnico **nunca** es «no pertenece».
- **Todo el corpus contabilizado**: cada raíz elegible termina con un estado (relevante/ajena/spam/indeterminada y, si relevante, pertenencias o «sin concepto»).

Escala (para decisiones futuras, fuera de este programa): hasta ~150K menciones el LLM por mención cabe en el techo; por encima, destilación (profesor-alumno sobre embeddings). Este programa construye y prueba la versión ≤150K.

---

## 4. Contratos

### 4.1 Ficha v1 (`facet_schema_version = "mention-facets-v1"`)

Unidad: **raíz canónica** (mención completa, no fragmento). Valores en código en inglés (`snake_case`); etiquetas visibles en `apps/studio/messages/{es-MX,en-US}.json`.

| Dimensión | Valores cerrados | Notas |
|---|---|---|
| `entities` | Lista 0..N de `{ entity_id, kind ∈ {primary_brand, competitor, category}, salience ∈ {main, secondary} }` | Cada `entity_id` (del contexto de entidades vigente, §4.2b) aparece a lo sumo una vez. Una comparación marca–competidor lleva **ambas** entidades. Resolver ambigüedad de nombre (homónimos, producto vs. marca madre). `main` = la mención trata principalmente de esa entidad; `secondary` = aparece de forma incidental o comparativa. Puede haber más de una `main`. |
| `unrelated_reason` | `homonym, off_topic` o `null` | Obligatorio cuando `entities` está vacío y no hubo abstención; `null` en otro caso. |
| `voice` | `individual, media, brand_official, retail_promo, creator, institution, unknown` | Metadatos (plataforma, `content_type`, autor, dominio) se pasan como pistas. |
| `act` | `experience, question_help, complaint, praise, opinion, news, promotion, other` | Un acto principal. |
| `spam_or_bot` | `boolean` | |
| `language` | ISO 639-1 | Tomar de `mentions.language` si existe; si no, del etiquetador. |
| `asunto` | texto libre ≤ 12 palabras, opcional | **No es taxonomía**: insumo para discovery. JEV no lo produce (null). |

Cada dimensión lleva `confidence` (`high|medium|low` para Claude; probabilidad 0–1 para JEV) y puede venir `abstained: true`.

`relevance` es **derivada** (función pura en query-engine, no la pregunta el modelo):
- `spam` si `spam_or_bot = true`;
- `relevant` si `entities` no está vacío;
- `unrelated` si `entities` está vacío y `unrelated_reason ∈ {homonym, off_topic}`;
- `unknown` si la dimensión de entidades abstuvo.

Validaciones del parser (no del modelo): IDs desconocidos en el contexto vigente → la ficha de esa mención se marca `error` (`unknown_entity_id`) y se reintenta una vez; `entities` vacío sin `unrelated_reason` → `abstained` en la dimensión de entidades.

### 4.2 Interfaz de etiquetador

`packages/query-engine/src/signal-mention-labeler-v1.ts` (tipos puros, sin I/O):

```ts
type LabelerIdentity = { kind: "facets" | "membership"; provider: "anthropic" | "typesafe" | "rules" | "human";
  model: string; prompt_digest: string; schema_digest: string; params: Record<string, unknown> };
// labeler_digest = signalWorkspaceEmbeddingDigestV1(LabelerIdentity)  (reutilizar ese digest canónico)
type FacetInput = { root_id: string; input_digest: string; text: string; title: string | null;
  platform: string | null; content_type: string | null; author: string | null; published_at: string; language: string | null };
type FacetResult = { root_id: string; input_digest: string; entity_context_digest: string;
  status: "labeled" | "abstained" | "refused" | "error"; facets?: MentionFacetsV1; refusal_category?: string; error_code?: string };
```

`input_digest` = digest canónico de `{text_sha256 (asset_sha256), title, platform, content_type, author}`. Cambiar cualquiera de esos campos invalida la ficha de esa mención.

Una ficha es válida para la clave `(input_digest, labeler_digest, entity_context_digest)` y además debe cumplir la regla de vigencia de §4.2b. Cambios en el Brand OS que **no** están en el contexto de entidades (tono, objetivos, KB narrativa) no invalidan nada.

### 4.2b Contexto de entidades y su invalidación

**Contexto de entidades (CE):** el subconjunto del Brand OS que la ficha y el juez necesitan para identificar entidades:

```ts
type EntityContextV1 = { entities: Array<{ entity_id: string; kind: "primary_brand" | "competitor" | "category";
  name: string; aliases: string[] /* incluye productos y submarcas */; disambiguation: string | null /* ≤ 300 caracteres */ }> };
// entity_context_digest = digest canónico con entidades ordenadas por entity_id y alias normalizados y ordenados
```

Se construye desde el contexto gobernado existente (`loadSignalSemanticResolutionGovernedContextV1`, `infrastructure/db/signal-semantic-resolution.ts`). Si el contexto gobernado no expone alias o productos por entidad, WS2 lo extiende en ese mismo módulo; no crea otra fuente de verdad.

**Versiones:** al iniciar cualquier run de ficha o pertenencia, el servidor calcula el CE vigente. Si su digest difiere de la última versión registrada, crea una versión nueva y su **conjunto afectado** antes de seleccionar trabajo. No hacen falta triggers en las pantallas de Brand OS: la detección es perezosa y ocurre en el run. El endpoint de estado (WS7) hace el mismo cálculo en sólo lectura para mostrar «ficha desactualizada para N menciones».

**Conjunto afectado (determinista, sin LLM),** calculado contra el diff entre la versión anterior y la nueva. La normalización pasa a minúsculas, quita acentos (NFKD), colapsa espacios y compara por límite de palabra sobre `title + text`:

| Cambio | Raíces afectadas |
|---|---|
| Entidad nueva, o alias/nombre nuevo o modificado (≥ 3 caracteres normalizados) | Raíces cuyo texto contiene ese alias o nombre |
| Alias eliminado | Raíces cuya ficha vigente incluye esa entidad |
| Entidad eliminada o con `kind` cambiado | Raíces cuya ficha vigente incluye esa entidad |
| Cambio de `disambiguation` de una entidad | Raíces cuyo texto contiene cualquier alias de esa entidad, más las que la incluyen en su ficha vigente |
| Alias o nombre < 3 caracteres, o cambio de entidad `category` sin alias propios | `affected_mode = full` (todas las raíces elegibles). Requiere confirmación explícita con coste estimado. |

**Regla de vigencia:** para cada raíz *r*, `v_min(r)` es la versión de CE más reciente en la que *r* quedó afectada (o la primera versión). La ficha vigente de *r* es la más reciente cuyo `entity_context_digest` pertenece a una versión **≥ `v_min(r)`**, con el mismo `input_digest` y `labeler_digest`. Si no existe, la raíz queda en estado `pending` (contabilizada, nunca se usa una ficha obsoleta). El run siguiente re-etiqueta sólo las raíces `pending` y las nuevas.

**Límite aceptado:** la regla léxica no detecta referencias indirectas a una entidad recién agregada (pronombres, errores de escritura). La UI ofrece «Recalcular ficha completa» con coste estimado. El recibo de WS2 reporta el tamaño de los conjuntos afectados en las pruebas.

**Pertenencia:** una decisión del motor (§9.5) también depende del CE y de las entidades de la ficha. Cada decisión guarda el `entity_context_digest` y el `effective_entities_digest` (digest del conjunto `entities` efectivo, overrides incluidos) con que se tomó. Deja de estar vigente cuando la ficha efectiva de esa raíz cambia, ya sea por re-etiquetado o por una corrección humana. Así un cambio de alias recalcula pertenencias sólo de las raíces afectadas.

### 4.3 Concepto (entrada del motor de pertenencia)

Un **concepto** es un Topic del catálogo de trabajo (`taxonomy_terms.metadata.topic`, `packages/query-engine/src/signal-topic-catalog-v1.ts:38-59`) con `lifecycle != archived` y origen `manual` **o** adoptado desde discovery (WS6). Se envía **completo**:

```ts
type ConceptForJudge = { concept_key: string /* term_key */; label: string; scope: "primary_brand"|"competitor"|"category"|"all_conversations";
  definition: string; inclusion: string[]; exclusion: string[]; positive_examples: string[]; negative_examples: string[];
  definition_digest: string };
```

`concept_set_digest` = digest de la lista ordenada de `(concept_key, definition_digest)`. El juez recibe además el contexto de entidades de §4.2b y, por raíz, su `entities[]` efectivo (con prominencia) y su voz/acto como pistas.

### 4.4 Salida del juez (por grupo de raíces)

```json
{ "contract_version": "concept-membership-judge-v1",
  "roots": [ { "root_ordinal": 0,
     "memberships": [ { "concept_key": "x", "verdict": "belongs" | "insufficient",
                        "span_ids": ["r0c0s2"], "rationale": "≤ 30 palabras" } ] } ] }
```

- **Cada `root_ordinal` del grupo aparece exactamente una vez** (puede venir con `memberships: []`).
- Concepto evaluado y **ausente** en `memberships` = `not_belongs`. El conjunto evaluado por raíz (conceptos compatibles por ámbito) queda registrado, así que la ausencia es auditable. Esto ahorra la mayoría de tokens de salida.
- `belongs` exige ≥1 `span_id` de esa raíz; el servidor reconstruye cita, offsets y hash (reutilizar `partition` y reconstrucción de `packages/query-engine/src/signal-workspace-interest-decision-v2.ts:46-125`, extrayéndolos a un módulo compartido sin cambiar su comportamiento).
- Si `stop_reason = max_tokens` o falta algún ordinal → el grupo se divide a la mitad y se reintenta; nunca se infiere nada de una salida incompleta.

### 4.5 Parámetros de proveedor (Claude, verificados en la documentación de la API, 2026-10-04)

| Uso | Modelo | Thinking / effort | Salida | Transporte |
|---|---|---|---|---|
| Ficha | `claude-sonnet-5-5` | `adaptive` + `effort: "low"` (alternativa a evaluar: `{type:"between_tools"}` con effort ≤ high, sin otros campos) | `output_config.format` JSON schema | Message Batches |
| Juez | `claude-sonnet-5-5` | `adaptive` + `effort: "medium"` (barrer `low/medium` en WS4) | JSON schema | Message Batches |

Reglas obligatorias para Sonnet 5.5:
- `thinking: {type: "disabled"}` devuelve 400. No usar `budget_tokens`, `temperature`, `top_p`, `top_k`, `tool_choice` forzado ni prefill.
- **Leer bloques de contenido por `type`**: la respuesta puede empezar con bloques `thinking` vacíos. El parser actual de V2 exige exactamente un bloque de texto (`signal-workspace-interest-decision-batch-v2.ts:199-202`) y **no sirve**; el parser nuevo toma el último bloque `text`.
- `stop_reason = "refusal"` (categorías `cyber, bio, frontier_llm, reasoning_extraction, general_harms` en `stop_details`) → estado `refused` con categoría, sin reintento automático en otro modelo en v1.
- Prompt de sistema + contexto de marca + catálogo de conceptos con `cache_control: {type: "ephemeral", ttl: "1h"}`; mínimo cacheable 512 tokens; en Batches la caché es best-effort.
- Límites de Batches: ≤100,000 solicitudes o 256 MB por batch; resultados ≤24 h (la mayoría <1 h); retención 29 días.
- No pedir al modelo que «escriba su razonamiento» (provoca negativas `reasoning_extraction`); el `rationale` es una justificación breve del veredicto.

Precios (batch, USD/MTok): Sonnet 5.5 entrada 1 · salida 5; Haiku 4.5 0.5 · 2.5; lecturas y escrituras de caché con el descuento de batch apilado. Implementar en un único módulo `packages/query-engine/src/llm-pricing-v1.ts` con tabla por `(provider, model, transport)`; **verificar precios vigentes al implementar**. JEV: precio configurable por env (publicado por el proveedor: USD 0.042/MTok entrada, salida sin coste; no verificado).

### 4.6 JEV (Typesafe) — superficie verificada en su OpenAPI público

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <API_KEY>`; `GET /v1/models`.
- Cuerpo: `{ "model": "jev-latest", "state": <texto u objeto>, "questions": { "<nombre>": { "type": "choice"|"noul"|"score", "instructions": ..., "criteria": ... } } }`.
- Respuestas: `choice` → `{choice, confidence, probabilities}`; `noul` → `{noul: probabilidad de sí}`; `score` → `{score, confidence, legend, probabilities}`. Uso: `{input_tokens, output_tokens}`.
- **No devuelve rationale ni spans.** Sin endpoint batch documentado. Sin documentación de idioma, longitud máxima ni retención de datos.

---

## 5. Almacenamiento (migraciones nuevas, aditivas, sin backfill)

Convención del repo: SQL escrito a mano, sólo hacia adelante, `NNNN_snake_case.sql`; la última es `0220`. **No usar `drizzle-kit generate`** (meta derivada). **Números reservados por WS** para que ramas paralelas no choquen:

| WS | Rango |
|---|---|
| WS2 ficha + ledger común | 0221–0224 |
| WS3 JEV | 0225 |
| WS5 pertenencia | 0226–0230 |
| WS6 discovery | 0231–0233 |
| WS7 UI | 0234–0236 |
| WS8 incremental | 0237–0239 |

Tablas (nombres definitivos; columnas mínimas, Codex puede añadir índices):

**WS2**
- `signal_labeler_versions` — `id, kind (facets|membership), provider, model, prompt_digest, schema_digest, labeler_digest UNIQUE, identity jsonb, status (experimental|approved|retired), eval_report_ref text, approved_by_user_id, approved_at, created_at`. Registro ligero de etiquetadores; **no** reutiliza la cadena `tagging_model_versions`/benchmarks/guardas de V2.
- `signal_labeling_runs` — `id, workspace_id, kind, labeler_version_id, preparation_run_id, concept_set_digest NULL, status (queued|running|completed|failed|canceled), counts jsonb, estimated_micro_usd, cap_micro_usd, idempotency_key, actor_user_id, timestamps`. Un run por ejecución de ficha o de pertenencia.
- `signal_labeling_calls` — **ledger común** de ficha, pertenencia y JEV: `id, run_id, workspace_id, provider, model, transport (batch|sync), provider_batch_id, custom_id UNIQUE, request_digest, request_storage_key, status (reserved|submitting|submitted|settled|failed|unknown), reserved_micro_usd, settled_micro_usd, usage jsonb (incluye cache tokens), raw_sha256, raw_storage_key, stop_reason, refusal_category, timestamps`.
- `signal_entity_context_versions` — `workspace_id, version_no, digest, parent_digest, context jsonb, diff jsonb, affected_mode (targeted|full), affected_count, created_at`. UNIQUE `(workspace_id, digest)` y `(workspace_id, version_no)`.
- `signal_entity_context_affected_roots` — `workspace_id, version_no, root_id`. PK `(workspace_id, version_no, root_id)`. Vacía cuando `affected_mode = full` (la vigencia lo trata como «todas»).
- `signal_mention_facet_labels` — PK `(workspace_id, input_digest, labeler_digest, entity_context_digest)`; `root_id, facet_schema_version, status, facets jsonb, relevance (derivada, guardada), effective_entities_digest, call_id, created_at`. Inmutable.
- `signal_mention_facet_overrides` — `workspace_id, root_id, dimension, value jsonb, actor_user_id, created_at, superseded_at`. La última vigente gana.
- Vista `signal_mention_facets_current_v1` — por raíz elegible de la preparación vigente: etiqueta vigente según la regla de §4.2b, del etiquetador **aprobado o seleccionado para el workspace**, con overrides aplicados, y su `effective_entities_digest`. Las raíces sin ficha vigente salen como `pending`.

**WS5**
- `signal_concept_memberships` — PK `(workspace_id, root_fingerprint, concept_key, definition_digest, labeler_digest, entity_context_digest, effective_entities_digest)`; `root_id, run_id, verdict (belongs|not_belongs|insufficient|refused|error), citations jsonb, rationale, call_id, created_at`. Inmutable. `not_belongs` se escribe explícitamente para cada concepto evaluado (barato: sin texto). Vigente sólo si `entity_context_digest` y `effective_entities_digest` coinciden con la ficha vigente de la raíz (§4.2b).
- `signal_concept_membership_overrides` — `workspace_id, root_id, concept_key, verdict, actor_user_id, created_at, superseded_at`.
- Vista `signal_concept_memberships_current_v1` — pertenencia vigente por (raíz, concepto) para la definición actual, overrides aplicados.

**Gobierno de coste** (WS2 lo hace una vez para ambos usos): añadir acciones `mention_facets` y `concept_membership` (proveedores `anthropic`, `typesafe`) siguiendo la receta existente: CHECKs de acción/proveedor (patrón `infrastructure/db/migrations/0211_signal_interest_decision_batches.sql:10-23`), envolver `signal_processing_org_exposure_v1` con el ledger nuevo (patrón `0155:147`, `0176:73`, `0211:157`), admisión con `admit_signal_processing_v1` (`0155:228`, TS `infrastructure/db/signal-processing-policy.ts:104`), y añadir las acciones a `SIGNAL_PROCESSING_ACTIONS_V1` (`signal-processing-policy.ts:4-5`) y a `apps/studio/src/lib/data-os/signal-processing-policy-ui.ts:12`. Provisionar estas acciones al crear marca (patrón `infrastructure/db/signal-brand-context-policy-provisioning.ts:110-115`).

---

## 6. Reglas para Codex en todo el programa

1. **Producto, no cliente.** Cero lógica, prompts, fixtures o textos específicos de Alexa o de cualquier marca. Todo lo específico entra por Brand OS y por la definición de conceptos.
2. **Aditivo.** No modificar migraciones existentes ni borrar código viejo en este programa. V2/V3 de interest decision y la búsqueda vectorial quedan **congelados**: flags en `false`, sin nuevas llamadas, sin borrar. Una limpieza posterior se planifica aparte.
3. **Integridad mínima obligatoria, y nada más sin justificarlo en el PR:** `custom_id` idempotente; respuesta cruda persistida antes de parsear; reserva → liquidación de coste; claves por contenido; un resultado técnico nunca se convierte en veredicto semántico. No añadir sellos, digests, outboxes ni ledgers adicionales «por si acaso».
4. **Escritura por lotes:** inserts multi-fila y transacciones por página (≥200 filas), lease por página, no por fila. Prohibido el patrón «una transacción con revalidación completa por raíz».
5. **Proveedores:** sólo con flag de entorno activo, tope de coste por run (`cap_micro_usd`) y estimación previa visible. Nunca imprimir secretos. Claves: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `TYPESAFE_API_KEY` (nueva).
6. **Autorización:** reutilizar `loadSignalWorkspaceCapabilitiesStoreV1`. Lanzar ficha/pertenencia exige `can_request_processing`; corregir exige `can_manage_topics` (o equivalente vigente). No debilitar guardas.
7. **Pruebas:** runner `node --test --import tsx` por paquete. Postgres local (docker-compose pgvector pg16, `infrastructure/docker/docker-compose.yml`). Las pruebas con PG son opt-in por variable de entorno, como las existentes. Toda prueba de proveedor real va en un script aparte, nunca en `pnpm test`.
8. **Definition of done de cada WS:** `pnpm typecheck` y `pnpm lint` verdes; tests del paquete tocado verdes; el comando de demo del WS corre localmente sobre el corpus de desarrollo; recibo de una página.
9. **Nada a `main` ni a producción.** UAT sólo al cierre de WS8 y con aprobación explícita del fundador.
10. **Idioma:** UI bilingüe es-MX/en-US; código en inglés; docs en español.

---

## 7. Política de ramas (vigente desde 2026-10-04)

Estado limpio actual: `main` (producción), `develop` (troncal UAT = integración `f4fb0b1`), `codex/noisia-release-integration-2026-10-03` (cabeza del PR #14, temporal), más etiquetas `archive/2026-10-04/*` (no ramas).

- Cada WS: rama `feat/mfp-ws<N>-<slug>` desde `develop`. PR hacia `develop`. Merge con squash o rebase. **Borrar la rama al hacer merge.**
- Worktrees: como máximo uno por WS activo, en `~/.codex/worktrees/mfp-ws<N>`, y se quita al hacer merge. **Ningún worktree ni checkout en `~/Downloads`** salvo el checkout principal.
- Ramas de vida máxima: una semana. Si un WS se alarga, se integra por partes detrás de flag.
- `.data/` y `.env*` nunca se versionan; los corpus de prueba viven en `.data/dev-corpus/`.

---

## 8. Workstreams, dependencias y orden

| WS | Nombre | Depende de | Paralelo con | Ingeniería estimada |
|---|---|---|---|---|
| WS0 | Higiene restante del repo | — | WS1 | 0.5–1 día |
| WS1 | Corpus de desarrollo + harness local | — | WS0 | 2–3 días |
| WS2 | Ficha v1 con Claude Sonnet 5.5 + ledger común | WS1 | WS3 | 4–5 días |
| WS3 | Adaptador JEV + ficha con JEV | WS1, contrato de WS2 (§4) | WS2 | 2–3 días |
| WS4 | Evaluación: prueba Sonnet 5.5 y prueba JEV, separadas | WS2, WS3, gold del fundador | WS5 (inicio) | 2 días + espera humana |
| WS5 | Motor de pertenencia multi-concepto + seam Signal | WS2 | WS6, WS7 | 5–7 días |
| WS6 | Discovery sobre relevantes + adoptar concepto | WS2 | WS5, WS7 | 3–4 días |
| WS7 | UI mínima (estado, ficha, intereses, excepciones, evidencia) | WS2; integra WS5/WS6 | WS5, WS6 | 4–5 días |
| WS8 | Segunda carga incremental + E2E con marca nueva por UI | WS5, WS6, WS7 | — | 3–4 días |

Total: ~4–5 semanas de ingeniería concentrada; las estimaciones son piso. Coste de proveedores durante la construcción: objetivo ≤ USD 30 en total.

**Fuera de este programa (no construir):** destilación profesor-alumno (scikit-learn ya está en la imagen del Worker, `services/workers/requirements-workspace-engine.txt`), ventana de marca para embeddings de textos largos, agrupación por «asunto», escala >150K, migración de datos viejos, limpieza de código V2/V3.

---

## 9. Especificación por workstream

### 9.0 WS0 — Higiene restante del repo

**Objetivo:** dejar el repo en 2–3 ramas reales y documentar la política.

Tareas:
1. Revisar las etiquetas `archive/2026-10-04/*` con commits **no integrados** y decidir, por cada una, aplicar con cherry-pick sobre `develop` o descartar. Lista: `feat/pitch-kit` (Pitch Kit comercial), `codex/fix-csv-upload-prod` (¿arreglo de producción?), `codex/noisia-front-recovery-p0-2026-08-26` y variantes (foco del menú móvil, hidratación de fechas en Admin), `codex/legacy-cap-copy-clarification-2026-09-27`, `codex/noisia-consolidated-workspace-2026-09-26` (velocidad de cotizaciones), `codex/noisia-editorial-batches-2026-09-26`, `codex/noisia-signal-from-import-2026-09-24` (intento anterior de revisión de intereses: probablemente descartable salvo dos arreglos), `codex/topic-legacy-screening-inspector-2026-09-27`, `docs/signal-pulse-spec`. Entregar una tabla «aplicado / descartado / motivo».
2. Ramas remotas no integradas que queden tras el punto 1: borrar las descartadas (la etiqueta las preserva). Borrar `codex/interest-membership-2026-10-02` (integrada por contenido).
3. Quitar el worktree `~/.codex/worktrees/uat-editorial-polling/noisia-website` y la rama local `codex/interest-membership-2026-10-02`.
4. Proponer al fundador sustituir el PR #14 por un PR `develop → main` (no fusionar; sólo preparar descripción).
5. Insertar al inicio de `AGENTS.md` un bloque «ESTADO ACTUAL (2026-10-04)» de ≤10 líneas que apunte a este spec y a la política de §7, y marque los banners anteriores como historia. No borrar los banners.

Aceptación: `git branch -a` muestra `main`, `develop`, ramas `feat/mfp-*` activas y nada más (más la del PR #14 mientras exista). Tabla del punto 1 en el recibo.

Archivo de la limpieza ya hecha: `~/Downloads/noisia-archive-2026-10-04/` (`MANIFEST.tsv`, `cleanup.log`, `refs/remote-deleted.tsv`, parches y `.data` movidos de cada worktree).

> **Prompt del sub-chat WS0:** «Lee `SPEC_FICHA_Y_PERTENENCIA_2026-10-04.md` §6, §7 y §9.0. Trabaja en el checkout principal sobre `develop`. Para cada etiqueta `archive/2026-10-04/*` no integrada, compara con `develop` (`git log`, `git diff develop...<tag> --stat`) y propón aplicar o descartar; aplica con cherry-pick sólo arreglos pequeños y vigentes, en una rama `feat/mfp-ws0-hygiene`, con typecheck/lint/test del paquete tocado. Prepara pero no ejecutes el borrado remoto: lista los comandos exactos y espera mi aprobación. Escribe el bloque de estado en AGENTS.md. Recibo de una página.»

---

### 9.1 WS1 — Corpus de desarrollo y harness local

**Objetivo:** un comando que levanta todo el pipeline local con ~1,000 menciones de cualquier marca, sin depender de bases remotas.

Entregables:
1. `scripts/dev-corpus/up.sh` (o `pnpm dev:corpus:up`): levanta Postgres local (docker-compose existente, pgvector pg16) y Redis local (añadir servicio a `infrastructure/docker/docker-compose.yml` si falta), aplica **todas** las migraciones con `infrastructure/db/scripts/smoke-migrations.ts` (sólo hosts locales).
2. `scripts/dev-corpus/seed.ts`: crea organización, usuario interno, marca nueva por la misma función que usa la UI de alta (cliente admin), Brand OS mínimo (nombre, 2 competidores, categoría, alias) desde un JSON de entrada, fuente de datos con política de derechos que permita `llm-processing` y métricas, y política de procesamiento con las acciones del programa y un tope diario configurable.
3. Importación **por el camino real**: `ingestSentioneCsvStream` / job `ingest_mentions_csv` (`infrastructure/db/sentione-csv-ingest.ts`, `services/workers/src/workers/mentions-csv-ingest.ts`), preparación (`services/workers/src/workers/signal-workspace-corpus-preparation.ts`) y embeddings.
4. Embeddings: `NOISIA_DEV_EMBEDDINGS=fake|voyage`. `fake` reutiliza el patrón de vectores sintéticos (`infrastructure/db/migrations/signal-client-workspace-entry.synthetic.fixture.ts:108-127`), subiendo sus límites (hoy 3 textos y `page<8`). `voyage` usa el proveedor real con tope (1,000 menciones ≈ USD 0.05).
5. Corpus: `.data/dev-corpus/load1.csv` (~1,000 filas, formato SentiOne) y `.data/dev-corpus/load2.csv` (~250 filas: ~200 nuevas, ~30 duplicadas de load1, ~20 con texto modificado). El fundador provee los CSV, o Codex muestrea de un corpus existente local (cualquier marca; es desechable). Nunca versionar.
6. Plantilla de gold: `scripts/dev-corpus/gold-template.ts` genera `.data/dev-corpus/gold-template.csv` con 150 raíces estratificadas (100 aleatorias + 50 enriquecidas: textos largos, alias ambiguos, competidores y **al menos 15 comparaciones con ≥2 entidades**), con columnas para cada dimensión de la ficha y 2–3 intereses de prueba. Las entidades se capturan como una celda con nombres del Brand OS separados por `;` y sufijo `*` para `main` (p. ej. `MarcaX*; CompetidorY`). Y `gold-import.ts` que valida contra el CE y convierte a `.data/dev-corpus/gold.jsonl`.
7. `scripts/dev-corpus/status.ts`: imprime conteos por etapa (importadas, únicas, elegibles, con ficha, relevantes, con pertenencia) para que cada WS tenga un «demo» reproducible.

Aceptación: desde cero, `up` + `seed` + import load1 + preparación + embeddings fake termina en < 10 min en la laptop y `status` cuadra los conteos. Una segunda corrida es idempotente.

> **Prompt del sub-chat WS1:** «Lee el spec §1, §3, §6, §7 y §9.1. Rama `feat/mfp-ws1-dev-corpus` desde `develop`. Construye el harness local descrito reutilizando las funciones reales de alta de marca, importación, preparación y embeddings; no dupliques lógica de negocio en scripts. Nada de bases remotas. Entrega comandos documentados en `scripts/dev-corpus/README.md`.»

---

### 9.2 WS2 — Ficha v1 con Claude Sonnet 5.5 + ledger común

**Objetivo:** etiquetar la ficha de todas las raíces elegibles de un workspace con Claude Sonnet 5.5 por Message Batches, de forma idempotente, con coste controlado y escritura por lotes.

Archivos nuevos (sugeridos):
- `packages/query-engine/src/signal-mention-facets-v1.ts`: zod de §4.1, `deriveRelevanceV1`, `facetInputDigestV1`, JSON schema de salida, constructor del prompt **genérico** (instrucciones + contexto de marca + metadatos por mención).
- `packages/query-engine/src/signal-mention-labeler-v1.ts`: §4.2.
- `packages/query-engine/src/llm-pricing-v1.ts`: §4.5.
- `packages/query-engine/src/anthropic-response-v1.ts`: parser de mensajes por tipo de bloque (thinking/text), manejo de `refusal`, `max_tokens`, uso con tokens de caché.
- `infrastructure/db/migrations/0221_signal_labeling_core.sql` (labeler_versions, runs, calls, acciones de política y envoltura de exposición), `0222_signal_entity_context_versions.sql` (versiones de CE y raíces afectadas), `0223_signal_mention_facets.sql` (labels, overrides, vista con la regla de vigencia).
- `packages/query-engine/src/signal-entity-context-v1.ts`: tipo y digest del CE, diff entre versiones, normalización y emparejamiento léxico de alias (funciones puras, probadas aparte).
- `infrastructure/db/signal-labeling-runs.ts`, `infrastructure/db/signal-mention-facets.ts` (exportar desde `infrastructure/db/index.ts`).
- `services/workers/src/workers/signal-mention-facets-batch.ts` + drainer, registrado en `services/workers/src/queues/data-os.ts` (rama por `job.name`, inicio/cierre del drainer como los existentes).
- Ruta Studio `apps/studio/src/app/api/data-os/signal/[workspaceId]/facets/route.ts` (GET estado y estimación; POST lanzar con `idempotency_key` y `cap_micro_usd`).

Comportamiento:
0. **Contexto de entidades:** calcular el CE vigente; si cambió, registrar la versión y su conjunto afectado (§4.2b) en la misma transacción que crea el run. Si `affected_mode = full` y el run no trae confirmación explícita, el run queda `queued` esperando confirmación con su coste estimado.
1. **Selección:** raíces `disposition='eligible'` de la preparación vigente que estén `pending` en `signal_mention_facets_current_v1`, es decir, sin ficha vigente para el `labeler_digest` activo según §4.2b (nuevas, con texto cambiado o afectadas por un cambio de CE). Nada más.
2. **Agrupación:** 15–25 menciones por solicitud según presupuesto de tokens estimado (~20K de entrada por solicitud); textos > 12K caracteres van solos. Instrucciones + contexto de marca en el sistema con caché 1h.
3. **Envío:** cliente existente `createAnthropicMessageBatchesClient` (`services/workers/src/providers/anthropic-message-batches.ts:53`). `custom_id = "mf1_" + hex(60)` del digest de la solicitud. Reservar coste en `signal_labeling_calls` antes de crear el batch; `submission_unknown` nunca se reenvía a ciegas (mismo criterio que `AnthropicBatchTransportError`).
4. **Resultados:** guardar crudo (almacenamiento de objetos, como V2) antes de parsear; liquidar coste desde `usage` (incluidos tokens de caché); parsear con `anthropic-response-v1`; validar que cada mención del grupo aparece una vez; `max_tokens` o faltantes → dividir y reintentar.
5. **Escritura:** inserts multi-fila en `signal_mention_facet_labels` con `ON CONFLICT DO NOTHING`, por página.
6. **Estimación previa:** tokens ≈ caracteres/3.5 + sobrecosto por solicitud; mostrar USD estimado y tope.
7. **Etiquetador inicial:** registrar en `signal_labeler_versions` con `status='experimental'`; WS4 lo pasa a `approved`.

Pruebas: unitarias con `fetch` falso y stores falsos (patrón `services/workers/src/workers/signal-workspace-interest-decision-queue-v2.test.ts:36-58`): agrupación, digest, parser con bloques thinking + text, refusal, max_tokens con división, idempotencia de reenvío, liquidación con caché, validación de `entities` (IDs desconocidos, duplicados, vacío sin motivo). Tabla de casos para el conjunto afectado y la regla de vigencia de §4.2b: alias nuevo, alias eliminado, entidad eliminada, cambio de `kind`, alias corto → `full`, cambio narrativo del Brand OS → sin efecto. PG opt-in: run completo con proveedor simulado sobre 1,000 raíces en < 2 min de escritura.

Aceptación (demo): sobre el corpus WS1, con proveedor real y tope USD 3, 100% de raíces elegibles con estado (`labeled|abstained|refused|error`), coste liquidado visible, segunda ejecución no envía nada. Después, agregar un alias a un competidor y relanzar: sólo se envían las raíces del conjunto afectado (conteo en el recibo) y ninguna ficha obsoleta queda como vigente.

> **Prompt del sub-chat WS2:** «Lee el spec §1–§7 y §9.2. Rama `feat/mfp-ws2-facets` desde `develop`; migraciones 0221–0224. Implementa la ficha v1 con Sonnet 5.5 por Batches según §4.1, §4.2, §4.2b, §4.5 y §5; el contexto de entidades y su regla de vigencia son parte del alcance, no un extra. Reutiliza el cliente de Batches, el patrón de drainer de `data-os.ts` y la receta de acciones de política; no reutilices tablas ni guardas de interest decision V2. Prompts genéricos sin ninguna marca. Escritura por lotes. Demo sobre el corpus de WS1 con tope USD 3.»

---

### 9.3 WS3 — Adaptador JEV y ficha con JEV

**Objetivo:** producir la misma ficha con JEV para compararla en WS4, sin tocar el flujo de Claude.

Prerrequisitos (bloqueantes, los resuelve el fundador): cuenta y `TYPESAFE_API_KEY`; confirmar por escrito con el proveedor idioma español, longitud máxima de `state`, retención/uso de datos y límites de tasa. Registrar respuestas en `docs/product/PROMPT_LOOPING/JEV_DUE_DILIGENCE.md`. Sin ese documento no se envía texto del corpus.

Archivos:
- `services/workers/src/providers/typesafe-jev.ts`: cliente HTTP con el patrón del proveedor Voyage (`services/workers/src/workers/signal-workspace-embeddings-provider.ts:81`): una solicitud, sin reintentos internos, timeout por AbortController, sin redirecciones, respuesta acotada, resultado clasificado como `definitely_not_sent | outcome_unknown | known_response_invalid`. Flag `NOISIA_JEV_PROVIDER_ENABLED`. Limitador de concurrencia configurable.
- `packages/query-engine/src/signal-mention-facets-jev-v1.ts`: mapeo de la ficha a preguntas JEV en **una sola solicitud por mención**:
  - por cada entidad del CE: `noul` «la mención se refiere a <nombre> (<alias>)», y `noul` «trata principalmente de <nombre>» (prominencia). Con ~10 entidades son ~20 preguntas; medir coste y latencia.
  - si ninguna entidad supera el umbral: `choice` `unrelated_reason ∈ {homonym, off_topic}`.
  - `choice` para voice y act; `noul` para spam_or_bot.
  - `asunto = null`. Probabilidades a `confidence`. Los umbrales de pertenencia de entidad y de prominencia se fijan en el split dev de WS4, nunca en test.
- Worker `services/workers/src/workers/signal-mention-facets-jev.ts`: mismo run/ledger/tabla de etiquetas que WS2 (`provider='typesafe'`, `transport='sync'`), escritura por lotes.
- `0225` sólo si hace falta ampliar CHECKs de proveedor.

Aceptación: sobre el corpus WS1, 100% de raíces con estado, coste registrado con el precio configurado, probabilidades guardadas. Reporte de latencia p50/p95 por solicitud.

> **Prompt del sub-chat WS3:** «Lee el spec §1–§7, §4.6 y §9.3. Rama `feat/mfp-ws3-jev` desde `develop` (rebase sobre WS2 cuando esté en develop; antes, programa contra los tipos de §4.2). No envíes texto hasta que exista `JEV_DUE_DILIGENCE.md` aprobado por el fundador. Reutiliza run, ledger y tabla de etiquetas de WS2.»

---

### 9.4 WS4 — Evaluación (dos pruebas separadas: Sonnet 5.5 y JEV)

**Objetivo:** elegir el etiquetador de la ficha y fijar los parámetros del juez con evidencia, sin sobreajustar.

Datos:
- Gold humano: 150 raíces de `gold.jsonl` (WS1), etiquetadas por el fundador (~1–2 h). Partición fija antes de mirar resultados: **dev 90 / test 60**, estratificada.
- Para pertenencia: 2–3 conceptos de prueba definidos por el fundador para la marca del corpus (con inclusiones, exclusiones y 3–5 ejemplos +/- cada uno). Al menos uno **no relacionado con consentimiento/activación** para detectar sobreajuste.

Prueba A — Sonnet 5.5: ficha con `adaptive/low` y con `between_tools`; juez con `low` y `medium`.
Prueba B — JEV: ficha con JEV; juez de pertenencia con `noul` por concepto (criterios true/false desde inclusiones/exclusiones), sólo como comparación de detección (sin evidencia).

Métricas (script `scripts/eval/facets-report.ts`, salida markdown sin texto del corpus):
- Por dimensión de una sola etiqueta (voice, act, spam): exactitud, F1 macro, matriz de confusión, tasa de abstención.
- Entidades (conjunto): precisión, recall y F1 por par (raíz, entidad), micro y macro por entidad; tasa de coincidencia exacta del conjunto; exactitud de `kind` y de `salience` sobre los pares correctos. Reportar aparte las menciones con ≥2 entidades (comparaciones).
- Relevancia: precisión y recall de `unrelated` y de `relevant`.
- Pertenencia por concepto: precisión, recall (con intervalo de Wilson), tasa de `insufficient`; errores clasificados por tipo.
- JEV: diagrama de fiabilidad y ECE de sus probabilidades; umbral elegido en dev, reportado en test. No llamar «calibradas» a probabilidades que no pasen esta prueba.
- Acuerdo Claude–JEV sobre las 1,000 raíces (sin gold) como monitor de deriva.
- Coste por 1,000 menciones y tiempo de pared.

Regla de decisión (preregistrada):
- Por dimensión, gana el etiquetador con mayor F1 macro en **test**; si la diferencia es < 3 puntos, gana el más barato.
- Umbrales de aceptación propuestos (el fundador puede ajustarlos antes de correr): relevancia precisión y recall ≥ 0.90; entidades F1 micro ≥ 0.90 y recall ≥ 0.90 en menciones con ≥2 entidades; voice y act F1 macro ≥ 0.75; juez de pertenencia precisión ≥ 0.80 con recall reportado e intervalo.
- Para entidades, la regla de «gana el de mayor F1 macro» usa F1 micro por par (raíz, entidad).
- Una ronda de evaluación + **una** corrección focal (prompt o definición) evaluada sólo en dev, y reporte final en test. Si no se alcanzan umbrales, se documenta el error dominante y se detiene para decidir con el fundador; no se itera indefinidamente.

Resultado: `docs/product/PROMPT_LOOPING/EVAL_MFP_<fecha>.md` y cambio de `status` a `approved` del etiquetador ganador en `signal_labeler_versions` (con `eval_report_ref`).

Presupuesto: ≤ USD 5 por prueba.

> **Prompt del sub-chat WS4:** «Lee el spec §1–§7 y §9.4. Rama `feat/mfp-ws4-eval`. Construye el reporte y corre la prueba A (Sonnet 5.5) y la prueba B (JEV) por separado, con la partición dev/test fijada antes de ver resultados. No toques prompts usando test. Entrega el reporte y la propuesta de etiquetador aprobado; no lo apruebes sin confirmación del fundador.»

---

### 9.5 WS5 — Motor de pertenencia multi-concepto + Signal

**Objetivo:** para cada raíz relevante, decidir con evidencia citada a qué conceptos pertenece, evaluando **todos** los conceptos compatibles en una sola solicitud por grupo, e integrar el resultado en Signal.

Archivos nuevos (sugeridos):
- `packages/query-engine/src/signal-concept-membership-v1.ts`: contratos §4.3–§4.4, constructor de prompt genérico (instrucciones + Brand OS + catálogo de conceptos completo en el sistema con caché), validador de salida, reconstrucción de citas (módulo compartido extraído de V2 sin cambiar su comportamiento).
- `infrastructure/db/migrations/0226_signal_concept_memberships.sql` (tablas y vista de §5, acción de política ya creada en WS2).
- `infrastructure/db/signal-concept-memberships.ts`.
- `services/workers/src/workers/signal-concept-membership-batch.ts` + drainer.
- Ruta Studio `.../memberships/route.ts` (estado, estimación, lanzar) y `.../memberships/preview/route.ts` (**probar una definición** sobre 30 raíces relevantes elegidas por diversidad, con coste < USD 0.20, sin persistir como pertenencia vigente).

Comportamiento:
1. **Conceptos:** catálogo de trabajo vigente (intereses `manual` + adoptados de WS6), no archivados.
2. **Raíces:** relevancia `relevant` en `signal_mention_facets_current_v1`. **No leer** `signal_topic_catalog_executions`, `signal_topic_classification_items` ni la búsqueda vectorial.
3. **Compatibilidad por ámbito (multi-entidad):** un concepto con `scope = S` se evalúa en una raíz si **cualquier** entidad de su `entities[]` efectivo tiene `kind = S`, sea `main` o `secondary`. `all_conversations` aplica a toda raíz relevante. Así una comparación marca–competidor se evalúa tanto para conceptos de marca como de competidor. La prominencia **no excluye** en v1: se pasa al juez como pista y queda disponible como filtro en Signal («principalmente sobre…»). Esto es filtro determinista, no semántico.
4. **Reutilización:** sólo pares (raíz, concepto) sin decisión vigente para `(root_fingerprint, definition_digest, labeler_digest, entity_context_digest, effective_entities_digest)` (§4.2b). Editar un concepto invalida sólo ese concepto; un cambio de CE o una corrección de entidades invalida sólo las raíces afectadas. Si la nueva ficha cambia la compatibilidad (un concepto deja de aplicar), la decisión anterior deja de ser vigente y no se muestra.
5. **Grupos:** 8–16 raíces por solicitud según tokens; textos largos solos; spans de ≤320 caracteres como V2.
6. **Escritura:** `belongs`/`insufficient` con citas; `not_belongs` explícito para el resto de conceptos evaluados; `refused`/`error` separados.
7. **Signal:** añadir una rama `UNION ALL` en el CTE `all_memberships` (`infrastructure/db/signal-workspace-topics-serving.ts:484-494`) que lea `signal_concept_memberships_current_v1` (sólo `belongs`) con `evidence_fragment` desde la primera cita. La selección de intereses en Signal reutiliza `signal_defined_interest_selections` (`infrastructure/db/migrations/0212_signal_defined_interest_selection.sql`); revisar que su PK `(workspace, term)` sirve para N conceptos (sí). Los conteos de Noise/Sin resolver para estos conceptos: «Ajenas» desde la ficha, «Sin concepto» = relevantes sin ningún `belongs`.
8. Cuando el flag `NOISIA_CONCEPT_MEMBERSHIP_ENABLED` está activo, ocultar los controles de interest decision V1/V2 en `TopicsManager` (`apps/studio/src/components/brands/TopicsManager.tsx:510-517`).

Prompt genérico del juez (requisitos, no texto final): identificar la entidad/producto exacto antes de evaluar; aplicar inclusiones y exclusiones literalmente; usar ejemplos como guía de frontera, no como palabras clave; `belongs` exige que el texto afirme el hecho (no basta tema parecido ni hipótesis); un artículo pertenece si documenta el fenómeno definido, no si sólo menciona la marca; `insufficient` sólo cuando falta una condición necesaria; la ficha (voz, acto) se pasa como pista, no como regla.

Pruebas: unitarias de validador (ordinales, ausencia = not_belongs, spans ajenos, max_tokens), compatibilidad por ámbito con menciones de una y de varias entidades (incluida una comparación marca–competidor evaluada para conceptos de ambos ámbitos), invalidación por edición de concepto, por cambio de CE y por corrección humana de entidades; PG opt-in con proveedor simulado; demo real sobre el corpus WS1 con los conceptos de WS4 y tope USD 3.

Aceptación: 100% de pares (raíz relevante × concepto compatible) con estado; Signal local muestra los conceptos seleccionados con conteos y citas; editar la definición de un concepto y relanzar sólo recalcula ese concepto (verificado por conteo de llamadas).

> **Prompt del sub-chat WS5:** «Lee el spec §1–§7 y §9.5. Rama `feat/mfp-ws5-membership`; migraciones 0226–0230. No extiendas interest decision V2: crea el motor nuevo usando run/ledger de WS2 y el cliente de Batches. Extrae a un módulo compartido el particionado en spans y la reconstrucción de citas de V2 sin cambiar su comportamiento (prueba de regresión). Integra Signal con una rama nueva en `all_memberships`. Demo con tope USD 3.»

---

### 9.6 WS6 — Discovery sobre menciones relevantes y adopción de conceptos

**Objetivo:** que BERTopic y la consolidación trabajen sólo con señal, y que un concepto descubierto pueda convertirse en concepto del motor con un clic.

Cambios:
1. **Población del motor BERTopic** = raíces elegibles con relevancia `relevant`. Tocar el snapshot y conteos (`infrastructure/db/signal-workspace-engine.ts:505-510`), la consulta de chunks (`:551-565`) y la verificación de embeddings faltantes (`:480-486`). Python no cambia (acepta cualquier población).
2. Opción de **muestra** para corpus grandes: `discovery_sample_cap` (por defecto sin tope en este programa), estratificada por fecha y plataforma, semilla registrada. Documentar que la muestra sólo propone conceptos; la pertenencia la calcula WS5 para todo el corpus.
3. **Estado de raíz nuevo `unrelated`** en la vista de estados (`infrastructure/db/migrations/0181_signal_topic_consolidation_activation.sql:205-214`, vía migración nueva que redefine la vista) para que las raíces ajenas no aparezcan como «Sin grupo estable».
4. **Adoptar concepto descubierto**: acción en Topics que copia `label` y `definition` de `signal_topic_editorial_concepts` al catálogo de trabajo como Topic `origin='workspace_discovery'` con `discovery_guidance=false` y `source` apuntando al concepto, editable por el usuario, y elegible para el motor de WS5. Reutilizar `adoptSignalTopicCandidateInputSchemaV1` (`packages/query-engine/src/signal-topic-catalog-v1.ts`) si su semántica encaja; si no, acción nueva con el mismo patrón de `mutateCatalog` (`infrastructure/db/signal-topic-catalog.ts:1216`).
5. Un concepto adoptado y seleccionado en Signal toma su pertenencia del motor (WS5), no de la herencia por grupo. Los conceptos no adoptados siguen con la herencia actual.

Aceptación: con el corpus WS1, discovery corre sobre las relevantes, el conteo de entrada coincide con la ficha, y adoptar un concepto + lanzar WS5 produce pertenencias citadas para él.

> **Prompt del sub-chat WS6:** «Lee el spec §1–§7 y §9.6. Rama `feat/mfp-ws6-discovery`; migraciones 0231–0233. Cambia sólo la selección de población del lado Node/DB, el estado `unrelated` y la adopción. No toques Python ni el pipeline de consolidación salvo la entrada.»

---

### 9.7 WS7 — UI mínima

**Objetivo:** que el fundador recorra el flujo sin terminal.

Superficies (reutilizar componentes y estilos existentes del Admin/Topics/Signal; bilingüe):
1. **Estado del procesamiento** en el workspace: Importar → Preparar → Ficha → Descubrir → Pertenencia → Signal, con conteos, coste estimado/real, progreso y errores accionables.
2. **Ficha:** distribución por dimensión, filtro de menciones por dimensión, corrección por mención (escribe `signal_mention_facet_overrides`).
3. **Intereses:** editor con definición, inclusiones, exclusiones y ejemplos +/-; botón **«Probar definición»** (preview de WS5 sobre 30 raíces, muestra veredicto y cita por raíz, coste visible); botón lanzar pertenencia completa.
4. **Excepciones:** cola de `insufficient`, `refused` y fichas `abstained`; acciones aceptar/rechazar que escriben overrides. Sin aprobar cientos: filtros y acciones por lote.
5. **Evidencia:** en detalle de concepto y en Signal, cita resaltada dentro del texto original, con enlace a la mención.

Aceptación: recorrido completo por UI sobre el corpus WS1 (crear interés, probar, lanzar, corregir 3 excepciones, seleccionar en Signal) sin usar terminal; QA en es-MX y en-US.

> **Prompt del sub-chat WS7:** «Lee el spec §1–§7 y §9.7. Rama `feat/mfp-ws7-ui`; migraciones 0234–0236 sólo si hacen falta. Construye cada superficie sobre las rutas de WS2/WS5/WS6; si una ruta aún no existe, programa contra su contrato de §4 con datos simulados y conecta al integrarse. No agregues prefetch de `<Link>` en rutas protegidas ni middleware de Kinde (ver AGENTS.md).»

---

### 9.8 WS8 — Segunda carga incremental y E2E con marca nueva

**Objetivo:** demostrar el producto completo con una marca nueva creada por UI y una segunda carga que actualiza sin rehacer.

Flujo de aceptación (UI, local o dev-test):
1. Crear marca nueva (no Alexa) → Brand OS con competidores y alias → 2–3 intereses.
2. Importar `load1.csv` → preparación → ficha → discovery sobre relevantes → adoptar 2 conceptos → pertenencia → seleccionar en Signal.
3. Importar `load2.csv` → la preparación reutiliza assets; la ficha procesa **sólo** `input_digest` nuevos/cambiados; la pertenencia procesa **sólo** raíces nuevas/cambiadas × conceptos, más todas las raíces para un concepto editado entre cargas; discovery: predicción de grupos conocidos para raíces nuevas (motor incremental existente, `tools/signal-semantic-lab/src/signal_semantic_lab/workspace_incremental_engine.py`) y propuesta de conceptos emergentes desde el residuo relevante sin concepto.
4. Signal refleja la segunda carga.
5. Entre cargas, editar el Brand OS: agregar un alias a la marca y un competidor nuevo, y cambiar el texto narrativo del Brand OS. Verificar que sólo se re-etiquetan las raíces del conjunto afectado, que sólo esas raíces recalculan pertenencia y que el cambio narrativo no dispara nada.

Métricas del recibo: llamadas y coste de la carga 2 vs. carga 1 (debe ser proporcional a lo nuevo), tiempo de pared por etapa, conteos que cuadran (toda raíz elegible con estado).

Aceptación: lo anterior, con conteos de llamadas que prueben la reutilización, y QA del fundador sobre la UI. Sólo entonces se propone desplegar en UAT (con su aprobación).

> **Prompt del sub-chat WS8:** «Lee el spec §1–§7 y §9.8. Rama `feat/mfp-ws8-incremental`; migraciones 0237–0239. Conecta las etapas para la segunda carga usando las claves por contenido ya definidas; no recalcules nada con clave vigente. Entrega el E2E guiado y el recibo con conteos de llamadas por carga.»

---

## 10. Riesgos y preguntas abiertas

| Riesgo | Mitigación |
|---|---|
| JEV no soporta bien español, textos largos o no da garantías de datos | Prueba B separada; due diligence previa; el producto no depende de JEV. |
| La ficha de Claude excede el presupuesto en corpus grandes | Este programa se limita a ≤150K; destilación es el siguiente programa. |
| Ausencia = `not_belongs` oculta errores de truncamiento | Validación de ordinales, división en `max_tokens`, conjunto evaluado registrado. |
| Prevalencia baja de algunos intereses hace ruidosas las métricas | Gold con estrato enriquecido; recall con intervalo; decisión preregistrada. |
| Ramas paralelas chocan en migraciones o en `data-os.ts` | Rangos reservados; cambios en `data-os.ts` mínimos y en bloques separados; rebase frecuente sobre `develop`. |
| Repetir el patrón de sobre-sellado y ciclos de control | Regla §6.3; los PR que añadan controles extra deben justificar el fallo concreto que previenen. |
| La regla léxica de §4.2b no detecta referencias indirectas a una entidad recién agregada | Límite aceptado y documentado; «Recalcular ficha completa» con coste estimado; tamaño de conjuntos afectados reportado en WS2 y WS8. |
| Muchas entidades en el CE encarecen la prueba JEV (2 preguntas por entidad) | Medir en WS3; si excede, limitar a la marca y los N competidores principales para la prueba y documentarlo. |

Preguntas para el fundador (no bloquean WS0–WS2):
1. ¿Quién provee `load1.csv`/`load2.csv` (o autoriza muestrear un corpus local existente)?
2. ¿Confirma los umbrales de §9.4 o los ajusta antes de WS4?
3. ¿Cuenta y API key de JEV, y quién hace la due diligence con el proveedor?
4. ¿Etiqueta él el gold de 150 raíces o delega en alguien del equipo?

---

## 11. Referencias

- Mapas de código usados para este spec (develop `f4fb0b1`): importación y preparación (`infrastructure/db/sentione-csv-ingest.ts`, `infrastructure/db/signal-workspace-corpus-preparation.ts`, `packages/query-engine/src/signal-workspace-corpus-preparation-chunks.ts`), embeddings (`packages/query-engine/src/signal-workspace-embeddings-v1.ts`, `services/workers/src/workers/signal-workspace-embeddings*.ts`), atribución de entidad (`packages/query-engine/src/signal-semantic-resolution-v1.ts`, `services/workers/src/workers/signal-semantic-resolution-*.ts`), discovery (`services/workers/src/workers/signal-workspace-engine*.ts`, `tools/signal-semantic-lab/src/signal_semantic_lab/workspace_engine.py`), consolidación (`packages/query-engine/src/signal-topic-editorial-global-v2.ts`, `infrastructure/db/signal-topic-editorial-global-stage-v2.ts`), Signal (`infrastructure/db/signal-workspace-topics-serving.ts`, `infrastructure/db/migrations/0181_signal_topic_consolidation_activation.sql`), clasificación y autoridad (`infrastructure/db/signal-workspace-classification.ts`, migraciones `0087`, `0136`, `0211`, `0216`), política de coste (migraciones `0155`, `0176`, `0178`, `0202`, `0211`), transporte (`services/workers/src/providers/anthropic-message-batches.ts`), pruebas (`infrastructure/docker/docker-compose.yml`, `infrastructure/db/scripts/smoke-migrations.ts`).
- Documentación externa: Anthropic Message Batches y límites de tasa (platform.claude.com/docs, consultada 2026-10-04); OpenAPI de Typesafe (`https://api.typesafe.ai/openapi.json`, consultado 2026-10-04).
- Precedentes de diseño: Clio (Anthropic, 2024: facetas por elemento + agrupación + nombrado jerárquico), TopicGPT (NAACL 2024) y LLooM (CHI 2024) para descubrir conceptos en muestra y asignar; FrugalGPT y SetFit para cascadas y destilación (programa siguiente).
