# 54 · Alexa Greenfield Operator QA

> **Inicio:** 2026-08-12T22:43:07-06:00 (`America/Mexico_City`)
> **Estado:** ejecución manual en curso; cero corrida T&B lanzada al abrir este registro
> **Entorno:** `noisia-staging` mediante Studio local
> **Producción:** fuera de alcance

## Propósito

Registrar el primer recorrido greenfield real de Noisia V0.2 con Alexa y convertir cada
hallazgo en evidencia de producto. Alexa no es una fixture que deba rescatarse: es el
primer QA del camino soportado de operador después de Backend 09.

El recorrido debe probar, en orden, marca/Brand OS, source, policies, provenance, import,
Semantic Review, governed views, authority estratégica, preflight, corrida T&B, Review,
release y Signal. No se utilizará `Estudios → Nuevo estudio` como identidad ni como
entrada a T&B V0.2.

## Hallazgos iniciales

### AQA-001 · Creación de marca todavía legacy

**Prioridad:** P1 de producto; cierre urgente en Gate E.

La pantalla no usa aún la densidad, ancho, cards, fields, estados y responsive canónicos
de Admin. Hay controles visualmente más frágiles que en la experiencia legacy anterior.
Debe reemplazarse como una superficie completa, reutilizando primitives existentes y el
comportamiento de Shopify cuando no exista canon interno.

### AQA-002 · Zona horaria abierta

**Prioridad:** P0 semántico antes de producción.

La UI acepta texto para una decisión que gobierna periodos, serving y reportes. El
contrato objetivo persiste una clave IANA, pero el browser sólo debe permitir elegirla
desde un catálogo gobernado. País o dirección pueden filtrar y sugerir; el operador debe
confirmar la zona cuando un país tenga más de una. API y DB continúan validando fail-closed.

### AQA-003 · Investigación de marca con Claude funciona

**Prioridad:** preservar durante AQA-001.

La investigación asistida pobló contexto y competidores de forma útil. El rediseño no debe
eliminarla ni convertir su resultado en verdad silenciosa: descripción, aliases, industria,
países y competidores continúan siendo revisables antes de crear el workspace.

### AQA-004 · Dos entradas aparentes a T&B

**Prioridad:** P1 de navegación; cierre urgente en Gate E.

El menú global `Estudios` abre el wizard de compatibilidad legado. La ejecución nueva vive
en `Workspace → Reportes`. Los CTA de marca deben dirigir al segundo y explicar o retirar
la ambigüedad del primero.

### AQA-005 · Policies sin ayuda operativa

**Prioridad:** P1 de onboarding; cierre urgente en Gate E.

Quality, Retention y Licensing exponen términos de backend sin explicar qué decisión
toma el operador ni qué superficie deja bloqueada. Cada título y field necesita un helper
canónico que funcione con hover, foco de teclado y tap; debe explicar definición,
consecuencia, módulos consumidores, ejemplo y diferencia `draft/active`. La información
obligatoria no puede depender sólo del hover y el trigger debe anunciarse correctamente a
tecnologías asistivas.

### AQA-006 · Contratos visibles inconsistentes

**Prioridad:** P0 funcional antes del siguiente workspace real.

El formulario de Quality acepta visualmente `0–100`, mientras PostgreSQL gobierna una
escala `0–10`. Retention reutiliza una opción `prohibited` aunque su contrato cerrado
espera `blocked`. Además, los fields de vigencia parecen contener una fecha aun cuando es
placeholder, y no distinguen claramente vigencia de policy frente a `retain_until`.
Frontend, validación HTTP y DB deben compartir enums, límites y copy generados desde un
solo contrato.

### AQA-007 · Authorities apiladas y onboarding sin defaults

**Prioridad:** P1 de densidad y velocidad operativa; cierre urgente en Gate E.

Con las tres policies activas, `Autoridades de policy` ocupa tres filas completas en un
viewport ancho. Quality, Retention y Licensing son un conjunto comparable y deben
presentarse como tres columnas compactas en desktop; tablet hace `2 + 1` y móvil conserva
el stack. Provenance sigue siendo una tabla separada porque compara sources, imports y
bindings.

El primer formulario de cada policy debe abrir prellenado con una plantilla explícita
`Piloto · seis meses`, sin ocultar ningún field:

| Policy | Valores iniciales propuestos |
|---|---|
| Quality | score vacío, flags vacíos, `evaluate`, vigencia de seis meses |
| Retention | `allowed`, `until`, `retain_until` a seis meses, `review_required` |
| Licensing | seis usos `allowed`, evidencia requerida, vigencia de seis meses |

La plantilla sólo reduce captura manual. El operador continúa pudiendo editar, crear el
draft y activarlo; no existe auto-approval. Después de activarse, cada policy conserva
versión, actor, fechas, estado y `Nueva versión`. Una nueva versión se prellena desde la
current para que una corrección sea explícita y no empiece desde un formulario vacío. Los
seis meses son meses calendario desde la fecha efectiva confirmada en la zona del
workspace, no un número fijo de días.

### AQA-008 · Import multiarchivo sin intención gobernada por batch

**Prioridad:** P0 semántico para productización; el QA de Alexa puede continuar bajo
observación explícita.

El primer CSV importado produjo 4,499 registros: 3,277 incluidos, 916 excluidos y 306
duplicados. El total reconcilia y cada upload posterior puede crear otro batch con filename,
conteos y lineage propios sobre la misma source.

La UI actual, sin embargo, fija toda source nueva a `Marca primaria`. Subir ahí un CSV de
Google, Siri/HomePod, Amazon Echo, otra competencia o `Smart Speakers · Categoría` no
convierte su filename en scope: el batch hereda intención `primary_brand`. Semantic Review
puede resolver la entidad correcta mediante el catálogo de identidades, y no la aprobará
por el nombre del archivo, pero el dato de adquisición queda demasiado grueso.

Para el QA actual se permite importar secuencialmente todos los exports de menciones en la
misma source y resolverlos después en Semantic Review. No se debe importar
`_rename_map.csv`, crear sources falsas por archivo ni asumir que el filename clasificó la
mención. Antes de producción, Admin debe ofrecer selección explícita y gobernada de scope,
entidad, query pack y periodo por batch, además de cola multiarchivo, preflight, progreso,
retry idempotente y resumen individual.

### AQA-009 · Ingesta asíncrona y recovery de CSV grande

**Estado:** cerrado y verificado en `noisia-staging` el 2026-08-13.

`Alexa Plus - Google.csv` fue validado localmente como UTF-8 BOM, delimitador `;`, 47
columnas, 13,595 registros lógicos, cero filas con ancho inválido y 1,794 IDs repetidos
dentro del archivo. Pesa 91,890,499 bytes y su SHA-256 es
`7c5840eff08f5fd5f8ee7bfb3e4db65d571a22ed69dcaf013a4989fa905bbfef`.

La ruta Admin workspace-owned original lo procesó dentro del request, perdió la conexión y
dejó persistencia parcial. 0079/0080 corrigieron el contrato sin crear otro parser: la
implementación única está en `infrastructure/db/sentione-csv-ingest.ts` y los adaptadores de
Studio/Workers comparten exactamente ese core. Admin
crea el batch y devuelve `202`; el browser sube directamente a storage privado en partes
deterministas de 48 MB; el outbox y BullMQ despachan al worker CSV canónico; el polling
expone upload, queued, processing, progreso, completed, failed y retry seguro.

La recuperación real mantuvo seis intentos fallidos append-only y creó una supersession
explícita. El batch aceptado reconcilió 13,595 = 0 incluidos + 0 excluidos + 13,595
duplicados: los roots ya existían por los intentos parciales, pero 10,417 quedaron enlazados
a la provenance completa y aceptada. Existe exactamente un batch exitoso para el hash, un
watermark, un sync run y una sola emisión de cada invalidación contractual. Cero roots
quedaron servidos sólo por batches fallidos. El historial Admin muestra tanto el resultado
completo como cada fallo y ofrece `Reintentar de forma segura`; Semantic Review carga 8,050
candidatos desde data aceptada.

El rehearsal desechable abortó a 7,500 registros, reinició el Worker a 5,000, reusó 5,500
roots parciales y cerró 13,595 registros sin outbox huérfano. El throughput fue 2.68 MB/s
local y 0.74 MB/s en staging; la proyección lineal para 717 MB es 4.5–16.1 minutos de
procesamiento, no varias horas. Upload y parsing son fases separadas. Un archivo de ~717 MB
produce quince partes de 48 MB, de modo que se reintenta sólo la parte fallida y Studio
nunca sostiene una conexión con el archivo completo.

Alexa puede continuar con los demás CSV desde la misma source y la misma UI. No requiere
SQL, rutas por marca, borrado de filas parciales ni división manual del archivo.

### AQA-010 · Resume mixto duplica contadores al finalizar

**Estado:** cerrado y verificado en `noisia-staging` el 2026-08-13 mediante 0081.

Después de 0079/0080, `Alexa Plus - Siri HomePod.csv` completó el upload multipart de
182,930,651 bytes y el Worker leyó 56,079 registros. La UI mostró `100% · 56079 registros
procesados`, pero el job terminó `failed` con `Workspace import final counters or hash are
invalid.` El estado fail-closed funcionó: quedaron 44,997 raíces persistidas y 47,029
memberships de import auditables, pero cero watermark, sync run o memberships operacionales
activas provenientes únicamente de este batch.

El procesamiento duró aproximadamente 43 minutos (182,930,651 bytes), ~0.071 MB/s. Esa
medición invalida para este caso la proyección previa de 0.74 MB/s: si no se corrige el
path de conflictos, un CSV de 717 MB se acercaría a 2.8 horas. La recuperación debe auditar
si los conflictos esperados están disparando fallback fila-por-fila y reemplazarlo por
resolución set-based antes de continuar con archivos mayores.

La clasificación reproducible es:

| Estado | Conteo |
|---|---:|
| Included | 40,647 |
| Excluded | 4,350 |
| Duplicate contra otros imports | 2,032 |
| Duplicate dentro del CSV | 9,050 |
| Total duplicate | 11,082 |
| Records | 56,079 |

El parser canónico llama a provenance para inserts antes de resolver los conflictos del
chunk. Al releer el chunk, esos inserts ya aparecen `already_in_batch` y algunas filas
included/excluded se suman dos veces. PostgreSQL rechazó correctamente el cierre.

El fix debe separar `inserted_this_attempt` de `resumed_before_attempt`, o hacer una única
clasificación durable por fila, y probar chunks que mezclen inserts, conflictos cross-import
y resume. La recuperación debe crear un intento auditable que reutilice las partes privadas
ya subidas; no debe exigir al operador volver a transferir 183 MB. La UI además debe separar
`archivo leído` de `batch aceptado`: 100% de bytes no puede presentarse como éxito ni como
un único progreso cuando todavía falta validación y publicación atómica.

0081 preservó la invariante PostgreSQL y corrigió la clasificación antes del insert:
`inserted_this_attempt`, `resumed_before_attempt`, `existing_from_other_import` y
`duplicate_inside_file` son mutuamente excluyentes. Los conflictos y provenance se
resuelven set-based; 95 chunks ejecutaron 285 queries cliente y `row_fallback_count=0`.
Property tests variaron chunk size, orden, conflictos, aborto, restart y retries
concurrentes; una fixture distinta de Siri produjo el mismo resultado para chunks de
1, 2, 3 y 7 filas.

El botón `Reintentar sin volver a subir` usó los objetos privados originales, validó sus
cuatro partes y el hash en el Worker y creó una supersession auditable. El resultado
observado fue:

| Verificación | Resultado |
|---|---:|
| Records | 56,079 |
| Included | 40,647 |
| Excluded | 4,350 |
| Duplicates | 11,082 |
| Memberships del recovery | 47,029 |
| Roots sólo en el batch fallido | 0 |
| Batch completed para el contenido | 1 |
| Watermark / sync run | 1 / 1 |
| Invalidación membership / acceptance | 1 / 1 |
| Outbox outstanding / jobs huérfanos | 0 / 0 |

El batch original continúa `failed` y el historial Admin muestra las dos filas: el fallo
con `Archivo leído; falló la validación final` y la recuperación completada. Repetir la
misma `Idempotency-Key` devolvió el batch existente. Admin Mentions, poblaciones y Semantic
Review reportaron cero raíces cuya única provenance fuera incomplete.

Tiempos operator-safe del Worker: verificación de storage 3.989 s,
parseo/persistencia 20.567 s, cierre 268.601 s y total 293.158 s (~4 min 53 s). El parser
procesó ~8.9 MB/s y el pipeline completo ~0.624 MB/s. El cierre relacional domina; una
proyección lineal conservadora sitúa 717 MB alrededor de 19 minutos más upload, por lo que
el siguiente archivo grande debe confirmar esa curva y conservar alertas por fase. No se
volvió a transferir ni se reclasificó manualmente el CSV durante el recovery.

### AQA-011 · Semantic Review no escala al corpus greenfield real

**Prioridad:** P0 de operabilidad, costo y data rights; no lanzar `Resolver` todavía.

Con todos los CSV aceptados y más de 100,000 menciones, la UI mostró skeletons prolongados
y terminó en `Semantic Review is temporarily unavailable`. El GET solicita 50 records,
pero `loadSignalSemanticReviewQueueV1` construye primero la población completa, carga texto,
provenance y assertions mediante subconsultas correlacionadas, ejecuta resolución
determinista en TypeScript, filtra, calcula digest y sólo al final pagina. Incluso una
lectura read-only de conteo sobre la misma elegibilidad agotó el timeout operativo.

El launcher tampoco está autorizado para usarse como bypass: prepara todo el workload en
memoria antes de estimar, el Worker limita un provider batch a 100,000 items y el SQL de
workload no prueba explícitamente `NOT signal_mention_has_only_incomplete_imports_v1` ni
rights `llm-processing` por provenance. Para un corpus superior al límite, una sola corrida
puede terminar `partial`; además el cap se deriva del estimate cuando éste supera el umbral,
en vez de exigir un hard cap elegido por el operador.

El cierre debe hacer la cola server-side/keyset y observable, materializar o versionar el
estado necesario para no reclasificar todo en cada GET, y añadir un preflight gratuito que
declare población elegible, derechos, estratos deterministas/ambiguos, número de provider
batches, estimate y hard cap. El dispatch debe ser durable, particionado, reanudable y
monitoreable; ningún texto puede salir sin provenance aceptada y licencia vigente.

**Cierre `staging_verified`.** 0082 materializa una proyección workspace-owned con
snapshot/watermark e invalidación incremental, pagina por keyset y calcula totals/facets
desde aggregates indexados. 0083 añadió los índices parciales que el rebuild real requirió
para recorrer sólo raíces aceptadas y provenance completed. La generación 1 de Alexa cerró
con 109,056 raíces, digests de snapshot/población y provenance incompleta 0.

El GET real devolvió 50 registros con cinco queries: p95 warm 427.7 ms, cursor 287.9 ms y
filtro 415.9 ms. `EXPLAIN (ANALYZE, BUFFERS)` observó `Index Scan`, 51 filas, cero temp
blocks y 0.151 ms de ejecución SQL. En el navegador local contra staging la cola cargó,
`Resolver` quedó disponible sólo después de la carga y desapareció el error temporal; una
recarga warm completa de la UI estuvo lista en 3,455 ms, mientras el presupuesto del GET se
mantuvo por debajo de 1.5 s.

El preflight gratuito declaró 109,056 raíces elegibles y sin resolver, 24,577
determinísticas, 84,479 ambiguas, tres batches y estimate USD 327.233340. Con hard cap USD
40 quedó bloqueado por cap insuficiente y el botón pagado permaneció disabled. Esto es el
comportamiento correcto: USD 40 es confirmation threshold, no ceiling, y no se recorta la
población. El recheck directo tardó 512.5 ms, creó cero runs, child batches u outbox,
encoló cero jobs, realizó cero provider calls y gastó USD 0. El flight card mostró las
109,056 seleccionadas, tres batches, modelo/precio pinneados y Worker/Recovery disponibles.
El operador debe
elegir explícitamente un hard cap suficiente en una autorización futura; no se ejecutó POST.

Al reanudar el supervisor se corrigió un defecto genérico en el tipo del error enviado a
`fail_signal_semantic_review_projection_v1`: los paths Worker/outbox usan ahora `text`, como
exige el writer. Un refresh imposible de un workspace inactivo quedó `dead_letter` tras sus
reintentos y sin lease; no pertenece a Alexa ni a Resolution. Alexa conservó exactamente su
generación, raíz, digests y cero provenance incompleta, y la cola pagada continuó con cero
jobs no terminales y cero provider batches.

## Camino soportado para Alexa

1. En `Datos y fuentes`, registrar una source de nombre reconocible; por ejemplo
   `SentiOne · Alexa Plus · Marca primaria`. Conservar `provider=sentione`.
2. No editar ni intentar desbloquear `CSV de listening`, `Carga manual` o `Marca primaria`:
   son contratos server-owned del conector disponible, no inputs omitidos.
3. Crear y después activar una versión de **Quality**. El draft por sí solo no gobierna.
4. Crear y después activar una versión de **Retention** con evidencia y vigencia reales.
5. Decidir los seis usos de **Licensing** y activar la versión. `client-derived-metrics`,
   lista, texto/excerpt, QA interno, LLM y análisis estratégico son derechos distintos.
6. Crear y activar un binding de **Provenance** a nivel source. Usar nivel import sólo
   cuando exista una excepción exacta y auditable.
7. Importar los CSV de menciones desde la source, un batch por archivo, y registrar records,
   included, excluded y duplicates. En el QA actual no importar `_rename_map.csv`; anotar
   el scope esperado de cada archivo porque la UI todavía hereda `primary_brand`.
8. Abrir **Revisión semántica** y resolver las raíces hasta obtener assertions current,
   approved y eligible; rechazadas y unattributed conservan lineage.
9. Abrir **Governed views**, reconciliar cada view aplicable y promover sólo los sets
   cuyo digest y blockers estén resueltos.
10. Abrir **Reportes**, reconciliar y promover la authority `triggers-barriers/strategic`.
11. Ejecutar el preflight gratuito; revisar población, muestra, coverage, modelo, estimate,
    hard cap, Worker y rights. Sólo entonces confirmar presupuesto e iniciar la corrida.
12. Completar Review, crear/promover `r1` y validar en Signal finding → evidence → mención.

## Qué significa cada check de Preparación de datos

| Check | Decisión o evidencia que representa |
|---|---|
| Identidad de marca | Brand OS y entidades estables reconciliadas con el workspace |
| Zona horaria | Clave IANA que gobierna cortes de periodo y reportes |
| Decisión de calidad | Regla versionada de eligibility; no modifica la observación original |
| Decisión de retención | Plazo/modo de conservación y acción al expirar |
| Decisiones de licencia | Permiso explícito por cada uso; métricas no implica texto ni LLM |
| Provenance de source e import | Une la source/import con las versiones activas de sus policies |
| Imports | Existe al menos una ingesta completada con lineage y conteos |
| Semantic Review | Hay assertions current, approved y eligible para servir/analizar |
| Governed views | Módulo y view tienen compilación lista y binding current |
| Authority T&B | Existe snapshot estratégico gobernado y apto para preflight/ejecución |

## Evidencia que debe capturarse durante el recorrido

- source creada y binding source-level activo;
- versiones activas y evidencia de quality, retention y licensing;
- archivo, periodo y conteos del import;
- conteos de Review por estado y ejemplos ambiguos;
- denominador/coverage/digest de cada governed view;
- flight card T&B y confirmación de presupuesto;
- run ID, reservation, settlement y estados de Worker/recovery;
- decisiones de Review, release `r1` y enlaces de evidence en Signal;
- cualquier confusión, fallo, latencia o componente no canónico observado en navegador.
