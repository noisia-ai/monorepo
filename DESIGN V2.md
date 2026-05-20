---
version: alpha
name: Noisia
description: >
  Social Intelligence Architects. A light, analytical identity for reports,
  strategic tools, and executive intelligence products. The system combines
  Google Sans typography, white canvas, glass surfaces, chromatic signal colors,
  diffuse fluid backgrounds, and restrained scroll motion.

colors:
  noisia:
    black: "#070113"
    voidPlum: "#12001F"
    deepViolet: "#261447"
    electricPurple: "#4B1D95"
    deepTeal: "#01535F"
    cyanInk: "#007E89"
    brightCyan: "#009CA8"
    magentaInk: "#D81B60"
    glitchRed: "#D91441"
    mutedGold: "#A76700"

  primary: "#070113"
  secondary: "#6d6d6d"
  tertiary: "#007E89"
  neutral: "#ffffff"

  canvas: "#ffffff"
  surface-01: "#fafafa"
  surface-02: "#f4f4f4"
  surface-03: "#eeeeee"

  neutral-03: "#eeeeee"
  neutral-04: "#e6e6e6"
  neutral-05: "#dadada"
  neutral-09: "#999999"
  neutral-10: "#6d6d6d"
  neutral-11: "#070113"
  ink: "#070113"

  signal: "#007E89"
  signal-dark: "#01535F"
  tension: "#D91441"
  tension-soft: "rgba(217, 20, 65, 0.08)"
  positive: "#007E89"
  positive-soft: "#eaf8f2"
  whisper: "rgba(75, 29, 149, 0.26)"

  blob-dark: "#070113"
  blob-charcoal: "#261447"
  blob-cyan: "#009CA8"
  blob-red: "#D91441"

colorSystem:
  principle: "Neon references are decorative only; functional UI, charts, icons, and text use deeper Noisia ink colors for legibility on white."
  chartPalette:
    - "#007E89"
    - "#01535F"
    - "#D81B60"
    - "#D91441"
    - "#4B1D95"
    - "#261447"
    - "#070113"
    - "#12001F"
  chartRule: "Use the chartPalette sequence for Noisia reports before introducing any other hue. Do not use yellow/orange for chart series unless a brief explicitly calls for the limited mutedGold token."
  glitchRule: "Use #009CA8, #D81B60, and #D91441 as offsets, glows, auras, or editorial accents; do not use them as long-form body text."
  gradientRule: "Gradients are atmospheric only. Do not use gradient text for report/article titles."

typography:
  display:
    fontFamily: "Google Sans"
    fontSize: "clamp(3.4rem, 9vw, 7.4rem)"
    fontWeight: "500"
    lineHeight: "0.98"
    letterSpacing: "0"
  headline-lg:
    fontFamily: "Google Sans"
    fontSize: "clamp(2.7rem, 7vw, 4.8rem)"
    fontWeight: "500"
    lineHeight: "1.04"
    letterSpacing: "0"
  headline-md:
    fontFamily: "Google Sans"
    fontSize: "clamp(2rem, 5vw, 3rem)"
    fontWeight: "500"
    lineHeight: "1.08"
    letterSpacing: "0"
  headline-sm:
    fontFamily: "Google Sans"
    fontSize: "clamp(1.4rem, 3vw, 1.9rem)"
    fontWeight: "700"
    lineHeight: "1.18"
    letterSpacing: "0"
  body-lg:
    fontFamily: "Google Sans"
    fontSize: "clamp(1.08rem, 2vw, 1.32rem)"
    fontWeight: "400"
    lineHeight: "1.48"
    letterSpacing: "0"
  body:
    fontFamily: "Google Sans"
    fontSize: "1rem"
    fontWeight: "400"
    lineHeight: "1.6"
    letterSpacing: "0"
  label:
    fontFamily: "Google Sans"
    fontSize: "0.78rem"
    fontWeight: "700"
    lineHeight: "1.1"
    letterSpacing: "0"
  caption:
    fontFamily: "Google Sans"
    fontSize: "0.82rem"
    fontWeight: "500"
    lineHeight: "1.45"
    letterSpacing: "0"
  metric:
    fontFamily: "Google Sans"
    fontSize: "clamp(2.4rem, 11vw, 7.4rem)"
    fontWeight: "700"
    lineHeight: "0.86"
    letterSpacing: "0"
  button:
    fontFamily: "Google Sans"
    fontSize: "0.95rem"
    fontWeight: "700"
    lineHeight: "1"
    letterSpacing: "0"

rounded:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  pill: "999px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  2xl: "64px"
  3xl: "96px"
  marketing-section-mobile: "72px"
  marketing-section-desktop: "112px"
  report-section-mobile: "88px"
  report-section-desktop: "120px"
  workspace-gutter: "20px"
  dashboard-gap: "16px"
  panel-padding-compact: "16px"
  panel-padding-comfortable: "24px"
  app-toolbar-height: "56px"

layoutModes:
  marketing:
    density: "3-5"
    posture: "expressive, spacious, brand-forward"
    maxWidth: "1200px-1440px"
    navigation: "persistent, elegant, conversion-aware"
  private-report:
    density: "4-6"
    posture: "mobile-first, editorial, executive"
    maxWidth: "1080px-1120px"
    navigation: "minimal or absent when scroll narrative is linear"
  app-workspace:
    density: "7-9"
    posture: "desktop-first, tool-like, fast comparison"
    maxWidth: "none; use full viewport"
    navigation: "persistent sidebar/topbar, command/search first"
  narrative-dashboard:
    density: "6-8"
    posture: "story plus controls; readable, explorable"
    maxWidth: "1200px-1440px"
    navigation: "contextual tabs, source drawers, export rail"
  data-chat:
    density: "6-8"
    posture: "conversation anchored to evidence"
    maxWidth: "split pane or full workspace"
    navigation: "chat composer, citations, source preview"

components:
  fluid-background:
    layer: "fixed canvas, z-index 0, pointer-events none"
    colors: "{colors.blob-red}, {colors.blob-cyan}, {colors.blob-dark}, {colors.blob-charcoal}"
    blur: "large gaussian blur inside low-resolution canvas"
    grain: "procedural noise overlay at low opacity"
    opacity: "0.55 to 0.72 depending on context"
    motion: "desktop only, very slow; static on coarse pointer"

  glass-card:
    backgroundColor: "rgba(255, 255, 255, 0.56)"
    border: "1px solid rgba(255, 255, 255, 0.66)"
    borderRadius: "{rounded.lg}"
    backdropFilter: "blur(20px) saturate(125%)"
    shadow: "0 22px 64px rgba(43, 43, 43, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.86)"
    padding: "{spacing.lg}"

  chart-surface:
    backgroundColor: "rgba(255, 255, 255, 0.56)"
    border: "1px solid rgba(255, 255, 255, 0.66)"
    borderRadius: "{rounded.lg}"
    backdropFilter: "blur(22px) saturate(125%)"
    minHeight: "300px mobile, 330px desktop"
    padding: "12px mobile, 18px desktop"

  primary-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    borderRadius: "{rounded.pill}"
    paddingX: "24px"
    paddingY: "14px"
    fontFamily: "{typography.button.fontFamily}"
    fontWeight: "{typography.button.fontWeight}"
    shadow: "0 10px 24px rgba(10, 10, 10, 0.14)"
    activeTransform: "scale(0.98)"

  toggle-button:
    backgroundColor: "rgba(255, 255, 255, 0.56)"
    activeBackgroundColor: "{colors.ink}"
    activeTextColor: "{colors.canvas}"
    border: "1px solid rgba(255, 255, 255, 0.68)"
    activeBorder: "1px solid {colors.ink}"
    borderRadius: "{rounded.pill}"
    paddingX: "14px"
    paddingY: "8px"
    backdropFilter: "blur(14px) saturate(120%)"

  section-eyebrow:
    backgroundColor: "{colors.surface-02}"
    textColor: "{colors.neutral-10}"
    borderRadius: "{rounded.pill}"
    paddingX: "14px"
    paddingY: "7px"
    fontFamily: "{typography.label.fontFamily}"
    fontWeight: "700"

  quote-critical:
    backgroundColor: "{colors.tension-soft}"
    borderColor: "{colors.tension}"
    textColor: "{colors.neutral-11}"
    borderRadius: "{rounded.lg}"

  quote-defender:
    backgroundColor: "{colors.positive-soft}"
    borderColor: "{colors.positive}"
    textColor: "{colors.neutral-11}"
    borderRadius: "{rounded.lg}"

  footer-panel:
    backgroundColor: "rgba(255, 255, 255, 0.52)"
    border: "1px solid rgba(255, 255, 255, 0.76)"
    borderRadius: "{rounded.xxl}"
    backdropFilter: "blur(24px) saturate(130%)"
    shadow: "0 22px 70px rgba(43, 43, 43, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9)"

  app-shell:
    backgroundColor: "{colors.canvas}"
    chromeBackground: "rgba(255, 255, 255, 0.72)"
    borderColor: "{colors.neutral-03}"
    sidebarWidth: "280px desktop, collapsed on narrow screens"
    toolbarHeight: "{spacing.app-toolbar-height}"

  source-drawer:
    backgroundColor: "rgba(255, 255, 255, 0.86)"
    border: "1px solid {colors.neutral-03}"
    backdropFilter: "blur(18px) saturate(120%)"
    width: "420px desktop, full-screen sheet on mobile"

  data-chat:
    userBubble: "{colors.ink} on {colors.canvas}"
    assistantBubble: "rgba(255, 255, 255, 0.68)"
    citationChip: "{colors.surface-02} with {colors.neutral-10}"
    composer: "glass input with attached send/action button"

  credit-wallet:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    accentColor: "{colors.signal}"
    borderRadius: "{rounded.xl}"

  export-bar:
    backgroundColor: "rgba(255, 255, 255, 0.74)"
    border: "1px solid rgba(255, 255, 255, 0.72)"
    backdropFilter: "blur(18px) saturate(125%)"
    actions: "share link, download PPT, duplicate, edit"
---

## Overview

Noisia makes social intelligence feel strategic, not decorative. The brand should look like someone found the useful signal inside a noisy public conversation and laid it out without theatrics.

The identity is built on four ideas:

- **White canvas first.** The page should feel breathable, editorial, and precise.
- **Atmosphere underneath.** Diffuse fluid color gives the work a living substrate without becoming the message.
- **Glass above signal.** Cards and charts sit on translucent surfaces so the system feels layered, not boxed.
- **Data with a human pulse.** Numbers are big, direct, and readable; quotes and cultural language keep the analysis grounded.

Noisia should never feel like a SaaS dashboard template, a generic agency landing page, or a corporate PDF. It should feel like a private intelligence artifact: personal enough to be sent in a DM, rigorous enough to start a boardroom conversation.


## Product Universe

This file is the brand system for all Noisia surfaces, not only a single report. The same visual DNA must stretch across:

- **Public website:** explains the category, builds trust, sells the promise, and shows Noisia's taste before anyone logs in.
- **Self-serve report builder:** lets a KAM, strategist, founder, or agency lead configure a research request without knowing exactly where to start.
- **Credit wallet:** supports a pay-per-event model where small budgets can unlock premium intelligence without enterprise friction.
- **Narrative dashboard:** turns raw social signal into a guided argument, with desktop depth for exploration.
- **Data workspace:** opens sources, tables, filters, segments, charts, and quote libraries without losing the thread.
- **Chat with data:** lets users ask for insights, challenge the analysis, request a different angle, and trace answers back to evidence.
- **Export artifacts:** shareable links, PPT downloads, client-ready snapshots, and private outbound freebies.

The brand should feel consistent across all of these, but density and spacing must change by mode. A public landing page can breathe. A paid dashboard must use space with more discipline. A private mobile report can be cinematic. A data workspace should feel calm and powerful, not sparse.


## Experience Modes

Noisia has five primary UI modes. Choose the mode before applying layout rules.

**Marketing mode** is brand-forward. It can use larger whitespace, stronger atmospheric backgrounds, immersive hero sections, richer scroll moments, and a persistent navigation system. It should sell clarity, not software complexity.

**Private report mode** is executive and narrative. It is mobile-first, readable in one sitting, and designed to be shared as a link. Navigation should be minimal. The report should feel authored.

**App workspace mode** is a tool. It is desktop-first, dense, fast, and operational. It needs persistent controls, compact panels, tables, filters, source drawers, saved states, and clear progress. It should make a confused KAM feel oriented in five minutes.

**Narrative dashboard mode** sits between report and workspace. It tells the story first, then lets the user drill into sources, edit framing, compare markets, and export. This is where Noisia feels most unlike a static report.

**Data chat mode** is conversational but evidence-bound. The assistant can be warm and useful, but every strategic answer must be traceable to sources, quotes, segments, or computed metrics.


## Colors

The palette has three active layers: canvas, signal, and tension.

**Canvas and neutrals**

Use `canvas` as the default page background. Use `neutral-11` for primary text, `neutral-10` for secondary text, and `ink` only for maximum emphasis: CTAs, active tabs, and high-confidence labels. Avoid pure black outside of `ink`.

**Signal colors**

`signal` cyan is the color of discovery. It belongs in active states, selected accents, positive chart moments, and subtle chromatic brand references.

`signal-dark` is the readable version of cyan. Use it for chart fills, small labels, progress, and UI where `signal` is too bright.

`positive` green is for proof from real users: peer validation, affinity, adoption, and grounded endorsement. Do not replace it with cyan; cyan is brand signal, green is behavioral proof.

**Tension colors**

`tension` red is the color of contradiction, urgency, and negative signal. It belongs in crisis lines, skeptical language, destructive frames, and market risk. It should not become the brand's main CTA color.

`tension-soft` is for quote cards and warning surfaces where the reader needs emotional context without visual alarm.

**Whisper**

`whisper` lavender is an auxiliary data color. Use it sparingly for secondary audience groups, never for primary UI actions.

**Atmospheric colors**

`blob-red`, `blob-cyan`, `blob-dark`, and `blob-charcoal` are not interface colors. They exist only inside the fluid background or generated atmospheric assets. Never apply them directly to text, buttons, icons, or card fills.


## Typography

Use **Google Sans or Product Sans only** across the site. No Inter, Roboto, Arial, serif pairing, or novelty display font. The brand voice needs one confident typographic system.

**Hierarchy**

Display headlines are large but not decorative. Use weight, line height, and whitespace instead of negative letter spacing. Letter spacing is always `0`.

Metrics use the `metric` style: bold, tight line height, and tabular visual rhythm. A metric should read in one glance on mobile.

Body copy should feel like a smart consultant talking plainly. Keep paragraphs under `65ch`; for mobile, prefer shorter sentence groups and strong rhythm over long blocks.

**Language rules**

Use sentence case or lowercase for visible headings. Avoid title case unless it is a formal product name or source label.

Write in Spanish LATAM when the artifact is in Spanish. Use `tú/te`, not `usted`, unless the document explicitly requires distance.

Avoid agency voice. Banned patterns include: "innovador", "disruptivo", "en un mundo cada vez más", "elevamos", "potenciamos", "soluciones integrales", and vague claims without proof.


## Layout

Noisia layouts are contextual. Private reports are mobile-first executive scrolls. The app is a desktop-first intelligence workspace. The public website is more expressive and brand-led. Do not apply one spacing rhythm to every surface.

**Page structure**

For report pages, use a centered page shell with `max-width` between `1080px` and `1120px`. Reading content should usually cap near `720px`.

For marketing pages, allow wider compositions up to `1440px`, asymmetric hero scenes, and larger image or canvas regions.

For app workspaces, use the full viewport. Prefer a persistent shell: sidebar, top toolbar, content canvas, optional inspector/source drawer. Avoid decorative spacing that makes the product feel empty.

Use vertical section spacing as a storytelling tool:

- Private reports: about `88px` mobile and `120px` desktop between major narrative sections.
- Marketing pages: about `72px` mobile and `112px` desktop, adjusted by visual asset scale.
- App dashboards: use `16px-24px` panel gaps and compact grouping. The workspace should feel efficient.
- Chat/data views: use conversation rhythm, not landing-page rhythm. Keep composer, citations, and evidence reachable.
- Never use huge blank gaps that require the reader to scroll through emptiness.

**Hero**

The hero should start near the top on mobile. Do not use `100vh` or vertically centered hero layouts on iOS. If a hero is tall, use controlled padding and let the document flow.

The first viewport should reveal the client/object clearly. For client reports, the client's logo or name should be a visible brand signal, not hidden in navigation chrome.

**Cards and grids**

Use cards for data modules, quotes, charts, and repeated strategic items. Do not wrap cards inside other cards unless the inner object is a real subcomponent like a quote or tooltip.

Dashboard summaries should be dense enough to scan. On mobile, small metric landscapes can use a `2 x 2` grid when each tile remains readable.

Avoid generic equal-weight feature grids. If the content has unequal strategic weight, the layout should show it.

**Tabs and controls**

Tabs can scroll horizontally on mobile, but shadows must not be clipped by the scroll container. Active states must be unmistakable: black fill, white text, strong border, and enough padding to feel tappable.


## Product Surfaces

### Public Website

The website is the front door. It should show the Noisia world: fluid signal, precise language, strong examples, and a clear path to run a report or request a deeper engagement.

The first screen should be an actual Noisia experience, not a generic hero with promises. Use real-looking report previews, data fragments, prompt examples, source cards, or animated intelligence flows. Marketing pages can be more spatial and cinematic than app pages, but they must still feel analytical.

Primary website CTAs should be concrete: "Crear reporte", "Ver ejemplo", "Hablar con Noisia", or a context-specific action. Avoid vague CTA text.

### Report Builder

The report builder is for someone who may not know how to ask the right research question. Design it like a guided strategy intake, not a blank form.

Core steps:

- Define the business question.
- Select market, timeframe, platforms, and language.
- Choose output type: quick snapshot, narrative dashboard, campaign read, category map, crisis scan.
- Preview estimated cost in credits.
- Run the job with clear progress states.

The builder should offer smart defaults, examples, and suggested research angles. A KAM arriving with a vague campaign request should feel assisted, not judged.

### Credit Wallet

Credits are part of the product experience. They should feel transparent and empowering, not like a hidden billing wall.

Show balance, estimated report cost, what the user receives, and when a run is charged. Use `signal` for available capacity and `tension` only when an action cannot proceed.

### Narrative Dashboard

The dashboard is not a wall of widgets. It is an argument with controls.

Start with the conclusion, then reveal supporting evidence. Every chart should answer a strategic question. Every drill-down should preserve context. Desktop can support advanced exploration: source drawer, filter rail, table view, quote library, export controls, and "ask the data" side panel.

### Data Workspace

The workspace is where users can do serious work after the first read. It can be denser than a report and should make room for:

- Tables with source rows, platform, market, sentiment, reach, and quote text.
- Filters for market, date, platform, audience, archetype, and topic.
- Source previews with original post metadata.
- Saved cuts and comparison views.
- Editable report blocks and regenerated insights.

Use borders, dividers, compact cards, and sticky toolbars. Avoid oversized presentation cards inside the workspace.

### Chat With Data

Chat is a thinking partner, not a novelty layer. It should help the user interrogate the report:

- "Qué insight puedo llevarle al cliente mañana?"
- "Dame el ángulo para Argentina, sin sonar alarmista."
- "Qué fuentes sostienen esta recomendación?"
- "Convierte esto en 3 slides para comité."

Responses must include citations or source chips when they make factual claims. The UI should make it easy to open the evidence behind an answer.

### Export And Sharing

Exports are product moments. A shared link, PPT download, or client snapshot should keep the same Noisia quality as the dashboard.

Use an export bar or compact share panel with clear actions: share link, download PPT, duplicate report, edit narrative, copy executive summary. Never bury export behind generic menus when the report is the thing users paid for.


## Elevation & Depth

Noisia depth is diffuse, not glossy. The system should feel expensive because it is calm, not because it glows.

**Layer 0: atmosphere**

Atmosphere lives as a fixed, pointer-event-free canvas behind the page. It uses procedural radial blobs, heavy blur, multiply blending, and low-opacity grain. On desktop, it can move very slowly. On touch devices, keep it static to avoid Safari viewport jump and battery cost.

Never use image backgrounds that dominate the text. The background should create pressure and mood; it must not compete with the analysis.

**Layer 1: content**

Text and charts sit above the atmosphere on a normal document layer. Maintain strong contrast. The background can be beautiful only if the content remains effortless to read.

**Layer 2: glass surfaces**

Glass cards use translucent white, a white inner highlight, and a broad low-opacity shadow. The formula is:

- `background: rgba(255,255,255,0.52-0.62)`
- `border: 1px solid rgba(255,255,255,0.66-0.76)`
- `backdrop-filter: blur(20px-24px) saturate(125%-130%)`
- `box-shadow: 0 22px 64px rgba(43,43,43,0.08), inset 0 1px 0 rgba(255,255,255,0.86)`

Do not use harsh drop shadows, neon glows, or dark overlay cards. If a shadow is visible as a hard shape, it is too much.


## Shapes

The system uses soft rectangles and pills, not decorative blobs for UI.

**Radius scale**

Use `8px` for small chips and accessibility affordances, `12px-16px` for compact inputs or tooltips, `20px-24px` for report cards, and `32px` only for large signature panels like footers.

**Pills**

Use pill radii for CTAs, active tabs, small labels, and progress capsules. Pills should have functional meaning. Do not turn every text label into a pill.

**Logos**

The Noisia logo can carry chromatic aberration. The rest of the interface should not imitate that effect too often. Treat it as a brand signature, not a texture.

**Icons**

Prefer simple SVG icons or brand assets. If an icon library is introduced, standardize one library and one stroke weight per product.


## Components

### Fluid Background

Use code-generated canvas for living reports and premium microsites. Use static render or plain white for high-stakes mobile delivery if motion affects readability. Motion must be decorative and never tied to touch, scroll position, or pointer movement on mobile.

### Glass Card

The default Noisia report surface. Use for chart modules, data cards, quote groups, timeline steps, and footer panels. Pair it with real content density. A glass card with only filler text looks like decoration.

### Chart Surface

Every chart needs axes or labels when the shape alone is not enough. Mobile charts should use the full card width, visible light-gray axes, and numbers when the chart communicates magnitude. Do not show decorative sparklines if the reader needs to compare values.

### Metric Tile

Structure: label, metric, submetric, optional mini visual. The metric should be the visual anchor. Keep one idea per tile.

### Toggle Group

Use when each tab reveals a genuinely different angle. If a toggle only restyles the same insight, remove it. Active tabs are black pills with white text; inactive tabs are translucent white with neutral text.

### Quote Card

Quotes are evidence, not decoration. Use `tension-soft` for skepticism or misinformation. Use `positive-soft` for user proof. Preserve the social texture of the quote, but clean obvious typos when the document already uses edited quotes.

### CTA

Use a single black pill CTA. The CTA should be concrete: "Agendar 20 minutos" beats "Conversemos". If the asset is 1-to-1 outbound, avoid lead forms, downloads, and generic conversion language.

### App Shell

The app shell is persistent and quiet. Use a left sidebar or compact top navigation for report history, credits, account, and workspace switching. Keep chrome translucent only when it helps depth; dense app areas can use solid white with subtle borders.

The shell should always show where the user is: configuring, running, reading, exploring, editing, exporting, or chatting.

### Source Drawer

Source drawers are essential to trust. They should open from the side on desktop and as a full-screen sheet on mobile. A source drawer contains original text, platform metadata, date, market, tags, sentiment, and why the source matters.

### Data Chat Composer

The composer should support normal questions and action prompts. It can include quick chips like "resumir", "buscar contradicciones", "hacer slide", "abrir fuentes", and "comparar mercados". Do not overload the composer with decorative prompts.

### Footer

The footer is a final brand impression, not a list. Use a large glass panel, Noisia logo, one sentence of context, and a compact metadata grid. It should feel like the back cover of a private report.

### Scroll Reveal

Use scroll reveal as pacing, not spectacle. Animate `transform` and `opacity` only. Reveal sections early enough that the reader never sees a dead blank screen. Stagger children around `60ms-80ms`. Respect `prefers-reduced-motion`.


## Do's and Don'ts

**Do:**

- Use Google Sans or Product Sans everywhere.
- Keep the page light, white, and breathable.
- Let the fluid atmosphere sit behind the content with low opacity.
- Use cyan for insight, red for contradiction, green for proof, and lavender only for secondary data.
- Make active tabs visually decisive.
- Give mobile charts enough width, axes, and labels to be legible.
- Treat quotes as evidence and metrics as argument.
- Write like a sharp analyst speaking to one specific person.
- Keep motion slow, subtle, and respectful of mobile constraints.
- Test on mobile Safari or an equivalent narrow viewport before shipping.
- Change density by product mode; do not make every Noisia surface feel like a mobile report.
- Keep app workspaces compact enough for real analysis.
- Make report generation feel guided, priced clearly, and reversible before purchase.
- Attach evidence to chat answers and strategic recommendations.
- Treat export flows as first-class product surfaces.

**Don't:**

- Do not use navbar chrome on single-page outbound reports unless it solves a real navigation problem.
- Do not use "lead magnet" language for 1-to-1 outreach.
- Do not use pure black for body text.
- Do not let card shadows get clipped by scroll containers.
- Do not use backgrounds that re-render or jump on touch.
- Do not use a toggle unless the alternate view changes the reader's understanding.
- Do not over-explain frameworks in the UI. Demonstrate the method through the analysis.
- Do not use generic agency phrases, placeholder strategy, or abstract recommendations.
- Do not apply blob colors directly to buttons or text.
- Do not compress vertical rhythm so much that the report feels like a dashboard dump.
- Do not apply private-report section spacing to dashboards, chats, builders, or admin screens.
- Do not make the app feel empty in the name of premium whitespace.
- Do not let chat invent insight without exposing the underlying evidence.
- Do not hide pricing or credit consumption behind vague language.
