# Corpus MFP — dev-test privado

Estado: harness en construcción. `up` verifica el entorno remoto; **no acredita**
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
Git. Las 20 modificaciones son edits de desarrollo marcados y registrados; no se
presentan como texto original del proveedor. Transferir corpus por Railway SSH
cifrado; nunca en argumentos, logs ni un endpoint público de base.

Pendiente de aceptación: ejecutar el recorrido remoto, comprobar replay/<10min,
completar gold real y Studio autenticado. El código y los tests sin DB no acreditan
esos resultados.
