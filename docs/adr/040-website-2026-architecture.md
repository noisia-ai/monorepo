# ADR 040 · Public website 2026 architecture

- **Status:** proposed (2026-10-18)
- **Scope:** `apps/website-next` (the rebuild of `apps/website`)
- **Numbering:** 040 leaves room for the ADRs being added on `develop` (031 at the time of writing).

## Context

The public site (`apps/website`) was built in April–May 2026. Its copy lives in one 877-line
`site.ts` in Spanish only, its styles in an 11,573-line `globals.css`, and it has no i18n. The
offer, the proof and the visual language of Noisia changed after that. The new site must be
mobile first, bilingual, heavy on motion, and its centerpiece is an Insights section that works
like a vertical short-video feed.

## Decisions

1. **New app, same stack.** `apps/website-next` (Next.js 15 App Router, React 18, TypeScript
   strict) is built next to the current site. At cutover it replaces `apps/website` and the
   Railway service points to it. Server components by default; client components only for
   interaction and motion.
2. **i18n with next-intl.** Spanish at the root, English under `/en`, localized slugs per locale
   (`/como-funciona` ↔ `/en/how-it-works`), `hreflang` alternates on every page, no automatic
   language redirect (links are shared in Spanish).
3. **Design tokens + CSS Modules.** One `tokens.css` (color, type, space, radius, motion, layers)
   mirrors `packages/pitch-kit/engine/noisia-tokens.css`, a small `base.css`, and one CSS Module
   per component. This departs from the "global CSS, no modules" convention of the repo on
   purpose: the old single global stylesheet is what made the current site hard to change.
4. **Content as typed data.** Inner pages are lists of blocks (`src/content/pages/types.ts`)
   rendered by one component; copy lives per locale in typed modules. Insight stories are JSON
   validated with zod (`src/content/stories/schema.ts`). Client-derived test content lives in a
   gitignored `_local/` folder and never ships. A CMS can replace the modules later without
   touching components.
5. **Motion runtime of our own.** Insight stories and the hero are frame-based compositions on a
   small deterministic runtime (`src/motion/runtime.tsx`: `Stage`, `Sequence`, `interpolate`,
   `spring`). A composition is a pure function of the frame, so the same source plays live, renders
   any single frame (reduced motion, posters, indexable text) and can be captured frame by frame
   into video. Remotion was the obvious alternative; its company license (from USD 100/month for
   teams of more than three) was not justified for playback we can own in ~250 lines. Canvas-based
   options (Lottie, Rive, Motion Canvas) lose selectable, translatable text. UI micro-motion uses
   `motion` (motion.dev) and CSS.
6. **Stories are data, scenes are templates.** Eight scene templates (hook, stat, compare,
   journey, split, tension, quote, takeaway) cover the stories. A new insight is a new JSON file,
   not new code.
7. **The feed.** Native CSS scroll-snap, one full-height item per story, only the active item plays
   and only items within ±2 mount a composition. The address bar follows the feed
   (`/insights/[slug]`), and every story has its own server-rendered page with structured data so
   it can be shared and indexed. Pause control (WCAG 2.2.2), keyboard navigation and a static
   poster when the reader prefers reduced motion.
8. **Video export from the same source.** `/render/[slug]?frame=N` renders one native frame at
   1080×1920 (`?frame=-1` renders a contact sheet). A headless browser captures frames and ffmpeg
   encodes MP4/WebM for social sharing. Rendering never runs on the web server.
9. **Search and answer engines.** Metadata and alternates per page, sitemap with language
   alternates, robots, FAQ structured data, a pillar page for the category and comparison pages.
10. **Forms.** `/api/taller` validates with zod, drops honeypot submissions and sends through
    Resend; delivery failures are returned to the reader instead of being reported as success.
11. **Legacy URLs.** Permanent redirects from every route of the 2026-05 site to its closest new
    page.

## Consequences

- Two website apps coexist until cutover; the old one keeps deploying from `main` untouched.
- The motion runtime is ours to maintain (tests for `interpolate` and `spring` are part of the
  definition of done).
- Copy and stories can be produced by people or agents as data and reviewed in pull requests.
