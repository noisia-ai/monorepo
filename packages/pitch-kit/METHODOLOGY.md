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
  with and without the accent, or half a Spanish-language corpus never shows up. One case saw the
  tool fold accents; until a controlled test settles it, both spellings still go in, since it
  costs nothing.
- **The unaccented variant can be a word of another language.** In a Portuguese query, `diaria`,
  `salario` and `migrantes` without their accents are Spanish words, and they brought in more
  Spanish (7,885) than Portuguese (2,386). When a query covers a language that shares roots with
  another, the ETL filters by detected language or by country for that export.
- **An exact phrase of two common words does not guarantee their order.** A two-word brand
  phrase brought back home remedies "at home" and a party in another country: 9 of 28 rows of the
  brand query were noise from that branch. When the phrase is common language, add an anchor that
  cannot be anything else (handle, domain, address), or leave it out and recover it after ingest.
- **Wildcards are prefix only, ≥4 chars.** `rent*` catches rent/renta/rental/rented; pair it with a
  subject anchor so it doesn't catch unrelated words.
- **Porting the client's booleans from another tool.** When the client already has queries built
  in another listening tool, reuse their logic but clean it before pasting: drop section comment
  markers (`<<<...>>>`), turn `-(...)` into `NOT (...)`, expand single-character wildcards (`?`) by
  hand, and remove field operators (`title:`, `author:`, `site:`, `subreddit:`, `url:`,
  `engagingWith:`) and every proximity operator. None of them parse.
- **"Invalid query format" does not say where.** Split the query in halves and paste each half
  until the broken clause shows up. In practice it is almost always a leftover `NEAR` or a field
  operator.
- **One query per client subcategory, each anchored to the brand.** When the study will be compared
  against a client metric with its own categories, each query is `(brand anchor) AND (that
  subcategory's terms)`, so every export maps to one client category. The overlap between those
  exports is measured and deduplicated after ingest (`DATA.md` §9), never by merging queries.

- **`rawText:` demands the subject in the post's own text, at collection time.** In one study 74%
  of the main query's rows carried the anchor only in the parent post, and the export weighed
  1.42 GB. Wrapping **only the anchor** in `rawText:(...)` in Advanced Query fixed it; the context
  can still come from the parent, which is what lets "mine is X" under a category post come in.
  Two warnings, both confirmed: **Advanced Query ignores the interface's language and country
  filters** (with Spanish and Mexico ticked, 901 of 1,535 mentions came back in English and 3,407
  of a category query in Portuguese), so the ETL resolves language and market every time; and the
  gate C check in the ETL stays as the net. A "with and without country" capture does not catch
  this, since both give the same total; the language and country profile of the first export does.
- **TikTok: one word per rule.** Two-word rules ("brand + match") returned 16,286 rows, of which 53
  named the brand. TikTok carries no country (resolve it in the ETL), its counts are not compared
  with other sources, and a brand name that is noise on its own in every language stays out; its
  product-line names go in.
- **Every non-unique term carries a territorial anchor.** Unique names go alone; common words,
  acronyms and process terms ("candidate", "2027", a party acronym that is also a common noun) only
  next to an anchor of the territory. Without it, two party queries brought 292 thousand mentions
  from the whole country in six weeks; anchored, 55 thousand.
- **Several markets in one study** add their own rules: one `AND` per query, the country's anchors
  inside the query rather than the tool's country filter, no language filter, one query per
  business question, and exports split by moment. See `DATA.md` §26.

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
- **Read the cultural dictionary against the corpus domain, not only against the subject.** A
  second failure mode showed up in a public-safety-heavy corpus: `patrimonio` was a criminal
  category and `identidad` came from prosecutors' records. Both words look cultural and neither
  was. Before a term goes into the cultural layer, sample where it actually appears.
- **The cultural layer is defined by normative language, not by category vocabulary.** In a craft
  textile category, `artesan*`, `telar`, `bordado` and `tradición` are the *subject*, not a cultural
  motive: the whole corpus talks that way. What makes an expression cultural is the language of
  norms, appropriation, plagiarism, fair pay, authorship, royalties, heritage, who has the right to
  use what. Applying that distinction took one study's cultural layer from 1,607 mentions to 259,
  and only then did it mean anything.
- **No default layer, literal evidence, and `unclear` allowed.** A codebook that sent every
  accusation to "psychological" by default put 71% to 78% of the mentions in one layer, with a
  κ of 0.43 against a blind second coder. Recoded with no default, a literal fragment required
  as evidence for each layer and `unclear` as a valid answer: κ 0.85 on the dominant layer, and
  the largest layer at 44%. A mention without evidence of a layer stays without a layer; it is
  reported apart, never spread across the four.
- **When the query is the vocabulary of the problem, the balance of direction is partly the
  query's.** A corpus collected with the words of an accusation (child labour, exploitation,
  boycott) will come back mostly barrier. Say it on the slide that shows the balance, and where
  possible compare against the brand's own baseline: how much of everything said about the brand
  is about this at all. That ratio was the strongest number of the study where it happened.
- **When the subject is an alternative, a barrier to the conventional product is a trigger toward
  it.** Rejecting conventional antiperspirant for health reasons is a barrier relative to its own
  target, and the reason to buy the natural one. Record the target (`alternative` or
  `conventional`) and read the rejection of the conventional as a push toward the alternative.
- **Motives that can point both ways go in both directions from the start.** In sunscreen, "it
  damages reefs and cenotes" had no barrier code, because the environment only existed as a push.
  Agents split it between no motive and safety until it was unified after the fact.
- **If one category of the scheme takes more than half the corpus, the dictionary is wrong, not the
  corpus.** Check the rules before reporting. It has now happened twice, in two different
  methodologies: a cultural layer at 62% and an effort category at 81%, both caused by rules that
  were broader than their neighbours. This is the same check as the single-label guard in
  `DATA.md` §15, arriving from the other direction. The "where to act" kanban falls straight out of this.
- **A topics layer beside the two axes, in a paid study.** T&B says why and where a motive lives;
  topics say what people talk about. Without them there is no "topics by channel" and no good "in
  real life" slide. Topics are coded by two agents like the axes, and never added to them. The
  approved version of one paid study needed this layer to turn the T&B into a drill-down.
- **Verbatims are real, linked, and sourced** (platform mark + date + link to the post). Never
  invent one. Imperfections stay — they're information.

## 4.6 Coding with agents, and reading by sample

What held up across three markets:

- **An explicit codebook in a file**: theme, relevance, subtheme, tone, level (for football:
  national team, local league, Europe), language, translation, quotable or not, brand mentioned.
- **Batches of about 200 posts per agent**, JSONL output validated against the input: same line
  count, same ids, same order, every key present. Assigning codes with a keyword script is not
  coding and is not allowed.
- **Two samples with two jobs.** A random sample fixes precision and volume per theme (posts that use
  the theme's words × the share that really talk about it, with a Wilson interval in the internal
  record). A focus sample, matched on a strict experience pattern, is used only for subthemes, tone
  and quotes.
- **A pilot batch, blind-recoded, before the agents run.** One batch of about 200 coded by an
  agent and recoded blind by another, with κ per axis. Only when it passes do the other batches
  launch. In one study the pilot passed relevance (κ 0.80) and direction (κ 0.93), and the layer,
  checked the same way after the fact, failed at 0.43: checking it on the pilot would have saved a
  full recode.
- **Below about 20 mentions read, a theme is not shown as a percentage**, unless the whole corpus was
  read. With a census the percentage is real and it goes on the slide.
- **Subthemes are their own layer.** The share of a subtheme inside its theme comes from the reading;
  the monthly curve and the channel split come from the full corpus by word rule (or from the
  reading, in a census).
- **Brands are counted behind a double gate**: a term from the topic and a signal from the country.
  Without it, a record book and a city that share a beer's name inflated the counts.
- **Day of the week.** When the question arrives, the useful answer is a heatmap of theme × day,
  crossed with the fixture. The finding there was that conversation follows the calendar of matches,
  not a weekly ritual.
- **Intensity of a moment**: posts per day inside the event window against regular days, over the
  months with data. It lets a deck say "the tournament ran at N times its usual pace" without depending on the size of
  the download.

Agents share the scratch folder, and they overwrote each other's helper files twice, in two
studies. **Give each agent its own folder**, and have the merge validate ids, order and allowed
values batch by batch before anything is added up; that check is what caught it the second time. Agents also return truncated or positional ids in their
summaries, so **quotes are always resolved against the file, never against the summary**. Quotes in
the original language are picked from the unfiltered exports (so local voice is not lost), verified
as a literal substring of the text, and, for X, against their source. Quotes or pieces carrying the
names of private people are trimmed or dropped.

## 4.5 Before any count goes on a slide

Run the quality gates in `DATA.md` §21. A study does not move to deck while a gate that affects
its main conclusion is failing, and a count without formal validation is called **directional**,
using that word. The evidence hierarchy (`DATA.md` §20) decides the verb: *shows* vs *suggests*.

## 4.7 Search and paid media, the two layers beside the conversation

Both paid studies of October used them, and in both they produced a central finding: what people
search, what they talk about and what brands advertise are three different maps, and the gaps
between them are what a media team can act on ("searched, not talked about"). They are standard
layers of a paid study now. Neither is coded in T&B, and neither is added to the corpus.

**Search** (Searchbuzz for volume in ranges, 48-month series and Share of Search; Google Trends for
daily and hourly series and lift against control days):
- an anchor term rescales between batteries; it does not measure peaks of small terms;
- topics, not single terms; a mean of at least 10 before a series is read;
- control for the day of the week; one capture per query, kept in the case folder;
- evidence levels: proxy for interest, directional for a comparison, exploratory for a new term;
- the reproducible extraction: the URL builds the search
  (`/keywords?platform=&query=&country=&language=`), wait for it to load, press Export (a download:
  ask first), move the CSV to the case folder; the monthly series, which Export leaves out, is read
  off the page; Share of Search exports its pie and its trend separately. TikTok comes without
  volume, some seeds return nothing, and the same tool covers Mercado Libre, Amazon, Walmart and
  Perplexity, useful for purchase-intent searches. Sending page data to a local receiver is blocked
  in the in-app browser and flagged as exfiltration: do not try it.

**Paid media** (the public ad libraries), coded against the same client hypotheses, so the study can
set what brands promise against what people ask for. What each library keeps, verified on
16 Oct 2026 in public browsing; re-check the date before relying on it:

| Library | Outside the EU and UK |
|---|---|
| Meta Ad Library | only **active** commercial ads, no history; its API does not cover them |
| Google Ads Transparency Center | history by country and date range |
| TikTok Ad Library | does not cover Mexico |

If the study period is over, Meta's paid media is a snapshot of the day of the query, and it is
said that way. Creatives are downloaded from the public DOM (the image URL or the video poster of the
chosen cards, from the CDN, with download permission), with each one's Library ID recorded. They
pass the same Quality Gate as the gallery (`LAYOUTS.md`): in one study, three of six fell out.

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
