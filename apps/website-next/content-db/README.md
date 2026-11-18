# Content database

Where the Insights pieces and the marketing studies live. It is its own Supabase
project, separate from Studio: the public site never has access to client data. The design is in
the founder's private notes (`website-2026/18_insights_y_estudios_diseno.md`).

Until `CONTENT_DATABASE_URL` is set, the site keeps reading `src/content/stories/public/*.json`.

## Roles

| Role | Who uses it | Can do |
|---|---|---|
| `postgres` (owner) | `content:migrate` | Create the schema and the roles |
| `content_admin` | `content:load`, `content:study`, `content:publish`, `content:links` | Write pieces, studies and personal links |
| `website_runtime` | The site in production | Read what is published; check a personal link and record an access through two functions |
| `website_review` | The site in UAT | The same, plus drafts |

The migration creates the roles without a login. The project owner gives each one a password
in the Supabase SQL editor (`alter role website_runtime with login password '…';`) and builds the
connection strings from the pooler address (Supabase → Connect → Session pooler). Passwords never
go into git or chat.

## Keys

Scripts read the repo root's `.env.local`. The site reads its own environment (Railway).

| Variable | Where | What it is |
|---|---|---|
| `CONTENT_OWNER_DATABASE_URL` | root `.env.local` | Owner connection, for migrations only |
| `CONTENT_ADMIN_DATABASE_URL` | root `.env.local` | `content_admin` connection |
| `CONTENT_SITE_URL` | root `.env.local` | Site to refresh after publishing (`https://noisia.ai`) |
| `CONTENT_REVALIDATE_SECRET` | root `.env.local` and Railway | Shared secret of the refresh endpoint |
| `CONTENT_DATABASE_URL` | Railway (`website`, production) | `website_runtime` connection |
| `CONTENT_DATABASE_URL` | Railway (UAT) | `website_review` connection |
| `CONTENT_DATABASE_CA` | Railway, optional | Supabase's root certificate, to verify the server |

## Commands (from `apps/website-next`)

```bash
pnpm content:migrate                                   # apply pending migrations
pnpm content:load <file.json | folder> [--study <id>]  # validate and load pieces as drafts
pnpm content:load <...> --dry-run                      # only run the checks
pnpm content:publish <id ...>                          # publish pieces and refresh the site
pnpm content:publish --study <id>                      # publish every draft of a study
pnpm content:publish <id ...> --retire                 # take pieces off the site
pnpm content:publish --list                            # every piece and its state
```

## Studies (stage 2)

```bash
pnpm content:study <web folder> [--dry-run]            # validate, render and load a study as a draft
pnpm content:publish --study <id>                      # publish the study and its draft pieces
pnpm content:publish --study <id> --retire             # take the study and its live pieces off the site
pnpm content:links <id> <leads.csv> [--days 90]        # one personal link per lead, written to <leads>.links.csv
pnpm content:links <id> --list                         # links of a study, with opens
pnpm content:links --revoke <link-id>                  # close one link
pnpm content:image <web folder> [--n 2]                # draw the study's image (STUDY_IMAGES.md)
```

The `web/` folder is what a study agent delivers: `estudio.json` (schema in
`src/content/studies/schema.ts`), `deck/` (the builder folder as is), optional `piezas.json` and
`portada.png`. `content:study` checks the summary, the pieces and the deck (no links to posts, no
@users, no provider names; screenshots of posts are flagged for a human look), then renders with
Google Chrome one image per slide (the phone view), the cover and, when `deck/` has no PDF, the PDF.
Files are stored per study version in `content.study_files`; loading changed files bumps the
version and removes the old ones.

**A deck in English too.** A `web/` folder may carry `deck-en/` beside `deck/`: the same study in
English, with its own PDF inside and exactly as many slides as `deck/` (the loader refuses
otherwise). It is checked and rendered like the main deck and stored as `deck-en/`, `slides-en/`
and `pdf-en/<id>.pdf`. The English site (`/en/insights/studies/<id>`, and the personal links of
readers who signed up in English) shows it; the Spanish site keeps `deck/`. The first five
slides of each are the public preview of a `registro` study.

**Booking a call.** Decks point to `noisia.ai/agenda` (slide and QR). The site sends it to the
booking page in `NOISIA_AGENDA_URL`; until there is one, to the contact form (`/taller`,
`/en/workshop`).

`market` is one market (`"MX"`) or a list for a study that reads several side by side
(`["UK", "DE", "ES", "FR"]`, the main one first). The index filter finds the study under each of
them; the card shows one or two names, or "4 markets".

What readers get:

| Page | Path | Cache |
|---|---|---|
| Studies index | `/insights/estudios`, `/en/insights/studies` | Static, refreshed on publish. `solo_link` studies are left out. |
| Study page | `/insights/estudios/<id>`, `/en/insights/studies/<id>` | Static, refreshed on publish |
| Full study | `.../<id>/completo`, `/en/.../<id>/full` | Per request, `private, no-store` |
| Files | `/api/content/studies/<id>/...` | Cover public; deck, slides and PDF only after the access check, `private` |
| Personal link | `/e/<token>` (`?lang=en` for English) | Sets a cookie for that study and opens the full study |

Access: `abierto` opens for anyone; `registro` and `solo_link` open only with a personal link until
the sign-up form ships (stage 3). The database keeps only the SHA-256 of each token; the CSV that
`content:links` writes is the only copy of the links, so keep it out of Git and shared drives.

`content:load` stops before writing anything if a piece breaks the schema or the privacy checks
(`scripts/content/lint.ts`): links, @users, provider or internal tool names, em dashes.

## Moving the pieces that are live today

Once the project exists and the keys are set:

```bash
pnpm content:migrate
pnpm content:load src/content/stories/public --publish-initial
pnpm content:publish --list
```

Then set `CONTENT_DATABASE_URL` in Railway and redeploy. The JSON files stay in the repo as a
fallback until the database has been live for a while; a later PR removes them.
