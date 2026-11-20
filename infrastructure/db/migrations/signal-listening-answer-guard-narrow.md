# Narrow answer receipt lookup (0339)

0339 is a conditional structural candidate. It replaces only
`signal_listening_answer_guard_v1()`; no table, type, trigger, grant or money
function changes. The existing BEFORE ROW trigger still executes for every
fresh and conflict-suppressed INSERT, and rejects UPDATE/DELETE first.

The same seed and four LEFT joins read one fresh snapshot. The run remains
independent of a missing call. The record always receives one described row,
including when any joined relation or parameter is NULL.

| Source | Fields consumed by the guard |
| --- | --- |
| Call | id, status, settled_micro_usd, usage, raw_sha256, raw_storage_verified_at, raw_storage_verified_key, raw_storage_key, results_applied, results, request_digest |
| Run | entity_context_digest, workspace_id, actor_user_id |
| Question | question_digest, definition->>'type', wire->'criteria' |
| Listening owner | Join predicates only; no payload is returned |

The four additional CASE slots always return NULL. Their whole-row references
remain on the original call/run/owner/question RTEs to retain the historical
column permission masks. This is **not permission equivalence evidence by
itself**: native OLD/NEW tests must prove the same `42501` and table error for
unused columns, combined denials and a missing call after a prepared plan has
already succeeded. If PostgreSQL prunes the required mask, the candidate fails.

`signal-listening-answer-guard-narrow.oracle.ts` reconstructs OLD0334 only from
the frozen 0296 body and its registered 0334 delta. A closed map of seventeen
field references must invert the entire new check tail byte for byte. The only
other changes allowed by that oracle are the declaration and lookup block.
JSON extraction moves only for two safe `->`/`->>` accesses; casts, checks,
error precedence, root rights and actor lock remain in the original tail.

The existing native answer-guard case retains the overall R16 census of 115.
It compares 0296, 0334 and 0339 for missing/NULL relations, mismatched receipts,
valid conflict/fresh rows, shape and cast failures, revoked rights/actor,
statement rollback and immutable updates/deletes. It verifies function
OID/owner/ACL/signature/attributes and the actual body before and after each
replacement. Temporary role/column perturbations run only in the accredited
owned PostgreSQL 17 fixture, roll back, and deallocate their one prepared name.

Its ABBA pair executes the same two rows (one valid conflict and one fresh row)
from the existing three-root fixture in one RR transaction. Each arm rolls back;
returned data hashes and actor check counts must agree. Timing covers the one
INSERT statement, excluding installation/catalog/snapshot checks. These are
descriptive wall times, not CPU, scale evidence, a speedup claim or proof of
1,000 roots/s. Narrower SQL projection does not establish physical TOAST savings.

The source/pure tests and native entry must pass on the final composed source
before adoption. H1 still needs its full original workload and the main runtime
witness for this exact body; a small native pair does not replace that gate.
