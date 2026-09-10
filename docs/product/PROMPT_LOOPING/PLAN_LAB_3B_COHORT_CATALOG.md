# LAB-3B: un catálogo en borrador y una prueba conjunta

Fecha:2026-09-06. Alcance local; UATbd7dbf9/0123 ya quedó cerrado. Este plan no activa Signal.

## Resultado visible que buscamos

Un Insights Manager podrá reunir reglas de candidatos en un único catálogo versionado y ver
cuántas menciones cubren juntas, cuáles comparten y cuáles quedan sin cubrir. No crea un perfil
por candidato. No suma conteos individuales como si fueran cobertura única. La edición manual
sigue siendo una vía de control; una futura sugerencia IA usa el mismo RuleSpec cerrado.

Este incremento local entrega primero contrato, persistencia, lector y prueba real. La selección
y panel conjunto se integrarán después del núcleo verificado, dentro de un corte de UI acotado.
No hace falta otra evaluación pagada ni repetir BERTopic para probar esta capacidad.

## Selección y autoridad de fuente

- Entre2y15 candidatos distintos del mismo workspace/run/snapshot congelado. Cada selección
  identifica su última versión de regla guardada y la revisión/token actual de su candidato.
- Resolver identidad y reglas en servidor usando la autoridad existente de0112/0115/0123.
  Rechazar duplicados, otra marca/run/snapshot, una revisión obsoleta o un candidato rechazado.
- Una familia de catálogos por workspace/run; cada cambio de selección, regla o identidad
  editorial produce una nueva versión mediante CAS del catálogo anterior.
- Digest del cohort completo, ordenado por candidate_key: identidad de snapshot/contexto y
  todas las referencias candidate_revision/draft_revision/digests/RuleSpec. No solo context_hash.
- Los ensayos517/8 anteriores fueron alternativas de UN candidato y rollback. No hay reglas
  guardadas en UAT. Las pruebas de este corte crearán dos candidatos/reglas distintos localmente.

## Persistencia sin un segundo sistema de tópicos

Reutilizar las tablas de taxonomía existentes: una taxonomía conNterms candidate, un ruleset
draft, un modelo de procedencia operator/deterministic sin consumo y un perfil topic draft.
Mantener inalterados los perfiles activos y toda clasificación/record_tags/serving existente.

Extraer el núcleo de inserción de `createSignalTaxonomyDraftStoreV1` para que pueda componer
en la transacción reservada del caller. El wrapper legado conserva su contrato/comportamiento;
el nuevo camino resuelve su propio contexto congelado y deduplicación por cohort, sin invocar
el loader legado de100muestras ni su reutilización por context_hash. No ampliar el normalizador
legado de800caracteres: el nuevo camino valida RuleSpec y conserva su definición completa1500.
No fabricar ejemplos para satisfacer el contrato antiguo. Guardar referencias exactas y metadata
del cohort; ejemplos, si existen, se obtienen de evidencia real, no de texto inventado.

Nueva DDL aditiva0124, si la forma concreta lo requiere: recibo/versionado del cohort ligado al
perfil existente y recibos de pruebas conjuntas, no una tabla paralela de Topics/asignaciones.
Las filas de versión/recibo son append-only. La metadata/ruleset registra los bindings exactos;
lectores validan identidad, vigencia y perfil todavía draft. No crear jobs/outbox ni tocar Workers.
Idempotencia por actor y petición exacta; mismo request devuelve mismo resultado, cambios dan
conflicto. SERIALIZABLE externo, savepoint interno; no BEGIN/COMMIT escondido en el core.

La revisión de la familia del catálogo es por workspace/run; NO es la versión del perfil.
`signal_taxonomy_profiles.version` y la pareja key/version del ruleset siguen siendo globales
por workspace/kind. El core de inserción compartido conserva el lock existente
`signal-taxonomy:${workspace}:topic` antes de MAX(version)+1. La familia mantiene su CAS
separado. Probar un perfil anterior y dos familias de cohort, además del creador legado,
para descartar colisiones o una reutilización falsa. Replay no consume una nueva versión.

## Prueba conjunta

Reutilizar `compileSignalTopicRuleSpecV1` y los checks de población/disponibilidad de0123.
Compilar todos los predicados cerrados y evaluarlos sobre UNA población ordenada y UN cap;
no repetir una lectura independiente por regla y combinar recibos de momentos distintos.
No SQL/regex/JS recibido del cliente. Reutilizar/refactorizar el resolvedor de población en un
helper interno cuando elimine duplicación necesaria, conservando el contrato individual.

Límites iniciales:2–15reglas,25000memberships por defecto,cap1–50000,ejemplos totales<=10,
timeout15segundos como máximo. Si el volumen no cabe, devolver timeout explícito; no afirmar
un resultado completo ni aumentar límites silenciosamente. Corpus actual21195incluyeoutliers.

Una membresía disponible se excluye globalmente solo si TODOS los filtros de las reglas la
excluyen. Entre las que pasan al menos un filtro, la máscara de matches decide0/1/varios.
Un match requiere filtro Y predicado léxico de ESA regla, no solo lexical_predicate.

```text
total = considered + not_tested
considered = unavailable + excluded_by_all_filters + abstained + single_match + multiple_match
covered = single_match + multiple_match
```

Por regla:matched/exclusive/shared, con matched=exclusive+shared. Por par:intersección,
sin contar una membresía dos veces dentro del par. Las intersecciones no suman cobertura.
No inventar un ganador ni escribir multi-label assignments. Mostrar ejemplos acotados de
solapamiento y no coincidencia con procedencia/disponibilidad actual; selección determinística,
no muestreo para precisión. Población se cuenta en memberships, no consumidores/raíces únicas.

Persistir identidad de todas las versiones, compiladores/planes, población y resultado acotado.
Replay conserva cuentas históricas pero revalida ejemplos; GET no ejecuta matching ni escribe.
Cambiar un candidato/regla vuelve obsoleto el catálogo/recibo anterior sin borrarlo. Una nueva
versión aún no probada tiene latest_trial=null, nunca hereda como vigente una prueba anterior.

## Pruebas de aceptación

1. Dos candidatos con reglas actuales generan un solo perfil/taxonomía/ruleset yNterms exactos.
2. Misma solicitud no duplica; regla/cohort distinto no reutiliza el catálogo anterior. CAS,
   actor/ruta/snapshot incorrectos y versiones rechazadas/obsoletas no escriben.
3. Fixtures PostgreSQL: reglas idénticas, disjuntas, subconjunto y filtros diferentes, con
   denominadores, unión, singles/múltiples, exclusivos/compartidos y pares exactos.
4. Ensayo sobre snapshot real21195 con outliers; cap100 deja21095no probadas. Reutilizar la
   base local existente y rollback total, sin otro clon. No fingir precisión/gold.
5. Replay/currentrights/GETúltimo/noFTS, nuevo catálogo sin prueba, fallo transaccional y
   restricciones append-only. Datos previos iguales tras rollback, cero perfiles activos,
   LF/políticas/asignaciones/record_tags/provider/outbox/serving adicionales.
6. Pruebas estándar/focales de paquetes tocados, typecheck/lint/diffcheck y revisión independiente.
   Solo después abrir UI mínima o entrega UAT focal separada. No migration/push remoto en3B.

## Fuera de este incremento, sin convertirlo en bloqueo

0087 registra funciones/políticas y generaciones/items/asignaciones contra un perfil ACTIVO.
No sirve como almacén de este ensayo en borrador. El append actual crea un item por raíz y
no resuelve dos llamadas para asignaciones solapadas. En su integración posterior se decidirá
la política multietiqueta/abstención y la reconciliación memberships↔raíces canónicas, usando
esa autoridad existente, sin aflojarla ni insertar una cadena paralela de assignments.

La UI simple, sugerencia automática de reglas, matching híbrido y activación en Signal son
pasos posteriores claros. No se exige gold para construir/probar el producto dummy; sólo no
se declara precisión/recall sin evidencia. No bloqueos genéricos por autorización ya otorgada.
