import "server-only";
import { getTranslations } from "next-intl/server";
import { studiesPage } from "@/content/pages/studies";
import { insightsReports, reportSummaryEn } from "@/content/reports/reports";
import { getStudies, type Study } from "@/content/studies";
import type { Market } from "@/content/studies/schema";

/** One card of the studies index: a study from the database or one of the repo's editorial reports. */
export type StudyCardItem = {
  key: string;
  kind: "study" | "report";
  href: { pathname: "/insights/estudios/[slug]"; params: { slug: string } } | { pathname: "/insights/reportes/[slug]"; params: { slug: string } };
  title: string;
  dek: string;
  industry: string;
  industryLabel: string;
  markets: { key: Market; label: string }[];
  /** Short form for the card: one or two names, or "4 markets". */
  marketLabel: string;
  meta: string;
  badge: string;
  /** Opens only with sign-up or a personal link. */
  gated: boolean;
  cover: string | null;
  date: string;
  draft: boolean;
};

export function studyCover(study: Study): string | null {
  return study.coverPath ? `/api/content/studies/${study.id}/cover.webp?v=${study.version}` : null;
}

/** The study's own image, when it has one. */
export function studyHero(study: Study): string | null {
  return study.heroPath ? `/api/content/studies/${study.id}/${study.heroPath}?v=${study.version}` : null;
}

export async function studyCardItems(locale: string): Promise<StudyCardItem[]> {
  const lang = locale === "en" ? "en" : "es";
  const c = studiesPage[lang];
  const t = await getTranslations({ locale, namespace: "industries" });
  const label = (industry: string) => (t.has(industry) ? t(industry) : industry);

  // Studies in the content database. Those shared only by link stay out of the index.
  const studies: StudyCardItem[] = (await getStudies())
    .filter((study) => study.accessMode !== "solo_link")
    .map((study) => ({
      key: `study:${study.id}`,
      kind: "study",
      href: { pathname: "/insights/estudios/[slug]", params: { slug: study.id } },
      title: study.summary[lang].title,
      dek: study.summary[lang].dek,
      industry: study.industry,
      industryLabel: label(study.industry),
      markets: study.markets.map((key) => ({ key, label: c.markets[key] })),
      marketLabel: c.marketSummary(study.markets),
      meta: [study.method, study.summary[lang].period_label ?? study.periodLabel].filter(Boolean).join(" · "),
      badge: c.access[study.accessMode],
      gated: study.accessMode === "solo_link",
      cover: studyHero(study) ?? studyCover(study),
      date: study.publishedAt ?? new Date().toISOString(),
      draft: study.draft
    }));

  // The editorial reports that were built by hand keep their own pages; they show here as cards.
  const reports: StudyCardItem[] = insightsReports.map((report) => ({
    key: `report:${report.slug}`,
    kind: "report",
    href: { pathname: "/insights/reportes/[slug]", params: { slug: report.slug } },
    title: report.meta.study,
    dek: lang === "en" ? (reportSummaryEn[report.slug] ?? report.meta.subtitle) : report.meta.subtitle,
    industry: "cultura-y-sociedad",
    industryLabel: label("cultura-y-sociedad"),
    markets: [{ key: "MX", label: c.markets.MX }],
    marketLabel: c.markets.MX,
    meta: c.reportNote,
    badge: c.access.abierto,
    gated: false,
    cover: report.heroVisual?.src ?? null,
    date: report.meta.analysis_date,
    draft: false
  }));

  return [...studies, ...reports].sort((a, b) => (a.draft === b.draft ? b.date.localeCompare(a.date) : a.draft ? -1 : 1));
}
