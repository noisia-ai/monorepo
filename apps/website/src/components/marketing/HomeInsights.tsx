import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { insightsReports } from "@/content/insights/reports";

const insightAssets: Record<string, { src: string; alt: string }> = {
  "cultural-foresight-mexico-2026": {
    src: "/assets/insights/cultural-foresight-hero-v2.png",
    alt: "Visual editorial de Cultural Foresight México 2026"
  },
  "future-is-human": {
    src: "/assets/insights/future-is-human-hero-v2.png",
    alt: "Visual editorial de Future is Human"
  }
};

function getHeroMetric(reportSlug: string) {
  const report = insightsReports.find((item) => item.slug === reportSlug);
  if (!report) return null;

  const preferredKey = reportSlug === "future-is-human" ? "mentions_reviewed" : "evidence";
  return report.hero_numbers[preferredKey] ?? report.hero_numbers.corpus_scope;
}

export function HomeInsights() {
  return (
    <div className="home-insights-grid">
      {insightsReports.map((report) => {
        const asset = insightAssets[report.slug];
        const metric = getHeroMetric(report.slug);

        return (
          <Link className="home-insight-card glass" href={`/insights/${report.slug}`} key={report.slug}>
            <div className="home-insight-card__media">
              {asset && (
                <Image
                  alt={asset.alt}
                  src={asset.src}
                  fill
                  sizes="(max-width: 760px) 100vw, 50vw"
                />
              )}
            </div>
            <div className="home-insight-card__body">
              <div>
                <span className="eyebrow">Insight Noisia</span>
                <h3>{report.meta.study}</h3>
                <p>{report.meta.subtitle}</p>
              </div>
              <div className="home-insight-card__footer">
                {metric && (
                  <span>
                    <strong>{metric.value}</strong>
                    {metric.label}
                  </span>
                )}
                <b>
                  Leer insight <ArrowUpRight size={16} strokeWidth={1.8} />
                </b>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
