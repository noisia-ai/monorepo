# Icons — every glyph on a Noisia deck comes from a real library

> Brandhon's rule, learned the hard way: **hand-drawn Feather-style SVGs read as fake** ("ninguno trae un icono real"). Use real, consistent icon libraries and inline them. The renderer blocks external CDNs, so **embed the SVG source** — never a `<link>` or `<script>` to a CDN.

Two libraries, two jobs:

| Use | Library | Install |
|---|---|---|
| **Semantic / UI icons** (eyebrows, KPIs, notes, glossary, bar labels) | **Iconoir** — `icons/regular/<name>.svg` | `npm i iconoir` |
| **Brand / platform logos** (X, YouTube, Reddit, Facebook, Instagram, Apple, Sonos, Google…) | **Simple Icons** — `icons/<slug>.svg` | `npm i simple-icons` |

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

1. **No hand-drawn icons.** If it's not from Iconoir or Simple Icons, it doesn't ship.
2. **Brand logos are Simple Icons, filled white on the brand color.** Semantic icons are Iconoir, stroked, tinted (teal / coral / green) inside an `.icobox`.
3. **`currentColor` gotcha (contrast bug).** Iconoir children hard-code `stroke="currentColor"`, which **overrides** a `stroke="#fff"` on the parent `<svg>`. A white-on-color marker (e.g. the Web/globe on grey) then renders dark and loses contrast. Fix: in those markers, replace the children's `stroke="currentColor"` with `stroke="#fff"`.
4. **Amazon isn't in Simple Icons** (removed for trademark) — and decks are brand-agnostic anyway. For "retailer reviews" use a generic **star**, not the Amazon smile:
   `<polygon points="12 2 15 9 22 9.3 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.3 9 9"/>` (fill white).
5. **Competitor rows** may carry the real brand logo (Simple Icons: `apple`, `sonos`, `googlehome`, …), white on the brand color. If a brand has no logo (Amazon/Alexa), use a neutral Iconoir device glyph (`sound-high`) instead of faking one.
6. **Never change a brand glyph across a deck** — a viewer finds a platform by its mark.

## Bulk replace (porting a deck)

Match each icon by a distinctive substring of its path, keep the original `<svg …>` opening (it owns size/color), swap only the inner. Leave charts and already-real brand logos untouched. A tested per-inner replace script lives in the deck build notes; the point is: **preserve the wrapper, replace the glyph, verify slide-by-slide.**
