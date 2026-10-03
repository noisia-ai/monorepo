# Signal workspace data plane — staging rehearsal 7A

Estado actualizado 2026-08-06: `noisia-staging` fue confirmado como preview aislado y
restaurable; 0059–0064 y el repair acotado de 0056 fueron aplicados y verificados. El
apply de 0064 preservó exactamente Operational V1 y dejó Operational V2 sólo como
candidata `draft`. No existe autorización de Review masivo, promoción, serving switch,
T&B real ni cutover.

## Estado verificado antes de 0064

- target: `noisia-staging`, clasificado `preview`;
- fingerprint observado en preflight/apply/verify:
  `sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19`;
- 0056 autolink: `complete`;
- 0059–0063: `complete`, sin sentinels faltantes;
- Laika: 4,587 menciones canónicas y `unresolved_count=0` estructural;
- población V1 activa: 192 `primary_brand` sostenidas por clasificación legacy a nivel
  batch;
- semantic gate: bloqueado; la auditoría encontró contradicciones batch↔contenido y no
  autoriza convertir `source_intent` en semántica aprobada;
- sync legacy huérfano: permanece intacto y debe reconocerse únicamente como stale en
  el preview sin Workers.

El backfill estructural 0059 no es el siguiente paso: repetirlo es idempotente, pero no
corrige la semántica. 0064 ya quedó aplicada sin promover V2; el próximo gate separado
es Review semántico real, todavía no autorizado.

## Resultado del rehearsal remoto de 0064

Se ejecutó mediante el entrypoint acotado `db:apply:signal-semantic-scope`, nunca con
`db:apply:existing` ni SQL manual. Preflight, apply, verify y el preflight posterior
terminaron con exit code `0` sobre fingerprint
`sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19`.
El checksum autorizado y registrado de 0064 fue
`sha256:62e45c4a63e7b0651133c23eec393a3bda1a4f948c358f931ed8a97cb8172e17`.

El preflight observó 0064 `absent` con `0/27` sentinels y el apply la dejó `complete`
con `27/27`. El ledger contiene una única fila 0064 con disposition `applied` y runner
`signal-semantic-scope-rehearsal-v1`; verify y el preflight posterior devolvieron
`actions=[]`, `writes_performed=false` y `shadow_or_cutover_executed=false`.

El gate transaccional de compatibilidad comparó antes y después:

- pointers V1: `6`;
- definitions V1: `6`;
- memberships V1: `18,996`, de las cuales `927` estaban incluidas;
- raíces visibles por el reader V1: `927`;
- hash agregado V1:
  `sha256:1af54acbc0c6a25139ec2e35fec9a0ebabdc9fa31f9929b49e8f5954214ba3ba`.

Los hashes de pointer, definition, memberships y canonical reader ID permanecieron
idénticos. El estado semántico posterior fue: `18,996` filas `source_intent`, todas
`not_eligible`; cero assertions `mention_semantic`, approvals y eventos de Review; seis
definitions Operational V2 `draft`, cero pointers V2 y cero memberships V2.

El restore point verificado fue el backup físico de `noisia-staging` del
`2026-08-05T14:16:15Z`. La inspección registró cero conexiones nombradas de Noisia,
cero conexiones activas de clientes y cero conexiones activas de larga duración. El
único sync legacy `running` permaneció intacto (`rows_modified=false`).

Artefactos locales, excluidos de git:

| Artefacto | SHA-256 |
|---|---|
| `0064-migration-preflight.log` | `7b01f85bb034c7356979cd159143d7073ae835deab76f59d2ad44ffb0c6df99e` |
| `0064-migration-preflight.json` | `5145438c4a82736aa6cdffe2a43cca7ab2a3efaf209427507edb95ec38307ea3` |
| `0064-migration-apply.log` | `96838aefdf276a09176c6ae1de0d8e64919aa1afa9b8c1f947bebd02c457d0c3` |
| `0064-migration-apply.json` | `8db21ed9faa35e531d1f498a54a999b75bd0414ab6a6eac4553bc5ac6a56c555` |
| `0064-migration-verify.log` | `165c1981a77b1220e242e555f18618db582c7a42912942a5c6b1ffdc67b241f2` |
| `0064-migration-verify.json` | `63a709fbbfeceecff2a7b9646a5f5e30bd0844b6ca5086c800329e9df050330c` |
| `0064-migration-post-preflight.log` | `df9bedf8a3fa67ecc9861d84deef31d5a44cd1c28e14074bb76c445a03c7c657` |
| `0064-migration-post-preflight.json` | `07a34e866a55605fc2f9d0376ada1e22cca18c22d132d4b55aa29ed419b49003` |

## Regla de target

La conexión remota que históricamente usa Studio se trata como producción mientras no se
demuestre lo contrario. Definir `NOISIA_REMOTE_DATABASE_TARGET=preview` no convierte una
base en preview. Antes de cualquier escritura debe existir un branch/proyecto/clon real,
aislado de Workers y restaurable, con un restore point registrado por el operador.

El runner añade dos controles contra confusión de destino:

- fingerprint SHA-256 estable de host, puerto, database y usuario, sin imprimirlos;
- confirmación explícita de aislamiento y referencia a un backup real.

## Drift 0056

`0059–0063` requieren las tablas de `0047–0055`, los perfiles de `0057` y la provenance
de aprobación de `0058`. La función y trigger de `0056` no son necesarios para transformar
las filas históricas, pero sí para conservar el adapter legacy al crear corpora nuevos.
Por eso son un invariante de compatibilidad obligatorio antes del rehearsal.

El runner clasifica 0056 como `complete`, `absent` o `partial`:

- `complete`: continúa sin tocarla;
- `partial`: falla cerrado; requiere revisión manual;
- `absent`: sólo en `apply`, en un clon confirmado y con
  `NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_0056_REPAIR_APPROVED=true`, instala exactamente la
  función y trigger de la migración existente y verifica ambos. No vuelve a ejecutar 0056
  si alguno de los dos objetos ya existe.

## Contrato del rehearsal remoto de 0064 — cumplido

El runner `db:apply:signal-workspace-data-plane` permanece cerrado deliberadamente a
0059–0063. 0064 no se pasó a `db:apply:existing` ni se ejecutó como SQL manual. El
rehearsal usó el entrypoint acotado `db:apply:signal-semantic-scope`, que reutiliza los
guards del runner existente y añade estos controles:

1. preflight `READ ONLY` contra target `preview`/`staging`;
2. fingerprint propio y comparación contra el target ya auditado;
3. restore point verificado, aislamiento y ausencia de Workers conectados;
4. precondición: 0056–0063 completas y 0064 `absent`, nunca `partial`;
5. checksum del archivo local 0064 y sentinels explícitos antes/después;
6. advisory lock, transacción, ledger, reanudación e idempotencia;
7. aprobación remota específica para 0064, no heredada del apply 0059–0063;
8. verify posterior `READ ONLY`.

El verify debe demostrar:

- definition, pointer, memberships, conteo y digest ordenado de Operational V1
  idénticos antes/después;
- una sola definición Operational V2 `draft` por workspace y cero pointers cliente a
  V2;
- todas las atribuciones heredadas convertidas/conservadas como `source_intent`
  non-eligible;
- cero assertions `mention_semantic` autoaprobadas a partir de imports o del scan
  privado;
- funciones, triggers, constraints e índices de Review/eligibility completos;
- una segunda ejecución sin duplicados ni cambios semánticos;
- `writes_performed=false` en verify y cero shadow/cutover.

Después del verify se detiene la misión. Crear candidatos, aprobar Review, promover el
pointer V2, cambiar `NOISIA_SIGNAL_OPERATIONAL_READ_MODE`, ejecutar T&B o modificar el
sync huérfano son autorizaciones posteriores y separadas.

## Rehearsal Fase 7B — candidate set de Laika

El entrypoint acotado es `db:rehearse:signal-semantic-candidates`. No es un runner SQL y
no modifica schema. Admite `preflight`, `dry-run`, `apply` y `verify`, siempre con URL
explícita y selector obligatorio por `brand_slug`. Un apply remoto está cerrado a
`laika` y exige, independientemente, target preview/staging, fingerprint coincidente,
restore point verificado, aislamiento, ausencia de conexiones Noisia, digest protegido
del dry-run, aprobación específica y acknowledgment del sync stale sin modificarlo.

El digest protegido incorpora checksum/sentinels/ledger de 0064, workspace redactado,
definition/pointer/memberships V1, source intents, assertions, estado V2, sync stale y
digest de los otros workspaces. El apply usa advisory lock y una transacción; aborta si
aparece cualquier cambio fuera de las nuevas assertions `pending/candidate`.

Secuencia autorizable:

1. `preflight` read-only;
2. `dry-run` Laika y revisión de distribución/digest;
3. `apply` sólo para candidatos pendientes, con digest exacto del dry-run;
4. segundo `apply` con el nuevo digest para probar idempotencia;
5. `verify` read-only.

El verify exige V1/source intent/sync/otros workspaces intactos, V2 draft sin pointer ni
memberships, cero Review events y approvals, y que todas las assertions persistidas
coincidan exactamente con la política determinista. Los artefactos públicos sólo
contienen sample hashes, scope, confianza y evidence hash; no contienen texto ni PII.

### Resultado observado — 2026-08-06

Preflight y dry-run seleccionaron un solo workspace Laika, confirmaron fingerprint,
0064 `27/27`, una ledger row, restore point físico `2026-08-05T14:16:15Z`, cero
conexiones Noisia y el sync stale intacto. La cola completa fue 729 raíces:

- 178 raíces `candidate_pending`;
- 551 `unresolved`;
- 183 assertions por cinco casos multi-entidad;
- 99 `primary_brand`, 84 `competitor`, cero category/reference/unattributed;
- 183 high-confidence, cero medium/low;
- candidate digest `sha256:16e7b6503737889ca89bd5d34f9e23e9d51edab52f813cbdc1a895e22aa65524`.

El primer apply creó 183 assertions pending/candidate. El segundo apply creó cero y
reconcilió 183 existentes. Verify fue read-only. Operational V1 conservó 192
memberships activas y sus hashes; las 4,587 filas source-intent, cinco workspaces no
seleccionados y el sync stale conservaron su digest. V2 quedó draft con cero pointer,
memberships, approvals y Review events. No hubo shadow, canary ni cutover.

Hashes de artefactos públicos redactados:

| Artefacto | SHA-256 |
|---|---|
| `candidates-preflight.public.json` | `9a4aa595d98721101e243a1c5f0ceaa01591116300b4c707dfbe41461d9152e4` |
| `candidates-dry-run.public.json` | `f124cb8f8fb40e04f14e92973c44f8c04a3f87d8edb947287020006c71cd97ca` |
| `candidates-apply-1.public.json` | `5c7cfe4eecb04d6023df50f3dd603a171a46f1a043015920bd4d041e10cbff9c` |
| `candidates-apply-2.public.json` | `62133d6c53bae66073fce06d465d5681fc5b39e4bdd7222f1cb5fa77685570df` |
| `candidates-verify.public.json` | `13b5a78bd06053b234ef4bd8ad0a5ad11ef84c2995ed1109f6c1553aa75f0164` |

El siguiente gate es UI y decisión humana de Review. Este resultado no autoriza
approval/rejection/supersession remotos, materialización, pointer V2 ni cambio de reader.

## 1. Crear el preview y registrar el restore point

Acción humana en Supabase:

1. crear un branch o clon desde la base auditada;
2. impedir que producción y sus Workers apunten al clon;
3. registrar project/branch, timestamp y mecanismo de restore;
4. comprobar read-only que Laika y sus 4,587 menciones existen en el clon;
5. proporcionar exclusivamente la URL del clon al operador backend.

No se guarda la URL en git ni se sobrescribe `apps/studio/.env.local`.

## 2. Variables base y preflight sin escritura

```bash
export DATABASE_URL='<preview-postgres-url>'
export DATABASE_SSL=true
export NOISIA_REMOTE_DATABASE_TARGET=preview
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_PREFLIGHT_ALLOW_REMOTE=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE=preflight

mkdir -p .data/signal-7a

corepack pnpm --filter @noisia/db db:apply:signal-workspace-data-plane \
  | tee .data/signal-7a/migration-preflight.json
```

El comando debe reportar:

- `writes_performed=false`;
- target `preview` o `staging`;
- fingerprint, checksums y orden 0059→0063;
- precondiciones y estado exacto de 0056;
- syncs `running`;
- estado `absent`, `partial` o `complete` por migración.

Una migración `partial`, un fingerprint inesperado o precondiciones core incompletas
bloquean el rehearsal.

## 3. Snapshot SQL y auditoría semántica pre-migración

```bash
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_AUDIT_ALLOW_REMOTE=true
export NOISIA_SIGNAL_WORKSPACE_AUDIT_BRAND_SLUG=laika
export NOISIA_SIGNAL_SCOPE_AUDIT_SAMPLE_SIZE=10

corepack pnpm --filter @noisia/db db:audit:signal-workspace-staging \
  | tee .data/signal-7a/laika-before.json
```

La salida pública está redactada: incluye digests, conteos, reglas y sample keys, pero no
texto ni UUIDs. La muestra determinista cubre `primary_brand`, `competitor`, `category` y
`unattributed`, junto con la regla exacta que asignó cada fila.

Para revisión humana del contenido real, sólo dentro de `.data` y con aprobación explícita:

```bash
export NOISIA_SIGNAL_SCOPE_AUDIT_INCLUDE_TEXT=true
export NOISIA_SIGNAL_SCOPE_AUDIT_PII_APPROVED=true
export NOISIA_SIGNAL_SCOPE_AUDIT_SAMPLE_OUTPUT="$PWD/.data/signal-7a/laika-scope-review.json"

corepack pnpm --filter @noisia/db db:audit:signal-workspace-staging \
  > .data/signal-7a/laika-before-redacted.json
```

Un revisor debe decidir si `mention_type`, `entity_kind`, entity y contenido justifican
cada scope. La suma aritmética no sustituye esta revisión.

## 4. Aplicar 0059→0063

Copiar literalmente el fingerprint del preflight y la referencia del restore point:

```bash
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_TARGET_FINGERPRINT='<sha256-from-preflight>'
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKUP_REFERENCE='<verified-restore-point>'
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_ISOLATED_TARGET_CONFIRMED=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_SCHEMA_APPLY_APPROVED=true
export NOISIA_DB_APPLY_SIGNAL_WORKSPACE_DATA_PLANE_ALLOW_REMOTE=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE=apply
```

El clon heredará el sync legacy `running`. No debe actualizarse artificialmente. Después
de verificar que el clon no tiene Workers conectados, se reconoce sólo para el rehearsal:

```bash
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_RUNNING_SYNCS_ACKNOWLEDGED=true
```

Si el preflight reportó 0056 `absent` —no `partial`— el operador puede autorizar el repair
acotado:

```bash
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_0056_REPAIR_APPROVED=true
```

Aplicación:

```bash
corepack pnpm --filter @noisia/db db:apply:signal-workspace-data-plane \
  | tee .data/signal-7a/migration-apply.json
```

El runner mantiene un advisory lock de sesión, aplica cada archivo en su propia
transacción, verifica sentinels y registra ordinal, SHA-256, fingerprint y disposition en
`signal_workspace_data_plane_migration_ledger`. Un fallo conserva migraciones completas y
la siguiente ejecución reanuda desde la primera pendiente. Dos runners concurrentes no
pueden aplicar la cadena dos veces.

## 5. Backfill estructural e idempotencia — no ejecutar como cura semántica

> **Detenido para Laika:** este procedimiento sólo reconcilia ownership/provenance de
> 0059. La auditoría 7A.1 demostró que no puede certificar `mention_semantic`. No volver a
> ejecutarlo como paso previo a 0064 ni usar su igualdad de hashes como semantic gate.
> Sólo se conserva como runbook de reparación estructural explícitamente autorizada.

El backfill no es clone-wide por defecto. Debe resolver exactamente un workspace mediante
`brand_slug` o `workspace_id`. Para Laika, la selección recomendada es el slug; nunca se
describe una ejecución `all_workspaces` como backfill de Laika.

Dry-run seleccionado, que también emite su propio fingerprint sin depender de las
variables usadas por el runner de migraciones:

```bash
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALLOW_REMOTE=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_MODE=dry-run
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_BRAND_SLUG=laika

corepack pnpm --filter @noisia/db db:backfill:signal-workspace-data-plane \
  | tee .data/signal-7a/backfill-dry-run.json
```

Antes de cualquier `apply`, copiar el fingerprint de este dry-run —no asumir que permanece
en la terminal desde la migración— y verificar de nuevo aislamiento y restore point:

```bash
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_TARGET_FINGERPRINT='<sha256-from-backfill-dry-run>'
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ISOLATED_TARGET_CONFIRMED=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_RESTORE_REFERENCE='<verified-restore-point>'
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_RESTORE_VERIFIED=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_MODE=apply
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_APPROVED=true

corepack pnpm --filter @noisia/db db:backfill:signal-workspace-data-plane \
  | tee .data/signal-7a/backfill-1.json
corepack pnpm --filter @noisia/db db:backfill:signal-workspace-data-plane \
  | tee .data/signal-7a/backfill-2.json
```

El backfill es reanudable por workspace y sólo usa funciones canónicas de 0059. Reproduce
provenance para cada par canonical mention/import, conserva aliases y review state,
reconcilia la población operacional y no copia enrichment a otro store. La segunda salida
debe conservar `content_hashes.aggregate` y todos los hashes por dominio, con
`content_changed=false` y `unresolved_count=0`. Los dominios cubren raíces, aliases,
provenance de import y study, attributions, memberships operacionales y current pointers;
se excluyen timestamps de mantenimiento que no cambian el significado gobernado.

Verificación read-only:

```bash
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_MODE=verify
corepack pnpm --filter @noisia/db db:backfill:signal-workspace-data-plane \
  | tee .data/signal-7a/backfill-verify.json
```

La operación sobre todas las marcas existe únicamente como modo separado:

```bash
unset NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_BRAND_SLUG
unset NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_WORKSPACE_ID
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES_APPROVED=true
```

Debe generar evidencia por cada workspace afectado. No usar este modo para el rehearsal
acotado de Laika.

## 6. ANALYZE y auditoría posterior

```bash
unset NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_BRAND_SLUG
unset NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_WORKSPACE_ID
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES_APPROVED=true
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_MODE=analyze
export NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_ANALYZE_APPROVED=true
corepack pnpm --filter @noisia/db db:backfill:signal-workspace-data-plane \
  | tee .data/signal-7a/analyze.json

corepack pnpm --filter @noisia/db db:audit:signal-workspace-staging \
  | tee .data/signal-7a/laika-after.json
```

`ANALYZE` actualiza estadísticas de tablas compartidas y por ello es siempre clone-wide.
En remoto exige nuevamente target preview/staging, fingerprint del dry-run, aislamiento,
restore point verificado y la aprobación específica de `ANALYZE`; la aprobación de
`apply` no la sustituye.

Comparar `laika-before.json` y `laika-after.json`: primary-brand, demás scopes, digests,
canonical roots, aliases, provenance, población current y filas sin resolver.

## 7. Shadow real por módulo

Resolver el workspace de Laika en el clon, sin publicar el UUID:

```bash
export NOISIA_SIGNAL_WORKSPACE_ID='<laika-preview-workspace-uuid>'
export NOISIA_SIGNAL_STAGING_SHADOW_EVIDENCE_ALLOW_REMOTE=true
export NOISIA_SIGNAL_STAGING_SHADOW_EVIDENCE_APPROVED=true

corepack pnpm --filter @noisia/studio signal:data-plane:staging-shadow-evidence \
  | tee .data/signal-7a/module-shadow.json
```

Este script ejecuta los adapters reales de Brand Monitoring, Mentions y Topics &
Narratives contra la población current y el baseline SQL independiente. Sólo emite hashes,
conteos, periodos, cursores y diferencias por scope. No cambia el payload cliente ni activa
cutover.

Gate:

- `primary_brand_contract=true`;
- `contract_violation_count=0`;
- `zero_unexplained_differences=true`;
- los tres `governed_module_checks=true`;
- cursor completo y válido;
- alias enrichment resuelto;
- diferencias legacy explicadas por scope, sin exigir paridad ciega.

## 8. Shadow HTTP, canary y rollback

Sólo después del gate SQL:

1. desplegar el mismo build en preview con
   `NOISIA_SIGNAL_OPERATIONAL_READ_MODE=shadow`;
2. comprobar rutas reales, Server-Timing, outbox diferido, ETags y AuthZ;
3. cambiar temporalmente el preview a `governed`;
4. recorrer Monitoring, Mentions, TN, evidence, deep links y Admin;
5. restaurar `NOISIA_SIGNAL_OPERATIONAL_READ_MODE=legacy`;
6. confirmar que no se borraron datos ni se ejecutó una down migration.

Los cambios de configuración del deployment son acciones humanas separadas. Ninguno de
los scripts anteriores modifica flags remotos, ejecuta shadow HTTP, canary, cutover,
Claude, Voyage o T&B.

## Criterio de detención

Detenerse sin promover readers si falta cualquiera de estos elementos:

- preview realmente aislado y restore point;
- schema 0056–0063 verificado;
- `unresolved_count=0`;
- revisión humana de scopes;
- cero diferencias inexplicadas;
- shadow por módulo y HTTP;
- canary governed y rollback legacy reproducibles.

Para el subgate 0064, detenerse además si el runner no puede probar que Operational V1
permanece byte/semánticamente estable, si aparece cualquier assertion autoaprobada o si
la candidata V2 obtiene un current pointer durante el apply.
