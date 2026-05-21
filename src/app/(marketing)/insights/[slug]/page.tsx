import { notFound, redirect } from "next/navigation";
import { InsightReportPage } from "@/components/insights/InsightsPages";
import { StructuredData } from "@/components/seo/StructuredData";
import { getInsightReport, insightsReports } from "@/content/insights/reports";
import { SITE_URL, absoluteUrl, breadcrumbJsonLd, createPageMetadata } from "@/lib/seo";

type InsightDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return insightsReports.flatMap((report) => [report.slug, ...(report.aliases ?? [])].map((slug) => ({ slug })));
}

export async function generateMetadata({ params }: InsightDetailPageProps) {
  const { slug } = await params;
  const report = getInsightReport(slug);

  return createPageMetadata({
    title: report ? report.meta.study : "Insight",
    description: report?.meta.subtitle ?? "Reporte editorial de Noisia.",
    path: report ? `/insights/${report.slug}` : "/insights",
    image: report?.heroVisual?.src,
    imageAlt: report?.heroVisual?.alt,
    type: "article"
  });
}

export default async function InsightDetailPage({ params }: InsightDetailPageProps) {
  const { slug } = await params;
  const report = getInsightReport(slug);

  if (!report) {
    notFound();
  }

  if (slug !== report.slug) {
    redirect(`/insights/${report.slug}`);
  }

  const canonicalPath = `/insights/${report.slug}`;
  const articleJsonLd = [
    breadcrumbJsonLd([
      { name: "Noisia", path: "/" },
      { name: "Insights", path: "/insights" },
      { name: report.meta.study, path: canonicalPath }
    ]),
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: report.meta.study,
      description: report.meta.subtitle,
      image: report.heroVisual?.src ? absoluteUrl(report.heroVisual.src) : undefined,
      datePublished: report.meta.analysis_date,
      dateModified: report.meta.analysis_date,
      inLanguage: "es-MX",
      mainEntityOfPage: absoluteUrl(canonicalPath),
      author: {
        "@type": "Organization",
        name: "Noisia",
        url: SITE_URL
      },
      publisher: {
        "@type": "Organization",
        name: "Noisia",
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: absoluteUrl("/assets/logos/logo_black@2x.png")
        }
      },
      articleSection: "Social intelligence",
      about: report.signals.slice(0, 8).map((signal) => signal.commercial_name),
      isAccessibleForFree: true
    }
  ];

  return (
    <>
      <StructuredData data={articleJsonLd} />
      <InsightReportPage report={report} />
    </>
  );
}
