import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { InsightReportPage } from "@/components/report/ReportPage";
import { getInsightReport, insightsReports } from "@/content/reports/reports";
import { routing } from "@/i18n/routing";
import { JsonLd } from "@/components/seo/JsonLd";
import { articleNode, pageGraph } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

type Params = { locale: string; slug: string };

export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => insightsReports.map((report) => ({ locale, slug: report.slug })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const report = getInsightReport(slug);
  if (!report) return {};
  return pageMetadata(`/insights/reportes/${report.slug}`, locale);
}

export default async function ReportPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const report = getInsightReport(slug);
  if (!report) notFound();
  const id = `/insights/reportes/${report.slug}`;
  const jsonLd = pageGraph(id, locale, {
    nodes: [
      articleNode(id, locale, {
        type: ["Article", "Report"],
        headline: report.meta.study,
        description: report.meta.subtitle,
        datePublished: report.meta.analysis_date,
        image: report.heroVisual?.src,
        extra: { keywords: report.signals.slice(0, 8).map((signal) => signal.commercial_name).join(", "), contentLocation: { "@type": "Country", name: "México" } }
      })
    ]
  });
  return (
    <>
      <InsightReportPage report={report} locale={locale} />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
    </>
  );
}
