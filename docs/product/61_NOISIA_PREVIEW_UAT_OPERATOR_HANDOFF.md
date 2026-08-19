# Noisia Preview/UAT — operator handoff and greenfield QA

Status: `uat_operator_qa_in_progress`  
Recorded: `2026-08-19T00:52:00-06:00` (`America/Mexico_City`)  
Owner: Product + Engineering  
Environment: **Noisia Preview/UAT**, never production  
Canonical release cut: [doc 60](./60_NOISIA_PREVIEW_UAT_RELEASE_CUT.md)  

This document is an additive handoff. It does not replace the historical evidence in
the North Star, the semantic-cascade execution plan or the Preview release cut.

## 1. Outcome of this handoff

Another Backend/operator session must be able to take over Preview/UAT without depending
on the chat that created the environment and without receiving secrets in Git, docs,
evidence, logs or prompts.

The immediate mission is deliberately smaller than the remaining product roadmap:

1. finish the online UAT checklist;
2. prove the clean Amazon Alexa acquisition path in the real hosted topology;
3. record every product defect and repair only general contracts;
4. stop before clustering, 10D, reader cutover or a paid semantic run.

The product hypothesis under test is:

> A new workspace can produce a clean, typed and traceable corpus through Brand OS,
> Acquisition Plan, slot-specific query evidence, durable imports, Mentions and Semantic
> Review before any local-model benchmark or strategic analysis begins.

Passing this test does not mean the semantic cascade is complete. It only creates valid
input evidence for a future preregistered 10C.2 benchmark.

## 2. Current truth

| Area | Current state |
|---|---|
| Branch | `codex/noisia-data-os-cut-1-uat-2026-08-18` |
| Known-good authenticated runtime commit | `787b7d1178131dfbf3e427920d92f116a328b3af` |
| Preview URL | `https://studio-uat-uat.up.railway.app` |
| Runtime profile | `uat` |
| Studio | Online, one Railway replica |
| Workers | Online, one Railway replica |
| Database/storage | Audited `noisia-staging` Supabase project |
| Redis | Dedicated Preview/UAT Upstash database |
| Auth | Separate Kinde Preview UAT environment/application |
| Operational Signal reader | `legacy`, intentionally |
| Paid T&B | Disabled |
| 10C.1 | `no_adoption` |
| 10D | Blocked |
| Production | Outside the authority and incident boundary |

The authenticated Kinde flow now returns to the canonical Preview origin. The standalone
legacy Studio landing has been removed. On 2026-08-19, the authenticated `/studio` route
loaded under the `Admin Noisia` DB role and deep health returned HTTP 200 with app,
environment, database, provider capability and UAT identity checks green.

### Why the badge still says `Serving Legacy`

`NOISIA_SIGNAL_OPERATIONAL_READ_MODE=legacy` is the first-cut safety posture. It means
existing visible Signal readers still use the legacy operational pointer while the new
workspace-owned acquisition and governance plane is tested in Admin.

It does **not** mean that Preview is the legacy application. It means that this UAT does
not yet authorize the Signal reader cutover. Changing this variable is outside the
current mission.

## 3. Canon and authority order

Read these before changing code or environment state:

1. [Signal Product North Star](./31_SIGNAL_PRODUCT_NORTH_STAR.md)
2. [Workspace ownership canon](./42_SIGNAL_WORKSPACE_DATA_OWNERSHIP.md)
3. [Signal frontend system](./43_SIGNAL_V2_FRONTEND_SYSTEM.md)
4. [Governed views and population policies](./50_SIGNAL_GOVERNED_VIEWS_AND_POPULATION_POLICIES.md)
5. [Feature catalog V0.2](./52_NOISIA_FEATURES_DESCRIPTION_V02.md)
6. [Acquisition, semantic cascade and Topic Contracts](./55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md)
7. [Execution plan 10A–10H](./56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md)
8. [Acquisition schema/contract audit](./57_SIGNAL_ACQUISITION_PLAN_SCHEMA_CONTRACT_AUDIT.md)
9. [10C.1 corrective benchmark handoff](./59_SIGNAL_10C1_CORRECTIVE_BENCHMARK_HANDOFF.md)
10. [Preview/UAT release cut](./60_NOISIA_PREVIEW_UAT_RELEASE_CUT.md)

When documents appear to conflict, newer timestamped checkpoints refine earlier state
without erasing it. Architecture, authority and stop rules win over a convenient fixture
or a browser-only workaround.

## 4. Hosted topology and non-secret identities

| System | UAT resource | Non-secret identity or location |
|---|---|---|
| GitHub | `noisia-ai/monorepo` | dedicated UAT branch above; never `main` |
| Railway project | `noisia-signal-v02-uat` | project ID `b7b7b325-f273-4eb6-80e0-d66e266159b2` |
| Railway environment | UAT environment | ID `13f17965-6ae3-4b5f-bcf3-08b496ff5d54` |
| Railway Studio | `studio-uat` | service ID `184f8966-0cac-4bb0-85bb-9348abde594f` |
| Railway Workers | `workers-uat` | service ID `0da3b6f5-0017-4568-8ad8-5dc727834037` |
| Supabase | `noisia-staging` | project-ref fingerprint `sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32` |
| Upstash | dedicated UAT Redis | connection fingerprint `sha256:63267aa0a500c613ffebeab7efccad637d3de6daa790c347fdad05c928db0f86` |
| Kinde | Preview UAT environment | issuer `https://noisiastudio-uat.us.kinde.com` |
| Public health | Studio | `/api/health` and `/api/health?deep=1` |

IDs and hashes above are routing/evidence identifiers, not credentials. Do not replace
them with URLs containing passwords, tokens or signed query strings.

## 5. Access and secret custody

### 5.1 Where access lives

| Capability | Canonical custody | Backend/operator use |
|---|---|---|
| Runtime configuration | Railway Variables on `studio-uat` and `workers-uat` | inspect names/presence; update UAT values in place |
| Database/storage | Supabase `noisia-staging` dashboard and server-side Railway variables | migrations/read-only verification only when separately authorized |
| Queue | dedicated Upstash UAT database and Railway `REDIS_URL` | inspect UAT queue state; never substitute production Redis |
| Authentication | Kinde Preview UAT web application | callback/logout configuration and browser QA |
| Source/deploy | GitHub UAT branch and Railway branch deployment | commit and push only the UAT branch |
| LLM capability | server-side provider variable and product flight cards | no paid call during this checklist |

The current desktop may already have authenticated provider-console sessions. A Backend
session running on the same operator desktop may use those sessions within the UAT scope.
An agent on another machine has no implicit access and must be provisioned through a
secure channel or the provider's own access control. This document never substitutes for
that provisioning.

### 5.2 Secret rules

- Never paste raw credentials into a prompt, chat, Markdown, issue, commit, terminal
  output, screenshot or evidence pack.
- Never print or export a complete Railway variable set.
- Verify secrets by presence, target identity, checksum/fingerprint or a successful
  least-privilege probe.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. It must never reach browser code.
- Keep UAT and production credentials in different provider resources.
- A leaked or historically pasted secret must be rotated before production use.
- Runtime services read secrets from Railway; Git contains only `.env.example` names.
- Evidence under `.data/` is private and ignored, but still must be sanitized and mode
  `0600`.

### 5.3 Kinde M2M decision

The Studio browser application must continue using the Kinde **back-end web
application** and its normal authorization-code flow. Do not replace it with M2M.

Create a separate Preview-UAT M2M application only if an automated Backend mission must
call the Kinde Management API. If created, it must:

- belong to the Preview UAT Kinde environment;
- have only the management scopes required by that mission;
- be distinct from the browser application and all production applications;
- store its client ID/secret only in the provider secret store or Railway;
- never be used to bypass the application's DB-owned AuthZ;
- be deleted or rotated when the automation no longer needs it.

No M2M credential is required to run the browser checklist below.

### 5.4 Required variable families

Verify names and target identity, never raw values:

- database/storage: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, storage bucket names;
- queue: `REDIS_URL` and the five `NOISIA_*_QUEUE_NAME` variables;
- UAT identity: `NOISIA_RUNTIME_PROFILE`, `NOISIA_REMOTE_DATABASE_TARGET`,
  `NOISIA_UAT_DATABASE_PROJECT_REF_SHA256`, `NOISIA_UAT_REDIS_IDENTITY_SHA256`,
  `NOISIA_UAT_STARTUP_MODE`, `NOISIA_UAT_RECOVERY_APPROVED`;
- auth: `KINDE_CLIENT_ID`, `KINDE_CLIENT_SECRET`, `KINDE_ISSUER_URL`,
  `KINDE_SITE_URL`, `KINDE_POST_LOGIN_REDIRECT_URL`,
  `KINDE_POST_LOGOUT_REDIRECT_URL`;
- public origin: `NEXT_PUBLIC_APP_URL` and any server-owned canonical origin consumed
  by the auth helpers;
- providers: model/pricing variables and `ANTHROPIC_API_KEY`, present only server-side;
- kill switches: the disabled feature posture in [doc 60](./60_NOISIA_PREVIEW_UAT_RELEASE_CUT.md#33-feature-posture-for-the-first-online-smoke).

## 6. Backend takeover bootstrap

Before browser QA, a new Backend session must:

1. checkout `codex/noisia-data-os-cut-1-uat-2026-08-18`;
2. run `git pull --ff-only` and record the starting commit;
3. confirm the worktree does not contain unrelated changes;
4. confirm the Railway project, environment and two service IDs above;
5. verify variable presence and UAT target hashes without printing values;
6. verify Studio deep health returns HTTP 200;
7. verify exactly one Worker replica and fresh UAT heartbeats;
8. verify all five queue names end in `-uat`;
9. confirm paid T&B, full-pop taxonomy enrichment and reader cutover remain disabled;
10. create a private sanitized evidence directory for this run.

If a target identity differs, stop before writes. Do not repair an identity mismatch by
changing the expected hash to match an unknown target.

## 7. UAT execution flight card

### Phase A — authentication and AuthZ

- [ ] Start from a logged-out/private browser session at the Preview origin.
- [ ] Complete Kinde login and land on the canonical Preview `/studio` route.
- [ ] Open the brand list under the authenticated DB user and record the effective role.
- [ ] Open an authorized workspace.
- [ ] Confirm a forbidden workspace or management action fails server-side when a safe
      negative fixture/identity exists; never weaken AuthZ to manufacture this test.
- [ ] Log out and confirm the browser returns to the Preview origin, never localhost,
      `0.0.0.0` or production.
- [ ] Log in a second time to prove that the success was not a stale cookie artifact.

Evidence: timestamps, status codes, route names, sanitized user/role identity and browser
screenshots without tokens or callback query strings.

### Phase B — clean Amazon Alexa control plane

Create a new disposable greenfield workspace only after Phase A passes.

- Canonical display name: **Amazon Alexa**.
- Aliases: `Alexa`, `Alexa Plus`, `Alexa+`.
- `Echo` is a related product, not the canonical brand name.
- Locale/market: governed Brand OS values, initially `es-MX` / Mexico.
- Category: `Asistentes de voz y bocinas inteligentes`.
- Begin with four to six curated competitors, each with its own slot.
- Do not reuse the earlier all-`primary_brand` Alexa corpus as clean evidence.

Then verify:

- [ ] Brand creation produces a canonical Brand OS snapshot and DB-owned AuthZ.
- [ ] Brand list and workspace reload correctly after a new session.
- [ ] Acquisition Plan prepares primary, category and one slot per active competitor.
- [ ] Acquisition Brief can be sealed and reloaded.
- [ ] Query Composer preflight is visible and bounded; do not execute a paid proposal
      unless separately authorized.
- [ ] Query Evidence V2 persists independently per slot as `operator_attested` or
      `unavailable`; `provider_verified` never appears as a browser choice.
- [ ] The plan can become current with `query_playbook_complete=false` as an explicit
      reproducibility warning.

An operator-edited SentiOne query is legitimate. The CSV cannot prove which query
produced it. Query evidence records what was observed, what the operator attested and
what a future provider adapter actually verified; it never grants semantic approval.

### Phase C — one asynchronous CSV smoke

Use a small, schema-valid SentiOne CSV associated with one exact slot. Prefer 100–500
rows sampled from a disposable dataset that has not already been imported into that
slot. Preserve the original header and source values.

- [ ] Create/select the exact connector and slot.
- [ ] Record honest query evidence for that file.
- [ ] Upload through the slot row, not a generic importer.
- [ ] Confirm the API returns `202` and a pollable import identity.
- [ ] Observe `uploading → queued → processing → completed`.
- [ ] Confirm `100%` appears only after atomic completion.
- [ ] Reconcile `records = included + excluded + duplicates`.
- [ ] Verify one accepted batch, one watermark/sync boundary and no orphan job/outbox.
- [ ] Verify the typed observation preserves plan, slot, query-evidence class, period,
      timezone and source provenance.

If the import fails, preserve the failed attempt. Recovery must reuse durable storage
when supported and must not relabel previously persisted roots as duplicates merely to
make counters close.

### Phase D — Mentions and Semantic Review

- [ ] Admin Mentions loads only canonical roots backed by accepted provenance.
- [ ] The imported roots display the correct source intent/slot and do not all become
      `primary_brand`.
- [ ] Detail remains operator-safe: no `raw_metadata`, raw profiles or secrets.
- [ ] Semantic Review loads without a full-pop scan or provider call.
- [ ] The smoke population appears with honest pending/approved/rejected/abstained state.
- [ ] Opening a mention from Review opens the correct detail or a canonical deep link.
- [ ] Filter and drawer interactions preserve the canonical mobile/desktop behavior.

Do not click a paid resolver in this checklist. A future bounded resolver must show its
population, denominator, coverage, model, pricing, estimate and hard cap first.

### Phase E — application rollback

The rollback target for future UAT code is the known-good authenticated runtime commit
`787b7d1178131dfbf3e427920d92f116a328b3af`.

- [ ] Ensure no import or strategic job is nonterminal.
- [ ] Scale `workers-uat` to zero before incident investigation if work is active.
- [ ] Use Railway deployment rollback/redeploy; do not use `git reset --hard`, rewrite
      history or reverse database migrations.
- [ ] Verify `/api/health?deep=1`, login, brand list and accepted import state after the
      rollback.
- [ ] Re-deploy the intended UAT head and repeat deep health.

Do not perform a destructive Supabase rollback. Migrations are forward-only. Because
`787b7d1` is the first confirmed end-to-end auth deployment, rehearse rollback only after
a later UAT application deployment exists; it must return to this known-good target.

## 8. Defect protocol — no patch-to-pass

For every browser defect, record:

| Field | Required content |
|---|---|
| ID | stable `UAT-###` identifier |
| Step | exact phase/checklist step |
| Expected | product/canon behavior |
| Observed | user-visible result plus status/error category |
| Scope | general product, environment, fixture or unknown |
| Severity | P0 data/security, P1 blocked flow, P2 degraded, P3 polish |
| Evidence | screenshot/log hash/request identity, sanitized |
| Root cause | required before implementation |
| Fix | canonical component/contract reused |
| Regression | automated test plus repeated browser step |

Rules:

- no Alexa-, Laika-, UUID- or CSV-filename-specific runtime branches;
- no direct DB edits that bypass writers, ledgers, CAS or idempotency;
- no relaxation of AuthZ, query evidence, semantic eligibility or import invariants;
- no standalone drawer, picker, table or filter when Signal/Admin already has a
  canonical component;
- inspect Shopify only when no internal canonical pattern exists;
- a browser error message must identify an actionable state, not merely `Load failed`;
- repair the product, redeploy UAT, and repeat the entire affected phase.

## 9. Exit states

The online checklist may close only when evidence supports:

```text
NOISIA_PREVIEW_UAT_OPERATOR_QA_COMPLETE=true
```

The clean acquisition flow may close only when primary, category and at least two
competitor slots have correct typed observations and accepted provenance:

```text
AMAZON_ALEXA_GREENFIELD_ACQUISITION_READY=true
```

Neither marker opens 10D. A new local-model benchmark requires a separate preregistered
10C.2 plan and a clean multi-scope population digest:

```text
SIGNAL_10C2_PREREGISTRATION_READY=true
SIGNAL_10D_READY=false
```

## 10. What follows after UAT

Once the small smoke passes:

1. run the same slot-specific flow for one primary, one category and two competitors;
2. reconcile counts, source intent and query evidence before adding more files;
3. import the remaining curated competitor datasets;
4. perform bounded manual Semantic Review on ambiguous records;
5. freeze the clean multi-scope population and its digests;
6. write and review a new 10C.2 preregistration;
7. benchmark local multilingual discovery/classification on that population;
8. only an adopted artifact plus operator decision can open 10D.

Claude remains bounded to contextual naming/synthesis or explicit exceptions. It must
not classify every mention, compute authoritative counts, change memberships, emit
executable SQL/rules, autoapprove classifications or promote Topic Contracts.

## 11. Copy-ready Backend takeover prompt

```text
Goal: close the Noisia Preview/UAT operator checklist and prove the clean Amazon Alexa
greenfield acquisition flow without production access, paid providers, clustering,
reader cutover or semantic full-pop resolution.

Repository:
- /Users/brandhon_o/Downloads/noisia-website
- branch codex/noisia-data-os-cut-1-uat-2026-08-18
- start from the latest remote head with git pull --ff-only

Read completely before acting:
- AGENTS.md and nested AGENTS.md files for touched paths
- docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md
- docs/product/42_SIGNAL_WORKSPACE_DATA_OWNERSHIP.md
- docs/product/43_SIGNAL_V2_FRONTEND_SYSTEM.md
- docs/product/55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md
- docs/product/56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md
- docs/product/57_SIGNAL_ACQUISITION_PLAN_SCHEMA_CONTRACT_AUDIT.md
- docs/product/59_SIGNAL_10C1_CORRECTIVE_BENCHMARK_HANDOFF.md
- docs/product/60_NOISIA_PREVIEW_UAT_RELEASE_CUT.md
- docs/product/61_NOISIA_PREVIEW_UAT_OPERATOR_HANDOFF.md

Authority:
- UAT CRUD is authorized only inside the named GitHub branch, Railway UAT project,
  noisia-staging Supabase project, dedicated UAT Upstash database and Kinde Preview UAT
  environment/application.
- You may use existing authenticated provider-console sessions on this operator desktop.
- You may create/update/rotate UAT-only secrets when required, but never print, paste,
  document, commit or include their values in evidence.
- Verify secrets by presence, target hash and least-privilege probes.
- Production must not be read, modified, redeployed or used as a credential source.

Hard prohibitions:
- no main merge/push;
- no production;
- no reader/pointer/binding promotion;
- keep NOISIA_SIGNAL_OPERATIONAL_READ_MODE=legacy;
- no Claude/Voyage/T&B/product provider calls or paid jobs;
- no 10C.2, 10D, clustering or topic propagation;
- no destructive DB rollback, direct SQL repair of product state or fixture-specific
  runtime logic;
- no weakening AuthZ, semantic authority, query-evidence or import invariants.

Work sequentially and validate each phase before continuing:
1. Reconcile UAT target identities, secrets presence, deep health, one Worker replica,
   five -uat queues, heartbeats, empty executable state and kill switches.
2. Browser QA complete logout → login → brand list/workspace AuthZ → logout → second
   login. Fix only general root causes and repeat the whole phase.
3. Create or select a clean disposable Amazon Alexa workspace following doc 61. Verify
   Brand OS, Acquisition Plan, Brief, slots and Query Evidence V2 online.
4. Import one 100–500-row schema-valid SentiOne CSV through one exact slot. Prove 202,
   async progress, atomic completion, reconciled counters, typed observation, accepted
   provenance, watermark/sync and zero orphan work.
5. Browser QA Admin Mentions and Semantic Review read-only. Do not launch the resolver.
6. After a later application deployment exists, rehearse Railway application rollback
   to known-good commit 787b7d1, verify state, then restore the intended UAT head.
7. Run proportional typecheck/tests/lint/build for touched packages, secret scan,
   git diff --check and repeat affected browser flows.
8. Update docs 31, 56, 60 and 61 additively with timestamps, defects, evidence hashes
   and exact remaining blockers. Never erase prior checkpoints.
9. Commit in intentional thematic commits and push only the UAT branch.

For every failure: capture a sanitized UAT-### defect, find root cause, repair the
canonical product contract/component, add regression coverage, redeploy and repeat the
affected phase. Do not call a patch or fixture workaround complete.

Final response must state true/false with evidence for:
- NOISIA_PREVIEW_UAT_OPERATOR_QA_COMPLETE
- AMAZON_ALEXA_GREENFIELD_ACQUISITION_READY
- SIGNAL_10C2_PREREGISTRATION_READY
- SIGNAL_10D_READY=false

Also report production_accessed, provider_calls, paid_jobs, staging_writes,
nonterminal_jobs, orphan_jobs, active deployment commit, rollback result, test results,
manifest path/SHA-256 and unresolved UAT defect IDs.
```
