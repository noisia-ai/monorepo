# Methodology — how a study earns its truth

> The criteria rulebook. `LAYOUTS.md`, `COPY_RULES.md` and `ICONS.md` govern how a deck **looks
> and reads**. This one governs how it **gets its content**: sourcing, what the data has to survive
> before you trust it, how T&B is tagged, and the provenance record that lets the kit evolve.
> A study that skips this is a nice-looking deck with numbers nobody can defend.
>
> **Boundary:** this file says *what you may claim and how strongly*. `DATA.md` says *how the
> processing is executed* — inventory, streaming ETL, quality gates, output contracts. When you
> are at the keyboard with the export open, you want `DATA.md`. `CANON.md` orders both.
>
> Client-safe by design: everything here is generic. Real inputs, numbers and verbatims live
> in `examples/_local/<study>/` (gitignored), never in a tracked file.

## The pipeline

```
brief → scope decisions → listening queries → ETL (streaming) → T&B tagging → verbatims
      → build deck (LAYOUTS/COPY/ICONS) → render-verify slide by slide → PDF → provenance record
```

Advisor before builder: close scope with the client, agree what to listen for, run the ETL once
over the right thing, then build. Never start slides before the corpus is real.

## 1. Sourcing — SentiOne LQL (or any listening tool)

Reference: `https://listen.help.sentione.com/reference/listen-query-language`. Supported:
`AND` / `OR` / `NOT`, parentheses, `"exact phrases"`, wildcard `*` (prefix, min 4 chars). **No
NEAR/proximity.** Language/country/window/sources are set in the UI, **never** as boolean clauses.

Hard rules, learned the hard way:
- **Exploratory mode for T&B: `ANCHOR AND NOT NOISE`.** Never gate discovery on theme phrases
  ("me convenció", "me frena"). Triggers/barriers are tagged *after* ingest, not queried for.
  Gating on themes pre-decides the answer and kills the finding.
- **One independent pack per competitor.** Never merge competitors into one query. Each gets its
  own `entity_key` and its own CSV.
- **Contextualize every homonym.** Bare brand/category words that collide with common language
  must carry a disambiguating anchor (rental context, market, `Mexico`, etc.) or the corpus fills
  with noise. Add a `NOT (...)` list of the known collisions preemptively.
- **A shared NOISE list.** For the category anchor, exclude the obvious off-domain senses up front
  (e.g. the housing/tax/objects senses of a rental word) and say what you cut.
- **Accents are not documented, so cover both spellings.** The LQL reference says nothing about how
  accented characters are matched. Assume they are not folded: every accented term goes in twice,
  with and without the accent, or half a Spanish-language corpus never shows up.
- **Wildcards are prefix only, ≥4 chars.** `rent*` catches rent/renta/rental/rented; pair it with a
  subject anchor so it doesn't catch unrelated words.

## 2. Data reality checks — before you trust the corpus

Run these every time. Most "insights" die here, and that's the point.

- **Full export vs sample.** Confirm whether the CSV is the whole universe or a filtered sample.
  Cross-check row counts against the platform's own totals (the tool's mention count + channel
  breakdown screenshot). The screenshot totals are the real numbers; the CSV may be a slice.
- **Streaming ETL, never a blender.** Files run to hundreds of MB with newlines inside content.
  Iterate row by row; never materialize the list. You are an LLM, not BERTopic: induce the theme
  taxonomy by *reading* a well-chosen sample, then let proxies bucket + count. Counts are
  directional unless they were validated; the curated verbatims are the deliverable. Mechanics,
  encodings and the reproducible-sample rules: `DATA.md` §4 and §13.
- **Noise contamination.** A hot news cycle can hijack a category term and inflate volume and
  sentiment (a political/PR wave riding a category keyword is the classic). Classify consumer vs
  off-topic, report the split, and cut the off-topic loudly. Silent truncation reads as "we covered
  everything" when we didn't.
- **Language / geo skew.** Blank country is normal (social geo is incomplete) — don't drop it.
  Watch for foreign-market spillover on shared-language terms; keep the in-market plurality.
- **Brand silence is a finding.** If the subject brand is near-invisible in-market (its mentions are
  foreign brand noise), that's not a dead end — it's white space. Say it plainly and build on it.

## 3. Channel roles — chart the "where", name the "why"

Which platform carries the conversation is itself an insight, and clients ask for it. Chart the
share, then give each channel its **role**, grounded in what the verbatims on it actually do. A
recurring shape (varies by market): the mass/debate channel, the how-to/decision channel, the
research channel, the complaint channel, and the foreign-planner channel. See the channels slide in
`LAYOUTS.md` (study addendum).

## 4. T&B tagging — double-coding × 4 layers

- Each expression is coded **twice**: push/pull, and which of the four layers it lives in
  (psychological / personal / social / cultural). Tag *post-ingest*, never in the query.
- **Permission to act:** a brand moves psychological + personal fully, social partially, and only
  *aligns* with cultural.
- **The cultural layer is defined by normative language, not by category vocabulary.** In a craft
  textile category, `artesan*`, `telar`, `bordado` and `tradición` are the *subject*, not a cultural
  motive: the whole corpus talks that way. What makes an expression cultural is the language of
  norms, appropriation, plagiarism, fair pay, authorship, royalties, heritage, who has the right to
  use what. Applying that distinction took one study's cultural layer from 1,607 mentions to 259,
  and only then did it mean anything.
- **If one category of the scheme takes more than half the corpus, the dictionary is wrong, not the
  corpus.** Check the rules before reporting. It has now happened twice, in two different
  methodologies: a cultural layer at 62% and an effort category at 81%, both caused by rules that
  were broader than their neighbours. This is the same check as the single-label guard in
  `DATA.md` §15, arriving from the other direction. The "where to act" kanban falls straight out of this.
- **Verbatims are real, linked, and sourced** (platform mark + date + link to the post). Never
  invent one. Imperfections stay — they're information.

## 4.5 Before any count goes on a slide

Run the quality gates in `DATA.md` §21. A study does not move to deck while a gate that affects
its main conclusion is failing, and a count without formal validation is called **directional**,
using that word. The evidence hierarchy (`DATA.md` §20) decides the verb: *shows* vs *suggests*.

## 5. Provenance + changelog — how the system evolves

Every study keeps a `PROVENANCE_AND_CHANGELOG.md` in its local folder (`examples/_local/<study>/`).
Start from `templates/PROVENANCE_AND_CHANGELOG.md` and fill it as you work, not at the end.
It's the memory that makes the next study better and lets anyone reconstruct a number months later.
Minimum contents:

1. **Sources consumed** — every input file (briefs, brand decks, transcripts), the listening
   queries run, the corpus totals + channel mix per query, and which engine/kit version built it.
2. **Scope decisions** — the calls that shaped the study (agnostic vs brand, which markets/langs,
   window, the narrative spine, framing) and why.
3. **Method notes** — what was cut as noise, how themes were induced, any caveats on the numbers.
4. **Deck structure** — the slide list.
5. **Changelog** — edits after the first cut, as `v1 → v2` before/after with the reason. Client
   edits count: they teach the kit what the real audience wants.

## 6. Where things live

- **Tracked (public):** the kit — engine, builders, `slides/`, and the four rulebooks
  (`LAYOUTS` · `COPY_RULES` · `ICONS` · this file). Generic templates only.
- **Gitignored (`examples/_local/<study>/`):** the real deck, the raw data, and the provenance
  record — anything with client names, real numbers, or verbatims. Per `AGENTS.md` rule 1, none of
  that ever enters a tracked file.

## The prompting system

The entry-point prompt (a study handoff), these four rulebooks, and each study's provenance record
form a loop: the prompt starts a run, the rulebooks constrain it, the provenance record captures what
was learned, and that feeds the next prompt. Keep the loop closed and the kit compounds.
