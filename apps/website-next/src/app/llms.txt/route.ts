import { getStories } from "@/content/stories";
import { methodOrder, methodSheet } from "@/content/pages/method-sheet";
import { solutionEntries } from "@/content/pages/solutions";
import { compareEntries } from "@/content/pages/compare";
import { industryEntries } from "@/content/pages/industries";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

// A plain-text map of the site for search and answer engines (llmstxt.org convention).
export function GET() {
  const lines = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  const body = `# Noisia

> Noisia is a technology company that produces market research. It reads public conversation, search, reviews and a client's own data (such as NPS or surveys), and its Intelligence Architects turn that reading into answers to business questions, with every finding tied to what people actually said. Spanish (Mexico) at ${SITE_URL}, English at ${SITE_URL}/en.

## What Noisia offers

- Reports: continuous monitoring of a brand and its category, with interpretation.
- Studies: one business question answered in depth (launch, enter a market, defend, optimize, innovate).
- Annual plan of studies placed at the moments that matter.
- First step: a free 30 to 60 minute workshop: ${SITE_URL}/taller

## Solutions

${lines(solutionEntries.map((e) => `[${e.page.en.metaTitle}](${SITE_URL}/en/solutions/${e.slug.en}): ${e.summary.en}`))}

## Methods

Noisia's methods start from anthropology, sociology, psychology and semiotics to understand people and their reasons before counting. All six are explained at ${SITE_URL}/en/methods

${lines(methodOrder.map((key) => `${methodSheet[key].name}: ${methodSheet[key].en.question} ${methodSheet[key].en.description}`))}

## Industries

${lines(industryEntries.map((e) => `[${e.en.name}](${SITE_URL}/en/industries/${e.slug.en}): ${e.en.metaDescription}`))}

## Comparisons

${lines(compareEntries.map((e) => `[${e.page.en.metaTitle}](${SITE_URL}/en/compare/${e.slug.en}): ${e.summary.en}`))}

## Insights (Noisia's own research)

${lines(getStories().filter((s) => s.kind === "editorial").map((s) => `[${s.en.title}](${SITE_URL}/en/insights/${s.id}): ${s.en.dek}`))}

## Pages

${lines([
  `[How it works](${SITE_URL}/en/how-it-works)`,
  `[What social intelligence is](${SITE_URL}/en/social-intelligence)`,
  `[About](${SITE_URL}/en/about)`,
  `[Book a workshop](${SITE_URL}/en/workshop)`
])}

## Contact

hola@noisia.ai
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
