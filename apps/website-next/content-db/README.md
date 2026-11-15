# Content database

Where the Insights pieces (and, from the next stages, the studies) live. It is its own Supabase
project, separate from Studio: the public site never has access to client data. The design is in
the founder's private notes (`website-2026/18_insights_y_estudios_diseno.md`).

Until `CONTENT_DATABASE_URL` is set, the site keeps reading `src/content/stories/public/*.json`.

## Roles

| Role | Who uses it | Can do |
|---|---|---|
| `postgres` (owner) | `content:migrate` | Create the schema and the roles |
| `content_admin` | `content:load`, `content:publish` | Write pieces and studies |
| `website_runtime` | The site in production | Read what is published |
| `website_review` | The site in UAT | Read what is published, plus drafts |

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
