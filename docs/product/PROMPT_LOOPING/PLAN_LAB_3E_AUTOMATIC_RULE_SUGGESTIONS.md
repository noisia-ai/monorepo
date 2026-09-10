# LAB-3E propuesto: reglas sugeridas desde candidato, Brand OS y evidencia

Borrador preparado el 6 de septiembre de 2026. Este archivo no abre un gate ni
cambia STATE/CURRENT. LAB-3D sigue su entrega independiente. La implementación de
A puede abrirse localmente después de su revisión; B y C requieren aperturas
separadas. No se ejecuta ninguna parte por el mero hecho de escribir este plan.

## Resultado de producto

La IA propone una regla útil y editable para un candidato existente. El operador
no tiene que construir queries desde cero: ve los campos ya sugeridos, puede
ajustarlos, guarda y prueba. La prueba léxica y la calibración conjunta siguen
separadas de la generación. Una regla sugerida no asigna menciones, no es un gold
label y no activa Topics en Signal.

```text
Candidato guardado + Brand OS aprobado + menciones trazadas
  -> sugerencia cerrada -> borrador editable -> prueba léxica
  -> catálogo de 2..15 reglas -> cobertura, solapamiento y ejemplos
```

El primer caso es UN candidato de los diez existentes. No se vuelve a ejecutar
BERTopic, no se renombra automáticamente el candidato y no se exige que los diez
estén resueltos para validar el recorrido. Las reglas medidas anteriormente con
517 y 8 coincidencias fueron alternativas de un solo candidato y se revirtieron;
no constituyen dos tópicos guardados. La prueba conjunta de LAB-3B también fue
rollback-only y no equivale a un catálogo real creado por el operador.

## Base real y reutilización

Código de producto en
`/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`:

- `packages/query-engine/src/signal-topic-rule-spec-v1.ts`: parser, digest y
  compilador cerrado existente. Any/all/not son frases literales de FTS simple,
  no programas SQL/regex. Máximos existentes: 16 términos por grupo, 32 totales,
  160 caracteres por término y 16 filtros por campo. Al menos any o all no vacío.
- `infrastructure/db/signal-topic-contract-drafts.ts`:
  `createSignalTopicContractDraftV1`, `runSignalTopicContractDraftTrialV1` y sus
  lectores. El writer conserva revisión/token del candidato y revisión/digest
  del borrador, es decir, comparación contra la versión esperada (CAS).
- `apps/studio/src/lib/data-os/signal-topic-rule-draft-product.ts`:
  `saveTopicRuleDraftProduct` exige label/definition iguales a la identidad
  editorial guardada. La sugerencia sólo propone lexical/filters.
- `infrastructure/db/signal-topic-rule-cohorts.ts`: los borradores resultantes
  pueden entrar al catálogo existente sin un perfil nuevo por candidato.
- `FullEvidenceTopicCandidateManager.tsx` y `TopicCandidateRuleDraft.tsx`, bajo
  `apps/studio/src/components/brands/`: editor, evidencia, campos y prueba ya
  disponibles. No cambiar Discovery Review.

Código Lab de referencia en `/Users/brandhon_o/Downloads/noisia-website`:

- `services/workers/src/workers/signal-topic-candidate-refinement-lab.ts`:
  `runSignalTopicCandidateRefinementLabV1`, bootstrap determinístico, bucle
  acotado y clasificación de errores del proveedor.
- `infrastructure/db/signal-topic-evaluation-v2-candidate-refinement.ts`:
  `createSignalTopicCandidateRefinementSessionV1`,
  `navigateSignalTopicCandidateRefinementV1`,
  `appendSignalTopicCandidateRefinementProposalV1`.
- `infrastructure/db/signal-topic-evaluation-v2-candidate-refinement-flight.ts`:
  creación de flight, claim, reserva y recibo terminal.
- `packages/query-engine/src/signal-topic-candidate-refinement-v1.ts`: contratos
  de navegación y salida actual de naming. Esa salida NO acepta RuleSpec.

Estos archivos Lab no están todos en el corte de producto. El resultado
importado y su sugerencia archivada no ofrecen una sesión ejecutable nueva.
No copiar las migraciones 0116–0121 ni todo el ejecutor experimental a UAT.

## A. Contrato y adaptador puro, local y sin proveedor

### Entrega propuesta

Un módulo QE nuevo, sin I/O ni transporte, con símbolos propuestos:

- `parseSignalTopicRuleSuggestionV1(value)`: unión estricta de sugerencia o
  `insufficient_evidence`, versión `signal-topic-rule-suggestion-v1`.
- `prepareSignalTopicRuleSuggestionContextV1(context)`: proyección acotada y
  determinística del candidato guardado, Brand OS y trazas suministradas por el
  servidor. El resumen obligatorio queda separado del historial descartable.
- `adaptSignalTopicRuleSuggestionToDraftV1({suggestion, context})`: devuelve
  RuleSpec canónico, `spec_digest`, digest de sugerencia, CAS esperado y binding
  de procedencia; no guarda ni prueba nada.

La salida del modelo contiene únicamente lexical, filters, evidence_refs y una
explicación breve del modelo, nunca un campo que deba llenar el usuario. Reutilizar
los schemas de RuleSpec, sin una segunda definición de sus límites. Cerrar todos
los objetos; versión/kind/label/definition de RuleSpec se construyen en el servidor.
Proponer evidence_refs distintas 1..12 y explicación de hasta 600 caracteres; el
prompt pide 3–5 citas y pocas frases dentro del límite de salida existente.
`insufficient_evidence` no contiene matcher ni produce borrador vacío.

El contexto lleva identidad y CAS guardados, run/snapshot, resultado de Brand OS
con estado explícito `available|empty|unavailable` y su digest de autoridad cuando
exista, y trazas ya validadas del mismo candidato/sesión. El adaptador
verifica consistencia y pertenencia de las citas. Los refs históricos incluidos
en candidate_context no se convierten en menciones recién leídas. Rechazar refs
ajenos, duplicados, de otra sesión/candidato y evidencia marcada no disponible.
Una selección Brand OS vacía no invalida por sí sola la sugerencia: conservar el
contexto disponible y declarar esa limitación sin inventar elementos aprobados.

No aceptar del modelo actor, workspace, CAS, autoridad, SQL, nombres de columna,
prompt alternativo, herramientas ni digest declarado como prueba de validez.
Los filtros vacíos son explícitamente «sin restricción»; no representan autoridad
Global, ni se deducen mercados por el título o por la presencia de una cita.

**Límite de A:** un adaptador puro no autentica fuentes ni comprueba derechos
actuales en DB. Los fixtures son simulados. No usar un booleano `verified` o un
contexto inyectable desde el navegador para saltarse la autoridad real. B/C
deben cargar y verificar esa información por los cores existentes del servidor.

### Bootstrap: dos requisitos focales

1. El Worker actual elimina los registros más antiguos cuando el contexto supera
   18 KiB (`compactTraceContext`). Para este propósito, el resumen sellado de
   candidato/Brand OS permanece presente aun con historial largo. Compactar lo
   opcional dentro del presupuesto; no elevar el límite para hacer pasar el test.
   A prueba el ensamblado puro; C integra ese ensamblado en el loop real.
2. El lector actual de Brand OS elige display_text por substring exacto del
   título/descripción/inclusion y puede devolver cero. A recibe un bootstrap del
   servidor ya validado, conserva todo contexto disponible y representa el resultado
   vacío/no disponible explícitamente. No arregla ese lector ni hace de cero
   coincidencias un bloqueo de desarrollo. El caso real posterior debe distinguir
   esa limitación de un fallo de autorización o CAS; nunca construir autoridad por
   el LLM ni ocultar el estado vacío como si se hubiera leído Brand OS completo.

No son una auditoría general de Brand OS ni motivo para detener LAB-3D. El
bootstrap real sigue usando candidate_context y brand_os_context antes del primer
transporte; consume dos de las doce navegaciones, no dos llamadas al modelo.

### Allowlist A y aceptación

Sólo en el worktree de producto:

- NUEVO `packages/query-engine/src/signal-topic-rule-suggestion-v1.ts`.
- NUEVO `packages/query-engine/src/signal-topic-rule-suggestion-v1.test.ts`.
- `packages/query-engine/src/index.ts`, únicamente exports nuevos.
- `packages/query-engine/package.json` sólo si fuera necesario incluir pruebas;
  la suite actual ya ejecuta `src/*.test.ts`, por lo que no se espera cambiarlo.

No modificar RuleSpec/compiler, DB, Worker, Studio o el esquema Lab en A. Ninguna
dependencia nueva. Pruebas de salida:

1. Un candidato simulado con contexto aprobado y trazas de menciones produce un
   RuleSpec válido y reproducible; identidad/CAS se conservan, y pasa los mismos
   parser/compilador usados por el editor y por el catálogo.
2. Una edición posterior de lexical produce el digest correspondiente sin
   modificar la sugerencia original. Generar, guardar y medir son operaciones
   distintas; A no afirma persistencia ni resultados de corpus.
3. Contexto disponible sobrevive historial largo dentro del límite; bindings
   cruzados o una estructura de bootstrap inválida no produce matcher aceptado.
   Brand OS `empty|unavailable` permanece visible y no elimina el contexto restante
   ni obliga a rechazar una regla sustentada por las menciones disponibles.
4. Citas inválidas, campos desconocidos, intento de elegir autoridad, matcher
   vacío, límites excedidos y programas en campos no admitidos son rechazados.
   Los caracteres especiales dentro de una frase válida siguen siendo datos
   parametrizados, no una prohibición arbitraria de vocabulario.
5. Resultado `insufficient_evidence` explícito; cero DB, transporte, credenciales,
   proveedor, escritura editorial o activación en todos los tests.

Ejecutar focal con `pnpm --filter @noisia/query-engine exec node --test --import
tsx src/signal-topic-rule-suggestion-v1.test.ts`, suite estándar y typecheck del
paquete, más typecheck/lint del repo y diff check antes del cierre. Revisión
independiente del contrato y del límite sugerencia→borrador. No requiere build
Studio ni otro clone PostgreSQL.

## B. Recepción y bridge al borrador, gate posterior

Con A cerrado, implementar la mínima persistencia que permita reabrir una
sugerencia, conservar procedencia y usar el editor sin perder trazabilidad.
Verificar primero si un recibo de producto existente puede representarla sin
falsear tipo/semántica. No meter RuleSpec en el rationale de naming ni reescribir
la sugerencia archivada. Si no existe ese almacenamiento, proponer UNA migración
aditiva del producto, numerada al abrir B, no migraciones Lab copiadas en bloque.

Allowlist propuesta: nuevo `infrastructure/db/signal-topic-rule-suggestions.ts`
y tests focal/PostgreSQL; exports en `infrastructure/db/index.ts`; schema y SQL
únicamente si la necesidad de DDL queda demostrada. El bridge llama al writer
ordinario existente; no cambia su semántica ni activa perfiles.

La recepción append-only vincula sugerencia/output digest, run/candidato/snapshot,
CAS de fuente, estado y autoridad disponible de Brand OS, citas verificadas, versión de propósito y
procedencia de modelo/coste. La vinculación a un draft guardado queda separada y
reversible. El servidor vuelve a cargar fuente/derechos/autoridad, construye el
contexto y aplica el adaptador A; no recibe «autoridad verificada» del cliente.

Guardar una sugerencia usa una transacción del caller, CAS de candidato y último
draft, idempotencia y core ordinario con savepoint. No anidar los BEGIN/COMMIT de
wrappers Lab suponiendo que participan del rollback externo. Ante fuente cambiada
se conserva la sugerencia como obsoleta, sin sobrescribir el borrador actual.

Aceptación con fake y luego PostgreSQL local existente, rollback-only: un recibo
simulado → guardar draft → editar → undo → trial separado → entrada válida al
catálogo. Probar replay, CAS cambiado, citas/derechos retirados y cero asignaciones,
perfiles activos, llamadas o coste. No fabricar un flight pagado para el fixture.

## C. UI y ejecución presupuestada, aperturas separadas

Primero UI con transporte simulado sobre B: acción «Sugerir regla», propuesta
prellenada editable y los botones existentes Guardar/Probar. Sin motivo cerrado,
rationale humano o confirmación extra de edición. Conservar lectura de evidencia,
estado cargando/insuficiente/obsoleto y recuperación de petición exacta; un GET
desconocido no se considera resultado terminal. No regenerar al editar o probar.

Allowlist UI propuesta: `TopicCandidateRuleDraft.tsx`, callback focal en
`FullEvidenceTopicCandidateManager.tsx`, nuevos helpers
`apps/studio/src/lib/data-os/signal-topic-rule-suggestion-{management,api,product}.ts`,
GET/POST bajo la ruta existente
`full-evidence/candidates/[candidateKey]/rule-suggestions`, tests, i18n y OpenAPI.
La ruta vincula run/candidato/workspace y authZ; no acepta matcher y autoridad
arbitrarios como una solicitud de ejecución. El uso de la propuesta conserva el
guardado ordinario y su comparación con identidad guardada.

Después adaptar sólo el propósito/salida del loop presupuestado existente,
reutilizando navegación y el adaptador de proveedor. No crear otro agente ni
herramienta de SQL. Sellar el nuevo propósito, contrato y prompt; un flight de
naming viejo no se reutiliza como permiso para generar reglas. Mantener máximos
de doce turnos/doce navegaciones, bootstrap dos, resultados acotados y cap USD1
de la primera prueba propuesta. El gate de ejecución comprobará el presupuesto
actual antes de reservar, sin tomar este documento como nueva autorización.

Al preparar el plan: nueve de diez experimentos pagados consumidos y
USD11.374937 restantes, según el corte del orquestador. A/B y UI simulada cuestan
USD0. No gastar el intento restante ahora ni convertir un resultado ambiguo en
retry automático; conservar liquidación/claim y reconciliar con el control actual.

Caso real posterior: UN candidato, bootstrap auténtico antes del transporte,
menciones navegadas y citas verificadas, regla cerrada y prellenada sin escritura
manual obligatoria. Guardar/editabilidad verificadas y ensayo léxico separado con
denominadores, unavailable/not_tested, coincidencias y ejemplos actuales. Evaluar
utilidad para la marca con las menciones, no por alcanzar un número de matches.
Sólo después decidir extensión a más candidatos y prueba conjunta; no exigir un
benchmark general nuevo para demostrar este primer recorrido.

## Fuera de alcance y criterio de cierre

Sin migración/remoto/proveedor en A; sin migraciones Lab masivas en ninguna parte;
sin re-clustering, adopción/publicación/serving, producción, rediseño de Discovery
Review, nuevos actores/permisos ni gestor paralelo de agentes. Reutilizar los
presupuestos y límites existentes, no crear infraestructura de permisos adicional.

Cerrar A como adaptador local probado, no como IA ejecutada o producto desplegado.
Registrar las aperturas/cierres posteriores en STATE/CURRENT sólo por el
orquestador. B/C no son condiciones retroactivas para entregar LAB-3D.

Fuentes: [refinamiento](../73_TOPIC_CANDIDATE_REFINEMENT_CONTROL_PLANE.md),
[flight](../74_TOPIC_CANDIDATE_REFINEMENT_FLIGHT_CARD.md),
[separación Lab/producto](../73_TOPIC_EVALUATION_LAB_AND_RELEASE_BOUNDARIES.md),
[reglas y ensayo](/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06/docs/product/75_TOPIC_RULE_DRAFTS_AND_LEXICAL_TRIALS.md),
[catálogo conjunto](/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06/docs/product/76_TOPIC_COHORT_CATALOG_AND_JOINT_TRIAL.md).
