# Noisia website (2026)

The public site at noisia.ai, rebuilt mobile first and bilingual. Architecture and the reasons
behind it: `docs/adr/040-website-2026-architecture.md`.

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

## Export a story as video

With the site running: `pnpm --filter @noisia/website-next export:story <id> [--locale en]`.
It captures `/render/<id>` frame by frame in headless Chrome and encodes an MP4 in `renders/`.
