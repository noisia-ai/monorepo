import "server-only";
import esMessages from "../../../messages/es.json";
import enMessages from "../../../messages/en.json";
import { methodOrder, methodSheet } from "@/content/pages/method-sheet";
import { HREFLANG, ORG_EMAIL, ORG_ID, ORG_NAME, ORG_SAME_AS, SITE_URL, WEBSITE_ID, absoluteUrl, toLang, type Lang } from "./config";
import { ogImageUrl } from "./metadata";
import { seoPage, seoPages, seoTrail, type SeoPage } from "./pages";

/**
 * schema.org builders. Each page renders one <JsonLd> with an @graph: the Organization and the
 * WebSite (referenced by @id everywhere), the page itself, its breadcrumb and whatever the page is
 * about (a service, a list, an article, a defined term). FAQPage comes from the Faq component,
 * built from the exact questions the page renders.
 */

type Node = Record<string, unknown>;

const description = { es: esMessages.meta.description, en: enMessages.meta.description };

export function organizationNode(lang: Lang): Node {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: ORG_NAME,
    url: SITE_URL,
    logo: { "@type": "ImageObject", "@id": `${SITE_URL}/#logo`, url: absoluteUrl("/icon-512.png"), width: 512, height: 512, caption: ORG_NAME },
    image: { "@id": `${SITE_URL}/#logo` },
    description: description[lang],
    slogan: "Social Intelligence Architects",
    email: ORG_EMAIL,
    sameAs: ORG_SAME_AS,
    contactPoint: [{ "@type": "ContactPoint", email: ORG_EMAIL, contactType: "sales", availableLanguage: ["es", "en"] }],
    knowsAbout: [
      lang === "en" ? "Social intelligence" : "Inteligencia social",
      lang === "en" ? "Market research" : "Investigación de mercado",
      lang === "en" ? "Brand monitoring" : "Monitoreo de marca",
      "Social listening",
      ...methodOrder.map((key) => methodSheet[key].name)
    ]
  };
}

export function websiteNode(): Node {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: ORG_NAME,
    inLanguage: [HREFLANG.es, HREFLANG.en],
    publisher: { "@id": ORG_ID }
  };
}

const pageUrl = (page: SeoPage, lang: Lang) => absoluteUrl(page[lang].path);

export function breadcrumbNode(page: SeoPage, lang: Lang): Node {
  return {
    "@type": "BreadcrumbList",
    "@id": `${pageUrl(page, lang)}#breadcrumb`,
    itemListElement: seoTrail(page).map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item[lang].name,
      item: pageUrl(item, lang)
    }))
  };
}

export function webPageNode(page: SeoPage, lang: Lang, type: string | string[] = "WebPage", extra: Node = {}): Node {
  const url = pageUrl(page, lang);
  return {
    "@type": type,
    "@id": `${url}#webpage`,
    url,
    name: page[lang].title,
    description: page[lang].description,
    inLanguage: HREFLANG[page.contentLanguage ?? lang],
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORG_ID },
    primaryImageOfPage: { "@type": "ImageObject", url: ogImageUrl(page, lang), width: 1200, height: 630 },
    dateModified: page.lastModified,
    ...(page.parent ? { breadcrumb: { "@id": `${url}#breadcrumb` } } : {}),
    ...extra
  };
}

type Options = {
  /** schema.org type of the page node (WebPage, CollectionPage, AboutPage, ContactPage...). */
  type?: string | string[];
  /** Extra properties of the page node (mainEntity, about...). */
  page?: Node;
  /** Further nodes: services, lists, articles, terms. */
  nodes?: Node[];
};

/** The @graph of a registered page. `id` is its Spanish path. */
export function pageGraph(id: string, locale: string, options: Options = {}): object | null {
  const page = seoPage(id);
  if (!page) return null;
  const lang = toLang(locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationNode(lang),
      websiteNode(),
      webPageNode(page, lang, options.type, options.page),
      ...(page.parent ? [breadcrumbNode(page, lang)] : []),
      ...(options.nodes ?? [])
    ]
  };
}

/** An ordered list of pages (a hub's children), for ItemList. */
export function itemListNode(id: string, locale: string, items: { name: string; url: string; description?: string }[], name?: string): Node {
  const page = seoPage(id);
  const lang = toLang(locale);
  const url = page ? pageUrl(page, lang) : SITE_URL;
  return {
    "@type": "ItemList",
    "@id": `${url}#list`,
    name: name ?? page?.[lang].name,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: absoluteUrl(item.url),
      ...(item.description ? { description: item.description } : {})
    }))
  };
}

/** The registered child pages of a hub, in registry order. */
export function childItems(parentId: string, locale: string, filter?: (page: SeoPage) => boolean) {
  const lang = toLang(locale);
  return seoPages()
    .filter((page) => page.parent === parentId)
    .filter((page) => !page.noindex && (!filter || filter(page)))
    .map((page) => ({ name: page[lang].name, url: page[lang].path, description: page[lang].description }));
}

/** A service Noisia provides, tied to the page that describes it. */
export function serviceNode(id: string, locale: string, fields: { name: string; description: string; serviceType: string; category?: string }): Node {
  const page = seoPage(id);
  const lang = toLang(locale);
  const url = page ? pageUrl(page, lang) : SITE_URL;
  return {
    "@type": "Service",
    "@id": `${url}#service`,
    name: fields.name,
    description: fields.description,
    serviceType: fields.serviceType,
    ...(fields.category ? { category: fields.category } : {}),
    provider: { "@id": ORG_ID },
    url,
    availableLanguage: [HREFLANG.es, HREFLANG.en],
    mainEntityOfPage: { "@id": `${url}#webpage` }
  };
}

/** An article (or report) published by Noisia on this page. */
export function articleNode(
  id: string,
  locale: string,
  fields: { type?: string | string[]; headline: string; description: string; datePublished?: string; image?: string; about?: unknown; isPartOf?: string; extra?: Node }
): Node {
  const page = seoPage(id);
  const lang = toLang(locale);
  if (!page) return {};
  const url = pageUrl(page, lang);
  return {
    "@type": fields.type ?? "Article",
    "@id": `${url}#article`,
    headline: fields.headline.slice(0, 110),
    description: fields.description,
    inLanguage: HREFLANG[page.contentLanguage ?? lang],
    url,
    mainEntityOfPage: { "@id": `${url}#webpage` },
    image: [fields.image ? absoluteUrl(fields.image) : ogImageUrl(page, lang)],
    ...(fields.datePublished ? { datePublished: fields.datePublished } : {}),
    dateModified: page.lastModified,
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    isAccessibleForFree: true,
    ...(fields.about ? { about: fields.about } : {}),
    ...(fields.isPartOf ? { isPartOf: { "@id": `${absoluteUrl(fields.isPartOf)}#article` } } : {}),
    ...fields.extra
  };
}
