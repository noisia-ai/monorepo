# Noisia Preview/UAT — release cut 2026-08-18

Status: `release_candidate_in_progress`
Owner: Product + Engineering
Target date: 2026-08-19
Scope: Noisia Admin, workspace-owned acquisition/import, Semantic Review, Signal V0.2 readers and Workers required by the greenfield flow.

## 1. Decision

The first online cut is named **Noisia Preview** and is a UAT environment. It is
not production, is not a production clone, and must never inherit production
database or Redis credentials.

| Layer | Preview/UAT decision | Isolation boundary |
|---|---|---|
| Source | dedicated release branch pinned to an exact commit | never `main` |
| Web/API | separate Railway project, service `studio-uat` | separate variables and domain |
| Async | same Railway project, service `workers-uat`, one replica | explicit UAT queues |
| Database/storage | existing audited Supabase project `noisia-staging` | never production Supabase |
| Queue | dedicated Upstash Redis database for UAT | never production Redis |
| Auth | current Kinde tenant with exact Preview callback/logout URLs | no local auth override |
| Providers | optional server-side key; paid launches remain operator- and budget-gated | no automatic run |

This uses the product's real deployment shape—Next.js, Railway, Supabase,
Upstash and Kinde—while keeping the environment disposable and safe for ongoing
development.

## 2. What this cut is for

Preview must let an authenticated operator demonstrate and test:

1. brand and Brand OS creation;
2. Acquisition Plan and Acquisition Brief;
3. governed slots for primary brand, category and each competitor;
4. query proposal preflight/review when provider authority is explicitly enabled;
5. query evidence V2 (`provider_verified`, `operator_attested`, `unavailable`);
6. durable SentiOne CSV upload and asynchronous import;
7. Admin Mentions and Semantic Review;
8. governed-view/readiness surfaces;
9. current Signal V0.2 routes and their explicit unavailable/partial states;
10. Workers, recovery and heartbeats required by the greenfield flow.

Incomplete features remain visible only when they fail closed or clearly say
that they are unavailable. Preview is not evidence that 10C adopted a local
model, that 10D is open, or that Signal V0.2 is production-ready.

## 3. Deployment safety contract

### 3.1 Mandatory Worker profile

`workers-uat` must use:

```text
NOISIA_RUNTIME_PROFILE=uat
NOISIA_REMOTE_DATABASE_TARGET=staging
NOISIA_UAT_STARTUP_MODE=empty-cut
NOISIA_UAT_RECOVERY_APPROVED=false
NOISIA_SIGNAL_TB_PAID_RUN_APPROVED=false
```

The initial startup fails closed unless:

- the observed Supabase project-ref hash equals
  `NOISIA_UAT_DATABASE_PROJECT_REF_SHA256`;
- the credential-free Redis identity equals
  `NOISIA_UAT_REDIS_IDENTITY_SHA256`;
- all five queue names are unique and end in `-uat`;
- the exact UAT Redis contains zero executable jobs;
- staging contains zero currently claimable strategic or import outbox rows.

The preflight logs only hashes, queue names and counts. It never logs database
or Redis URLs. A later recovery restart requires both
`NOISIA_UAT_STARTUP_MODE=recovery` and
`NOISIA_UAT_RECOVERY_APPROVED=true`; that change is an operator action, not an
automatic fallback.

### 3.2 Mandatory queue names

Studio and Workers must share these environment-owned identities:

```text
NOISIA_QUERY_ENGINE_QUEUE_NAME=noisia-query-engine-uat
NOISIA_ENGINE_QUEUE_NAME=noisia-engine-analysis-uat
NOISIA_DATA_OS_QUEUE_NAME=noisia-data-os-uat
NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME=noisia-semantic-resolution-uat
NOISIA_TB_ANALYSIS_QUEUE_NAME=noisia-tb-analysis-uat
```

T&B no longer has a fixed runtime queue. The shared Query Engine contract
resolves its name server-side, and Studio and Workers consume the same value.

### 3.3 Feature posture for the first online smoke

Keep these disabled for the first deploy:

```text
NOISIA_ENGINE_RUNTIME_ENABLED=false
NOISIA_ENGINE_LLM_ENABLED=false
NOISIA_DATA_OS_WORKER_ENABLED=false
NOISIA_SIGNAL_REFRESH_SCHEDULER_ENABLED=false
NOISIA_SIGNAL_TAXONOMY_ENRICHMENT_ENABLED=false
NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED=false
NOISIA_SIGNAL_TB_PAID_RUN_APPROVED=false
NOISIA_SIGNAL_OPERATIONAL_READ_MODE=legacy
```

The query-engine Worker remains active because durable workspace imports use
that queue. Provider-backed actions may be enabled later only through their
existing flight card, confirmation and hard cap.

## 4. Required environment values

Do not copy a Railway production environment. Create Preview variables from
the approved UAT targets. Both services need the appropriate subset of:

- `DATABASE_URL` for `noisia-staging`;
- `SUPABASE_URL`, anon key and service-role key for the same staging project;
- storage buckets for outputs, corpus files, imports and avatars;
- the dedicated UAT `REDIS_URL`;
- Kinde credentials and the exact Preview site, callback and logout URLs;
- the five explicit UAT queue names;
- the runtime identity hashes and startup mode above;
- server-owned pricing/model configuration where its feature is enabled.

No secret value belongs in Git, docs, evidence packs, build logs or chat.

## 5. Release sequence

1. Freeze the current work on a dedicated UAT branch and commit an explicit
   product snapshot.
2. Run secret scan, `git diff --check`, typechecks, tests, Studio lint/build and
   migration smoke from `0000–0088`.
3. Push only the dedicated branch; do not merge or push to `main`.
4. Create a separate Railway project named `noisia-signal-v02-uat`.
5. Create a separate Upstash Redis database and compute its credential-free
   identity hash locally.
6. Configure `studio-uat` and `workers-uat` from the pinned commit.
7. Register the generated HTTPS domain in Kinde before testing authentication.
8. Start Studio first; verify `/api/health` and `/api/health?deep=1`.
9. Start exactly one Worker replica in `empty-cut` mode and retain its sanitized
   startup evidence.
10. Run a zero-cost browser smoke. Only after it passes may the operator test a
    bounded provider action or CSV import.

## 6. Online acceptance checklist

- [x] Preview domain returns HTTPS 200.
- [x] `/api/health` reports liveness even when Anthropic is absent.
- [x] `/api/health?deep=1` reports core environment and database healthy.
- [x] Kinde login returns to Preview, never production, localhost or `0.0.0.0`.
- [ ] Kinde logout returns to Preview and a second login succeeds from a clean session.
- [x] Worker startup says `profile=uat`, `startup_mode=empty-cut` and zero work.
- [x] Query Engine and T&B heartbeat names end in `-uat`.
- [x] Production health and production data are unchanged.
- [ ] Brand list and Amazon Alexa workspace load under real AuthZ.
- [ ] Acquisition Plan loads and its query-evidence choices persist.
- [ ] One small CSV uploads, returns `202`, processes asynchronously and polls to
      a terminal state without an orphan job.
- [ ] Admin Mentions and Semantic Review load accepted provenance only.
- [ ] No provider call or paid job occurs without visible confirmation and cap.
- [ ] Known incomplete states are explicit; no fixture is presented as a product result.

## 7. Rollback and incident response

Application rollback is a Railway deployment rollback to the prior Preview
commit. Worker containment is scaling `workers-uat` to zero; do this before any
database investigation. Redis is disposable UAT infrastructure, but do not
delete it while a durable import is nonterminal.

Supabase staging is shared development state. There is no destructive database
rollback in this release cut. Migrations are forward-only, and restore evidence
must exist before any future staging schema write. Production remains outside
the incident boundary.

## 8. Known limitations at this cut

- 10C concluded `no_adoption`; 10D remains blocked.
- Local clustering is still a reproducible laboratory, not an adopted engine.
- Acquisition and Admin UI require product-polish QA after functional proof.
- The first Preview cut intentionally serves legacy operational mode until a
  governed-reader canary receives separate authorization.
- The Kinde tenant is shared for speed; exact Preview callbacks are required.
- Observability is currently health checks and Railway logs; Sentry/PostHog UAT
  projects are a follow-up, not permission to reuse production telemetry keys.

## 9. Evidence to append after deployment

Record, without secrets or raw identifiers:

- release branch, commit SHA and UTC deployment time;
- Railway project/service deployment IDs as hashes;
- Preview hostname;
- Supabase project-ref hash and Redis identity hash;
- Worker startup evidence and queue counts;
- health, authentication and browser-smoke results;
- any write performed in staging and its idempotency key hash;
- rollback rehearsal result.

Until section 6 is complete, the correct status is:

```text
NOISIA_PREVIEW_UAT_ONLINE_READY=false
```

## 10. Local release-candidate evidence — 2026-08-18

The release candidate is frozen on branch
`codex/noisia-data-os-cut-1-uat-2026-08-18`. It is not yet an online deployment.

- Query Engine: typecheck passed; 289/289 tests passed.
- Database package: typecheck passed; 76 passed, 26 opt-in integrations skipped,
  0 failed.
- Studio: typecheck and production build passed; 363 passed, 1 skipped,
  0 failed; lint passed with 13 pre-existing warnings and 0 errors.
- Workers: typecheck passed; 170 passed, 3 opt-in integrations skipped,
  0 failed.
- Migration smoke: migrations `0000–0088` applied to disposable local
  PostgreSQL with pgvector; 89 migrations, 74 required tables and 54 required
  indexes verified.
- `git diff --check`: passed before release staging.

Advisor Fable 5 reviewed the topology and the UAT identity/startup boundaries.
After remediation it returned `approve_with_p2_p3`, `can_advance=true`, with
zero P0/P1 findings. The remaining P2 identity observations were then closed by
requiring the same database, Redis and queue identity contract in Studio deep
health and by failing closed when UAT-only variables are present under a
mistyped runtime profile.

Sanitized Advisor evidence:

```text
.data/uat-release-cut/advisor-remediation/advisor-review.sanitized.json
sha256:fca380bc6273d0ba479553da158146ffbb80f0f601f726e6c3e1b16beab4953c
```

This evidence authorizes creating the isolated Preview infrastructure. It does
not authorize production access, paid product runs, a governed-reader cutover
or marking Preview online-ready.

## 11. Online deployment evidence — 2026-08-19T03:45Z

The first isolated Preview deployment is online from commit
`433f5f75e2896a616173cd92950b796e4d4f82ba` on branch
`codex/noisia-data-os-cut-1-uat-2026-08-18`.

- Preview hostname: `studio-uat-uat.up.railway.app`.
- Railway project identity:
  `sha256:747e39fc86c84c345387d519c5101171bf9334f04a53c320937760c149d71ac2`.
- Railway environment identity:
  `sha256:2b1d77fc590f81dffef04e0ef0025a8fc07337a9c4640a10fac4fdaff3885cb1`.
- Studio deployment identity:
  `sha256:49d7508857c325e86a94ab7f87c9e1168a93e38070020463b4f9cf973efd0cf5`.
- Workers deployment identity:
  `sha256:59cdcd6a48aaa65af63cb7c0276c9f9ba55d2b7ac238791e9019ee434ce33a63`.
- Supabase project-ref identity:
  `sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32`.
- Redis connection identity:
  `sha256:63267aa0a500c613ffebeab7efccad637d3de6daa790c347fdad05c928db0f86`.
- Kinde uses the separate `Preview UAT` environment and a dedicated back-end
  web application. Its application identity is
  `sha256:9a39da7c09ed4895e77fc24f8f8066dd6c33b5e7400c0596c7a9230f4a1512c9`.

Verified online:

- `studio-uat` and `workers-uat` are both `Online`, one replica each;
- `GET /api/health` returned HTTP 200 with app/env/provider checks green;
- `GET /api/health?deep=1` returned HTTP 200 with database and UAT identity
  checks green and no missing environment or capabilities;
- Worker startup passed with profile `uat`, mode `empty-cut`, five distinct
  `-uat` queues, zero executable Redis jobs and zero claimable strategic,
  strategic-step or workspace-import outbox rows;
- engine, Data OS refresh, taxonomy enrichment and paid T&B execution remain
  disabled; Query Engine and T&B queue consumers are online;
- the Preview home page and Kinde UAT sign-in page load, and the OAuth request
  returns to the exact Preview callback;
- no production service, database, Redis, domain, branch or Kinde environment
  was modified.

Still required before changing the readiness marker:

- complete the first passwordless Kinde login and verify logout;
- verify the authenticated brand list and Amazon Alexa workspace under DB AuthZ;
- exercise Acquisition Plan/query evidence in the online UI;
- run one bounded asynchronous CSV smoke and confirm Mentions/Semantic Review;
- rehearse application rollback in Preview.

Therefore the current status remains:

```text
NOISIA_PREVIEW_UAT_ONLINE_READY=false
```

## 12. Authenticated runtime checkpoint — 2026-08-19T00:52:00-06:00

This checkpoint is additive to the first deployment evidence above. It records the
canonical-auth remediation and does not claim the remaining operator flow has passed.

- Active authenticated runtime commit:
  `787b7d1178131dfbf3e427920d92f116a328b3af`.
- The standalone legacy Studio auth landing was removed. The Preview root now starts the
  Kinde UAT flow directly.
- Callback state and post-login continuation remain on the canonical Preview HTTPS
  origin. A successful login landed on `/studio`, never `localhost` or `0.0.0.0`.
- The authenticated session resolved the DB-owned role `Admin Noisia`; Kinde remains
  authentication only.
- `GET /api/health?deep=1` returned HTTP 200 at `2026-08-19T06:52:17.961Z` with
  `app`, `env`, `database`, `llm_provider` and `uat_identity` all `ok`.
- The user observed a material responsiveness improvement after the hosted auth path
  stabilized. This is a qualitative observation, not a performance SLO.

The remaining online gate is now one coherent operator run:

1. logout and second clean login;
2. brand list and workspace AuthZ;
3. Acquisition Plan and Query Evidence V2 online;
4. one small asynchronous CSV import;
5. Admin Mentions and Semantic Review from accepted provenance;
6. Railway application rollback after a later deployment exists.

The executable takeover, access-custody rules, defect protocol and Amazon Alexa
greenfield sequence live in
[doc 61](./61_NOISIA_PREVIEW_UAT_OPERATOR_HANDOFF.md). `Serving Legacy` remains the
intentional Signal-reader posture and is not permission to change a pointer or read mode.

Current markers:

```text
NOISIA_PREVIEW_UAT_ONLINE_READY=false
NOISIA_PREVIEW_UAT_OPERATOR_QA_COMPLETE=false
SIGNAL_10D_READY=false
```
