# Brand Context → Topics · cierre local · 11 septiembre 2026

## Resultado de producto

El primer guardado de una marca deja un Brand OS durable, una base de conocimiento
automática visible y una preparación semántica versionada. La misma acción usa una cotización
emitida por el servidor y conserva una identidad idempotente; una respuesta perdida se puede
repetir sin crear otra marca, generación, llamada o costo. Cuando no existe admisión vigente,
la marca se conserva y el recorrido queda esperando autorización en un estado recuperable.

Claude propone vocabulario, límites y relaciones después del guardado. Las reglas del servidor
activan automáticamente los elementos válidos y dejan sólo las excepciones para editar o
borrar. Voyage codifica los prototipos positivos y negativos de esa versión activa. Topics no
puede iniciar una preparación nueva si no existe contexto publicado o si Brand OS cambió; los
recibos históricos permanecen visibles.

La implementación no contiene un camino especial para National, Laika o Alexa. La siguiente
prueba real empieza con otra marca creada desde la UI.

## Superficies cerradas

- Zona horaria IANA buscable en creación, edición, gobierno e importación. La API rechaza
  valores arbitrarios y conserva zonas guardadas válidas.
- Brand OS sin sugerencias pagadas antes del guardado. La generación empieza cuando ya existen
  workspace, actor, ledger, cotización e idempotencia.
- Fuente automática visible y fuentes adicionales independientes. Notas iniciales admiten
  100.000 caracteres; cada fuente admite 200.000 completos y el exceso se rechaza sin truncar.
- Alta, edición y borrado de marca/KB con replay exacto. Reutilizar una clave con otro cuerpo,
  actor, workspace, acción o fuente falla antes de modificar dominio.
- Activación automática parcial: elementos válidos activos, excepciones aisladas, sin una
  aprobación masiva ni una publicación manual adicional.
- Sucesores por cambios de Brand OS, competidores, mercados, idiomas o KB. Ediciones, linaje,
  costos y respuestas históricas se conservan.
- Recuperación de respuesta terminal, drift después de una ejecución pagada y reemplazo de
  intentos Voyage únicamente cuando se prueba que no hubo gasto.
- Separación de conocimiento: Brand OS sólo ve fuentes con `study_corpus_id IS NULL`. Un corpus
  consume su propia evidencia y la KB global de marca; nunca la de otro corpus de la misma
  marca. La creación de un estudio no vuelve obsoleto el contexto de marca.
- Topics muestra `context_required` o `context_stale`, deshabilita la acción imposible y evita
  cualquier envío Voyage hasta que exista autoridad vigente.

## Evidencia local

El ensayo integrado final fue `attempt-16-non-corpus-final-pass` sobre SQL0153 SHA256
`12313855826e27e81b6d7916d5f44c91582ec1612a30abdb0a05b47a6ce033f5`.

- Una conexión PostgreSQL local; migraciones 0141–0153 dentro de una sola transacción.
- Dos generaciones listas, dos respuestas Claude simuladas, dos lotes Voyage simulados y un
  input reutilizado desde caché en el camino principal.
- Marca nueva, KB automática de 60.279 caracteres, edición exacta de 200.000 y rechazo de
  200.001.
- Dos corpus de la misma marca: corpus A incluye A + KB global y excluye B en autoridad,
  taxonomía y Worker.
- Alta 400/400/422, replay exacto y conflicto 409; Brand PATCH y KB PATCH/DELETE con replay y
  conflictos sin escrituras laterales.
- Contexto ausente u obsoleto bloquea quote, lease y sender de embeddings.
- Rollback físico: 269 censos y fingerprint del esquema idénticos; SQL0153 ausente al final.
- 116 archivos sellados mantuvieron sus hashes. Resultado SHA256
  `157ecdd776890f1e3a64a086151891352c51f2386dbdc75221291cbb4ccb382d`.
- Cero conexión remota y cero transporte real a Claude o Voyage.

Recibo privado completo:
`.data/brand-context-e2e-2026-09-10/IMPORT_RECEIPT.md`, SHA256
`e384243b1d7283f5c70159529aa6853bcfb4b035b1b83829c0d02932e8561aaf`.

## Verificación de código y UI

- Studio: 903 aprobadas, 7 omitidas, 0 fallidas.
- DB: 358 aprobadas, 89 omitidas, 0 fallidas.
- Worker: 561 aprobadas, 42 omitidas, 0 fallidas.
- Query engine: 472 aprobadas, 0 fallidas.
- Typecheck de Studio, DB, Worker y Query engine: PASS.
- Lint monorepo: 0 errores; 13 advertencias preexistentes.
- Build de producción Studio: PASS con valores locales no secretos.
- QA local: 13/13 recorrido de formularios, 31/31 responsive/componentes, ES-MX/en-US y
  cero errores de consola. El navegador confirmó el límite visible de 200.000.
- Revisión adversarial final: 0 P0, 0 P1 y 0 P2 abiertos.
- Escaneo de 98 archivos cambiados/nuevos: ninguna credencial o llave privada.

## Límite de esta entrega

Este cierre prueba contexto de marca → prototipos listos para Topics sin corpus real. No mide
precisión semántica y no fabrica Topics sin menciones. Después de la entrega focal UAT, el
operador creará una marca nueva y cargará sus archivos por la UI. Esa sesión comprobará corpus
completo → clustering → interpretación → Topics editables → selección → Signal con evidencia.

No se modificó producción ni main, no se repararon resultados históricos y no se consumió
presupuesto de proveedores durante este corte.
