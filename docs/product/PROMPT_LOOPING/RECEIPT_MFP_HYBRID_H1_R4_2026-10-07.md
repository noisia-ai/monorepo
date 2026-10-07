# H1 hybrid experimental route — working receipt (2026-10-07)

## Scope and state

This cut is stacked on the MFP Phase C evaluation branch (#37) and includes the disposable PostgreSQL CI lane from #38. It adds an explicit workspace H1 route, a JEV `noul` threshold of 0.4 followed by Claude confirmation for JEV positives, a hidden `review_required` state for disagreements, a rights-scoped review API, human override precedence, and a read-only measurement contract for 150 gold roots and 1,086 full-corpus roots. No workspace selects H1 on migration. The 16-lens engine and V2/V3 interest decisions remain untouched.

The route is **not ready to enable**. Sequential JEV and Claude stage code now uses the existing `signal_labeling_calls` store for admission, reservation, durable raw receipts and settlement. The runtime and Studio switch require an unset `NOISIA_MFP_HYBRID_LEDGER_READY` guard while stage handoff and real costs remain unverified. A guarded MFP fixture policy successor can plan without changes and, in a separately authorized remote window, copy all existing actions and caps before appending the two H1 provider actions. No provider calls, UAT deployment, production migration, labeler approval, or default switch were made in this cut.

## Verified locally

- Query engine: 586/586 tests passed, including H1 reducer and citation integrity.
- DB typecheck passed; DB suite after #37 merge: 633 passed, 107 PostgreSQL skips locally. Fresh migrated `noisia_mfp_ci` passed H1 integration and all inherited PG checks in [run 37587345115](https://github.com/noisia-ai/monorepo/actions/runs/37587345115), with zero skips. The new policy successor PG test is awaiting the next CI run.
- Studio and Workers typechecks passed; Studio lint: zero errors, 13 existing warnings.
- H1 read-only scoring test passed. It rejects a missing root, stale gold input, invalid decision and invalid ledger values. It never treats `review_required` as a binary false negative, but reports the operational unpublished positive count separately. Worker ordering and ambiguous-send tests passed (2/2).

## Evidence still required

1. Keep CI green after the stage worker is wired. #39 extends only the inherited #38 PostgreSQL workflow's PR trigger and general `ci.yml` PR trigger to the #37 base branch; existing production/develop triggers, jobs, permissions and guards are unchanged.
2. Verify the MFP-only policy successor and sequential JEV and Claude stage handoff against migrated PostgreSQL with settled receipts, rights changes, replay and human override. Enable only an explicit workspace policy with both provider actions and rights checks.
3. Execute the real 1,086-root corpus on the remote MFP runner, reconcile unknown calls, and compute the 150-gold three-view readout plus settled USD per 1,000 roots. No simulated price is reported as observed.

JEV `noul` does not localize a quote. H1 records the entire source root as a literal JEV reference; Claude selects a literal span and its offsets are verified against that root. This distinction must remain visible in the review UI and acceptance receipt.
