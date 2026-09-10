# LAB-3C propuesto — selección y prueba conjunta desde el editor existente

Preparado y revisado el 6 de septiembre de 2026. Gate abierto tras el cierre
real PostgreSQL y la revisión independiente de LAB-3B, commit3e4708b. Local-only, sin nueva llamada
pagada, migración remota, Workers, adopción/publicación/serving ni Discovery Review.

## Resultado esperado

El operador selecciona de 2 a 15 candidatos con reglas guardadas actuales, guarda
un catálogo y prueba esas reglas juntas. Ve cobertura única, solapamientos y huecos
sin repetir formularios de motivos, justificaciones o confirmación. Editar reglas
manualmente sigue siendo una vía de control, no un requisito permanente del producto.

## Autoridad y API

- Añadir un lector DB read-only de fuentes del **run explícito**, con candidate key,
  título/descripción, revisión/token editorial y draft id/revisión/digest/vigencia.
  No usar el listado que sustituye el run por el último disponible. Lectura acotada,
  con paginación coherente y refresco exacto de hasta quince seleccionados.
- Una respuesta de gestión reúne fuentes, catálogo último y su prueba última en
  REPEATABLE READ READ ONLY. Ausencia real es null; un error no equivale a vacío.
- GET/POST `full-evidence/cohorts/[runKey]` y POST `.../trial` bajo los helpers
  de autorización existentes. El run del cuerpo debe igualar al de la ruta.
- Guardar recibe sólo run, CAS de catálogo y referencias/CAS de fuentes. Probar
  recibe sólo run, CAS del catálogo y límites (25,000, diez ejemplos, 15 segundos
  inicialmente). No admite RuleSpec, actor, workspace, perfil o SQL del navegador.
- Header Idempotency-Key cerrado 8..200; POST una transacción SERIALIZABLE del
  wrapper, writers existentes con savepoints, DTO y constraints antes de commit.
- Contratos de respuesta cerrados, errores de dominio seguros, sin mensajes SQL.

## UI mínima

Checkboxs hermanos de los botones de abrir candidato; nunca elementos interactivos
anidados. Estado de regla: elegible, sin regla, obsoleta o candidato rechazado.
Guardar fuera de 2..15 no está disponible. Selección modificada es «sin guardar»;
Probar nunca mide silenciosamente la selección nueva como si fuera el catálogo guardado.

Acciones: Guardar catálogo, Probar catálogo, Actualizar. La tabla muestra conteos
con denominadores explícitos, exclusivos/compartidos por regla y pares plegables;
no suma pares como cobertura. Diez ejemplos totales con etiquetas y disponibilidad.
Versión de catálogo y perfil son distintas. Una versión sin prueba no hereda el
resultado previo. Resultados obsoletos pueden leerse con advertencia, no reprobarse.

Los callbacks de cambio editorial/regla refrescan vigencia y preservan selección.
Cambiar workspace/run nunca transporta selección o petición anterior al destino nuevo.
Ignorar respuestas GET/POST tardías del workspace/run anterior; paginar no descarta
selecciones ni reemplaza silenciosamente su CAS por una revisión distinta.
Conservar body/key exactos en sessionStorage antes de POST. Respuesta incierta:
GET de estado y recuperación manual de la misma petición/key, nunca otro ensayo
automático. El último GET por sí solo no prueba el término de una petición específica.

## Allowlist y responsabilidades

DB: lector de fuentes y pruebas en signal-topic-rule-cohorts; sin cambiar writers
ni 0124 salvo causa demostrada en revisión. Studio: FullEvidenceTopicCandidateManager,
callback focal en TopicCandidateRuleDraft, nuevo TopicRuleCohortManager, helpers
signal-topic-rule-cohort-{management,api,product}, dos rutas y pruebas. i18n es-MX/en-US,
manifiesto estándar, OpenAPI y CSS focal si hace falta. QE/Workers/Discovery intactos.

## Pruebas de salida

Run/actor incorrectos, CAS cambiado, duplicados, no-trial=null, GET sin FTS/DML,
rollback antes de commit si DTO/constraint falla, errores seguros y replay exacto.
PostgreSQL real en la base local existente, sin crear otro clone, con rollback.
Componente real: seleccionar→guardar→probar, conteos/pares del recibo real, refresh
sin POST, regla cambiada obsoleta, remount tras respuesta perdida con misma key,
cambio de workspace, Escape/foco y 390/740/escritorio sin desbordamientos.

Suite estándar/focal, typecheck/lint/build, JSON/OpenAPI y revisión independiente
antes del commit/release separado. La UI no activa perfiles ni asigna menciones.
