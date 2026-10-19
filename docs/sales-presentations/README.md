# Noisia sales presentations

Slide-by-slide copy for the three outreach decks, EN and ES (Mexican Spanish, professional, English kept for technicisms). Written to read like a person, not a template.

| File | When to send | Lead temp | Slides |
|------|--------------|-----------|--------|
| [01-informative-opener.md](01-informative-opener.md) | Lead already knows us, talked before | Warm | 9 |
| [02-outbound-opener.md](02-outbound-opener.md) | Cold lead, paired with a Loom video | Cold | 9 |
| [03-commercial-offer.md](03-commercial-offer.md) | Warm lead, overview + pricing | Warm | 7 |

## Conventions
- `[BRAND]` and `[INDUSTRY]` are placeholders. Swap in the real ones before sending.
- The value proposition line is identical across all three so the brand voice stays consistent.
- Worked examples use RTD beverages only to show tone. Delete or replace them per lead.
- Pricing: 300 USD is a hook (decks 1 and 2). Deck 3 shows the real structure (975 / 375 / 775 USD with scope factors).
- The six methods and the use-case menu mirror the live site (`apps/website/src/content/site.ts`) and the services page, so the decks and the website say the same thing.

## What to automate through the platform
The lead-specific copy is Slides 2, 3 and (partly) 8 in decks 1–2, and Slide 2 in deck 3. These are the slides worth generating automatically from the company + industry context:

1. **Slide 2 (punch line / question).** Take the strongest signal from a quick read of the lead's category and phrase it as one line. Two templates already in the files: a statement for warm leads, a question for cold ones.
2. **Slide 3 (2–4 insights).** Pull the top objection, the competitive-migration signal, and the cultural-permission gap from the same read. Cap at four, rank by relevance to the brand.
3. **Slide 8 / Slide 2-offer (study menu and proposal).** Match the use cases to what the lead's category actually needs, instead of listing all of them.

A realistic build: feed the company name and industry to a short pipeline that runs a light read, then fills these three slots from the report. Slide 2 and 3 are the high-value, low-risk place to start; the proposal slide can follow once the read is trustworthy enough to auto-rank use cases.
