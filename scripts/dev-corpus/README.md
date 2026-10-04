# Corpus MFP — dev-test privado

Estado: harness en construcción. `up` verifica el entorno remoto; **no acredita**
provisión, migraciones, importación ni aceptación WS1 por sí solo. No se ejecuta
PostgreSQL, Redis, Worker ni Docker en la Mac.

Recursos propios: base/rol `noisia_mfp` en el PG17 existente; Redis `mfp-redis`;
runner `mfp-private-runner`. Sus IDs revisados están en `target.json`. No modificar
`noisia_dev_test`, bases históricas ni el runner `noi19-private-runner`.

## Provisión única

1. Comprobar entorno, PostgreSQL17, system identifier, conexiones y ocupación.
2. En el servicio pgvector privado, configurar temporalmente
   `NOISIA_MFP_DATABASE_PASSWORD` como variable privada y ejecutar `provision.sql`
   con psql administrador. Rechaza recursos existentes; no borra ni sobrescribe.
   Retirar después la variable temporal. La contraseña permanece sólo en las
   variables privadas del runner/Studio MFP. No imprimir valores ni URLs.
3. Desplegar Redis privado, autenticado, sin dominio/proxy, con volumen persistente.
4. Desplegar el runner con `scripts/dev-corpus/railway.json` y su Dockerfile, sin
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
0700/0600). Ejecutar los scripts TypeScript con `pnpm exec tsx`.

```
pnpm exec tsx scripts/dev-corpus/gold-template.ts roots.jsonl entity-context.json comparisons.json concepts.json
pnpm exec tsx scripts/dev-corpus/gold-import.ts annotated.csv .data/dev-corpus/gold-selection.json
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

Pendiente del corte inicial: migraciones dedicadas verificadas, seed/importación/
preparación/embeddings, corpus real, Studio autenticado, demo y replay remoto.
