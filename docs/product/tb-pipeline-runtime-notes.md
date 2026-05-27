# T&B Pipeline — Runtime Notes & Observations

> Notas operativas del pipeline real corriendo contra Seguros El Potosí
> (corpus de ~40K menciones). Documenta limitaciones conocidas, decisiones
> heurísticas y oportunidades de mejora **a las que cualquier agente
> (humano o IA) volverá tarde o temprano**. Léelo antes de tocar un step.

Última actualización: 2026-05-25 · Pipeline: `tb-engine-2026.05.25` · Metodología: `1.0`

---

## Step 0 — Preflight

### Comportamiento actual
- Tres niveles de decisión: `PROCEDER` | `PROCEDER_WITH_WARNINGS` | `ABORTAR`.
- Thresholds (flexibilizados vs spec original):
  - `window_temporal`: PASS ≤13m · WARN 14-24m · FAIL >24m
  - `source_balance`: PASS si ninguna >60% · WARN una entre 60-90% · FAIL única fuente 100%
  - `polarity_balance`: WARN si polarizado, FAIL sólo si TODO un lado
  - `language_uniformity`: PASS ≥90% es · WARN 70-90% · FAIL <70%
- Warnings se persisten automáticamente en `tb_analyses.limitations` con `source: "preflight"`.

### Observaciones del corpus de Seguros El Potosí
- **Pasa preflight con 1 warning**: `comments` concentra 84.7% del corpus.
- **El cliente debe ver esa warning en el output final** — los hallazgos están sesgados al comportamiento conversacional de comments (Facebook page reactions, X replies), subrepresentando posts orgánicos y foros.

### Limitaciones / mejoras conocidas
- **El preflight no inspecciona el contenido**, sólo metadata (counts, distribución, idioma). No detecta si las menciones son spam, bots o ruido. Eso lo agarra el corpus assessment (existente) y los stages posteriores.
- **No hay re-check después de cleanup**: si el IM corre cleanup-with-AI y elimina 8K menciones, el preflight del siguiente análisis re-evalúa desde cero. Eso está bien hoy, pero si en el futuro queremos "preflight diferencial" (mostrar cómo cambió el corpus desde el último análisis), hay que agregar comparación entre snapshots.

---

## Step 1 — Open Pass (codificación emergente)

### Comportamiento actual
- Sample estratificado por plataforma, cap a `TB_OPEN_PASS_MAX_SAMPLE = 1500`.
- Batches de `TB_OPEN_PASS_BATCH_SIZE = 30` mentions.
- Concurrency = 4 batches en paralelo contra Anthropic API.
- Cada mention recibe 1-3 tags en lenguaje del usuario, o `["irrelevant"]`.
- Resultado persistido en `tb_mention_codings` (con `polarity='mixed'`, `layer=NULL` provisional).
- Agregado: top 60 tags con counts en `tb_pipeline_steps.result_summary.top_tags`.

### Health flags
- `ok`: 40-90 tags únicos (criterio de la spec)
- `shallow`: <40 — el pase fue superficial, anotado en `limitations`
- `exploded`: >90 — Claude está siendo muy específico, anotado en `limitations`

### Observaciones del corpus de Seguros El Potosí
- **1287 tags únicos** en última corrida → flag `exploded`. Mucho long-tail con count=1.
- **47-48% del corpus tagged como `irrelevant`** — consistente con el assessment ("demasiado ruido"). Esto es un fuerte argumento para **correr cleanup-with-AI antes del análisis T&B**.
- **Top tags son lenguaje real del usuario**, no marco: `letra chica`, `el ajustador nunca llego`, `pague de mas por nada`, `es puro negocio`. Validó la filosofía de la spec.

### Limitaciones / mejoras conocidas
- **Duración: ~11 min** para 1500 mentions con concurrency=4. Cuello de botella claro de la API de Anthropic, no de la DB.
  - Optimización futura A: subir concurrency a 8-10 (riesgo de rate limits).
  - Optimización futura B: switchear a Claude Haiku para step 1 (es tagging simple, no requiere razonamiento profundo).
  - Optimización futura C: prompt caching para el preámbulo del prompt (ahorra ~40% tokens).
- **Sample fijo en 1500** independiente del corpus size. Para corpus pequeños (<5K) procesamos todo; para corpus grandes (>5K) sólo procesamos 1500/total. Si quieres cobertura del 100% de un corpus de 40K, hay que añadir modo "full sweep" como opt-in (caro y lento).
- **Tags con count=1 son ruido**: en la corrida real, ~80% de los 1287 unique tags aparecen sólo una vez. Mucho de ese long-tail es Claude generando variantes ("pésimo servicio" vs "mal servicio" vs "pesimo servicio"). El paso 2 consolida vía clustering, pero ayudaría agregar **post-procesado fuzzy matching** (Levenshtein <3) en step 1 para deduplicar antes de persistir.
- **Los `sample_mention_ids` por tag están limitados a 5**. Step 2 sólo carga 2 verbatims por tag para evitar context blow-up. Suficiente para tags frecuentes, pobre para tags con count alto que merecerían más contexto.

---

## Step 2 — Coding (polarity + layer per tag)

### Comportamiento actual
- Toma los top `TB_CODING_TOP_TAGS = 120` tags del step 1 (pero el step 1 sólo expone 60 — ver limitación abajo).
- Una sola llamada a Claude codifica toda la vocabulary (~30-60 tags) con polarity + layer + cluster + reason.
- Propagación a `tb_mention_codings`: por cada row, busca dominante en sus `emergent_tags`, asigna polarity + layer. Conflicto entre tags → `ambiguous=true`.
- Resolución de empates en polarity: barrier > trigger > mixed. En layer: personal > psicologico > social > cultural.

### Observaciones del corpus de Seguros El Potosí
- **60 tags codificados en 80 segundos** (1 llamada Claude) vs 1500+ que habría sido per-mention.
- **Ambigüedad = 1/941 = 0.1%** — muy por debajo del <5% de la spec. Bien.
- **Distribución real**: 93% barrier, 5% trigger, 2% irrelevant, 0% mixed. **Brutal asimetría hacia barriers** — consistente con que las menciones de seguros son mayormente quejas. **Esto es un finding válido para reportar al cliente**, no un bug.
- **Layer dist**: 65% personal, 20% psicológico, 10% cultural, 5% social. Cultural está subrepresentado, esperable en un corpus de comments transaccionales.

### Limitaciones / mejoras conocidas
- **Step 1 sólo expone top 60 tags al step 2** (hardcoded `slice(0, 60)` en `tb-step-1-open-pass.ts`). Las constantes en el package (`TB_CODING_TOP_TAGS = 120`) no se respetan. **Quick fix**: subir el slice a 120-200 o eliminar el cap y dejar que step 2 decida.
- **556 mentions "unmatched"** (37% del sample) porque sus tags no estaban en el top 60. Esas rows quedan con `polarity='mixed'`, `layer=NULL` — no se cuentan para findings ni se descartan, simplemente flotan. Solucionable subiendo el slice del punto anterior o haciendo una segunda pasada para el long-tail.
- **Empates polarity privilegian barrier** — diseño heurístico defendible (la mayoría del corpus es barrier en seguros) pero podría sesgar otros corpora (ej. categoría aspiracional). Considerar volver el tie-breaker configurable por metodología.
- **El `cluster` que Claude asigna en step 2 NO se usa todavía** — sólo se persiste en `coded_vocabulary` del result_summary. Step 3 lo usará como semilla para findings (sino habría que re-clusterizar).

---

## Step 3 — Hierarchy (jerarquización tridimensional)

### Comportamiento actual
- Lee `coded_vocabulary` del step 2 y agrupa tags por `(polarity, layer, cluster)`.
- Filtra clusters con frecuencia < `TB_HIERARCHY_MIN_FREQUENCY = 3` (long-tail noise).
- Cap a `TB_HIERARCHY_MAX_CLUSTERS = 60` clusters (por seguridad de tokens).
- Una sola llamada a Claude evalúa todos los clusters con:
  - `nombre_comercial` (business-friendly, 60 chars max)
  - `intensidad_promedio` 0-5 (qué tan visceral es el lenguaje)
  - `capacidad_predictiva` 0-1 (cuánto predice cambio de decisión)
  - `confidence` (alta | media | baja_direccional)
  - Índices de verbatim protagonista + 1-4 supporting
- `score_compuesto = 0.30·freq_norm + 0.35·intensity_norm + 0.35·predictividad` (escala 0-5).
- Frecuencia normalizada **dentro del bucket de polaridad** (trigger / barrier) para que un cluster gigante de barriers no aplaste pequeños clusters de triggers que pueden ser estratégicamente más interesantes.
- `finding_id` con formato `<P>-<LAYER>-<NN>` donde P=B|T|M, LAYER=PSI|PER|SOC|CUL, NN=ordinal dentro del bucket por score.

### Observaciones del corpus de Seguros El Potosí
- **14 findings de calidad ejecutiva**, 7 barriers personales + 3 barriers psicológicos + 1 barrier cultural + (resto en buckets menores).
- Top score `B-PER-01` (4.16): *Falla sistémica en resolución de siniestros* — 50 menciones, intensidad 3.9, predictividad 0.74.
- **Capa cultural detectada con 1 finding** (`B-CUL-01 · Corrupción institucional como barrera cultural al seguro`) pero con confidence=baja_direccional porque solo 3 menciones. Esto es honesto — el corpus es transaccional, no editorial; capa cultural está subrepresentada y el motor lo refleja.
- **Verbatims protagonistas son devastadores y reales**, no genéricos. Ej: *"perdí mis gemelos, mi útero, mi dignidad, y las ganas de vivir... yo pago por mi seguro"* (B-PSI-01).
- 142 codings linkeados a findings, ~80 quedaron sin link (sus tags caen fuera de los 14 clusters). Aceptable para MVP.

### Limitaciones / mejoras conocidas
- **Una mención = un finding** por ahora (UPDATE con `finding_id IS NULL` guard). En la realidad una mención puede tocar 2 barriers simultáneamente. Para multi-link, necesitamos insertar nuevas rows en `tb_mention_codings` con cada finding adicional (la unique constraint lo permite).
- **`TB_HIERARCHY_MIN_FREQUENCY = 3` es muy bajo** para corpus chicos pero podría ser muy alto para corpus enormes. Considerar hacerlo dinámico: `max(3, total_codings * 0.005)` para que sea ~0.5% del corpus.
- **El `cluster` field de step 2 no siempre se respeta** — Claude a veces deja tags semánticamente iguales en clusters separados. Step 3 los trata como findings distintos, lo que infla el count de findings con baja frecuencia. Una pasada de post-clustering vía embeddings (cuando lleguemos a C-original) lo arregla.
- **`computeCompositeScore` es heurística**. Los pesos (0.30/0.35/0.35) son intuición, no calibración. Cuando tengamos varios análisis aprobados, vale la pena ajustar pesos mirando qué findings los strategists humanos priorizaron post-hoc.
- **`tb_findings.raw_data` guarda todas las samples** del cluster (no solo las citation) — útil para debugging pero infla la columna. Si la BD crece mucho, mover esto a una tabla de "scratch" separada.
- **Score se calcula sobre frecuencias del cluster**, NO sobre todas las mentions del corpus. Si un cluster tiene 50 menciones pero el corpus total era 1500, el "freq_norm" se compara contra el max-frequency-in-bucket, no contra el corpus total. Esto es intencional para que findings de triggers (siempre menos frecuentes que barriers) no salgan castigados injustamente. Mencionar al cliente si pregunta "¿por qué finding X con sólo 6 menciones tiene score similar a finding Y con 30?".

---

## Step 4 — Mobility (movible vs estructural)

### Comportamiento actual
- Lee todos los `tb_findings` del análisis.
- Una sola llamada a Claude evalúa mobility + razon para todos.
- Para cada finding: clasifica como `movible_por_marca` | `parcialmente_movible` | `estructural` + razón de 2-3 oraciones anclada en el verbatim protagonista.
- UPDATE en `tb_findings.movilidad` y `tb_findings.movilidad_razon`.
- Distribución agregada en `tb_pipeline_steps.result_summary.mobility_distribution`.

### Heurística que aplica Claude (en el prompt)
- Layer `cultural` → tiende a `estructural` (pero no siempre — algunos códigos culturales son móviles vía categoría).
- Layer `personal` → tiende a `movible_por_marca` (fricciones operativas concretas).
- Layer `psicologico` → suele caer en `parcialmente_movible`.
- Layer `social` → depende del tipo (recomendaciones boca-a-boca son móviles; status de categoría es estructural).
- La heurística NO es ciega: Claude lee el `nombre_comercial` y el verbatim protagonista antes de decidir.

### Observaciones del corpus de Seguros El Potosí
- **Distribución**: 8 movible_por_marca (57%) · 4 parcialmente_movible (29%) · 2 estructural (14%).
- **Esto es strategic gold para el cliente** — le dice exactamente qué % de su problema puede arreglar vs. qué % tiene que aceptar.
- **Razones cabronas** (ejemplos reales):
  - B-PER-01 → MOVIBLE: *"Si Seguros El Potosí implementa protocolos de seguimiento de siniestros y SLAs publicados..."*
  - B-PSI-03 → ESTRUCTURAL: *"'No hay que pagar ningún seguro... siempre se abren de gamba'... desconfianza radical hacia el modelo asegurador como sistema, no hacia una marca específica."*
  - B-CUL-01 → ESTRUCTURAL: *"fraude de empleados y ajustadores en Oaxaca... corrupción sistémica... ninguna campaña de marca puede..."*
- **Honestidad estratégica brutal**: Claude NO inventa soluciones para barriers estructurales. Reconoce los límites y orienta hacia alineamiento o whitespace.
- **Duración: 47s** para 14 findings. Lineal con N findings — para corpus con 30-50 findings sería ~2-3 min, aún cómodo.

### Limitaciones / mejoras conocidas
- **El prompt usa la heurística por layer** como guía. Para metodologías futuras (no T&B) hay que parametrizar — `mobility_heuristic_by_layer` debería venir del manifest de la metodología, no estar hardcoded.
- **Sin contexto de competidores**, Claude infiere mobility usando su conocimiento general de la industria. Cuando llegue step 5 (comparativo) con corpora reales de competidores, mobility puede re-evaluarse con evidencia: *"AXA tiene este mismo barrier con score X, demuestra que ES movible"*.
- **Movilidad no propaga a frontend automáticamente** — el dashboard tiene que renderizar el badge (MOV/PAR/EST) usando `tb_findings.movilidad`. La spec del dashboard ya lo contempla pero la UI aún no existe.
- **Sin override manual**: el IM no puede cambiar el verdict de mobility sin re-correr el step. Para MVP está bien; para v2 conviene permitir edición + re-cálculo del playbook step 6.
- **Costo bajo**: ~$0.03-0.05 por corrida de step 4 (14 findings, 1 call, ~5K in + 3K out). Más barato que step 3 porque el prompt no necesita verbatim samples (ya están en el finding's cita_protagonista).

---

## Step 5 — Comparative (cross-brand)

> **Estado actual**: stub. Se ejecuta como skip + warning automático en `limitations` cuando no hay corpora de competidores disponibles. Implementación real **diferida hasta tener al menos 1 competidor con T&B aprobado**.

### Pre-condiciones para activarlo
1. La marca del análisis tiene `competitors` registrados (tabla `competitors` → `brand_seeds`).
2. Para CADA competidor priorizado existe un `study_corpora` con:
   - Misma `methodology_id` (T&B)
   - Status `corpus_approved`
   - Al menos un `tb_analyses` con `status='approved_by_kam'` (o como mínimo `needs_review`)
3. El análisis del competidor tiene su step 4 completo (necesitamos sus `tb_findings` con mobility).

### Cómo activarlo cuando estén las pre-condiciones
1. En `services/workers/src/workers/tb-step-stubs.ts`, retirar el `runStub` para `tbStep5ComparativeJob` y reemplazar por un nuevo archivo `tb-step-5-comparative.ts` siguiendo el patrón de los pasos 3 y 4.
2. Re-wire en `services/workers/src/queues/tb-analysis.ts`.

### Lógica esperada del worker (boceto)
```ts
// Pseudocódigo de tb-step-5-comparative.ts

1. Cargar tb_analysis actual + brand_id del corpus.
2. Cargar lista de competidores activos:
     SELECT bs.canonical_name, sc.id AS competitor_corpus_id, ta.id AS competitor_analysis_id
     FROM competitors c
     JOIN brand_seeds bs ON bs.id = c.competitor_brand_seed_id
     JOIN study_corpora sc ON sc.brand_id = (SELECT id FROM brands WHERE slug = bs.canonical_name) -- ajustar al lookup real
     JOIN tb_analyses ta ON ta.study_corpus_id = sc.id
     WHERE c.brand_id = $1 AND ta.status IN ('needs_review', 'approved_by_im', 'approved_by_kam')
     ORDER BY c.priority NULLS LAST
     LIMIT 5
3. Si lista vacía → registrar en `tb_analyses.limitations` un objeto:
     { source: "step5_comparative", text: "Comparativo no disponible: no hay análisis T&B aprobados para competidores priorizados. Recomendación: ejecutar T&B en al menos AXA y GNP antes del siguiente refresh." }
   Saltar el step (status='skipped' en tb_pipeline_steps), avanzar a step 6.
4. Si lista no vacía:
   - Para cada competidor: cargar sus top 8 findings (por score_compuesto)
   - Para mi marca: cargar mis top 8 findings
   - Construir prompt que le pide a Claude:
     a) triggers_compartidos (findings que aparecen en >=2 marcas con polarity=trigger)
     b) triggers_diferenciales (findings que solo aparecen en una marca)
     c) barriers_compartidos / barriers_diferenciales
     d) lectura_estrategica (3-4 párrafos sobre dónde tiene whitespace mi marca)
   - 1 sola llamada Claude, ~10-15K tokens in, ~5K out → costo ~$0.10
5. Persistir resultado en tb_analyses.comparative_brief (jsonb).
6. Avanzar a step6_synthesis.
```

### Schema del output (esperado en `tb_analyses.comparative_brief`)
```json
{
  "marcas_analizadas": ["Seguros El Potosí", "AXA México", "GNP Seguros"],
  "fecha_analisis_per_brand": {
    "Seguros El Potosí": "2026-05-25",
    "AXA México": "2026-05-12",
    "GNP Seguros": "2026-04-30"
  },
  "triggers_compartidos": [
    {
      "tema": "recomendación de familiar/amigo",
      "presente_en": ["Seguros El Potosí", "AXA México", "GNP Seguros"],
      "intensidad_relativa": { "Seguros El Potosí": 3.2, "AXA México": 4.1, "GNP Seguros": 3.8 }
    }
  ],
  "triggers_diferenciales": [
    {
      "tema": "vinculación bancaria",
      "presente_en": ["GNP Seguros"],
      "ausente_en": ["Seguros El Potosí", "AXA México"],
      "lectura": "GNP capitaliza alianza bancaria; whitespace para Seguros El Potosí en canal directo digital."
    }
  ],
  "barriers_compartidos": [...],
  "barriers_diferenciales": [...],
  "lectura_estrategica": "Seguros El Potosí sufre 60% más el barrier 'no resuelven siniestros' vs AXA (score 4.16 vs 2.5). Es la palanca operativa de mayor ROI competitivo. Por otro lado, AXA carga el barrier 'caro vs alternativas digitales' que Seguros El Potosí NO tiene — oportunidad para posicionarse como 'experiencia + accesibilidad'."
}
```

### Por qué NO hacer comparative "blando" sin corpora reales
Tentación: pedirle a Claude que use su conocimiento general sobre AXA/GNP/Quálitas para hacer el comparative sin necesitar corpora reales. **NO recomendado**:
- Alucinación alta — Claude inventa datos que parecen plausibles pero no son auditables.
- No defendible — un strategist en junta no puede decir "comparé contra AXA basado en lo que Claude recordó".
- Sesgo de entrenamiento — Claude tiene más datos de marcas globales que regionales; el comparative sale sesgado.

Si necesitas algo intermedio mientras llegan los corpora competidores, mejor: skip step 5 y agregar en `tb_analyses.limitations` una nota explícita: *"Este análisis es absoluto, no relativo. Para benchmark vs categoría, corre T&B en AXA/GNP/Quálitas y re-ejecuta este step."*

### Estimación de implementación
- Worker `tb-step-5-comparative.ts`: ~250 líneas siguiendo el patrón de step 3.
- Prompt + parser en `query-engine/src/tb.ts`: ~150 líneas.
- Sin migración de schema (todo cae en `tb_analyses.comparative_brief` jsonb).
- Tiempo estimado: **2-3 horas de implementación + 1 hora de pruebas** una vez que existan los corpora competidores.

### Cuándo en el roadmap
**Después de**:
1. Tener AXA, GNP, Quálitas seteados como brands en BD con sus seeds + corpora.
2. Correr el flujo Engine → corpus_approved en cada uno (~1 día por marca de iteraciones).
3. Correr T&B end-to-end en cada uno hasta `needs_review`.

**Antes de**:
- Cualquier promesa al cliente de "benchmark de industria". Hoy el output solo dice "según TU corpus", no "según TU corpus vs categoría".

---

## Step 6 — Synthesis (playbooks + humanizer)

Implementado el 26-may-2026.

### Qué hace
- Carga findings de `tb_findings` con movilidad ya asignada por Step 4.
- Selecciona para prompt:
  - triggers con `movilidad IN ('movible_por_marca', 'parcialmente_movible')`, top 5 por `score_compuesto`
  - triggers parcialmente movibles extra para detectar saturación
  - barriers con `movilidad='movible_por_marca'`, top 5 por `score_compuesto`
  - barriers con `movilidad='estructural'`
- Hace una primera llamada Claude para generar:
  - `activation_playbook`
  - `friction_removal_plan`
- Hace una segunda llamada Claude sobre el JSON completo para humanizer.
- Persiste:
  - `tb_analyses.activation_playbook`
  - `tb_analyses.friction_removal_plan`
  - `tb_analyses.confidence_per_finding`
  - `tb_recommendations` con `kind IN ('activation', 'friction_removal', 'structural_note')`

### Idempotencia
Antes de insertar recomendaciones, el worker ejecuta:

```sql
DELETE FROM tb_recommendations WHERE tb_analysis_id = $1
```

Esto permite re-correr Step 6 sin duplicar rows. No hay unique constraint todavía.

### Corrida real — Seguros El Potosí
Análisis validado:

- `tb_analysis_id`: `cff49fb4-1cc6-4323-840c-3c2b63cc376f`
- `study_corpus_id`: `67bac581-4bc5-4884-96a8-fe294d8104dc`
- Findings disponibles: 14
- Findings enviados a Claude: 7
- Triggers movibles: 0
- Barriers movibles usados: 5 (`B-PER-01`, `B-PER-02`, `B-PER-03`, `B-PER-04`, `B-PER-05`)
- Barriers estructurales: 2 (`B-PSI-03`, `B-CUL-01`)
- `tb_recommendations`: 5 `friction_removal` + 2 `structural_note`
- `confidence_per_finding`: 14 entradas
- Status final: `needs_review`, vía `quality_gates` stub

Resultado clave: el `activation_playbook` queda vacío de forma correcta:
`top_triggers_movibles=[]`, `por_trigger_recomendacion=[]`. El JSON incluye una nota explícita: no hay señal positiva suficiente para proponer detonadores de compra sin inventar evidencia. La recomendación operativa es capturar señal positiva en la próxima iteración.

### Limitaciones observadas
- El primer intento local se quedó esperando respuesta de Claude porque la llamada no tenía `timeout` ni `maxOutputTokens`. Se agregó `timeout: 90_000`, `maxOutputTokens: 5000`, `maxRetries: 1` en synthesis y humanizer.
- Hubo dos corridas de Step 6 durante validación manual. La idempotencia funcionó: quedaron 7 recomendaciones finales, no 14.
- Step 6 todavía selecciona top findings sólo por score. 
  // TODO mejora-futura: balancear selección por layer para que un solo bloque personal no domine todo el playbook cuando haya corpus con más diversidad.

---

## Quality Gates (post-step6)

Implementado como worker determinístico en `services/workers/src/workers/tb-quality-gates.ts`.
No llama a Claude: corre reglas explícitas sobre `tb_findings`, `tb_recommendations`
y los JSON finales de `tb_analyses`. Esto evita sumar otra caja negra al cierre del
pipeline.

Checks persistidos como `post_*` en `tb_quality_gates`:

1. `post_traceability_complete`: cada hallazgo debe tener cita protagonista y al
   menos 3 citas trazables.
2. `post_layer_coverage`: valida cobertura psicológico / personal / social /
   cultural, permitiendo warning si la limitación está documentada.
3. `post_hierarchy_complete`: frecuencia, intensidad, capacidad predictiva y
   score deben existir en todos los hallazgos.
4. `post_mobility_marked`: todos los hallazgos deben tener movilidad y razón.
5. `post_synthesis_complete`: requiere playbook, plan de fricción y rows en
   `tb_recommendations`.
6. `post_actionability_complete`: cada recomendación debe traer los campos que
   la hacen accionable: intervención, esfuerzo, señal de éxito, responsable o
   nota estructural según el tipo.
7. `post_confidence_calibrated`: la síntesis debe reflejar la confianza de todos
   los hallazgos.
8. `post_human_voice_and_no_projection`: heurística contra proyecciones fuertes
   y jerga consultora después del humanizer.

El worker deja el análisis en `needs_review` y libera el lock del corpus. Si el
análisis ya fue aprobado por IM/KAM, preserva ese status para no degradar una
aprobación manual existente. El endpoint de aprobación bloquea nuevas
aprobaciones cuando existe cualquier `post_*` con `passed=false`.

Limitación MVP: todavía no existe status explícito `requires_fixes`; por ahora el
bloqueo vive en el endpoint de aprobación y en la UI de revisión.

Validación real contra `cff49fb4-1cc6-4323-840c-3c2b63cc376f`:

- 7/8 gates post-step6 pasaron.
- `post_layer_coverage` falló porque el análisis tiene hallazgos psicológico,
  personal y cultural, pero ningún hallazgo social. No había limitación
  documentada que lo justificara.
- El análisis ya estaba aprobado por IM; el worker preservó la aprobación y
  normaliza `current_step='done'` para no regresar visualmente a una etapa
  técnica.
- El bloqueo queda activo para aprobaciones nuevas: si un análisis llega a
  review con ese gate fallido, el endpoint de aprobación responde 409.

---

## Decisiones arquitectónicas para acordarse

### Por qué un solo Worker queue (`noisia-tb-analysis`) y no uno por step
BullMQ permite chain de jobs en la misma queue. Tener una queue por step daría más aislamiento pero requiere N workers separados. Para MVP y para un solo análisis a la vez (concurrency=1), una queue es suficiente. Si en el futuro queremos correr análisis en paralelo (varios clientes), hay que evaluar si los steps largos (step 1) bloquean a otros corpora.

### Por qué tagging-first vs mention-first
La spec §5.2-5.3 se podría leer como "codifica cada mention individualmente". Yo elegí codificar el **vocabulario** (tags) y propagar el coding a las mentions. Razones:
1. **Costo**: 1 llamada Claude vs N llamadas.
2. **Consistencia**: las mismas palabras reciben siempre el mismo coding, no depende de qué viene en el batch.
3. **Reusabilidad**: el `coded_vocabulary` queda como diccionario que step 3-4 pueden inspeccionar sin re-llamar Claude.

Trade-off: pierdo el matiz de mentions específicas que usan un tag fuera de su uso típico. Para MVP es aceptable; con embeddings (futuro C) se podría rescatar.

### Por qué stratified sampling vs random sampling en step 1
Random sampling pierde plataformas minoritarias (en un corpus 85% comments, las menciones de Twitter/foros se diluyen). Stratified asegura representación de cada fuente proporcional. Si IM quiere oversamplear una fuente específica (ej. para análisis cultural enfocado en Twitter), habría que agregar override.

### Por qué `tb_mention_codings` es many-to-many vs columnas en `mentions`
Permite múltiples análisis sobre el mismo corpus (re-correr T&B con prompts mejorados) sin sobreescribir codings previos. Si cambias de approach a "columnas en mentions", pierdes la capacidad de comparar análisis v1 vs v2.

---

## Things to test when implementing Step 3+

1. **Re-correr el pipeline sobre el mismo snapshot** debería ser idempotente — crea nuevo `tb_analyses` sin chocar con codings anteriores (por el unique constraint en `tb_analysis_id + mention_id + finding_id`).
2. **Forzar fallo en step N** (puedes hacer un `throw` manual) y verificar:
   - `tb_pipeline_steps.status = 'failed'`
   - `tb_analyses.status = 'failed'`
   - `study_corpora.locked_by_analysis_id = NULL` (liberado)
3. **DELETE analysis** debería cascadear y limpiar codings + findings + citations + recommendations + steps + gates. Las foreign keys ya están con `ON DELETE CASCADE`, pero conviene confirmar.
4. **Diferencia de N análisis sobre el mismo corpus**: si IM corre el análisis 2 veces seguidas con cleanup distinto entre medias, los findings DEBEN ser diferentes (validar con snapshot diff).

---

## Costos aproximados por análisis (estimado, Sonnet 4.6)

- Preflight: 1 call, ~2K tokens in + 1K out → ~$0.01
- Step 1: 50 batches × ~3K in + 1K out cada uno → ~50 calls, ~$0.45
- Step 2: 1 call, ~8K in + 4K out → ~$0.05
- Step 3 (estimado): 1 call, ~10K in + 6K out → ~$0.08
- Step 4 (estimado): 1 call, ~5K in + 3K out → ~$0.04
- Step 6 (estimado): 2-3 calls humanizer → ~$0.10
- **Total estimado por corrida completa**: ~$0.75 USD por análisis de un corpus de 1500-sample.

Si subimos a "full sweep" sin sample, multiplicar step 1 × (corpus_total / 1500) ≈ ~$12-15 para un corpus de 40K.
