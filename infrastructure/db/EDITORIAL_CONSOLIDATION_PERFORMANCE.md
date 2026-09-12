# Editorial consolidation runtime — local closure, 2026-09-12

Functional composed gate: **PASS**. No migration was durably applied, no provider was called, and no serving/catalog data was changed. The final rehearsal used the actual sealed 1,652-group input and 42 screening batches, with synthetic HTTP outputs that consolidated all groups into one test concept inside a rolled-back transaction. This verifies the runtime contract, not editorial quality.

## Verified outcome

- 43 simulated calls (42 screening + 1 global), all settled.
- Simulated total: 774 microUSD; real provider spend: zero.
- Final state `completed`, execution status `review_ready`.
- Exact conservative reservation: USD 29.081754; largest call: USD 4.266609; execution cap: USD 30.
- UAT ledger exposure before the new task grant: USD 5.270440. The task grant adds USD 32 rather than replacing prior provider exposure.
- Explicit `ROLLBACK`, followed by a fresh query confirming zero editorial executions.
- Sealed plan digest remained `sha256:bed81d4960c56c89debe6a2c4f57289d41f7e08d5b51bec4cebeb195f4575f74`.

Private evidence under `.data/alexa-plus-e2e-2026-09-12/release/`:

- `uat-editorial-materialization-composed-rollback-receipt.json`: final 43-call result, materialization, timings and query counts.
- `editorial-performance-closure-receipt.json`: code SHA manifest and checks.
- `uat-editorial-composed-cache-baseline-receipt.json`: first completed cache baseline.
- `uat-editorial-composed-roundtrip-baseline-receipt.json`: intermediate baseline.
- `rehearse-editorial-composed.ts`: existing rollback rehearsal with synthetic transport and receipt-only instrumentation.

## Performance and practical limits

Final run: source 21.376 s, admission 17.073 s, Worker 165.071 s, total 203.792 s. Earlier completed Worker baselines were 152.661 s, 131.956 s and 128.069 s. The final run observed 875 SQL commands from the Mac; SAVEPOINT/RELEASE alone consumed 40.614 s. This is not the user's Signal query SLO. A less-than-60-second editorial Worker gate from the Mac was **not achieved** and is not claimed.

Avoided duplicate 17 MB plan transfers: the final state load was 0.215 s and global binding 1.510 s. The isolated PostgreSQL owner guard processed 44 updates with a 17 MB synthetic plan in 638 ms. The actual scoped context fingerprint took 184 ms. The isolated state guard processed 42 growing checkpoints in 999 ms.

Remaining performance work after UAT: measure the Worker colocated with PostgreSQL, attribute the 44 real UPDATEs (29.749 s in the final remote rehearsal), and reduce avoidable roundtrips where atomicity remains equivalent. Preserve separate durable reserve/send/receipt/settlement boundaries. Do not trade recovery or revocation guarantees for the Mac benchmark.

## Runtime guarantees retained

- Set-based plan validation proves complete unique group coverage, exact sealed source dossiers and selected evidence subsets. Editorial canonical hashes match Query Engine bytes; float-bearing dossiers remain sealed strings.
- State guard proves append-only prior outputs and validates new outputs against exact settled HTTP-complete responses, receipt lineage and per-batch coverage. Global completion requires its exact paid result.
- Owner guard compares the immutable plan directly as JSONB and checks terminal state separately. Heavy fields are nulled only in a temporary record used for the generic comparison; all other columns, including future columns, retain immutable protection. State digest and paid-output guards remain active.
- Every reserve/send reads scoped ownership and revalidates live policy, source authority and lease in the final SQL mutation guard. Context cache never grants permission.
- Context cache keys include database identity, lease, workspace/actor/run and expected semantic digest. Its SQL fingerprint hashes all 19 dependent table families, including identities/category, aliases, Brand OS, claims, knowledge, locale and published semantic history. On revision change, the exact context is rebuilt and its revision is reread before cache admission.
- Verified plan cache is scoped by database object, full lease identity and plan digest; maximum four LRU entries. Values are private copies deeply frozen at runtime. Initial `loadInput` always validates the full owner/source/plan seal. Retry/new process reconstructs from DB. Finish/failure and observed revocation/conflicts clear the snapshot; standalone stores still validate their initial plan.
- Historical paid recovery remains available under its original lease rules after policy/source drift; it does not create new provider authority.

## Checks

- DB TypeScript: PASS; final `git diff --check`: PASS.
- Latest combined focal suite: 36 PASS; locale/context parity suite: 21 PASS; editorial source loader suite: 4 PASS.
- Additional revocation cleanup/store test rerun: 7 PASS.
- PostgreSQL actual migration compile and context fingerprint test: PASS (all 19 source families, insertion/deletion and timezone).
- PostgreSQL owner negative cases: PASS (plan, state digest, owner, source, cap, future field, terminal state and deletion).
- Prior focused state guard suite: 6 PASS (paid proof, HTTP completeness, repair lineage, growing state, retention and global proof).
- Final composed rehearsal: PASS with the current SQL0178–0179, USD 30 action cap, cold Redis recovery, retryable provider-free materialization and all-noise support.

No production runtime instrumentation was added. All SQL/phase timings live in the private rehearsal script and receipts.
