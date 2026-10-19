# Design QA — Signal Mentions

Date: 2026-07-27

## Reference

- Shopify resource index: `.codex/audits/signal-mentions-definition-2026-07-27/02-shopify-resource-index.jpg`
- Shopify search state: `.codex/audits/signal-mentions-definition-2026-07-27/03-shopify-search-state.jpg`
- Shopify selection state: `.codex/audits/signal-mentions-definition-2026-07-27/04-shopify-selection-state.jpg`
- Shopify columns state: `.codex/audits/signal-mentions-definition-2026-07-27/05-shopify-columns-sort.jpg`
- User column-control reference: `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-b7a5e8db-0c34-4aea-b514-ccc102f2ff04.png`
- User T&B context references:
  - `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-bea16903-e1ec-4c7c-b247-75c76384c12a.png`
  - `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-dd040ab6-a8f4-48ae-8976-609a51187cac.png`
  - `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-098053f0-ca3d-4054-99c6-dd6ca52ffe24.png`

## Implementation captures

- Resource index: `.codex/design-qa/signal-mentions-desktop.png`
- Search state: `.codex/design-qa/signal-mentions-search.png`
- Five-column responsive card state: `.codex/design-qa/signal-mentions-cards.png`
- Column-control state: `.codex/design-qa/signal-mentions-columns.png`
- Column-control crop: `.codex/design-qa/signal-mentions-columns-menu.png`
- Reference/prototype comparison: `.codex/design-qa/signal-mentions-columns-comparison.png`
- Enriched detail drawer: `.codex/design-qa/signal-mentions-drawer.png`
- Compact T&B context: `.codex/design-qa/signal-mentions-tb-context.png` (1280 × 720 desktop card state)
- T&B context before/after: `.codex/design-qa/signal-mentions-tb-comparison.jpg`

## Comparison

- Shell, sidebar, top bar, workspace background and 13 px information density remain aligned with the approved Brand Monitoring shell.
- The resource index follows the Shopify hierarchy: view tab, compact search/actions row, fixed column header, dense selectable rows and contextual bulk actions.
- Source identity uses official Simple Icons glyphs when available and a restrained generic fallback for web/news sources.
- Source marks retain their native silhouette without circular clipping; Google, Facebook, Instagram and TikTok were checked in populated states.
- Corpus scope is explicit as Brand, Competitor or Category without claiming that a post came from an official account.
- Approved T&B context now separates the structured decision classification (`polarity · layer`) from short evidence phrases found in the mention. Arbitrary governed record tags are no longer used as a T&B fallback.
- Compact cards label those roles as `T&B` and `Signal`, keep both on one line with a full-text title, and use the available width before ellipsizing; no chip can grow to a second line.
- The column control matches the reference hierarchy: immutable Mention column, drag handles, visible/hidden eye states and compact spacing.
- The card alternative keeps the same search, filtering, selection and detail behavior in a five-column desktop grid.
- The detail drawer preserves context without navigating away from the corpus and keeps the original verbatim mention visually dominant.
- Search updates the URL and every row/count through the governed serving endpoint; clearing search restores the full filtered population.
- The same governed endpoint now supports corpus scope, conversation role, T&B polarity, decision layer and observed-signal filters; filter values are fetched once per active filter window and reused briefly to avoid redundant facet queries.
- Sorting is executed server-side for publication date, source, conversation role and interactions, so ordering remains correct across pages rather than only reordering the visible rows.
- Pagination defaults to 50 rows, offers 25/50/100, and caps requests at 100 to protect both scanning usability and database latency.
- Concept helpers explain corpus scope, the T&B analysis lifecycle, enriched context, analyzed attributes and observed signals in plain language without naming listening providers.
- The inventory, not the whole application shell, owns vertical scrolling on desktop; the toolbar, column header and pagination remain anchored while mentions move.
- Exact-layout skeletons preserve the table and card geometry during filter changes.
- No clipping, unexpected overflow, broken borders, mixed radii or runtime overlays were observed in the desktop reference state.

## Functional states checked

- Direct route reload.
- Search and clear search.
- Multi-selection and contextual actions.
- Table/card layout switch.
- Column menu, immutable Mention state and visible/hidden controls.
- Filter controls entry point.
- Enriched filter facet load, including Corpus scope, Conversation role, T&B classification, Decision layer and Observed signal.
- Observed-signal facet search, including the approved signal “la promo no era lo que decía”.
- Server-side sort selector and 25/50/100 pagination controls.
- Sticky inventory header and anchored pagination at desktop height.
- Corpus scope and T&B helper entry points.
- Row detail drawer and original-source link.
- Empty/loading/table/card states.
- Approved T&B classifications and Brand/Competitor/Category scope in populated rows.
- T&B context at desktop card density, including classifications with and without an observed signal.
- Enriched drawer separation between the controlled classification and observed evidence signals.
- Browser console after populated card and drawer interactions: zero errors.

## Mentions controls and support-content pass

- Shopify helper reference: `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-d68c4327-cd01-4f9b-8bcf-7e0a4fbb3013.png`
- Shopify sorting reference: `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-50f53e07-b124-4ebe-8788-33b92dcfb9f8.png`
- Filter-chip reference: `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-be40b325-e4b6-4892-94f4-f1c5fbe886ea.png`
- Final helper capture: `.codex-artifacts/mentions-helper.png`
- Final enriched drawer capture: `.codex-artifacts/mentions-drawer-final.png`
- Final sorting capture: `.codex-artifacts/mentions-sort.png`
- Final pagination capture: `.codex-artifacts/mentions-page-size.png`
- Final stacked-filter capture: `.codex-artifacts/mentions-filter-chips.png`
- Side-by-side comparisons:
  - `.codex-artifacts/compare-helper.png`
  - `.codex-artifacts/compare-sort.png`
  - `.codex-artifacts/compare-filter.png`

### Visual conclusions

- Support content now uses the same dotted-title, help-cursor and anchored popover convention as Brand Monitoring. Separate question-mark icons and duplicated explanatory paragraphs were removed.
- The custom sorting and rows-per-page menus use the approved 8 px surface radius, compact typography, selected-row treatment, checkmarks, shadows and grouped separators instead of browser-native selects.
- Selected filter values render as natural-language chips in a dedicated wrapping row beneath each immutable filter label. `Observed signal` stays on one line and its values no longer inherit inconsistent source casing.
- Table density, fixed toolbar, sticky header, left alignment and footer pagination remain unchanged while menus are open.
- The reference/prototype pairs were inspected together. No clipped menus, mixed radii, doubled focus rings, overflowing chips or misleading support copy remain.

### Functional conclusions

- `Most interactions` returns the actual descending engagement order, including imported numeric-string values.
- Serving controls such as `offset`, `limit`, `sort` and `direction` are no longer parsed as Signal dimensions.
- Switching among newest, oldest, source, conversation-role and interaction sorting no longer produces or preserves `Unsupported Signal dimension: offset.`.
- Page sizes 25, 50 and 100 load server-side; QA confirmed `1–25 of 723` and restored the default `1–50 of 723`.
- Browser console after helper, filter, sort, pagination and drawer interactions: zero errors.

## T&B context iteration history

- Before: controlled T&B polarity/layer values and free-form evidence phrases shared the same undifferentiated chips. Long evidence wrapped to two or three lines.
- After: structured classification and observed evidence have separate labels, color roles and truncation behavior. The drawer preserves every evidence phrase and explains the distinction in plain language.
- Remaining P0/P1/P2 visual issues: none.

## Brand helper and cross-module loading retrofit

- User helper references:
  - `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-ed84682d-9991-4508-addc-2027ba630fea.png`
  - `/var/folders/c5/1_ln5drj1f1cytjbcbf8plmm0000gn/T/codex-clipboard-3407a091-c13c-4573-b225-054d12c45235.png`
- Canonical Brand helper: `.codex-artifacts/brand-helper-retrofit-open.png`
- Old/new helper comparison: `.codex-artifacts/compare-brand-helper-retrofit.png`
- Mentions loading geometry: `.codex-artifacts/mentions-route-skeleton-final.png`
- Mentions loading/rendered comparison: `.codex-artifacts/compare-mentions-skeleton-final.png`
- Mentions-to-Brand pending state: `.codex-artifacts/mentions-to-brand-pending-final.png`

### Visual conclusions

- Brand Monitoring KPI labels now use the same dotted title, help cursor, anchored caret and 8 px support surface as the approved Mentions helpers; the separate question-mark icon was removed.
- The four conversation-unit helpers retain their full definitions and “How to read it” guidance without changing the KPI grid geometry.
- Cross-module loading preserves the top bar and swaps only the destination workspace body, so navigation has immediate feedback without a blank or stale page.
- The Mentions skeleton follows the rendered page head, date controls, resource tab, toolbar, fixed columns, two-line mention copy, row density and pagination footprint.
- The Brand Monitoring destination skeleton follows the page head, filter row, insights surface, KPI grid, wide trend chart and secondary cards.

### Functional conclusions

- Mobile/off-canvas navigation was exercised from Brand Monitoring to Mentions and back to Brand Monitoring.
- Pointer-down activates the destination skeleton before the route transition completes; the active navigation state changes with it.
- Direct Mentions route loading displays the route skeleton before the governed rows resolve.
- Final populated Brand and Mentions states retain the same shell and do not expose runtime overlays.

## Stable shell navigation refinement

- User references:
  - `/Users/brandhon_o/Desktop/Screenshot 2026-07-27 at 10.06.17 p.m. (3).png`
  - `/Users/brandhon_o/Desktop/Screenshot 2026-07-27 at 10.06.26 p.m. (3).png`
- Final transition capture: `.codex-artifacts/signal-stable-shell-clean.png`

### Visual conclusions

- Brand Monitoring → Mentions and Mentions → Brand Monitoring now preserve the real top bar, workspace switcher, complete left navigation and Settings control.
- The destination navigation item becomes active immediately, while only the destination module’s data geometry enters a loading state.
- The loading palette is quieter and closer to the surrounding Shopify-inspired neutrals; shimmer duration is slower and reduced-motion users receive no shimmer.
- The module skeletons retain their final layout footprint, avoiding a full-page flash or a shell-level layout jump.

### Functional conclusions

- Both sibling navigation directions were exercised with the persistent shell mounted.
- The canonical URL changes only after the destination payload succeeds, while the active destination and loading feedback appear immediately.
- Browser Back restores the matching URL, module and active navigation state.
- Modified clicks keep native browser behavior for new tabs and windows.
- Browser console after both transition directions: zero new application errors.

## Final result

passed
