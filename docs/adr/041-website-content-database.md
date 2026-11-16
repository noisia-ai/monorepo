# ADR 041 · Website content database for Insights and studies

- **Status:** proposed (2026-11-15)
- **Scope:** `apps/website-next` — the Insights feed now; the studies (index, study page, full study, gated access) next
- **Follows:** ADR 040 (website 2026 architecture)

## Context

The Insights pieces live as JSON files in `apps/website-next/src/content/stories/public/` and
the three report pages are hand-built in code. Noisia will publish many more pieces, each tied
to a marketing study, plus a page per study and the full study behind an access gate. Keeping
that content in the repo has four problems:

1. The repo is public, so a draft is visible on GitHub before it is approved.
2. Nothing else (outreach, decks, Studio) can read the content without copying it.
3. Every new piece needs a deploy.
4. Gated studies and the leads they collect need private storage.

The rest of the site (home, solutions, methods, industries, about) changes rarely and stays in code.

## Decisions

1. **Its own Supabase project for content**, separate from Studio's. The public site never holds
   credentials to a database with client data.
2. **Schema `content`, not exposed through the Supabase REST API.** Tables `studies` and `stories`
   (leads, access links and events arrive with the gated studies). A piece's `payload` is the same
   story the site's zod schema validates; `notes` (how each figure was derived) never leaves the
   database.
3. **Four Postgres roles, least privilege:**
   - `website_runtime` (production) reads only the `published_*` views;
   - `website_review` (UAT) also reads drafts;
   - `content_admin` (load and publish scripts) writes content;
   - the owner runs migrations.

   The roles are created without login; the owner sets their passwords out of band.
4. **States `borrador`, `publicado`, `retirado`.** Publishing is the approval step.
5. **No CMS for now.** Agents and the founder load content with `pnpm content:load`, which
   validates the schema and the privacy rules (no links, no @users, no provider names) before
   writing anything, and publish with `pnpm content:publish`.
6. **Static pages, refreshed on demand.** Pages are still prerendered. Story reads are cached
   under the `content:stories` tag; the publish script calls `/api/content/revalidate` (bearer
   secret) and the site regenerates on the next visit, without a deploy.
7. **The SEO registry becomes async** (`seoPages`, `seoPage`, `pageMetadata`, `pageGraph` and the
   JSON-LD helpers), because it now includes database content. `staticSeoPage` stays synchronous
   for pages that never come from the database.
8. **JSON fallback during the move.** Without `CONTENT_DATABASE_URL` the site reads the JSON files
   as before, so production keeps working until the variable is set. The files are removed in a
   later PR, once the database has been live for a while.

## Consequences

- Publishing a piece takes seconds and leaves no trace in the public repo.
- The site depends on the content database at build time and when a page regenerates. If the
  database is down at build, the build fails and the previous deploy keeps serving; if it is down
  at regeneration, Next keeps serving the cached page.
- Full studies and their files will be served through routes that check access and send
  `Cache-Control: private, no-store`, so Cloudflare never caches gated content.
- Migrations live in `apps/website-next/content-db/migrations`, forward-only, applied with
  `pnpm content:migrate`.

## Addendum: stage 2, studies (15 Nov 2026)

- **Study files live in the database**, in `content.study_files` (one row per file and version),
  not in Supabase Storage. Reading Storage from the site would need the service key, which opens
  everything; with the database the site keeps its single read-only role and reads files of
  published studies through a view. A study is 10 to 20 MB; files are cached in the site's memory
  per version.
- **Personal links are tokens, stored as hashes.** `/e/<token>` puts the token in an httpOnly
  cookie scoped to the study. Every request for the full study checks it through the
  `security definer` function `content.link_study`; the site never reads `access_links`.
  Opens and PDF downloads are recorded by `content.record_event`.
- **Two views of the full study.** On tablet and desktop the builder's deck runs read-only in an
  iframe (`no-rail`). On a phone the load script's slide images are stacked full width and open
  full size on tap.
- **`registro` waits for stage 3.** Until the form ships, a `registro` study behaves like
  `solo_link` for readers without a link: the page explains how to request it.
