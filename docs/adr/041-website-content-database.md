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
