import Link from "next/link";
import { useTranslations } from "next-intl";

type Step = "brand-os" | "topics" | "data" | "signal";

/** Navigation only: visiting a step does not claim that its preparation is complete. */
export function BrandMonitoringJourney({ brandId, current, destinations }: { brandId: string; current?: Step;
  destinations?: { topics: string; data: string; signal?: string; brandOs?: string | null }; }) {
  const t = useTranslations("AdminWorkspace.monitoringJourney");
  const steps: Step[] = destinations ? [...(destinations.brandOs ? ["brand-os" as const] : []), "topics", "data", ...(destinations.signal ? ["signal" as const] : [])] : ["brand-os", "topics", "data"];
  const href = (step: Step) => destinations ? (step === "brand-os" ? destinations.brandOs! : destinations[step]!) : `/studio/brands/${encodeURIComponent(brandId)}/${step}`;
  return <nav className="brand-monitoring-journey" aria-label={t("label")}>
    <div><strong>{t("title")}</strong><p>{t("body")}</p></div>
    <ol>{steps.map((step, index) => <li key={step}>
      <Link aria-current={current === step ? "step" : undefined}
        href={href(step)} prefetch={false}>
        <span aria-hidden>{index + 1}</span><strong>{t(`steps.${step}`)}</strong>
      </Link>
    </li>)}</ol>
  </nav>;
}
