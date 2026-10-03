# ADR 011: One Stable Signal Workspace per Brand

## Status

Accepted. Implemented additively on the Signal V2 branch. Client-visible activation
still requires the existing Data OS staging gates.

The workspace identity and stable URL remain accepted. The client-visible
`study_corpus` page model below is superseded by ADR 014: the workspace has one report
surface per `report_key`, while study runs/releases remain internal history.

## Context

Historically, each published study produced an output UUID and therefore appeared to
produce a separate Signal URL. That model exposes an implementation detail to the
client, fragments the history of a brand and makes always-on monitoring coexist poorly
with periodic strategic work.

The database already models `signal_workspaces` as unique per organization and brand,
and `signal_workspace_corpora` as a many-to-one temporal membership. The missing part
was applying that identity to routing, navigation and new-study creation.

## Decision

- A brand has one canonical Signal workspace, enforced by
  `uq_signal_workspaces_brand`.
- Its client entry point is `/signal/{workspaceSlug}`. For example,
  `/signal/laika`.
- The top-left workspace chevron switches between Signal workspaces the signed-in user
  can access. It does not switch between studies.
- Brand Monitoring is the workspace home.
- Triggers & Barriers has one client-visible report surface inside the workspace.
- A `study_corpus` may remain as a compatibility execution identity, but does not become
  navigation.
- A new approved T&B analysis becomes a new immutable release/version of the T&B
  report. It does not create another workspace, page or client URL.
- `/signal/{outputId}` remains a backward-compatible report route while links and
  navigation migrate to the canonical workspace URL.
- Migration `0056_signal_workspace_auto_membership` remains a transition bridge that
  attaches study corpora to a workspace. ADR 014 requires future canonical ingestion to
  be workspace-owned rather than making that membership the data ownership boundary.

## Consequences

- A client bookmarks one URL and sees live monitoring, named strategic studies and
  their history in one place.
- Study identity, report identity and release identity are separate: client navigation
  belongs to the report key; population/period belong to the run; review/publication
  belong to the release.
- Operational data may continue updating without rewriting a frozen strategic
  release.
- The T&B visual redesign and new data-plane migration do not change workspace identity.

## Rejected Alternatives

### One workspace per study

Rejected because it reproduces the current fragmentation and forces clients to manage
multiple URLs for one brand.

### One navigation item per analysis run

Rejected because recurring runs are versions of a strategic question, not separate
products. They belong in history inside the named study page.

### Use the latest output UUID as the canonical URL

Rejected because publishing a new output would change the client entry point and break
continuity.
