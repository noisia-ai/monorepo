# H1 hybrid experimental route — working receipt (2026-10-07)

## Scope and state

This cut is stacked on the MFP Phase C evaluation branch (#37) and includes the disposable PostgreSQL CI lane from #38. It adds an explicit workspace H1 route, a JEV `noul` threshold of 0.4 followed by Claude confirmation for JEV positives, a hidden `review_required` state for disagreements, a rights-scoped review API, human override precedence, and a read-only measurement contract for 150 gold roots and 1,086 full-corpus roots. No workspace selects H1 on migration. The 16-lens engine and V2/V3 interest decisions remain untouched.

The route is **not ready to enable**. The provider runner is hard blocked until its two stages use the existing `signal_labeling_calls` ledger, admission, durable raw receipts, reservation, settlement, and unknown-outcome recovery. The Studio route switch additionally requires an unset `NOISIA_MFP_HYBRID_LEDGER_READY` guard. No provider calls, UAT deployment, production migration, labeler approval, or default switch were made in this cut.

## Verified locally

- Query engine: 586/586 tests passed, including H1 reducer and citation integrity.
- DB typecheck passed; DB suite: 630 passed, 104 skipped without remote PostgreSQL; the H1 PG migration test is reserved for migrated `noisia_mfp_ci`.
- Studio and Workers typechecks passed; Studio lint: zero errors, 13 existing warnings.
- H1 read-only scoring test passed. It rejects a missing root, stale gold input, and invalid decision/receipt shape. It never treats `review_required` as a binary false negative, but reports the operational unpublished positive count separately.

## Evidence still required

1. Run PG migration 0259 and H1 integration in fresh migrated `noisia_mfp_ci`, with rollback and grants checks. #39 extends only the inherited #38 workflow's PR trigger to the #37 base branch; the disposable PostgreSQL runner, `develop` trigger and guards are unchanged.
2. Complete sequential JEV and Claude stage adapters against the common ledger. Enable only an explicit workspace policy with both provider actions and rights checks.
3. Execute the real 1,086-root corpus on the remote MFP runner, reconcile unknown calls, and compute the 150-gold three-view readout plus settled USD per 1,000 roots. No simulated price is reported as observed.

JEV `noul` does not localize a quote. H1 records the entire source root as a literal JEV reference; Claude selects a literal span and its offsets are verified against that root. This distinction must remain visible in the review UI and acceptance receipt.
