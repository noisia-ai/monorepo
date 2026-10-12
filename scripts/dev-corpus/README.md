# Corpus MFP — dev-test privado

Estado: recorrido remoto y replay comprobados, embeddings simulados. `up` verifica el entorno remoto; **no acredita**
provisión, migraciones, importación ni aceptación WS1 por sí solo. No se ejecuta
PostgreSQL, Redis, Worker ni Docker en la Mac.

Recursos propios: base/rol `noisia_mfp` en el PG17 existente; Redis `mfp-redis`;
runner `mfp-private-runner`. Sus IDs revisados están en `target.json`. No modificar
`noisia_dev_test`, bases históricas ni el runner `noi19-private-runner`.

## Provisión única

1. Comprobar entorno, PostgreSQL17, system identifier, conexiones y ocupación.
2. En el servicio pgvector privado, pasar `NOISIA_MFP_DATABASE_PASSWORD` sólo por stdin SSH al shell remoto
   y ejecutar `provision.sql` con psql administrador. Rechaza recursos existentes; no borra ni sobrescribe.
   No persistir esa variable en pgvector. La contraseña permanece sólo en las
   variables privadas del runner/Studio MFP. No imprimir valores ni URLs.
3. Desplegar Redis privado, autenticado, sin dominio/proxy, con volumen persistente.
4. Configurar en Railway el Dockerfile `scripts/dev-corpus/Dockerfile`, reinicio NEVER,
   una réplica us-west2 y volumen `/app/.data/dev-corpus`; el JSON es referencia
   declarativa y las opciones de servicio deben verificarse en Railway. Desplegar sin
   autodeploy, dominio ni proxy. Configurar `DATABASE_URL` privada al rol/base MFP,
   `REDIS_URL` privada MFP, `NOISIA_MFP_ENABLED=true`, `DATABASE_SSL=false`.
   El runner permanece disponible para SSH, sin trabajo automático ni proveedor.
5. Desde la Mac: `pnpm dev:corpus:up`. Sólo lanza el comando privado por Railway SSH;
   requiere la sesión Railway del operador. Una observación correcta no aplica SQL.

Las conexiones se validan por IDs revisados, host/base/rol exactos, DNS privado,
PG17 y system identifier. El pool verificado se reutiliza por las funciones de
Studio. No se habilitan destinos remotos genéricos ni se retiran guardas históricas.

## Runtime del recorrido UI

La imagen incluye el mismo Python CPU-only y dependencias fijadas del Worker,
con embeddings precalculados; no descarga modelos ni incorpora encoders. Incluye
los módulos de fit e incremental y los scripts de proveedores, sin corpus ni claves.
El arranque sigue inactivo por defecto. `NOISIA_MFP_WORKER_ENABLED=true` verifica
primero el destino remoto exacto y arranca el Worker existente con sus pools fijados.
Se configura únicamente después de instalar las migraciones del corte, reconciliar
las ejecuciones manuales y configurar las colas privadas compartidas con Studio.
Los flags de etapa y proveedor conservan su significado: iniciar el proceso no
concede autoridad ni activa por sí solo llamadas pagadas. Mantener una sola réplica.
Para recuperar el modo de pruebas explícitas, desactivar ese flag y redesplegar
después de cerrar/reconciliar el trabajo aceptado. No interrumpir un batch para
repetirlo; sus recibos permanecen en la base y el volumen remoto.

## Gold humano

Los datos viven exclusivamente en `.data/dev-corpus/` (ignorado por Git, permisos
0700/0600). Ejecutar los scripts TypeScript con `node --import tsx`.

```
node --import tsx scripts/dev-corpus/gold-template.ts roots.jsonl entity-context.json comparisons.json concepts.json
node --import tsx scripts/dev-corpus/gold-import.ts annotated.csv .data/dev-corpus/gold-selection.json
```

`roots.jsonl` contiene raíces reales con `root_id`, `input_digest`, `text` y `title`.
`comparisons.json` enumera IDs de comparaciones verificadas leyendo el texto; una
coincidencia léxica sola **no** certifica comparación. La plantilla exige 15 de ellas,
reserva 50 enriquecidas y toma otras 100 aleatorias reproducibles. La partición
estratificada 90/60 queda fijada antes de resultados de modelo. Capturar entidades
como `Nombre*; Competidor` (`*` significa principal), idioma ISO639-1 y las demás
dimensiones; usar `entities_abstained=true` explícitamente cuando corresponda.
El importador rechaza entidades desconocidas/duplicadas, texto o partición alterados,
dimensiones incompletas y menos de 15 comparaciones confirmadas por la anotación.

Pruebas ligeras, sin red ni DB: `pnpm dev:corpus:check`. Typecheck, lint, suites y
build se ejecutan en CI remoto. Las pruebas de proveedor se lanzan aparte; no forman
parte de `pnpm test`. Los presupuestos son orientativos, sólo un cap configurado
explícitamente es estricto. No transformar requisitos de cap legacy en máximos MFP.

## Ejecución explícita en el runner

Desde Railway SSH, dentro de `/app` (`TSX_TSCONFIG_PATH` ya definido en imagen):

```
node scripts/dev-corpus/up.mjs
node scripts/dev-corpus/migrate.mjs
node --import tsx scripts/dev-corpus/seed.ts .data/dev-corpus/brand.json
node --import tsx scripts/dev-corpus/import.ts .data/dev-corpus/load1.csv 2026-01-01 2026-12-31
node --import tsx scripts/dev-corpus/prepare.ts
NOISIA_DEV_EMBEDDINGS=fake node --import tsx scripts/dev-corpus/embeddings.ts
node --import tsx scripts/dev-corpus/status.ts
node --import tsx scripts/dev-corpus/export-roots.ts
```

Las fechas son argumentos del rango real del CSV. El importador usa Storage privado,
la admisión real y el job real mediante BullMQ en Redis MFP. Preparación usa páginas
de 500 y el mismo handler de producto. Repetir las órdenes conserva claves estables.
`migrate` serializa el entorno, verifica hashes ya aplicados y sólo ejecuta pendientes;
rechaza una base existente sin historial. No aplica SQL histórico a otra base.

`brand.json` incluye `fixture_key`, `organization_name`, `category`, `brand` con campos
del alta UI, `aliases` y ≥2 `competitors`; opcionalmente `client_email` para el login
autenticado posterior. No configura atajos de Kinde ni override local. Derechos de
la fuente incluyen texto, métricas y procesamiento LLM. Las nuevas acciones de
política MFP se incorporarán con WS2; el seed muestra ese pendiente expresamente.

Fake produce vectores sintéticos y recibos marcados como simulados, costo proveedor
real cero. No puede reutilizarse después como Voyage: usar otra identidad de fixture
en la misma base, nunca un clon. Voyage requiere flag y clave selectiva; mientras el
contrato compartido de embeddings exija un cap no nullable, el script devuelve
`mfp_voyage_nullable_cap_contract_pending` si no hay cap explícito del operador.
No convierte el presupuesto orientativo en techo. Éste es un pendiente de código,
no una solicitud de aprobación de gasto.

`sample.mjs <directorio CSV> <entity-context.json>` genera 1,000 + 250 filas fuera de
Git. La identidad para deduplicar es el `id` de proveedor: dos menciones con texto
idéntico permanecen como dos registros distintos. Las 20 modificaciones son edits
de desarrollo marcados y registrados; no se presentan como texto original del proveedor.
`facets-lock-check.ts` exige una identidad cuyo `fixture_key` tenga el formato
`facets-lock-check-<sufijo-aleatorio>` y verifica en PostgreSQL que organización, marca,
workspace, operadores y fuente estén ligados a ese fixture desechable antes de crear
datos de prueba. El probe se limita al orden de locks de reserva/renovación y no cambia
políticas. No apuntar esa comprobación a la identidad habitual del corpus. Transferir
corpus por Railway SSH cifrado; nunca en argumentos, logs ni un endpoint público de base.

Recorrido remoto comprobado: 1,000 filas → 977 únicas → 905 elegibles → 3,158 chunks;
replay sin nuevos vectores ni llamadas. Plantilla privada `gold-template.csv` creada:
150 raíces, 90 dev/60 test, 15 comparaciones verificadas por lectura, 35 enriquecidas
más 100 aleatorias. Tres conceptos propuestos esperan confirmación del fundador;
las etiquetas humanas quedan vacías. No existe todavía gold anotado ni aceptación WS4.
Studio MFP responde, pero Kinde devuelve `Invalid callback URL` para el retorno MFP;
la corrección exacta está pendiente de confirmación del operador en Kinde.

## Recuperación explícita

Añadir `--retry` a import, prepare o embeddings sólo cuando el estado es recuperable.
Import sigue la cadena de sucesores y usa `retryWorkspaceImportFromStorageV1` para
reutilizar el objeto privado validado. Preparación/embeddings recuperan el mismo run
cuando su revisión de entrada coincide; una nueva preparación crea una intención nueva.
Embeddings usa la cotización actual, mantiene el cap original y el costo asentado.
`outcome_unknown` requiere reconciliación: nunca se reenvía automáticamente.
Cada job usa su propia cola MFP determinista para que dos comandos concurrentes no
consuman trabajo ajeno. Un job BullMQ fallido requiere recuperación explícita.

Pruebas remotas opt-in (fuera de suites comunes, proveedor simulado):
`node --import tsx scripts/dev-corpus/redis-check.ts` prueba concurrencia/reintento/replay.
`recovery-check.ts <csv>` requiere una identidad nueva cuyo `fixture_key` termine en
`-recovery-check`, creada con seed desde un cwd privado separado. Usa ≥129 chunks
para fallar después del primer lote asentado y verificar recuperación con cotización
cambiada, costo conservado y replay sin llamadas; también falla import/preparación.
No ejecutar contra la identidad principal ni reutilizar una fixture ya completada.
La prueba de import usa un flag exclusivo de esa fixture, `--test-fail-import`.
`node --import tsx /app/scripts/dev-corpus/snapshot-recovery-check.ts`, desde otra
fixture pequeña sin preparación previa, comprueba fallo anterior al snapshot:
`input_revision=null` requiere `--retry` y crea sucesor, preservando el run fallido.
