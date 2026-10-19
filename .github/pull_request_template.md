<!--
Publishing conditions. A PR is the ONLY path to `main` (which deploys to prod).
No direct pushes to main. Fill this out — reviewers gate on it.
Full rules: docs/AGENT_GUARDRAILS.md
-->

## What & why


## Pre-merge checklist (required)

- [ ] Branch is **not** `main`; this is a PR (no direct push to prod).
- [ ] `corepack pnpm typecheck` green
- [ ] `corepack pnpm lint` green
- [ ] `corepack pnpm test` green for every package I touched
- [ ] `corepack pnpm --filter @noisia/studio build` green if this PR touches Studio routing, Signal Pulse, Data OS serving or browser-visible code
- [ ] CI `Studio production build` passed if this PR touches Studio routing, Signal Pulse, Data OS serving or browser-visible code
- [ ] `corepack pnpm data-os:verify` green if this PR touches Data OS, Signal Pulse serving, DB schema, migrations or rollout docs
- [ ] No secrets / `.env*` files in the diff (CI secret-scan must pass)
- [ ] If runtime/engine/worker flow changed: I ran it locally with `pnpm dev:workers` up

## Sensitive areas — tick if touched, and explain below

- [ ] **Auth/authz** (`apps/studio/src/lib/auth/**`, middleware) — Code Owner review required
- [ ] **DB schema / migrations** (`infrastructure/db/**`) — migration hand-verified (drizzle meta is drifted), forward-only, applied plan noted
- [ ] **Data OS / live serving** (`api/data-os/**`, `lib/data-os/**`, Data OS docs/scripts) — shadow evidence attached, flags default off, rollback to `published_outputs.payload`
- [ ] **Public API** (`api/public/**`, `lib/reporting/**`) — contract + visibility/redaction unchanged or versioned
- [ ] **Team/roles** (`api/team/**`) — no privilege-escalation path opened
- [ ] **Money pipelines** (`corpora/run-engine`, `tb-analysis`, query-engine, workers) — budget cap surfaced before queueing
- [ ] **Deploy/infra** (`.github/**`, `supabase/config.toml`, Railway)

### Notes on the above


## Data OS evidence (if touched)

<!-- Required for Data OS / Signal Pulse serving / DB schema PRs. Paste summarized outputs. -->

- [ ] `corepack pnpm data-os:verify` output included
- [ ] `corepack pnpm data-os:candidates` output included, or explain why no real target was available
- [ ] Evidence pack includes `staging-check.txt` from `corepack pnpm data-os:staging-check` with `LOCAL_DATA_OS_VERIFY=passed`, `ready_for_staging_shadow=true` and no sensitive values, or explain why PR is foundation-only
- [ ] For production/client-visible Data OS, `staging-check.txt` includes `DATABASE_URL_FORMAT=postgres_url` and `DATABASE_URL_ENVIRONMENT=remote_redacted`; local-redacted evidence is not release-gate eligible
- [ ] `shadow-run.log` was reviewed inside `.data` and shows `ready_for_live_api_shadow: true`; do not paste raw `shadow-run.log` if it contains corpus/output UUIDs
- [ ] `analyze.json` was reviewed inside `.data` and shows `ready_for_serving_reads: true`; do not paste raw `analyze.json` if it contains corpus UUIDs
- [ ] `corepack pnpm data-os:serving-smoke` output included with `ready_for_serving_shadow: true`, or explain why PR is foundation-only
- [ ] `serving-smoke.json` includes fallback checks proving disabled Data OS/live APIs return `published_outputs.payload`
- [ ] `corepack pnpm data-os:evidence` output included with `ready_for_pr_review: true`, or explain why PR is foundation-only
- [ ] `evidence.json` was reviewed inside the local `.data` evidence pack; do not paste raw `evidence.json` if it contains corpus/output/brand UUIDs
- [ ] `evidence.md` pasted/summarized in the PR includes the architecture decision: Data OS is `customer_intelligence_lakehouse_cdp_like`, not Customer 360/reverse ETL CDP, with live APIs behind flags/shadow and `published_outputs.payload` fallback
- [ ] `corepack pnpm data-os:staging-shadow` evidence pack reviewed (`.data/data-os-evidence/.../evidence.md`), and pasted markdown has IDs redacted, or explain why PR is foundation-only
- [ ] If the first staging shadow stopped for human review, `corepack pnpm data-os:staging-finalize` closed the same evidence dir after tag/assertion review
- [ ] `corepack pnpm data-os:validate-evidence-pack` output included, or `evidence-pack-validation.json` attached/summarized
- [ ] `evidence-pack-validation.json` includes `artifact_manifest_algorithm: "sha256"` and artifact checksums for the reviewed files
- [ ] `pr-summary.md` from `corepack pnpm data-os:pr-summary` is attached/pasted, includes `local_data_os_verify_precheck` and `Database format: postgres_url`, and contains no UUIDs, DB URLs, API keys or tokens
- [ ] `completion-audit.json` from `corepack pnpm data-os:completion-audit` is attached/summarized; production/client-visible Data OS requires `ready_for_goal_completion: true` and gate `database_format_postgres_url`
- [ ] Evidence artifacts passed the sensitive artifact scan: no DB URLs, API keys/tokens, or corpus/output UUIDs in `evidence.md`
- [ ] Evidence pack validates Data Catalog + lineage serving counts (`catalog_assets`, `catalog_fields`, `catalog_contracts`, `catalog_quality_results`, `lineage_edges`) with zero catalog quality failures
- [ ] Evidence pack validates Brand OS/Knowledge links (`brand_os_briefs`, `brand_os_links`, `knowledge_assertion_links`, `knowledge_usage_events`) so briefs/context did not die as prompt text
- [ ] Evidence pack includes redacted `review-queue.json` plus Data OS Review Queue gates: `tag_assertion_review_queue`, `ready_for_human_review: true`, `required_before_client_visible: true`, `record_tags_with_evidence`, `record_tag_taxonomies`, `knowledge_assertions_with_evidence`, `tag_review_events >= 1`, and `knowledge_assertion_review_events >= 1`
- [ ] Evidence pack includes `review-sample.json` from `corepack pnpm data-os:review-sample`, with `ready_for_release_review_sample: true`, tag/assertion `review_event_created: true`, IDs redacted and no client text
- [ ] If `corepack pnpm data-os:review-queue` was used to pick IDs, its private output was not attached to the PR or committed
- [ ] If this enables production/client-visible Data OS: evidence pack includes `release-gate.json`, or `corepack pnpm data-os:release-gate` output, with `ready_for_production_review: true` and `database_format: "postgres_url"`
- [ ] `next_flags` keep `NOISIA_DATA_OS_SHADOW_MODE=true`; `rollback_flags` turn off live API, serving and Data OS
- [ ] CI `Data OS local smoke` passed and `corepack pnpm data-os:validate-local-smoke` reports `ready_for_staging_preflight: true`
- [ ] Data OS serving flags remain off by default for clients
- [ ] Rollback plan keeps `published_outputs.payload` as fallback

## Deploy / migration plan (if prod-affecting)

<!-- migrations to apply, env vars, ANALYZE, worker redeploy, Upstash plan -->
