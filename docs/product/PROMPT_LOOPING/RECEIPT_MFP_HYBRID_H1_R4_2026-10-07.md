# H1 hybrid experimental route — working receipt (2026-10-07)

## Scope and state

This cut is stacked on the MFP Phase C evaluation branch (#37) and includes the disposable PostgreSQL CI lane from #38. It adds an explicit workspace H1 route, a JEV `noul` threshold of 0.4 followed by Claude confirmation for JEV positives, a hidden `review_required` state for disagreements, a rights-scoped review API, human override precedence, and a read-only measurement contract for 150 gold roots and 1,086 full-corpus roots. No workspace selects H1 on migration. The 16-lens engine and V2/V3 interest decisions remain untouched.

The route is **not ready to enable**. Sequential JEV and Claude stage code now uses the existing `signal_labeling_calls` store for admission, reservation, durable raw receipts and settlement. The runtime and Studio switch require an unset `NOISIA_MFP_HYBRID_LEDGER_READY` guard while stage handoff and real costs remain unverified. A guarded MFP fixture policy successor can plan without changes and, in a separately authorized remote window, copy all existing actions and caps before appending the two H1 provider actions. No provider calls, UAT deployment, production migration, labeler approval, or default switch were made in this cut.

## Verified locally

- Query engine: 586/586 tests passed, including H1 reducer and citation integrity.
- DB typecheck passed; DB suite after #37 merge: 633 passed, 109 PostgreSQL skips locally. Fresh migrated `noisia_mfp_ci` passed 240 migrations and seven MFP PostgreSQL tests with zero failures or skips in [run 37591245797](https://github.com/noisia-ai/monorepo/actions/runs/37591245797), including policy succession with an active sibling admission, the real-selector restart acceptance, and exact provider-result binding. A settled JEV positive remains pending for Claude and does not reenter JEV selection in the same or a new run. The writer rejects valid settled JEV/Claude calls belonging to another pair, retains `review_required` for disagreement, and gives a human override precedence in the current view. The focused fixture repair after two failed CI attempts was escalated to `gpt-6-astra` at medium reasoning; it changed only the synthetic PostgreSQL fixture and made no provider call or spend. [General CI 37591245804](https://github.com/noisia-ai/monorepo/actions/runs/37591245804) passed typecheck, lint, tests, Studio build and Data OS checks.
- Studio and Workers typechecks passed; Studio lint: zero errors, 13 existing warnings.
- H1 read-only scoring test passed. It rejects a missing root, stale gold input, invalid decision and invalid ledger values. It never treats `review_required` as a binary false negative, but reports the operational unpublished positive count separately. Worker ordering and ambiguous-send tests passed (2/2).

## Evidence still required

1. Keep CI green after the stage worker is wired. #39 extends only the inherited #38 PostgreSQL workflow's PR trigger and general `ci.yml` PR trigger to the #37 base branch; existing production/develop triggers, jobs, permissions and guards are unchanged. A later fix also excludes JEV pairs with applied receipts from a new JEV admission or selection, preventing repeat spend while Claude confirmation is pending.
2. Verify the sequential JEV and Claude runtime against real settled receipts, including rights changes, unknown-send recovery and replay. The MFP-only policy successor, exact result-to-pair binding, selector restart and human override passed migrated PostgreSQL; remote execution still requires the coordinated window and explicit workspace policy with both provider actions.
3. Execute the real 1,086-root corpus on the remote MFP runner, reconcile unknown calls, and compute the 150-gold three-view readout plus settled USD per 1,000 roots. No simulated price is reported as observed.

JEV `noul` does not localize a quote. H1 records the entire source root as a literal JEV reference; Claude selects a literal span and its offsets are verified against that root. This distinction must remain visible in the review UI and acceptance receipt.

## Remote window and reversible cut

Before any H1 route change, run the guarded read-only `scripts/eval/hybrid-h1-census.ts --real --phase=before` on the dedicated MFP runner and preserve its private receipt. Require the final front5 jobs and all sibling admissions to be terminal, zero unknown/unapplied calls, exact evidence rights and the dedicated fixture scope. Plan the policy successor without `--execute`, then activate it only in the coordinated window after its PostgreSQL gate. The policy successor copies every existing action and organization cap; no manual SQL changes a live policy. The runtime remains gated by `NOISIA_MFP_HYBRID_LEDGER_READY` until that window.

If H1 must stop, first prevent new H1 admissions and provider dispatch, reconcile every submitted/unknown call and durable raw receipt, then use guarded `scripts/eval/hybrid-h1-rollback.ts --real --execute` with `NOISIA_MFP_HYBRID_ROLLBACK_EXECUTE=true`. It invokes the product route transaction, which refuses active or uncertain work, restores the prior facet labeler and removes only the workspace H1 selection. Historical decisions, admissions, settled costs and policy versions remain retained. Run `hybrid-h1-census.ts --real --phase=after` and compare population, rights, unresolved calls and settled USD. Do not treat a disabled worker flag as proof that a previously sent call was unpaid.
