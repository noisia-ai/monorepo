# LAB-3E-C — sugerir una regla en el editor existente

Plan propuesto, 6 de septiembre de 2026. **No abre C ni ejecuta llamadas.** A está
cerrado en `9adee21`; B sigue implementándose y sus firmas deben congelarse antes
de integrar. UAT conserva el corte LAB-3D. Planeamiento USD0; nueve de diez
experimentos pagados consumidos, uno restante y USD11.374937 conservadores según
el orquestador. No gastar ese intento en fixtures.

## Entrega mínima y secuencia

Un candidato guardado → **Sugerir regla** → leer explicación y citas → **Usar
sugerencia** → editar los mismos campos actuales → **Guardar regla** → **Probar**.
El resultado puede entrar después al catálogo de 2..15 reglas existente. Escribir
queries a mano queda como escape hatch, no como requisito permanente. Una regla
sugerida o una coincidencia léxica no activa Topics ni asignaciones de Signal.

Separar dos cortes verificables, sin esperar a reconstruir el producto completo:

1. **C-UI, local y sin proveedor:** integrar lectura/copia/guardado/restauración de
   B con transporte simulado para QA. `origin=local_fixture` se muestra como
   **«Simulación local»**, nunca como IA ejecutada. No crear un endpoint que reciba
   fixtures ni habilitar un botón pagado en UAT conectado a ese writer. La
   capacidad de ejecutar se deriva del servidor; si falta, lectura/edición siguen
   disponibles y «Sugerir» indica que la generación aún no está habilitada.
2. **C-exec, apertura posterior y propósito real:** conectar un ejecutor acotado
   que termine en la salida RuleSpec de A y en un recibo genuino. Primero prueba
   local sin proveedor; después UNA ejecución real de un candidato, con preflight
   y presupuesto reconciliados. No reutilizar el flight de naming ni marcar un
   fixture como resultado real. Una autorización previa del operador no requiere
   otra ronda genérica de preguntas; el orquestador registra el gate concreto.

## Reutilización exacta y huecos comprobados

Los caminos de producto siguientes viven en
`/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`:

| Reutilizar | Cambio mínimo pendiente |
| --- | --- |
| `apps/studio/src/components/brands/TopicCandidateRuleDraft.tsx`: identidad guardada, campos any/all/not, Guardar/Probar/Actualizar, recuperación con sessionStorage | Añadir sugerencia dentro de esta sección; hoy no existen Sugerir ni restauración de versiones de regla. Languages/markets ya se editan; scopes sólo se muestran: si la sugerencia los incluye, exponer su selector cerrado de cinco valores, sin borrarlos silenciosamente. |
| `apps/studio/src/components/brands/FullEvidenceTopicCandidateManager.tsx`: drawer, key workspace/run/candidato, callbacks `onBusyChange`, `onRefreshCandidate`, `onRuleSaved` | Conservar edición editorial, evidencia y refresh del catálogo. La sugerencia archivada de `TopicCandidateRefinementSuggestion.tsx` es naming: reutilizar su patrón de lectura/copia, no sus datos ni su writer. |
| `apps/studio/src/lib/data-os/signal-topic-rule-draft-{management,api,product}.ts`: schemas browser-safe, campos↔RuleSpec, `withTopicRuleTransaction`, authZ y CAS | Nuevo adaptador HTTP pequeño para B. GET coherente `REPEATABLE READ READ ONLY`; POST con caller `SERIALIZABLE`, DTO y constraints validados antes del COMMIT. No importar el índice QE/DB/node:crypto en el cliente. |
| `packages/query-engine/src/signal-topic-rule-suggestion-v1.ts`: `prepareSignalTopicRuleSuggestionContextV1`, `parseSignalTopicRuleSuggestionV1`, `adaptSignalTopicRuleSuggestionToDraftV1` | Ya resuelve contrato y compacción puros. No es sesión, permiso, transporte ni prueba de lectura real. El ejecutor debe alimentarlo con contexto/trazas del servidor. |
| `infrastructure/db/signal-topic-rule-suggestions.ts` de B: `loadSignalTopicRuleSuggestionV1`, `saveSignalTopicRuleSuggestionDraftV1` | Recibo/replay, CAS y link al draft; verificar firmas finales al cerrar B. El DTO observado tiene `origin=local_fixture`, disponibilidad agregada y `latest_link`; aún no representa ejecución real ni devuelve excerpts para leer las nuevas citas. |
| `infrastructure/db/signal-topic-contract-drafts.ts` y `signal-topic-rule-cohorts.ts` | Guardado ordinario, trial individual y catálogo/trial conjunto ya existen. Usar B al guardar desde una sugerencia para no perder su link; no sustituir estos writers ni duplicar sus métricas. |

El proveedor `services/workers/src/providers/anthropic-bounded-text.ts` sí existe
en producto: reutilizar `generateAnthropicBoundedTextV1` y su mapeo cerrado de
errores, sin cambiar la temperatura explícita de Semantic Context. El Worker de
evaluación V2 produce candidatos/rankings y su persistencia espera ese resultado;
no basta con cambiarle el prompt para guardar reglas.

Revisión independiente del plan: P0=0/P1=0. Un P2 causal sólo de C-exec requiere
portar el delta ya probado en main que conserva usage/request ID **antes** de leer
el getter SDK6 `result.output`: `NoOutputGeneratedError` tras una respuesta conocida
no debe perder su coste. Incluir sus fixtures sin red `output_limit|missing_output`
en la allowlist y aceptación C-exec. No modificar temperatura ni los demás
consumidores; este ajuste no bloquea C-UI ni reabre A/B/3D.

Sólo como referencia en `/Users/brandhon_o/Downloads/noisia-website`:
`services/workers/src/workers/signal-topic-candidate-refinement-lab.ts` y
`infrastructure/db/signal-topic-evaluation-v2-candidate-refinement-flight.ts`
demuestran bootstrap, navegación, claim/reserva y liquidación. Están ligados al
Lab, naming y migraciones 0116–0121. **No copiarlos como framework a UAT.** Extraer
únicamente la composición necesaria del bucle y conservar sus límites. El
`compactTraceContext` antiguo elimina las entradas más viejas: en C se usa el
preparador A, que conserva candidato, Brand OS disponible y evidencia citable.

## Flujo y contrato de UI/API

- GET bajo la ruta existente `full-evidence/candidates/[candidateKey]/rule-suggestions`:
  `run_key` obligatorio; latest o `receipt_id` exacto. Componer candidato/draft/
  recibo en una lectura coherente. Leer o actualizar no genera, no prueba y no
  adopta. Respuesta cerrada con origen, estado, CAS, stale, links, disponibilidad y
  capacidad real de generación; no asumir disponibilidad por existir una tabla.
- **Usar sugerencia** copia sólo lexical/filters al formulario, conserva identidad
  guardada y vincula el receipt localmente. Cero POST. No sobrescribir campos al
  recibir/pollear un resultado. Conservar los valores anteriores para deshacer la
  copia; «Descartar cambios» vuelve al draft guardado sin escribir.
- **Guardar regla** desde la sugerencia llama a B con `run_key`, candidato,
  `receipt_id`, lexical/filters y CAS esperado del candidato y último draft.
  Ruta propuesta `/rule-suggestions/[receiptId]/draft`, acción `save|restore`
  cerrada según B; `restore` recibe `restore_draft_id` del mismo candidato
  y crea una revisión nueva: no es el undo editorial ni un DELETE. No inventar
  una regla vacía si no existe versión previa. El receipt original no se edita.
- Explicación y citas del modelo son información de lectura, no campos humanos
  obligatorios. B necesita una proyección acotada de **sus propias citas** con
  derechos actuales si se ofrecen excerpts. Reutilizar el patrón lazy de
  `TopicCandidateEvidence`, no su colección de naming archivado. No exponer raw
  IDs/URLs/handles ni afirmar disponibilidad de una cita a partir de otra.
- `insufficient_evidence` no crea matcher. Recibo stale por candidato/Brand OS/
  evidencia se puede consultar, pero no usar como resultado actual. Un cambio del
  draft requiere reconciliación explícita de sus valores y CAS; nunca rebasar el
  formulario silenciosamente. Probar permanece separado y sólo usa regla guardada.
- Mantener pending exacto `{operación,scope,body,key}` antes de un POST; scope incluye
  workspace/run/candidato. Respuesta inválida, HTML, 5xx o pérdida de conexión no
  borran ese registro. GET desconocido/latest no demuestra que ese key terminó.
  Recuperación manual reenvía **el mismo body/key**, tras lectura de estado; no
  crea un nuevo intento pagado. Un outcome ambiguo del proveedor se reconcilia,
  no se convierte en un retry de transporte.
- Ignorar respuestas tardías GET y POST de otra instancia/scope. Conservar texto
  local y CAS retenido durante refresh; no mezclar selección/receipt viejo con
  CAS nuevo. Respuestas conocidas 403/404 se traducen a errores cerrados; no tratar
  una denegación de authZ conocida como ejecución incierta. Mantener Escape/foco y
  coordinación busy del drawer.

## Hueco mínimo de ejecución real

C-exec necesita un propósito nuevo, propuesto `topic_rule_suggestion_v1`, con
schema/prompt versionados y **terminal durable propio**. Su entrada del navegador
selecciona candidato/CAS y preflight; nunca recibe output, refs, contexto,
`origin`, actor, credenciales ni una supuesta autoridad verificada. El servidor
resuelve ejecución, reserva, navegación y salida. B sólo admite fixtures: añadir
recepción real vinculada al terminal y verificar bytes/digests/uso/coste; no basta
con ampliar un enum a `provider` ni reutilizar el terminal del naming anterior.
La DDL mínima, si hace falta, se declara en ese gate; no copiar 0116–0121.

Investigación local de reutilización: usar `getDataOsQueue` y
`loadDataOsRuntimeReadiness` de Studio, más `startDataOsWorker`/heartbeat y la cola
Data OS existente. Un job cerrado `signal-topic-rule-suggestion-v1`, no otra cola
ni un servicio MCP. Una única fila nueva de ejecución puede reunir entrada sellada,
reserva, claim, trazas acotadas y terminal; también es el pendiente durable de
despacho. Job ID determinístico, `attempts:1`, reconciliación del mismo request sin
volver a llamar si ya existe claim. El handler real se prueba primero con transporte
simulado; no crear otro camino exclusivo Lab. El terminal y recibo genuino B se
vinculan en una transacción corta; guardar/probar la regla sigue siendo separado.
V1 outbox y V2 completed exigen resultados de otros propósitos: no reutilizarlos
falseando una regla como evaluación Top 10. No hace falta tabla de sesiones, otro
ledger de presupuesto ni un framework de agentes. A no expone `next_cursor`;
una continuación por `trace_index` puede resolver el cursor/filtros anteriores
del lado servidor, conservando límites sin modificar el adaptador puro.

Antes del primer transporte: candidate_context y Brand OS del snapshot exacto,
dos de **doce navegaciones** como máximo. Usar menciones realmente obtenidas por
`representative_mentions`/`search_cluster` dentro de los clusters del candidato;
preservar cursor y límites, source/content/rights y trazas. El lector V2 selecciona
snapshot por workspace: debe coincidir con el run pedido, nunca sustituirlo por
otro más reciente. La selección Brand OS puede quedar vacía: mostrarlo y conservar
lo disponible, sin confundir vacío con error de autorización. Las citas históricas
no cuentan como menciones recién leídas.

Mantener contexto A **≤18 KiB**, bootstrap fijado, veto de refs no disponibles,
hasta doce turnos y límite propuesto **USD1 para el primer caso real**, siempre
dentro del saldo real al abrir el gate. Si falla antes de cualquier transporte,
terminal definitely_not_sent y coste cero; si pudo enviarse, conservar la incertidumbre y
el presupuesto correspondiente. No retry automático ni lote de diez candidatos.
Una regla requiere al menos evidencia leída; `insufficient_evidence` es un
resultado legítimo. La IA interpreta y propone, **no calcula cobertura,
precision/recall ni métricas del corpus**.

## Allowlist propuesta y aceptación

C-UI: `TopicCandidateRuleDraft.tsx`, callback focal en
`FullEvidenceTopicCandidateManager.tsx`; nuevos helpers
`apps/studio/src/lib/data-os/signal-topic-rule-suggestion-{management,api,product}.ts`
y tests; GET de `rule-suggestions` y POST de `[receiptId]/draft` bajo la ruta
anterior; i18n es/en, OpenAPI y tests/manifest Studio si son necesarios. Proyección
de citas pequeña en el módulo B y sus tests sólo si se confirma ese hueco al cierre.
Sin nueva pantalla, Discovery Review, cambios a 0123/0124 o al writer editorial.

C-exec: nuevo Worker focal `signal-topic-rule-suggestion.ts` y tests; nuevo módulo
DB focal de ejecución/terminal, extensión **acotada** del receiver B para origen
real, contratos/tests/export necesarios; ruta de launch/status específica dentro
de `rule-suggestions` después de revisar esa integración. Reutilizar adaptador
Anthropic; no tocar sus otros consumidores. Queue/registro y DDL se incluyen sólo
si la ruta real elegida los necesita, explícitos en el gate, no como framework.

Aceptación C-UI con UN candidato simulado: abrir→leer→usar (0 POST)→editar→guardar
con link→reabrir→restaurar como nueva revisión→trial separado; fixtures etiquetados,
sin lanzamiento real. Cubrir closed bodies, auth/scope/CAS, stale/dirty/empty,
derechos retirados, HTTP inválido, remount/same-key, respuestas tardías y cambios
de versión. QA del componente real integrado a 390/740/desktop, Escape/foco,
sin overflow ni peticiones inesperadas. Suites focal/Studio, typecheck/lint,
contratos/i18n y un build; revisión independiente antes de entrega UAT separada.

Aceptación C-exec: fake demuestra bootstrap antes de transporte, límites/terminal/
replay y cero llamadas no autorizadas; luego UN candidato real muestra navegación
auténtica, salida cerrada, recibo de propósito correcto y coste liquidado. Copiar,
editar y guardar no repiten generación. Trial determinístico posterior reporta
total/considered/not_tested/unavailable/matches y ejemplos actuales, sin equiparar
matches a calidad semántica. Evaluar relevancia con las menciones y conservar la
regla editable aunque se decida iterar. No exige rehacer BERTopic ni resolver los
diez candidatos antes de demostrar este recorrido.

Este plan no activa Topics, perfiles, asignaciones, publicación, serving o
producción; tampoco realiza migraciones, despliegues o llamadas. Referencias:
[plan A/B/C](PLAN_LAB_3E_AUTOMATIC_RULE_SUGGESTIONS.md),
[bridge B](PLAN_LAB_3E_B_SUGGESTION_DRAFT_BRIDGE.md).
