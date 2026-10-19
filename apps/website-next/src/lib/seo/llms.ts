import "server-only";
import type { Block } from "@/content/pages/types";
import { about } from "@/content/pages/about";
import { workshop } from "@/content/pages/workshop";
import { offer } from "@/content/pages/offer";
import { situationCopy } from "@/content/pages/solutions";
import { situationDetails } from "@/content/pages/situation-details";
import { methodOrder, methodSheet } from "@/content/pages/method-sheet";
import { methodsPage } from "@/content/pages/methods";
import { howItWorks } from "@/content/pages/howItWorks";
import { socialIntelligence } from "@/content/pages/socialIntelligence";
import { compareEntries, compareUi } from "@/content/pages/compare";
import { industryEntries } from "@/content/pages/industries";
import { moments } from "@/content/moments";
import { insightsReports } from "@/content/reports/reports";
import { getStories } from "@/content/stories";
import { ORG_EMAIL, ORG_SAME_AS, SITE_UPDATED, absoluteUrl, type Lang } from "./config";
import { seoPage } from "./pages";

/**
 * Plain-text versions of the site for answer engines (llmstxt.org convention). Everything here
 * is read from the same content files the pages render, so the text never says more than the
 * site does. llms.txt is the map; llms-full.txt carries the full text of the key pages.
 */

const url = (id: string, lang: Lang) => {
  const page = seoPage(id);
  return page ? absoluteUrl(page[lang].path) : absoluteUrl(id);
};

const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
const qa = (items: { q: string; a: string }[]) => items.map((item) => `Q: ${item.q}\nA: ${item.a}`).join("\n\n");
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join("\n\n");

function blockText(block: Block, level: string): string {
  const head = "title" in block && block.title ? `${level} ${block.title}` : "";
  switch (block.type) {
    case "text":
      return join(head, ...block.paragraphs);
    case "cards":
    case "steps":
      return join(head, "lead" in block ? block.lead : "", bullets(block.items.map((item) => `${item.name}: ${item.text}`)));
    case "faq":
      return join(head, qa(block.items));
    case "callout":
      return join(head, block.text);
    case "quote":
      return block.source ? `"${block.text}" (${block.source})` : `"${block.text}"`;
    case "table":
      return join(head, block.lead, bullets(block.rows.map((row) => row.map((cell, i) => `${block.headers[i] ?? ""}: ${cell}`).join("; "))));
    case "links":
      return join(head, bullets(block.items.map((item) => `${item.label}${item.text ? `: ${item.text}` : ""} (${absoluteUrl(item.href)})`)));
    default:
      // CTAs and animations carry no information beyond the page text.
      return "";
  }
}

const labels = {
  en: {
    intro: "Noisia is a technology company that produces market research and brand monitoring from what people say in public: social media, search, reviews, forums and a client's own data such as NPS or surveys. Our software reads the whole conversation and an Intelligence Architect, a person trained in research and the social sciences, defines the question, approves the topics, interprets with a method and signs off the answer. Every finding links back to the mentions that support it.",
    facts: ["Conversation read in 16 languages.", "More than 20 countries across the Americas, Europe and Africa.", "Days from the brief to the first answer.", "First step: a free 30 to 60 minute workshop."],
    sections: {
      about: "About Noisia",
      offer: "What you receive",
      situations: "Situations we solve",
      how: "How we solve it",
      compare: "Compared with",
      deliverable: "What you receive",
      faq: "Frequently asked questions",
      methods: "Methods",
      library: "The six methods",
      builtOn: "Built on",
      howItWorks: "How it works",
      social: "What social intelligence is",
      comparisons: "Comparisons",
      industries: "Industries",
      questions: "Questions we can answer",
      where: "Where the conversation lives",
      workshop: "Workshop",
      insights: "Insights: Noisia's own research",
      reports: "Reports (published in Spanish)",
      stories: "Short findings",
      contact: "Contact",
      method: "Method",
      criteria: "Point by point",
      when: "When each one makes sense"
    }
  },
  es: {
    intro: "Noisia es una empresa de tecnología que produce investigación de mercado y monitoreo de marca a partir de lo que la gente dice en público: redes sociales, búsquedas, reseñas, foros y los datos propios de cada cliente, como NPS o encuestas. Nuestro software lee la conversación completa y un Intelligence Architect, una persona con formación en investigación y ciencias sociales, define la pregunta, aprueba los temas, interpreta con un método y firma la respuesta. Cada hallazgo se puede abrir hasta las menciones que lo sostienen.",
    facts: ["Conversación leída en 16 idiomas.", "Más de 20 países en América, Europa y África.", "Días desde el brief hasta la primera respuesta.", "Primer paso: un taller gratis de 30 a 60 minutos."],
    sections: {
      about: "Sobre Noisia",
      offer: "Lo que recibes",
      situations: "Situaciones que resolvemos",
      how: "Cómo lo resolvemos",
      compare: "Frente a",
      deliverable: "Lo que recibes",
      faq: "Preguntas frecuentes",
      methods: "Métodos",
      library: "Los seis métodos",
      builtOn: "Se apoya en",
      howItWorks: "Cómo funciona",
      social: "Qué es la inteligencia social",
      comparisons: "Comparaciones",
      industries: "Industrias",
      questions: "Preguntas que podemos responder",
      where: "Dónde vive la conversación",
      workshop: "Taller",
      insights: "Insights: investigación propia de Noisia",
      reports: "Reportes",
      stories: "Hallazgos cortos",
      contact: "Contacto",
      method: "Método",
      criteria: "Punto por punto",
      when: "Cuándo conviene cada una"
    }
  }
};

function fullSection(lang: Lang): string {
  const l = labels[lang].sections;
  const o = offer[lang];
  const m = methodsPage[lang];
  const h = howItWorks[lang];
  const s = socialIntelligence[lang];
  const cu = compareUi[lang];
  const w = workshop[lang];
  const a = about[lang];

  const aboutText = join(`## ${l.about}`, `Source: ${url("/nosotros", lang)}`, a.title, a.lead, ...a.blocks.map((b) => blockText(b, "###")));

  const offerText = join(
    `## ${l.offer}`,
    `Source: ${url("/soluciones", lang)}`,
    o.title,
    o.lead,
    ...([o.report, o.study, o.plan] as const).map((p) => join(`### ${p.name}`, p.promise, p.text)),
    join(`### ${o.formats.title}`, o.formats.lead, bullets(o.formats.items.map((item) => `${item.name}: ${item.text}`))),
    blockText(o.start, "###"),
    join(`### ${o.faq.title}`, qa(o.faq.items))
  );

  const situationsText = join(
    `## ${l.situations}`,
    ...moments.map((moment) => {
      const key = moment.slug.es;
      const d = situationDetails[key]?.[lang];
      const faq = situationCopy[key]?.[lang].faq ?? [];
      return join(
        `### ${moment[lang].name}`,
        `Source: ${url(`/soluciones/${key}`, lang)}`,
        moment[lang].question,
        d?.summary ?? moment[lang].summary,
        d &&
          join(
            `#### ${d.howTitle}`,
            ...d.steps.map((step, i) => `${i + 1}. ${step.title}. ${step.text}${step.method ? ` (${l.method}: ${methodSheet[step.method].name})` : ""}`),
            `#### ${d.compare.title}`,
            bullets(d.compare.rows.map((row) => `${row.label}. ${d.compare.them}: ${row.them}. Noisia: ${row.us}.`)),
            `#### ${d.deliverable.title}`,
            bullets(d.deliverable.items.map((item) => `${item.name}: ${item.text}`))
          ),
        faq.length ? join(`#### ${l.faq}`, qa(faq)) : ""
      );
    })
  );

  const methodsText = join(
    `## ${l.methods}`,
    `Source: ${url("/metodos", lang)}`,
    m.hero.title,
    m.hero.lead,
    join(`### ${m.number.title}`, m.number.lead),
    join(`### ${m.layers.title}`, m.layers.lead, bullets(m.layers.items.map((item) => `${item.name}: ${item.text} ${item.move}`))),
    join(`### ${m.weight.title}`, m.weight.lead, `${m.weight.levelsTitle}:`, bullets(m.weight.levels.map((level) => `${level.name}: ${level.text}`))),
    join(`### ${m.roots.title}`, m.roots.lead, bullets(m.roots.items.map((root) => `${root.name}: ${root.text} (${root.authors})`))),
    join(
      `### ${l.library}`,
      m.library.lead,
      ...methodOrder.map((key) => {
        const method = methodSheet[key];
        return join(`#### ${method.name}`, method[lang].question, method[lang].description, `${l.builtOn}: ${method[lang].roots}`);
      }),
      join(m.library.growTitle, m.library.growText)
    ),
    join(`### ${m.faq.title}`, qa(m.faq.items))
  );

  const howText = join(
    `## ${l.howItWorks}`,
    `Source: ${url("/como-funciona", lang)}`,
    h.hero.title,
    h.hero.lead,
    join(`### ${h.sources.title}`, h.sources.lead),
    join(`### ${h.architect.title}`, h.architect.lead, bullets(h.architect.points.map((p) => `${p.name}: ${p.text}`))),
    join(`### ${h.methods.title}`, h.methods.lead),
    join(`### ${h.evidence.title}`, h.evidence.lead, bullets(h.evidence.levels.map((p) => `${p.name}: ${p.text}`))),
    join(`### ${h.views.title}`, h.views.lead),
    join(`### ${h.faq.title}`, qa(h.faq.items))
  );

  const socialText = join(
    `## ${l.social}`,
    `Source: ${url("/inteligencia-social", lang)}`,
    s.title,
    s.lead,
    join(`### ${s.definition.title}`, bullets(s.definition.steps.map((step) => `${step.name}: ${step.text}`))),
    join(`### ${s.listening.title}`, ...s.listening.paragraphs),
    join(`### ${s.research.title}`, s.research.lead, bullets([`${s.research.survey.name}: ${s.research.survey.text}`, `${s.research.conversation.name}: ${s.research.conversation.text}`])),
    join(`### ${s.sources.title}`, s.sources.lead, bullets(s.sources.items.map((item) => `${item.name}: ${item.text}`))),
    join(`### ${s.can.title}`, s.can.lead, bullets(s.can.items.map((item) => `${item.name}: ${item.text}`))),
    join(`### ${s.cannot.title}`, bullets(s.cannot.items.map((item) => `${item.name}: ${item.text}`))),
    join(`### ${s.glossary.title}`, bullets(s.glossary.items.map((item) => `${item.term}: ${item.text}`))),
    join(`### ${s.faq.title}`, qa(s.faq.items))
  );

  const compareText = join(
    `## ${l.comparisons}`,
    `Source: ${url("/comparar", lang)}`,
    cu.title,
    cu.lead,
    join(`### ${cu.glanceTitle}`, bullets([`Noisia: ${cu.glance.us}`, ...compareEntries.map((e) => `${cu.names[e.kind]}: ${cu.glance[e.kind]}`)])),
    ...compareEntries.map((entry) => {
      const p = entry.page[lang];
      return join(
        `### ${p.title}`,
        `Source: ${url(`/comparar/${entry.slug.es}`, lang)}`,
        p.lead,
        join(`#### ${l.criteria}`, bullets(p.criteria.map((row) => `${row.name}. ${p.them}: ${row.them}. Noisia: ${row.us}.`))),
        join(`#### ${l.when}`, bullets([p.when.them, p.when.us, p.when.both].map((item) => `${item.name}: ${item.text}`))),
        join(`#### ${l.faq}`, qa(p.faq))
      );
    }),
    join(`### ${cu.faqTitle}`, qa(cu.indexFaq))
  );

  const industriesText = join(
    `## ${l.industries}`,
    `Source: ${url("/industrias", lang)}`,
    ...industryEntries.map((entry) => {
      const c = entry[lang];
      return join(
        `### ${c.name}`,
        `Source: ${url(`/industrias/${entry.slug.es}`, lang)}`,
        c.title,
        c.lead,
        join(`#### ${l.questions}`, bullets(c.questions.map((q) => q.text))),
        c.where.length ? `${l.where}: ${c.where.join(", ")}` : ""
      );
    })
  );

  const workshopText = join(`## ${l.workshop}`, `Source: ${url("/taller", lang)}`, w.title, w.lead, ...w.blocks.map((b) => blockText(b, "###")));

  return join(aboutText, offerText, situationsText, methodsText, howText, socialText, compareText, industriesText, workshopText, insightsText(lang, true), contactText(lang));
}

function insightsText(lang: Lang, full: boolean): string {
  const l = labels[lang].sections;
  const stories = getStories().filter((story) => story.kind === "editorial");
  return join(
    `## ${l.insights}`,
    `Source: ${url("/insights", lang)}`,
    `### ${l.reports}`,
    bullets(insightsReports.map((r) => `[${r.meta.study}](${url(`/insights/reportes/${r.slug}`, lang)}) (${r.meta.analysis_date}): ${r.meta.subtitle}`)),
    `### ${l.stories}`,
    bullets(stories.map((story) => `[${story[lang].title}](${url(`/insights/${story.id}`, lang)}): ${story[lang].dek}${full && story[lang].takeaway ? ` ${story[lang].takeaway}` : ""}`))
  );
}

function contactText(lang: Lang): string {
  return join(`## ${labels[lang].sections.contact}`, bullets([`Email: ${ORG_EMAIL}`, ...ORG_SAME_AS.map((profile) => `LinkedIn: ${profile}`), `${labels[lang].sections.workshop}: ${url("/taller", lang)}`]));
}

/** /llms.txt: what Noisia is and a map of the pages, English first, Spanish links alongside. */
export function llmsTxt(): string {
  const link = (id: string, name: string, note?: string) => `[${name}](${url(id, "en")}) (ES: ${url(id, "es")})${note ? `: ${note}` : ""}`;
  const o = offer.en;
  return `${join(
    "# Noisia",
    `> ${labels.en.intro}`,
    `Spanish (Mexico) is the main language of the site at ${absoluteUrl("/")}; English lives at ${absoluteUrl("/en")}. The full text of the key pages, in both languages, is at ${absoluteUrl("/llms-full.txt")}.`,
    join("## Key facts", bullets(labels.en.facts)),
    join("## What Noisia offers", bullets([o.report, o.study, o.plan].map((p) => `${p.name}: ${p.promise} ${p.text}`)), bullets([link("/soluciones", "Solutions"), link("/taller", "Book a free workshop")])),
    join("## Situations", bullets(moments.map((mo) => link(`/soluciones/${mo.slug.es}`, mo.en.name, `${mo.en.question} ${mo.en.summary}`)))),
    join(
      "## Methods",
      `${methodsPage.en.hero.lead} ${link("/metodos", "All six methods")}`,
      bullets(methodOrder.map((key) => `${methodSheet[key].name}: ${methodSheet[key].en.question}`))
    ),
    join("## Learn", bullets([link("/como-funciona", "How it works", howItWorks.en.metaDescription), link("/inteligencia-social", "What social intelligence is", socialIntelligence.en.lead), link("/nosotros", "About Noisia")])),
    join("## Comparisons", bullets(compareEntries.map((e) => link(`/comparar/${e.slug.es}`, e.page.en.title, e.summary.en)))),
    join("## Industries", bullets(industryEntries.map((e) => link(`/industrias/${e.slug.es}`, e.en.name, e.en.metaDescription)))),
    insightsText("en", false),
    contactText("en")
  )}\n`;
}

/** /llms-full.txt: the full text of the key pages, English then Spanish. */
export function llmsFullTxt(): string {
  return `${join(
    "# Noisia",
    `> ${labels.en.intro}`,
    `Full text of ${absoluteUrl("/")} for answer engines, generated from the site's own content (updated ${SITE_UPDATED}). English first, then Spanish (Mexico), the site's main language. Map of pages: ${absoluteUrl("/llms.txt")}.`,
    join("## Key facts", bullets(labels.en.facts)),
    "---",
    "# English",
    fullSection("en"),
    "---",
    "# Español (México)",
    `> ${labels.es.intro}`,
    join(`## Datos clave`, bullets(labels.es.facts)),
    fullSection("es")
  )}\n`;
}
