# Migración de almacenamiento local — 10 septiembre 2026

## Salvaguardas remotas previas

- NOI-19 incompleto, 28 archivos verificados contra `SAFE_PAUSE_SNAPSHOT.json`: commit remoto `256f0922a72071bd450042245f103f4f12e924d0`, rama `codex/backup-noi19-storage-migration-2026-09-10`.
- Historia y documentación local no versionada, 182 archivos: commit remoto `ae9998043c35a25771b9623daad3f96dace8e527`, rama `codex/backup-local-history-storage-migration-2026-09-10`.
- Runtime editorial separado: commit remoto `070c94eee9759801f2586760475822eccbdd1d6d`, rama `codex/backup-incremental-editorial-runtime-2026-09-10`.
- Los checkpoints se crearon con índices Git alternos: no movieron HEAD, índice ni archivos de los worktrees.

## Diagnóstico

- Docker Desktop ocupaba 148 GB físicos al inicio. `Docker.raw` muestra 1 TB lógico por ser sparse.
- El volumen anónimo `54a963b8ee789af1c0bd3299dc76990a0d37edfd1386e1c80fed2b780d6837da`, montado sólo por `noisia-r24a-provenance-pg`, ocupaba 128.7 GB.
- PostgreSQL contenía 63 bases de usuario/prueba por 119 GB. Cincuenta clones históricos terminales/reproducibles sumaban 100 GB; no había sesiones de aplicación activas.
- `.data` local ocupa 16 GB y conserva dumps, exports y recibos de los ensayos históricos. No se elimina en este corte.

## Retención PostgreSQL local durante la transición

Se conservan 19 GB y estas bases antes de trasladar las pruebas a ejecución remota aislada:

- `noisia_r24a`, `noisia_r24b`, `noisia_r24d_sha51`, `noisia_r24d_sha51b`, `noisia_r24d_sha51c`.
- Parent/resultados recientes: `noisia_topic_eval_lab_20260905_20e4b67a137a`, `noisia_topic_eval_lab_20260906_1cd623f0d548`, `noisia_topic_eval_lab_20260906_80d2cb97d6eb`, `noisia_topic_eval_lab_20260906_bb5cda6df853`, `noisia_topic_eval_lab_20260906_6074882e5bec`.
- Fixtures vigentes: `noisia_national_import_test_1788849021234`, `noisia_projection_test_1788913069775`.
- Bases de sistema: `postgres`, `template0`, `template1`.

Los 50 candidatos se resolvieron por nombre antes de ejecutar cualquier baja. No se usa `docker system prune --volumes`, no se elimina el volumen completo y no se toca UAT.

## Liberación comprobada

- Se eliminaron exclusivamente las 50 bases PostgreSQL resueltas; quedaron las 15 bases de la lista anterior por 19 GB.
- Se retiraron cachés de build e imágenes Docker no usadas, sin borrar volúmenes.
- El volumen PostgreSQL local bajó de 128.7 GB a aproximadamente 21 GB.
- Docker Desktop bajó de 148 GB a aproximadamente 46 GB físicos.
- El espacio libre de macOS subió de 3.1 GiB a aproximadamente 103 GiB.
- Los worktrees, `.data`, Redis, UAT, producción y los tres drafts ajenos permanecen intactos.

## Objetivo remoto

Railway Pro dispone de 100 GB de disco compartido incluidos; al observar el panel, el uso del ciclo era USD 5.54 y el estimado USD 10.87, por debajo de los USD 20 incluidos.

Se creó el entorno aislado `dev-test` dentro del proyecto UAT, sin duplicar variables ni servicios de UAT:

- Environment ID: `5bad359d-cfa4-4e8f-aa41-98e6f075375a`.
- Servicio `pgvector` (`pgvector/pgvector:pg17`), ID `8cc1601e-a87a-4b23-ae7c-9a4dc0a315a0`.
- Volumen persistente `pgvector-volume`, ID `24c805d4-0884-41f9-9f08-e6e04582f090`, montado en `/var/lib/postgresql/data`.
- Límites comprobados después de recargar: 2 vCPU y 4 GB de memoria.
- Red privada: `pgvector.railway.internal`; no queda proxy TCP ni dominio público.
- Contraseña rotada después de la carga inicial y nunca incorporada al repositorio.
- Esquema técnico restaurado: 269 tablas públicas y extensiones `pgcrypto`, `plpgsql` y `vector`. No se transfirieron textos, embeddings, recibos ni datos de National porque el proxy temporal no ofrecía TLS.
- Backup diario activado; primer backup del volumen creado y visible en Railway.

El siguiente corte debe crear un fixture sintético mínimo y un runner interno/CI que acceda a PostgreSQL por la red privada de Railway. Sólo después de comprobar los gates remotos se apagarán y retirarán las 19 GB de bases locales retenidas. UAT seguirá fuera de pruebas destructivas y los proveedores permanecerán deshabilitados.
