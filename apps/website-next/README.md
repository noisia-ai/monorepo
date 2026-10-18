# Noisia website (2026)

The public site at noisia.ai, rebuilt mobile first and bilingual. Architecture and the reasons
behind it: `docs/adr/040-website-2026-architecture.md`.

## Brand rules (non-negotiable)

1. **Always the real logo.** `public/brand/noisia.svg` (and `noisia-white.svg` on dark) via
   `src/components/brand/Logo.tsx`. Never type "noisia" as a stand-in for the logo: header,
   footer, feed bar, the closing card of every story and every Open Graph image use the file.
2. **Every source carries its icon.** A platform or source name never appears alone: use
   `SourceMark` / `SourceIcon` (`src/components/brand/SourceMark.tsx`). Platforms use their real
   logo from Simple Icons; source types (reviews, forums, press, search, NPS) use Iconoir.
   `pnpm test` fails if a story names a source without an icon.
3. **Mentions look like mentions.** A quote is a chat bubble, signed with the platform logo and
   name, then a calendar icon and the month (`MentionMeta`).
4. **White canvas.** Stories and pages sit on white; the chromatic offset belongs to the logo.

## Run it

```bash
pnpm --filter @noisia/website-next dev      # http://localhost:3010 (ES) and /en (EN)
pnpm --filter @noisia/website-next build
pnpm --filter @noisia/website-next test     # motion runtime + story schema
pnpm --filter @noisia/website-next smoke:feed   # headless check of the Insights feed (server running)
```

## Where things live

| What | Where |
|---|---|
| Design tokens | `src/styles/tokens.css` |
| UI strings (ES/EN) | `messages/es.json`, `messages/en.json` |
| Routes and translated slugs | `src/i18n/routing.ts` |
| Home copy | `src/content/pages/home.ts` |
| Inner pages (as blocks) | `src/content/pages/*.ts`, rendered by `src/components/blocks/Blocks.tsx` |
| Offer moments | `src/content/moments.ts` |
| Industries | `src/content/pages/industries.ts` |
| Insight stories | `src/content/stories/public/*.json` (validated by `schema.ts`) |
| Study collections (feed tabs) | `src/content/stories/collections.ts` |
| Logo and source icons | `src/components/brand/` |
| Full editorial reports | `src/content/reports/` |
| Motion runtime and scenes | `src/motion/` |

## Add an insight to the feed

1. Write a JSON story in `src/content/stories/public/` following `src/content/stories/schema.ts`:
   an industry, a market, and per locale a title, a short context, 3 to 6 scenes (hook, stat,
   compare, journey, split, tension, quote, takeaway), the takeaway and the verbatim evidence.
2. Every number must come from the source research and every quote must be literal.
3. `pnpm test` validates it. Check it frame by frame at `/render/<id>?frame=-1`.
4. It appears in the feed, gets its own page at `/insights/<id>` and an OpenGraph image.

Content derived from client work never goes in `public/`. For local tests put it in
`src/content/stories/_local/` (gitignored).

## A tab for one study (collections)

To give a report or study its own feed tab (for example a Buen Fin study):

1. Add the collection to `src/content/stories/collections.ts` (`id`, name in ES and EN).
2. Set `"collection": "<id>"` on each of its stories. They keep their industry too.
3. The tab appears next to "Todo" with a teal dot, and the feed for that study alone is
   shareable at `/insights?coleccion=<id>` (`/en/insights?collection=<id>`).

`src/content/stories/demo/` holds invented stories that test a format (today, Buen Fin 2026).
They are labelled "Datos inventados", never indexed, and load only in development or when
`NOISIA_DEMO_STORIES=1` (UAT). Production never sets it.

## Export a story as video

With the site running: `pnpm --filter @noisia/website-next export:story <id> [--locale en]`.
It captures `/render/<id>` frame by frame in headless Chrome and encodes an MP4 in `renders/`.
