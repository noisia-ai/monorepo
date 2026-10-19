import "server-only";
import esMessages from "../../../messages/es.json";
import enMessages from "../../../messages/en.json";
import { home } from "@/content/pages/home";
import { howItWorks } from "@/content/pages/howItWorks";
import { methodsPage } from "@/content/pages/methods";
import { solutionsIndex, solutionEntries } from "@/content/pages/solutions";
import { offer } from "@/content/pages/offer";
import { about } from "@/content/pages/about";
import { workshop } from "@/content/pages/workshop";
import { socialIntelligence } from "@/content/pages/socialIntelligence";
import { compareEntries, compareUi } from "@/content/pages/compare";
import { privacy } from "@/content/pages/privacy";
import { industriesPage, industryEntries } from "@/content/pages/industries";
import { moments } from "@/content/moments";
import { insightsReports } from "@/content/reports/reports";
import { getStories } from "@/content/stories";
import { SITE_UPDATED, type Lang } from "./config";

/**
 * Every public page of the site, in both languages, read from the content files so titles,
 * descriptions and slugs never drift from what the page renders. One registry feeds the page
 * metadata, the sitemap, the Open Graph images, breadcrumbs and llms.txt.
 */

export type SeoLocaleCopy = {
  /** Public path in this locale, with the /en prefix for English. */
  path: string;
  /** <title> (the layout appends " · Noisia" unless `absoluteTitle`). */
  title: string;
  description: string;
  /** Short name for breadcrumbs and lists. */
  name: string;
  /** Headline drawn on the Open Graph image (usually the page's H1). */
  headline: string;
  /** Small line above the headline on the Open Graph image. */
  kicker: string;
};

export type SeoPage = {
  /** The Spanish path: the stable key of the page. */
  id: string;
  /** id of the parent page for breadcrumbs ("/" for top-level pages). */
  parent?: string;
  kind: "home" | "page" | "collection" | "solution" | "compare" | "industry" | "report" | "story" | "about" | "contact" | "definition";
  /** Excluded from the sitemap and marked noindex. */
  noindex?: boolean;
  /** Title used as-is, without the " · Noisia" template. */
  absoluteTitle?: boolean;
  /** Content language when it differs from the URL's locale (the reports are written in Spanish). */
  contentLanguage?: Lang;
  lastModified: string;
  image?: string;
  es: SeoLocaleCopy;
  en: SeoLocaleCopy;
};

const messages = { es: esMessages, en: enMessages };

const section = {
  es: { home: "Inicio", solutions: esMessages.nav.solutions, how: esMessages.nav.howItWorks, methods: esMessages.nav.methods, insights: esMessages.nav.insights, about: esMessages.nav.about, workshop: "Taller", social: "Inteligencia social", compare: "Comparaciones", privacy: "Privacidad", industries: "Industrias", reports: "Reportes" },
  en: { home: "Home", solutions: enMessages.nav.solutions, how: enMessages.nav.howItWorks, methods: enMessages.nav.methods, insights: enMessages.nav.insights, about: enMessages.nav.about, workshop: "Workshop", social: "Social intelligence", compare: "Comparisons", privacy: "Privacy", industries: "Industries", reports: "Reports" }
};

const en = (path: string) => (path === "/" ? "/en" : `/en${path}`);

function both(build: (lang: Lang) => SeoLocaleCopy): { es: SeoLocaleCopy; en: SeoLocaleCopy } {
  return { es: build("es"), en: build("en") };
}

function build(): SeoPage[] {
  const pages: SeoPage[] = [];

  pages.push({
    id: "/",
    kind: "home",
    absoluteTitle: true,
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? "/en" : "/",
      title: messages[lang].meta.defaultTitle,
      description: messages[lang].meta.description,
      name: section[lang].home,
      headline: home[lang].hero.heading.split(/(?<=\.) /).pop() ?? home[lang].hero.heading,
      kicker: lang === "en" ? "Social intelligence" : "Inteligencia social"
    }))
  });

  pages.push({
    id: "/soluciones",
    parent: "/",
    kind: "collection",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/solutions") : "/soluciones",
      title: solutionsIndex[lang].metaTitle,
      description: solutionsIndex[lang].metaDescription,
      name: section[lang].solutions,
      headline: offer[lang].title,
      kicker: section[lang].solutions
    }))
  });

  for (const entry of solutionEntries) {
    const moment = moments.find((m) => m.slug.es === entry.slug.es);
    pages.push({
      id: `/soluciones/${entry.slug.es}`,
      parent: "/soluciones",
      kind: "solution",
      lastModified: SITE_UPDATED,
      ...both((lang) => ({
        path: lang === "en" ? en(`/solutions/${entry.slug.en}`) : `/soluciones/${entry.slug.es}`,
        title: entry.page[lang].metaTitle,
        description: entry.page[lang].metaDescription,
        name: entry.page[lang].metaTitle,
        headline: moment ? moment[lang].question : entry.page[lang].title,
        kicker: section[lang].solutions
      }))
    });
  }

  pages.push({
    id: "/como-funciona",
    parent: "/",
    kind: "page",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/how-it-works") : "/como-funciona",
      title: howItWorks[lang].metaTitle,
      description: howItWorks[lang].metaDescription,
      name: section[lang].how,
      headline: howItWorks[lang].hero.title,
      kicker: section[lang].how
    }))
  });

  pages.push({
    id: "/metodos",
    parent: "/",
    kind: "collection",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/methods") : "/metodos",
      title: methodsPage[lang].metaTitle,
      description: methodsPage[lang].metaDescription,
      name: section[lang].methods,
      headline: methodsPage[lang].hero.title,
      kicker: section[lang].methods
    }))
  });

  pages.push({
    id: "/inteligencia-social",
    parent: "/",
    kind: "definition",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/social-intelligence") : "/inteligencia-social",
      title: socialIntelligence[lang].metaTitle,
      description: socialIntelligence[lang].metaDescription,
      name: section[lang].social,
      headline: socialIntelligence[lang].title,
      kicker: section[lang].social
    }))
  });

  pages.push({
    id: "/comparar",
    parent: "/",
    kind: "collection",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/compare") : "/comparar",
      title: compareUi[lang].metaTitle,
      description: compareUi[lang].metaDescription,
      name: section[lang].compare,
      headline: compareUi[lang].title,
      kicker: section[lang].compare
    }))
  });

  for (const entry of compareEntries) {
    pages.push({
      id: `/comparar/${entry.slug.es}`,
      parent: "/comparar",
      kind: "compare",
      lastModified: SITE_UPDATED,
      ...both((lang) => ({
        path: lang === "en" ? en(`/compare/${entry.slug.en}`) : `/comparar/${entry.slug.es}`,
        title: entry.page[lang].metaTitle,
        description: entry.page[lang].metaDescription,
        name: compareUi[lang].names[entry.kind],
        headline: entry.page[lang].title,
        kicker: section[lang].compare
      }))
    });
  }

  pages.push({
    id: "/industrias",
    parent: "/",
    kind: "collection",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/industries") : "/industrias",
      title: industriesPage[lang].metaTitle,
      description: industriesPage[lang].metaDescription,
      name: section[lang].industries,
      headline: industriesPage[lang].title,
      kicker: section[lang].industries
    }))
  });

  for (const entry of industryEntries) {
    pages.push({
      id: `/industrias/${entry.slug.es}`,
      parent: "/industrias",
      kind: "industry",
      lastModified: SITE_UPDATED,
      ...both((lang) => ({
        path: lang === "en" ? en(`/industries/${entry.slug.en}`) : `/industrias/${entry.slug.es}`,
        // Industry copy has no metaTitle; pair the industry with the search term of the page.
        title: (entry[lang] as { metaTitle?: string }).metaTitle ?? `${entry[lang].name} · ${lang === "en" ? "Social intelligence" : "Inteligencia social"}`,
        description: entry[lang].metaDescription,
        name: entry[lang].name,
        headline: entry[lang].title,
        kicker: `${section[lang].industries} · ${entry[lang].name}`
      }))
    });
  }

  pages.push({
    id: "/insights",
    parent: "/",
    kind: "collection",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/insights") : "/insights",
      // A feed.metaTitle message, when added, replaces the bare "Insights" label.
      title: (messages[lang].feed as { metaTitle?: string }).metaTitle ?? messages[lang].feed.label,
      description: messages[lang].feed.metaDescription,
      name: section[lang].insights,
      headline: messages[lang].feed.metaDescription,
      kicker: section[lang].insights
    }))
  });

  // The reports are written in Spanish; their English pages get an English summary.
  const reportSummaryEn: Record<string, string> = {
    "the-mexican-home": "Eight signals on what home means in Mexico today. A Noisia report, in Spanish.",
    "future-is-human": "Six signals that separate an efficient brand from a dehumanized one in Mexico. A Noisia report, in Spanish.",
    "cultural-foresight-mexico-2026": "Eight signals we heard in Mexican conversation before they reach the brief. A Noisia report, in Spanish."
  };

  for (const report of insightsReports) {
    const subtitle = report.meta.subtitle.replace(/\.$/, "");
    pages.push({
      id: `/insights/reportes/${report.slug}`,
      parent: "/insights",
      kind: "report",
      contentLanguage: "es",
      lastModified: report.meta.analysis_date,
      image: report.heroVisual?.src,
      ...both((lang) => ({
        path: lang === "en" ? en(`/insights/reports/${report.slug}`) : `/insights/reportes/${report.slug}`,
        title: report.meta.study,
        description: lang === "en" ? (reportSummaryEn[report.slug] ?? `${subtitle}. Noisia editorial report, published in Spanish.`) : `${subtitle}. Reporte editorial de Noisia.`,
        name: report.meta.study,
        headline: report.meta.study,
        kicker: `${section[lang].reports} · Noisia`
      }))
    });
  }

  for (const story of getStories()) {
    const report = story.report ? insightsReports.find((r) => story.report?.endsWith(`/${r.slug}`)) : undefined;
    pages.push({
      id: `/insights/${story.id}`,
      parent: "/insights",
      kind: "story",
      // Illustrative examples are for the feed experience, not for search results.
      noindex: story.kind !== "editorial",
      lastModified: report?.meta.analysis_date ?? SITE_UPDATED,
      ...both((lang) => ({
        path: lang === "en" ? en(`/insights/${story.id}`) : `/insights/${story.id}`,
        title: story[lang].title,
        description: story[lang].dek,
        name: story[lang].title,
        headline: story[lang].title,
        kicker: `${(messages[lang].industries as Record<string, string>)[story.industry] ?? story.industry} · ${story.market}`
      }))
    });
  }

  pages.push({
    id: "/nosotros",
    parent: "/",
    kind: "about",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/about") : "/nosotros",
      title: about[lang].metaTitle,
      description: about[lang].metaDescription,
      name: section[lang].about,
      headline: about[lang].title,
      kicker: section[lang].about
    }))
  });

  pages.push({
    id: "/taller",
    parent: "/",
    kind: "contact",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/workshop") : "/taller",
      title: workshop[lang].metaTitle,
      description: workshop[lang].metaDescription,
      name: section[lang].workshop,
      headline: workshop[lang].title,
      kicker: section[lang].workshop
    }))
  });

  pages.push({
    id: "/privacidad",
    parent: "/",
    kind: "page",
    lastModified: SITE_UPDATED,
    ...both((lang) => ({
      path: lang === "en" ? en("/privacy") : "/privacidad",
      title: privacy[lang].metaTitle,
      description: privacy[lang].metaDescription,
      name: section[lang].privacy,
      headline: privacy[lang].title,
      kicker: section[lang].privacy
    }))
  });

  return pages;
}

let cache: SeoPage[] | null = null;

export function seoPages(): SeoPage[] {
  // Rebuilt on every call in development so copy edits show up without a restart.
  if (process.env.NODE_ENV !== "production") return build();
  cache ??= build();
  return cache;
}

/** A page by its Spanish path (the registry key). */
export function seoPage(id: string): SeoPage | undefined {
  return seoPages().find((page) => page.id === id);
}

/** A page by its public path in either language ("/en/solutions/launch" or "/soluciones/lanzar"). */
export function seoPageByPath(path: string): { page: SeoPage; lang: Lang } | undefined {
  for (const page of seoPages()) {
    if (page.es.path === path) return { page, lang: "es" };
    if (page.en.path === path) return { page, lang: "en" };
  }
  return undefined;
}

/** The chain of pages from the home to this one, for breadcrumbs. */
export function seoTrail(page: SeoPage): SeoPage[] {
  const trail: SeoPage[] = [page];
  let current = page;
  while (current.parent) {
    const parent = seoPage(current.parent);
    if (!parent) break;
    trail.unshift(parent);
    current = parent;
  }
  return trail;
}
