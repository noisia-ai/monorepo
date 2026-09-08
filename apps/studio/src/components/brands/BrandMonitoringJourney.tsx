import Link from "next/link";
import { useTranslations } from "next-intl";

type Step = "brand-os" | "topics" | "data";

/** Navigation only: visiting a step does not claim that its preparation is complete. */
export function BrandMonitoringJourney({ brandId, current }: { brandId: string; current?: Step }) {
  const t = useTranslations("AdminWorkspace.monitoringJourney");
  return <nav className="brand-monitoring-journey" aria-label={t("label")}>
    <div><strong>{t("title")}</strong><p>{t("body")}</p></div>
    <ol>{(["brand-os", "topics", "data"] as const).map((step, index) => <li key={step}>
      <Link aria-current={current === step ? "step" : undefined}
        href={`/studio/brands/${encodeURIComponent(brandId)}/${step}`} prefetch={false}>
        <span aria-hidden>{index + 1}</span><strong>{t(`steps.${step}`)}</strong>
      </Link>
    </li>)}</ol>
  </nav>;
}
