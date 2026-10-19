# ADR 030 — Client entry to assigned brand workspaces

Status: accepted for the focal UAT delivery, 10 September 2026.

## Context

Clients could have an active brand assignment and permission to import mentions or edit an unprocessed Topics draft, yet `/signal` listed only published reports. The relevant APIs already enforced workspace capabilities. The missing navigation forced an internal operator to use Studio. Selecting a computed Topic for Signal also required the unrelated capability to execute models.

## Decision

Add an authenticated inventory of assigned brand workspaces to `/signal`, independent of reports or corpora. Management pages live at `/signal/{workspaceSlug}/manage/topics` and `/manage/data`, using the existing workspace primitives, Topics and import components. Every page resolves an explicit brand slug through current DB authority. An ambiguous slug resolves nothing; there is no legacy report fallback. Studio access and authentication helpers remain unchanged.

The new `can_select_signal` capability permits existing authorized internal roles and active client administrators with an unrevoked comment/admin brand grant in the same organization to select or withdraw Topics. It does not confer model execution, adoption, semantic approval or spending authority. Selection retains its current generation, definition, membership, rights, CAS and actor-bound receipt checks, including reauthorization under the existing locks. No DDL or queue is added.

Components receive server-derived destinations and capabilities. Their initial mount only reads. Workspace/actor changes remount the relevant state, obsolete responses cannot restore it, and access rejection clears retained data and pending interactions. Protected links keep prefetch disabled. The existing workspace API feature flags also control this management entry.

## Consequences and validation

A brand can expose Topics and Data before its first report. Read-only users can inspect authorized state; operational actions are shown only when allowed. Client editing retains the current limitations once a catalogue has been processed. Brand creation, complete Brand OS editing, invitations, real role grants and spending policy are separate pending deliveries.

The focal PostgreSQL acceptance checks assigned brands without outputs, tenant isolation, roles/grants, selection/withdrawal/replay and revocation, while confirming model requests remain forbidden and work/cost records remain unchanged. UI acceptance covers the reused components, both languages, compact/desktop screens and stale response handling. Local fixtures do not stand in for a real client login or a second remote import.

Canonical scope and release evidence are maintained additively in `docs/product/PROMPT_LOOPING/PLAN_CLIENT_WORKSPACE_ENTRY_2026-09-10.md` and the associated delivery receipt in the documentation checkout. This decision does not mark the overall self-service E2E programme complete.
