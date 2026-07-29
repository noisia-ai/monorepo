# ADR 011: One Stable Signal Workspace per Brand

## Status

Accepted. Implemented additively on the Signal V2 branch. Client-visible activation
still requires the existing Data OS staging gates.

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
- Each Triggers & Barriers `study_corpus` becomes a named page inside the workspace.
  `study_corpora.name` is its navigation title.
- A new approved T&B analysis for that study becomes a new immutable release/version
  of the same page. It does not create another workspace or client URL.
- `/signal/{outputId}` remains a backward-compatible report route while links and
  navigation migrate to the canonical workspace URL.
- Migration `0056_signal_workspace_auto_membership` attaches every newly created study
  corpus to its subject workspace. T&B is `strategic`; the first Signal Pulse corpus is
  `operational`; other corpora remain `legacy`.

## Consequences

- A client bookmarks one URL and sees live monitoring, named strategic studies and
  their history in one place.
- Creating a study requires a client-facing page name. Studio exposes this explicitly
  in Corpus Engine.
- Study identity and release identity are separate: renaming/navigation concerns
  belong to the study; period, review and publication belong to the release.
- Operational data may continue updating without rewriting a frozen strategic
  release.
- The T&B visual redesign can proceed page by page without changing the workspace
  identity again.

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
