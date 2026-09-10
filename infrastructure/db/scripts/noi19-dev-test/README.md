# NOI-19: synthetic private-network PostgreSQL gate

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
   service IDs, exact hostname/port/database/role, every DNS answer, PG17, all
   269 empty public tables, and uses `default_transaction_read_only=on`.
   It emits only the nonsecret database system identifier, schema SHA, counts
   and verification status. The connection is pinned to a resolved private IP;
   `inet_server_addr()` must agree with it. No application modules are imported.
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
The database-backed synthetic bootstrap has not yet been executed on Railway.
The existing local PG result is retained; it was not repeated for this runner.
No remote readiness or delivery claim is valid until phase two returns
`status=passed`, `physical_rollback=true`, `post_rollback_empty=true` and zero
provider transports against the newly sealed private target.
