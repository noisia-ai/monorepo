import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { InsightReportPage } from "@/components/report/ReportPage";
import { getInsightReport, insightsReports } from "@/content/reports/reports";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site";

type Params = { locale: string; slug: string };

const paths = (slug: string) => ({ es: `/insights/reportes/${slug}`, en: `/en/insights/reports/${slug}` });

export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => insightsReports.map((report) => ({ locale, slug: report.slug })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const report = getInsightReport(slug);
  if (!report) return {};
  const { es, en } = paths(report.slug);
  const subtitle = report.meta.subtitle.replace(/\.$/, "");
  const description =
    locale === "en"
      ? `${subtitle}. Noisia editorial report, published in Spanish.`
      : `${subtitle}. Reporte editorial de Noisia.`;
  return {
    title: report.meta.study,
    description,
    alternates: { canonical: locale === "en" ? en : es, languages: { es, en } },
    openGraph: {
      title: report.meta.study,
      description,
      type: "article",
      images: report.heroVisual ? [{ url: report.heroVisual.src, alt: report.heroVisual.alt }] : undefined
    }
  };
}

export default async function ReportPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const report = getInsightReport(slug);
  if (!report) notFound();
  const url = `${SITE_URL}${locale === "en" ? paths(report.slug).en : paths(report.slug).es}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: report.meta.study,
    description: report.meta.subtitle,
    image: report.heroVisual ? `${SITE_URL}${report.heroVisual.src}` : undefined,
    datePublished: report.meta.analysis_date,
    dateModified: report.meta.analysis_date,
    inLanguage: "es-MX",
    url,
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: "Noisia", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Noisia", url: SITE_URL },
    about: report.signals.slice(0, 8).map((signal) => signal.commercial_name),
    isAccessibleForFree: true
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <InsightReportPage report={report} locale={locale} />
    </>
  );
}
