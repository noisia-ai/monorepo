# Icons — every glyph on a Noisia deck comes from a real library

> Brandhon's rule, learned the hard way: **hand-drawn Feather-style SVGs read as fake** ("ninguno trae un icono real"). Use real, consistent icon libraries and inline them. The renderer blocks external CDNs, so **embed the SVG source** — never a `<link>` or `<script>` to a CDN.

Two libraries, two jobs:

| Use | Library | Install |
|---|---|---|
| **Semantic / UI icons** (eyebrows, KPIs, notes, glossary, bar labels) | **Iconoir** — `icons/regular/<name>.svg` | `npm i iconoir` |
| **Platform / network marks** (X, YouTube, Reddit, Facebook, Instagram…), and the fallback for a brand with no real logo | **Simple Icons**: `icons/<slug>.svg` | `npm i simple-icons` |

A brand that is studied or compared (the client, a competitor, a benchmark) carries **its real
logo**, trimmed to its ink and set at the same optical size as the others (`LAYOUTS.md`, "Brand logos
at the same optical size").

**Look in the repo before you install or ask for a download.** After `pnpm install` at the repo root,
Simple Icons is already there (the website and `packages/motion` depend on it):
`node_modules/.pnpm/simple-icons@*/node_modules/simple-icons/icons/<slug>.svg`. A case that asked
the user to approve a download for a platform mark had it on disk the whole time. Iconoir is only
there as `iconoir-react`; its raw SVGs still come from `npm i iconoir` in a scratch folder.

## How to inline

**Iconoir (semantic).** 24×24, `stroke`, `fill="none"`. Keep your own `<svg class="ic" …>` wrapper (it sets size + color) and drop in Iconoir's inner paths. Its children carry `stroke="currentColor"` and inherit `stroke-width` from the parent — so the icon takes the parent's `color`.

```html
<span class="eb"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><!-- paste iconoir/icons/regular/flash.svg inner --></svg> what the screen pulls in</span>
```

**Simple Icons (brands).** A single filled `<path>`. Put it in a brand-colored chip (`.bmk` / `.cc` / `.sq`) and fill the glyph **white**:

```html
<span class="bmk" style="background:#000"><svg viewBox="0 0 24 24" fill="#fff"><path d="…x.svg path…"/></svg></span>
```

## Hard rules

1. **No hand-drawn icons.** If it's not from Iconoir, Simple Icons or a brand's real logo file, it doesn't ship.
2. **Platform and network marks are Simple Icons, filled white on the brand color.** A studied or compared brand carries its real logo, trimmed to its ink at the same optical size (`LAYOUTS.md`); Simple Icons white on colour is only its fallback when no real logo exists. Semantic icons are Iconoir, stroked, tinted (teal / coral / green) inside an `.icobox`.
3. **`currentColor` gotcha (contrast bug).** Iconoir children hard-code `stroke="currentColor"`, which **overrides** a `stroke="#fff"` on the parent `<svg>`. A white-on-color marker (e.g. the Web/globe on grey) then renders dark and loses contrast. Fix: in those markers, replace the children's `stroke="currentColor"` with `stroke="#fff"`.
4. **Amazon isn't in Simple Icons** (removed for trademark) — and decks are brand-agnostic anyway. For "retailer reviews" use a generic **star**, not the Amazon smile:
   `<polygon points="12 2 15 9 22 9.3 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.3 9 9"/>` (fill white).
5. **Competitor rows** carry the real brand logo, trimmed to its ink (rule 2). Where there is none, the Simple Icons glyph (`apple`, `sonos`, `googlehome`, …), white on the brand color. If a brand has neither (Amazon/Alexa), use a neutral Iconoir device glyph (`sound-high`) instead of faking one.
   **Simple Icons has almost no consumer-goods brands.** In a study of packaged-goods or retail brands, settle in the plan where each logo comes from: a list of logos the user approves, or the user's yes to download them from Wikimedia Commons (a file download: ask with the source). Not at the end of the build.
6. **Never change a brand glyph across a deck** — a viewer finds a platform by its mark.
7. **Platform marks inside a card run at about 16px.** Bigger, they compete with the content they
   label.
8. **No icon tile stacked above a heading, a figure or a KPI.** The icon goes beside the heading,
   to the left of the figure's label, or inside the row it belongs to (`impeccable.style/slop`).

## Bulk replace (porting a deck)

Match each icon by a distinctive substring of its path, keep the original `<svg …>` opening (it owns size/color), swap only the inner. Leave charts and already-real brand logos untouched. A tested per-inner replace script lives in the deck build notes; the point is: **preserve the wrapper, replace the glyph, verify slide-by-slide.**

## Brand chips used in decks (Simple Icons slug · chip color)

Fill white on the brand color. Keep the same mark for a platform across the whole deck.

| Platform | slug | chip bg |
|---|---|---|
| X | `x` | `#000` |
| YouTube | `youtube` | `#FF0000` |
| Reddit | `reddit` | `#FF4500` |
| Facebook | `facebook` | `#1877F2` |
| TikTok | `tiktok` | `#000` |
| Instagram | `instagram` | `#E4405F` |
| Web / prensa | Iconoir globe | `#6b7280` (children `stroke="#fff"`, see rule 3) |

## Asset names (one file, one name)

Three filenames for the same map (`tb-map.png`, `map-tb.png`, `map-t&b.png`) and three for the
same cover illustration were found across shipped decks, all byte-identical. Copy them from
`assets/` under their canonical names and do not rename them per deck:
`tb-map.png`, `cover-illustration.png`, `logo_norm.svg`. An ampersand in a filename also has to be
URL-encoded in the `src`, which is one more thing to get wrong.

## The T&B map ships in English, and nothing goes on top of it

`assets/tb-map.png` labels its rings `cultural` / `social` / `personal` and, innermost,
**`Psychological`** in English. That is how the asset ships and how it gets used, **in every deck,
whatever language the deck is in.** Do not overlay a translated label, do not patch it at runtime,
do not rename the file per deck.

Earlier decks covered that ring with a white `psicológico` box. That was a workaround, it reads as
a sticker over the artwork, and it is retired. The `.lperm` cards under the map already name the
four layers in the deck's language, which is where a Spanish reader gets the word.
