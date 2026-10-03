"use client";

import { SlidersHorizontal } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";

import { SignalV2ModuleHeader } from "@/components/signal-v2/SignalV2ModuleHeader";
import type { SignalClientSettingsV1 } from "@/lib/data-os/signal-client-settings";

export function SignalV2Settings({ data }: { data: SignalClientSettingsV1 }) {
  const t = useTranslations("SignalV2.settings");
  const locale = useLocale();
  return (
    <div className="signal-v2-settings">
      <SignalV2ModuleHeader
        icon={<SlidersHorizontal aria-hidden size={20} weight="fill" />}
        status={t("status")}
        subtitle={t("subtitle")}
        title={t("title")}
      />
      <div className="signal-v2-settings__grid">
        <section>
          <header><h2>{t("workspace.title")}</h2><p>{t("workspace.subtitle")}</p></header>
          <dl>
            <div><dt>{t("workspace.status")}</dt><dd>{t(`states.${data.workspace.status}`)}</dd></div>
            <div><dt>{t("workspace.timezone")}</dt><dd>{data.workspace.timezone}</dd></div>
            <div><dt>{t("workspace.access")}</dt><dd>{t("workspace.allowed")}</dd></div>
          </dl>
        </section>
        <section>
          <header><h2>{t("data.title")}</h2><p>{t("data.subtitle")}</p></header>
          <dl>
            <div><dt>{t("data.sources")}</dt><dd>{new Intl.NumberFormat(locale).format(data.data.active_sources)}</dd></div>
            <div><dt>{t("data.freshness")}</dt><dd>{t(`states.${data.data.overall_freshness}`)}</dd></div>
          </dl>
          {data.data.visible_sources.length > 0 ? (
            <ul>{data.data.visible_sources.map((source) => (
              <li key={`${source.provider}:${source.name}`}><div><strong>{source.name}</strong><small>{source.provider}</small></div><span>{t("data.sourceMeta", { cadence: t(`data.cadence.${source.cadence}`), freshness: t(`states.${source.freshness}`) })}</span></li>
            ))}</ul>
          ) : <p className="signal-v2-settings__empty">{t("data.noVisibleSources")}</p>}
        </section>
        <section>
          <header><h2>{t("profiles.title")}</h2><p>{t("profiles.subtitle")}</p></header>
          {data.profiles.length > 0 ? <ul>{data.profiles.map((profile) => <li key={`${profile.kind}:${profile.version}`}><strong>{t(`profiles.kinds.${profile.kind}`)}</strong><span>v{profile.version}</span></li>)}</ul> : <p className="signal-v2-settings__empty">{t("profiles.empty")}</p>}
        </section>
        <section>
          <header><h2>{t("report.title")}</h2><p>{t("report.subtitle")}</p></header>
          <dl>
            <div><dt>{t("report.state")}</dt><dd>{t(`states.${data.report.state}`)}</dd></div>
            <div><dt>{t("report.revision")}</dt><dd>{data.report.revision ? `r${data.report.revision}` : "—"}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
