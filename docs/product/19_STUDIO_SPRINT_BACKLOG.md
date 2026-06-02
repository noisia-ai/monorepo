# Studio sprint backlog

Last updated: 2026-06-02

## Progress

- In progress: 01 Admin CRUD and reassignment controls.
- Done in 01 so far:
  - Organizations can be created, edited, and deleted when empty.
  - Organization delete now reports blockers for users, pending invitations, brands, and themes.
  - Brands can be moved between organizations from the Brand OS edit form.
  - Brand OS edit can create a missing destination organization inline and select it immediately.
  - Moving a brand syncs client brand access for the old/new organization.
  - Brands with corpora are archived instead of hard-deleted; empty brands can be hard-deleted.
  - Archived brands can be viewed from Brands and permanently deleted.
  - Permanent brand deletion removes related corpora, mentions, analyses, outputs, access, competitors, memory, and KB rows.
  - Corpora can be archived from the brand detail page.
  - Themes now explain their purpose in the UI and can be archived/deleted from the theme detail page.
  - Archived themes can be permanently deleted through the theme detail action.
  - Sephora duplicate organizations were merged into a single `sephora` organization with 1 brand and 3 corpora.
- Still open in 01:
  - Optional self-serve organization merge UI for future duplicate workspaces.

## Backlog

01. As an admin, I need to delete organizations, corpora, brands, and related Studio entities.
    - Includes CRUD for brands, organizations, corpora, and similar admin-owned records.
    - Current examples: remove duplicate Sephora-related organizations; move the Novibet study/brand to a different organization.
02. As an admin, I want to create studies from Noisia around a topic without having to associate the study to a brand.
03. As an admin, I want to select an existing corpus and run another study against it.
    - There are more methodologies in the KB that are not implemented yet.
04. `/studio` needs a redesign.
    - It currently only shows recent corpora and should surface more admin/client value.
05. As an admin, I do not understand what the Themes functionality does.
06. As an admin, I want to edit a study brief and rerun the full study.
07. As an admin, I want a redesigned study wizard.
08. As an admin, I want Workspace settings.
09. As a client admin, I want a home designed around the reports I can access.
