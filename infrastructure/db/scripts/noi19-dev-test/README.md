# NOI-19: synthetic private-network PostgreSQL gate

On September 24, the operator inspected the existing PostgreSQL service
`8cc1601e-a87a-4b23-ae7c-9a4dc0a315a0` in `dev-test` through the Railway UI:
`POSTGRES_USER=noisia_dev` and `POSTGRES_DB=noisia_dev_test`. These were the
original service values, not changes to PostgreSQL. The earlier runner contract
incorrectly assumed user `postgres` and database `railway`. The seal and strict
allowlist now use the two observed values; the private host, port and service
identities remain the same. Subsequent private read-only receipts sealed system
identifier `7683766906362679330`. The first restored database contained only
pre-data objects; the available complete schema was actually at SQL0140, not
SQL0152. SQL0141–0152 passed on an empty local PostgreSQL database, and its
schema-only dump was restored into a new private dev-test database. Both prior
incomplete databases remain retained under separate names. The current
read-only receipt confirms 269 empty tables and SHA
`1767ba283151f2859f85e03871ad906ba8ab078fbb562bfe5030369592e7c228`.
No business data was copied. SQL0153–0182 also passed locally on that empty
schema; remote transactional acceptance remains pending.

## Explicit empty dev-test schema upgrade: 0152 → 0182

`upgrade-0152-0182.mjs` is a separate maintenance command. Neither test runner,
the Docker default, nor the read-only bootstrap invokes it. It is not an UAT
migration command. It accepts only the private dev-test identity already pinned
in `target-seal.json`, with a newly observed/reviewed `system_identifier`, the
**old** schema SHA and explicit `table_count: 269`. Never copy runtime observations
into the seal automatically. A source that is populated, partially migrated,
already upgraded, or differs from the sealed fingerprint is rejected.

After reviewing the read-only bootstrap receipt and sealing that exact old
target, the operator must set `NOISIA_DEV_TEST_SCHEMA_UPGRADE_APPROVED=true` in
the private runner environment and invoke this command explicitly:

```
pnpm --filter @noisia/db db:upgrade:dev-test-0152-0182 --commit-empty-0152-to-0182
```

The command verifies all 30 checked-in SQL byte hashes against
`upgrade-0152-0182-manifest.json` before connecting. It runs one mutation
transaction, takes the same advisory lock as the synthetic gates, locks every
old public table in ACCESS EXCLUSIVE mode, and checks identity, count, emptiness,
fingerprint, required 0152 markers and absent 0153/0182 markers before the first migration. Controlled
`extensions.digest(bytea,text)` must exist; enabled DDL event triggers are refused.
The restored dev-test schema has pgcrypto owned in `public` and an immutable
`extensions.digest(bytea,text)` SQL bridge to its extension-owned function.
The source guard accepts this exact bridge or a digest directly owned by
pgcrypto; it does not relocate the extension or accept an arbitrary function.
There is no extension relocation, automatic schema repair, down migration,
provider execution, data copy, fixture insertion or cleanup of existing rows.

Static viability review: the SQL package only installs schema/functions/ACLs,
apart from the technical singleton inserted by 0167. On an empty `mentions`
table the original backfill function must return zero; 0168 still checks that
completion and 0169 validates both constraints and removes only the scratch
table/function created by 0167 in this same transaction. The separately committed
batch requirement for a populated production table does not apply to this
empty target. The 0178 empty-editorial-ledger guard remains intact. Installing
provider admission functions/triggers does not invoke them or create permissions.

The exact expected result is **299 empty public tables**: 30 permanent additions,
including the `IF NOT EXISTS` cohort checkpoint in 0163, plus the temporary
0167 scratch table removed by 0169. Before COMMIT, the command checks the exact
table-name delta, completed 0182 markers, validated text digest invariant, zero
rows and a changed schema SHA. After COMMIT acknowledgment it opens a fresh
read-only transaction to verify identity, count, empty state and the new SHA.
The secret-free receipt includes all 30 source/applied hashes and before/after
counts and fingerprints. Only `status=committed`, `commit_acknowledged=true` and
`post_commit_verified=true` confirm the complete result.

An error before COMMIT rolls back; a lost acknowledgment is reported as
`commit_outcome_unverified`, never retried or represented as rollback. A failed
post-commit check is `committed_verification_failed`: inspect read-only and do
not rerun the upgrade. After a successful receipt, separately review/reseal the
new SHA and `table_count: 299` before running the imported Signal gate. The old
NOI-19 runner remains tied to its historical schema and is not the gate for this
upgraded target. Disable the one-shot upgrade approval after maintenance.

Local validation (no PostgreSQL, DNS or providers):

```
pnpm --filter @noisia/db db:test:dev-test-upgrade-guards
```

The local fake-client tests verify ordering and rejection paths; they do not
claim a PostgreSQL execution or remote schema upgrade. A live reviewed bootstrap
receipt and the explicit maintenance invocation remain required.

This is a finite test program, not a Worker service. It is not enabled by GET,
application polling, a scheduler or a product flag. It never opens a public proxy,
starts Redis, calls a provider, imports customer data or applies a migration.

The dedicated runner's reviewed Railway service ID is sealed in
`target-seal.json`. The mutating test additionally refuses a missing
PostgreSQL system identifier or schema fingerprint. There is no environment or
command-line bypass for those checks.

## First phase: identify the empty private test database

1. Create a dedicated, finite service **inside `dev-test`**, environment
   `5bad359d-cfa4-4e8f-aa41-98e6f075375a`. Use the repository root as build context,
   and this directory's `railway.json` and `Dockerfile`; do not reuse the normal
   Workers service/config. Its default command is the read-only bootstrap.
   Keep one replica, restart policy **NEVER**, no public domain/TCP proxy,
   and no automatic redeployment/cron. Build the reviewed branch only.
2. Confirm the service ID in `target-seal.json.runner_service_id` remains the
   actual dedicated runner. Railway-provided environment/service IDs must match.
3. Set only `DATABASE_URL` via the **private** reference to the dev-test `pgvector`
   service, `NOISIA_DEV_TEST_DATABASE_SERVICE_ID=8cc1601e-a87a-4b23-ae7c-9a4dc0a315a0`,
   and `NOISIA_NOI19_PRIVATE_TEST_APPROVED=true` for the explicit test intent.
   Do not copy UAT/shared variables or set PG* variables. No API keys, Redis,
   Supabase, storage credentials, `.env`, `NODE_OPTIONS` or `NODE_PATH`.
   Credentials stay in Railway's runtime secret variables, never source, image,
   CLI arguments, a local file or test receipt.
4. Run `pnpm --filter @noisia/db db:test:noi19-private-bootstrap` inside that
   service's private network. It validates the environment, runner and database
   service IDs, exact hostname/port/database/role, every DNS answer, PG17 and all public tables, and uses `default_transaction_read_only=on`.
   It emits only the nonsecret database system identifier, schema SHA, table count,
   nonempty-table count and `status=observed`. A newer schema or nonempty database
   is reported read-only; this observation never authorizes fixture mutation. The connection is pinned to a resolved private IP;
   `inet_server_addr()` must agree with it. No application modules are imported.
   A rejection prints only a fixed `noi19_dev_test_*` stage code, never the
   connection URL, environment, query, row or underlying error text.
5. Compare the output with the intended service. Seal `system_identifier` and
   `schema_sha256` in source and review the delta. A reset/replacement of the
   database requires a new read-only observation and source review; never copy
   a guessed value. The SHA includes functions, triggers, table ACL/RLS, columns
   constraints, standalone/partial indexes, RLS policies and extensions. It is specific to the restored database, including OIDs.

## Second phase: run the composed gate once

After both identities are sealed and reviewed, explicitly run:

```
pnpm --filter @noisia/db db:test:noi19-private
```

The test rechecks all target guards, takes an advisory lock and SHARE-locks the
public tables after opening its outer READ COMMITTED transaction. The empty
check starts after the locks, so a previously waiting writer's commit is visible. Any existing application row
causes rejection before inserting synthetic data. It requires the current schema
through SQL0152; no migrations or schema compatibility fallback run here.

It creates a fresh organization, internal operator, brand/workspace, source,
three literal invented mention roots, an accepted import receipt and invented
policy rows. The real preparation stores/handler seal the texts. Embedding stores
consume deterministic unit vectors and explicit **synthetic usage receipts**;
there is no HTTP and no real provider usage. These fixture receipts are rolled
back and must never be presented as a real processing result. The existing
projection fixture constructs two numerical units and Topics through real
ledger/catalog APIs. NOI-19 then uses exactly the same composed assertions as
its already-closed local gate: scoped entry without a report; role/grant matrix;
selection/withdrawal, receipts, CAS/staleness, revoked rights and no new compute
or spending caused by client actions.

All nested store transactions are savepoints inside **one physical connection**.
This retains the original lost-ACK and deterministic post-lock revocation tests;
it does **not** claim a two-connection race or a network-partition test. No real
Worker daemon or queue transport is involved. Every imported handler receives
its database and in-memory storage explicitly. HTTP/fetch are additionally
blocked at runtime, and a 180-second watchdog closes the connection on overrun.

`cleanup()` always issues physical ROLLBACK. It then opens a fresh read-only
transaction to verify all 269 public tables are empty and the schema SHA is
unchanged. The output is one small JSON receipt with assertion results,
rollback verification and fixed error codes (optional SQLSTATE). It contains no
text, SQL arguments, URL, environment dump or provider body. A timeout or lost
connection cannot claim verified rollback: stop, inspect read-only and do not
automatically rerun. PostgreSQL sequences are not covered by the table-empty
check; the fixture's inserted identities are UUIDs, not sequence IDs.

## Offline validation and current limit

```
pnpm --filter @noisia/db db:test:noi19-private-guards
pnpm --filter @noisia/db typecheck
```

The guard tests use invented credentials only and do not connect to PostgreSQL.
The original September 10 documentation did not record a completed remote
bootstrap. Determine current runtime status from its receipts; this historical
statement is not a fresh observation. The existing local PG result is retained.
No remote readiness or delivery claim is valid until phase two returns
`status=passed`, `physical_rollback=true`, `post_rollback_empty=true` and zero
provider transports against the newly sealed private target.

## Signal from import: separate focal gate (SQL0182 schema)

The historical `db:test:noi19-private` runner and its 269-table/SQL0152 gate
remain unchanged. The new command is separate:

```
pnpm --filter @noisia/db db:test:signal-imported-private
```

Before that command may mutate a fixture, the checked-in `target-seal.json`
must contain the reviewed `system_identifier`, `schema_sha256`, and an explicit
positive integer `table_count` from the current read-only bootstrap. Missing
`table_count` remains equivalent to 269 for historical helper callers, but is
rejected by this new gate. Never copy runtime observations straight into the
mutating expectation or supply a count through environment/CLI. This separate
gate requires a fresh post-upgrade 299-table seal; the current 0152 seal
cannot authorize it.

This gate requires `NOISIA_SIGNAL_IMPORTED_PRIVATE_TEST_APPROVED=true` instead
of the historical NOI-19 approval flag. All environment/service/host/role/IP,
private-DNS, no-provider-credentials, all-table emptiness, schema fingerprint,
advisory and table-lock guards remain. The bootstrap still uses the original
bootstrap approval flag and remains the image/default Railway command; adding
this entrypoint does not schedule or automatically run it.

The runner verifies current consolidation binding/snapshot functions, the
SQL0182 successor signature, and the validated, maintained, non-null exact-text
digest invariant before importing the fixture. It invokes only
`assertSignalWorkspaceImportedServingV1`: three invented accepted roots and six
SQL acceptance scenarios, with no preparation, embedding, Engine or provider
execution. It does not apply or repair migrations. A schema mismatch blocks the
gate and requires a separately reviewed infrastructure action.

Nested store reads use savepoints and preserve their UTC/search-path/query
planner settings. The outer physical transaction always rolls back, followed
by a fresh read-only all-table emptiness and schema-fingerprint verification.
HTTP/fetch remain blocked. A 180-second connected-work watchdog closes the
physical connection on timeout; no verified rollback is claimed on timeout.
A passing receipt requires all six assertions, zero transports,
`physical_rollback=true`, and `post_rollback_empty=true`.

Offline validation uses `node --test scripts/noi19-dev-test/guards.test.mjs`.
The added gate has not been run against PostgreSQL by this local implementation.
Current remote service status must be observed separately; historical README
status and a completed container alone are not evidence of a passing SQL gate.


## Interest preparation0183 — SQL preflight only, not full acceptance

`interest-preparation-runner.mjs` rehearses installation of the exact0183 bytes
pinned in `interest-preparation-manifest.json` inside an outer transaction that
always rolls back. It does not extend or invoke the0152–0182 upgrade, modify the
runner's default command, seal observed identities automatically, or enable any
provider. The checked-in target remains unsealed: do not attempt this command
until the already-reported private authentication failure is corrected and a
fresh read-only receipt is reviewed.

This command requires its own `NOISIA_INTEREST_PREPARATION_PRIVATE_TEST_APPROVED=true`,
the reviewed private target seal, exactly299 empty public tables at0182, no0183
markers, and no enabled DDL event triggers. Approval for the imported Signal,
NOI-19 or schema-upgrade runner does not authorize this one. It uses the same
private identity/DNS, credential exclusion, schema fingerprint, single-runner
lock and post-rollback verification helpers. No new remote service is needed.

When those conditions are satisfied, the explicit command is:

```
pnpm --filter @noisia/db db:test:interest-preparation-private
```

**Do not execute it now.** No approved target identity or corrected connection
has been received in the current session. The command exists for future use;
this file is not authorization to connect.

Its receipt explicitly declares
`acceptance_scope=ddl_contracts_negative_paths_only` and
`full_preparation_acceptance=false`. The cases cover the real0183 installation,
fixed configuration and canonical digest, Unicode/definition normalization and
limits, private ACL/RLS, absent authority/source rejection, and unchanged paid
pipeline rows. Tiny invented actor/workspace records are rolled back. HTTP
transports are disabled in the process before fixture imports. SQL errors are
reported only as bounded codes and SQLSTATE, never rows, credentials or payloads.

It does **not** prove successful prepare/load, replay after commit, source/catalog
drift on a valid preparation, complete group/interest coverage against persisted
numeric evidence, or concurrency. Those require the missing full synthetic
source fixture and a separate acceptance stage. A passed preflight is insufficient
for UAT, paid admission or classification. The existing imported-Signal six-case
gate remains independent and mandatory.

Local guard tests never connect:

```
pnpm --filter @noisia/db db:test:interest-preparation-guards
```

### September24 follow-up: positive preparation fixture written, PG execution pending

The optional `--positive-preparation` mode now composes a synthetic Brand OS/KB
input with real semantic publication, prototype receipts, the existing three-root
workspace fixture, numeric control0175 and guarded census/community materializers.
Two numerical groups are explicitly invented; neither BERTopic nor a provider is
run. Intake input rows are a fixture, not acceptance of Studio's creation routes.
The fixture supplies explicit synthetic runtime/bindings without reading provider
environment variables. HTTP remains blocked before imports.

The mode requires **both** `NOISIA_INTEREST_PREPARATION_PRIVATE_TEST_APPROVED=true`
and `NOISIA_INTEREST_PREPARATION_POSITIVE_APPROVED=true`, the exact command flag,
and all previous private-target, empty299-table and reviewed-schema guards.
Neither approval nor the flag is enabled by this documentation. No remote command
has been executed; the authentication blocker and missing seals remain unchanged.

It first runs the eight earlier preflight cases inside a savepoint and rolls back
their identities. Then it runs eight positive scenarios: prepare/load, replay,
resealed incomplete/duplicate/reordered/foreign matrices, immutable history,
catalog drift/new identity, tenant isolation/revocation, knowledge drift and
unchanged paid history/assignments. The seed creates **simulated** receipts through
real functions; unchanged-history checks compare complete rows **after the seed**.

Receipts use `acceptance_scope=positive_preparation_with_savepoint_replay_and_physical_rollback`
and still `full_preparation_acceptance=false`. A successful future receipt would
prove these rollback-only scenarios, not committed replay, crash recovery,
concurrency, maximum capacity, provider quality, UI creation, actual BERTopic or
classification. Physical rollback and a fresh empty/schema verification remain
mandatory before any PASS. The imported-Signal six-case gate is still separate.

After a preflight failure, inspect its bounded receipt and preserve the source.
Do not retry automatically, substitute a populated target, copy real customer
rows, disable triggers or turn mocks into an acceptance claim.
