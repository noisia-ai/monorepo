# LAB-3E-B: recibo de sugerencia y bridge al borrador

Abierto el 6 de septiembre de 2026, 08:14 CST, según CURRENT_PROMPT. A cerró
PASS en 9adee218b26d068b6bbff5bf79ad9b20450e1027; revisión independiente de este
plan 9e32a852 sin hallazgos. Se implementa 0125 aditiva y prueba local rollback,
no migración remota, proveedor ni cambios de UI. LAB-3D ya quedó entregado.
Base de producto inspeccionada: `d9a9ce78554407f4eba6532fff5827019d6bf1ed` en
`/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`.

## Resultado y decisión de almacenamiento

Reabrir una sugerencia original, distinguirla de la regla finalmente guardada y
conservar su procedencia al editar/restaurar el borrador. Generar, guardar y medir
siguen siendo operaciones distintas. B sólo demuestra recepción **simulada** y
persistencia local; no demuestra una sugerencia producida por un proveedor real.

La necesidad de almacenamiento nuevo queda acotada por contratos existentes:

- `0122_signal_topic_evaluation_v2_historical_result_import.sql` fija un import
  completo de 10 candidatos. Su `signal_topic_evaluation_v2_archived_refinements`
  admite naming, una propuesta por importación y `source_revision=1`; no RuleSpec.
- `0123_signal_topic_contract_drafts.sql` sella RuleSpec y petición CAS exactos.
  No tiene un campo de procedencia de sugerencia, y no se le añadirán campos
  ocultos al request ni al spec. Su trial es una medición, no una generación.
- `0091_signal_semantic_context_pack_authority.sql` admite artifacts de workspace
  sólo con propósito `topic_discovery|semantic_context`. Una regla sugerida no
  es ninguna de esas autoridades. `0092` ejecuta propuestas de Semantic Context,
  no reglas de candidatos. Los turns de `0112` pertenecen al run de evaluación
  original y tampoco deben representar esta nueva operación.

Propuesta: **una migración aditiva con dos tablas pequeñas y de propósito cerrado**.
Numerarla al abrir B; la última migración del producto inspeccionado es 0124.
No cambiar 0112/0115/0122/0123/0124 ni copiar 0116–0121.

1. `signal_topic_rule_suggestion_receipts`: resultado append-only con FK exacta
   workspace/run/candidato/snapshot, fuente editorial y sus revision/digest/token,
   CAS del draft observado, salida canónica A, spec/digest o null si insuficiente,
   procedencia A, digests de contexto/output/recibo, propósito/versión, origen,
   actor, idempotencia y timestamp. Contexto y evidencia quedan acotados por A;
   no guardar prompts arbitrarios, secretos ni texto completo de menciones.
2. `signal_topic_rule_suggestion_draft_links`: recibo append-only que une una
   sugerencia con la versión ordinaria resultante, su spec/digest y la petición
   esperada. Conservar el spec sugerido y el guardado por separado cuando hubo
   edición. FK y validación atan ambos extremos al mismo workspace/run/candidato;
   no un enlace genérico a cualquier UUID. Una restauración registra otra versión,
   no modifica ni borra la relación histórica.

Ambas rechazan UPDATE/DELETE, campos fuera de contrato, digests divergentes y
reuso de idempotencia con otro actor/request. No almacenan reservas, claims,
leases, outbox, permisos nuevos ni asignaciones de menciones.

## A: nombres reales, con reconciliación pendiente de cierre

El módulo A cerrado y auditado es
`packages/query-engine/src/signal-topic-rule-suggestion-v1.ts`. Usar sus exports,
no duplicar schemas ni límites:

- `parseSignalTopicRuleSuggestionV1(value)` devuelve
  `SignalTopicRuleSuggestionV1`: `contract_version=signal-topic-rule-suggestion-v1`,
  `status=suggested|insufficient_evidence`; el primero contiene lexical, filters,
  1..12 evidence_refs distintas y explanation <=600. El segundo no tiene matcher.
- `prepareSignalTopicRuleSuggestionContextV1(context)` prepara contexto <=18 KiB.
  El input inspeccionado contiene `source`, `candidate`, `draft`, `brand_os` y
  `traces`. `source` incluye workspace/run/candidato/snapshot/session y CAS;
  `candidate` conserva label/definition/editorial y refs históricos;
  `draft` contiene revision/digest; Brand OS tiene estado y autoridad explícitos.
- `adaptSignalTopicRuleSuggestionToDraftV1({suggestion,context})` devuelve
  `SignalTopicRuleSuggestionDraftV1`: salida/procedencia/digest originales,
  run_key/candidate_key, CAS de candidato y draft, más rule_spec/spec_digest o
  null. `provenance` incluye source/context_digest, estado/autoridad de Brand OS
  y las citas con source_digest y bindings de sus trazas.

**Paridad cerrada el 6 de septiembre:** A usa arrays editoriales de hasta 16,
conserva metadatos Brand OS dentro de 18 KiB y separa referencias históricas de
citas disponibles. La revisión independiente confirmó que la compacción conserva
evidencia realmente citable; 15 pruebas focales y 372 del motor pasaron.
No truncar silenciosamente el candidato guardado para acomodar un schema de A.
`source.session_key` agrupa un contexto: no prueba que exista una sesión Lab,
un permiso ejecutable o un flight. Los helpers puros no autentican estos datos.

## Origen honesto y carga de autoridad del servidor

**B admite únicamente `origin=local_fixture`, fijado por el core de simulación,
no seleccionable como afirmación de confianza por el browser/modelo.** Registrar
fixture_digest, output_digest y context_digest; `provider_execution=false`,
provider_calls=0, input/output tokens de proveedor=0 y cost_micro_usd=0. Los bytes
del fixture no son tokens facturados. No inventar modelo ejecutado, request ID,
flight, claim, reserva o recibo terminal. Conservar el origen al reabrir y vincular.
El fixture es un dato simulado pasado al helper de prueba, no evidencia de IA real.
No habrá ruta HTTP para recibir outputs ni para escoger su origen en B.

Para el recorrido local, recibir una plantilla de datos cerrada: status, lexical,
filters, explanation y citation_count (1..12) cuando corresponde. El core carga
contexto y menciones frescas, elige referencias disponibles en orden determinístico
y construye la salida simulada para A. No aceptar callbacks, contextos, referencias
o afirmaciones de autoridad inyectadas por el fixture. Registrar plantilla y salida
como digests distintos. Esta selección de citas demuestra integración, no juicio
semántico del modelo; no presentarla como una sugerencia real en UAT.

**Provider real queda rechazado/no implementado en B.** C deberá recibir el
resultado desde el controlador servidor que ejecutó el nuevo propósito sellado.
Ese adaptador deberá cargar el recibo terminal real y vincular propósito/versión,
input/output/context digests, candidato/snapshot/CAS, modelo/precio, tokens y coste
liquidado. Comprobará que los bytes recibidos corresponden al output del recibo;
no aceptará estos valores como prueba porque un caller los declaró. Un naming
flight viejo no autoriza ni demuestra generación de reglas. Un resultado ambiguo
no se convierte en output completado o retry automático. B no añade esa ejecución.

En B la confianza de las fuentes tampoco viene de `verified=true` ni del fixture:

1. `signalTopicRuleDraftInternal.authorize/sourceFor` valida actor activo en DB y
   carga el run/candidato actual; comparte el bloqueo editorial antes del CAS.
   Completar con una proyección exacta run->snapshot de rights, población,
   generación semántica y autoridad. `sourceFor` solo no valida Brand OS/citas.
2. Cargar identidad editorial mediante
   `loadSignalTopicEvaluationV2CandidateDetail`, después de autorización DB.
   Construir label/definition en servidor. Reutilizar la regla de
   `saveTopicRuleDraftProduct`: deben coincidir con el candidato guardado.
3. Reutilizar `navigateSignalTopicEvaluationEvidenceV2` sólo comprobando que su
   snapshot_digest coincide con el snapshot del run fijado: hoy su `loadSnapshot`
   elige el último de workspace. Si difiere, rechazar sin sustituir el run; una
   extracción interna exact-snapshot pequeña también es válida si resulta necesaria.
   Brand OS carga elementos aprobados/activos y autoridad de esa misma generación.
   Una selección vacía es `empty`; no equivale a autorización fallida ni a leer el
   catálogo completo. Fallos de actor/SQL no se disfrazan de `unavailable`.
4. Las trazas A representarán lecturas reales de las operaciones indicadas, no
   refs históricos rebautizados como navegación nueva. Para cada cita resolver
   miembro del snapshot, asociación al contexto/candidato, source_digest,
   canonical root, text_hash, inclusión y data_source activo; verificar además
   source_content_hash con la normalización NFKC/espacios existente. Reusar las
   comprobaciones de `loadSignalTopicEvaluationV2CandidateEvidence` y
   `signalTopicRuleDraftInternal.sourceAvailabilitySql`; no aceptar IDs arbitrarios.
5. Construir contexto del servidor, llamar A y sellar el recibo. Conservar fuente
   y sugerencia inmutables si luego cambian CAS, derechos o autoridad. Las lecturas
   muestran ese desfase y ocultan ejemplos no disponibles; no vuelven a generar.

El recibo conserva procedencia acotada y digests; no crea un almacén genérico de
trazas ni una segunda autoridad Brand OS. La pertenencia de evidencia nueva al
contexto de generación no modifica el lector histórico de citas LAB-2W.

## Bridge y lectores propuestos

Nuevo módulo `infrastructure/db/signal-topic-rule-suggestions.ts`. Nombres B
propuestos, no exports existentes todavía:

- `receiveSimulatedSignalTopicRuleSuggestionV1`: fixture explícito + cliente,
  actor/workspace/run/candidato e idempotencia; carga contexto real del servidor,
  aplica A y persiste sólo el recibo local_fixture. Insuficiente también se conserva.
- `loadSignalTopicRuleSuggestionV1`: run/candidato exactos, recibo último o recibo
  concreto dentro de ese mismo ámbito; devuelve propuesta, origen, vínculo y estado
  actual de fuente/draft/evidencia. GET coherente RRRO, sin DML, FTS ni proveedor.
- `saveSignalTopicRuleSuggestionDraftV1`: recibo scoped, lexical/filters elegidos,
  CAS exactos de candidato y último draft e idempotencia. La identidad sale del
  servidor; la propuesta original no cambia aunque el operador ajuste la regla.

El caller posee una transacción SERIALIZABLE. El bridge usa savepoint propio y
llama `createSignalTopicContractDraftV1`, que sólo usa SAVEPOINT/RELEASE. Inserta
el vínculo en la misma transacción. No llamar wrappers pool-owned que hagan
BEGIN/COMMIT dentro del rollback exterior. Replays devuelven el resultado original
del mismo actor/request aunque después exista otra revisión; nunca hacen una
segunda creación. Un request distinto o fuente obsoleta no sobrescribe el draft.
La clave derivada para el writer ordinario será determinística y separada de la
idempotencia de recepción; probar el fallo del vínculo para demostrar atomicidad.

Restaurar una regla guardada significa tomar lexical/filters de una versión previa
del mismo candidato y **crear una nueva revisión ordinaria** con CAS actual.
No cambiar el undo editorial de 0115 ni borrar drafts. Si no existía borrador
anterior, no afirmar que puede restaurarse una regla vacía: el parser la rechaza.
Una propuesta `insufficient_evidence` nunca entra al writer como spec vacío.

## Allowlist y prueba de salida al abrir B

Sólo módulo DB nuevo, test unitario y helper PostgreSQL suministrado por caller;
exports en `infrastructure/db/index.ts`, mirror `schema/index.ts`, una migración
aditiva y `package.json` únicamente si hace falta descubrir los tests. Reutilizar
cores actuales; reportar antes cualquier cambio necesario fuera de esa lista.
Nada de UI/API pública, Worker, QE A, migraciones Lab, provider ni código de deploy.

Prueba focal sobre PostgreSQL local existente, dentro de BEGIN/ROLLBACK del
orquestador; sin nuevos clones, contenedores ni builds:

1. Aplicar el DDL nuevo dentro del rollback, con dependencias presentes. La base
   local existente no conserva 0123/0124 porque sus pruebas terminaron en rollback:
   instalar esas dos dependencias ya auditadas dentro de la misma transacción,
   sin ledger ni commit y sin repetir los benchmarks cerrados. No usar UAT.
   Cargar un candidato real y contexto/citas por los cores; pasar un output fixture
   inequívoco. Verificar recibo y reapertura con los mismos digests/origen cero.
2. Guardar regla, editar en otra versión y restaurar lexical/filters anteriores
   mediante una tercera. Probar igualdad del recibo original y sus vínculos.
3. Ejecutar el trial ordinario por separado, cap 100 suficiente para integración,
   sin repetir benchmark de corpus. Crear un draft de un **segundo candidato
   distinto** y comprobar que ambos entran al writer de catálogo existente.
4. Negativos: replay/divergencia/otro actor, scope y snapshot cruzados, CAS cambiado,
   cita ajena/histórica no leída/retirada, contenido mutado, Brand OS vacío frente
   a autoridad inválida, insuficiente, origen provider rechazado y SQL directo
   contra append-only. Fallo después de crear draft revierte draft y vínculo.
5. GET/replay mantienen output/coste históricos y reevalúan exposición actual,
   sin medir. ROLLBACK restaura baseline y ledger: cero llamadas, reservas,
   asignaciones, record_tags, perfiles activos, outbox, importaciones o activación.

Unitarios/focal y estándar DB, typecheck DB/QE, diff check y revisión independiente.
El helper real recibe un client; no carga credenciales ni abre conexiones. El
cierre declara sólo bridge local probado, no IA ejecutada ni producto desplegado.

Relacionados: [plan A/B/C](PLAN_LAB_3E_AUTOMATIC_RULE_SUGGESTIONS.md),
[reglas ordinarias](/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06/docs/product/75_TOPIC_RULE_DRAFTS_AND_LEXICAL_TRIALS.md),
[catálogo conjunto](/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06/docs/product/76_TOPIC_COHORT_CATALOG_AND_JOINT_TRIAL.md).
