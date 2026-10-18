"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { SemanticContextPackManager } from "./SemanticContextPackManager";

/** MFP reads the saved Brand OS directly; corpus preparation lives in Data. */
export function BrandOsContextPreparation({ brandId, workspaceId, mfpEnabled, allowProcessingAuthorization }: {
  brandId: string; workspaceId: string; mfpEnabled: boolean; allowProcessingAuthorization: boolean;
}) {
  const t = useTranslations("AdminWorkspace.brandOs.mfpContext");
  if (!mfpEnabled) return <SemanticContextPackManager workspaceId={workspaceId}
    allowProcessingAuthorization={allowProcessingAuthorization} />;
  return <section className="admin-section" aria-label={t("title")}>
    <div className="admin-section__head"><div><h3>{t("title")}</h3><p>{t("body")}</p></div></div>
    <div className="admin-section__body"><Link className="admin-button" prefetch={false}
      href={`/studio/brands/${encodeURIComponent(brandId)}/data`}>{t("openData")}</Link></div>
  </section>;
}
