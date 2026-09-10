import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ClientBrandWorkspaceEntryV1 } from "@/lib/data-os/workspace-management-entry";

export function ClientBrandWorkspaceList({ entries }: { entries: ClientBrandWorkspaceEntryV1[] }) {
  const t = useTranslations("ClientWorkspaceEntry");
  return <section aria-label={t("brandsTitle")}>
    <h2>{t("brandsTitle")}</h2><p>{t("brandsBody")}</p>
    {entries.length ? <div className="signal-output-grid">{entries.map(entry => <article className="signal-output-card" key={entry.workspaceId}>
      <h3>{entry.name}</h3><p>{t(entry.capabilities.can_import_mentions || entry.capabilities.can_select_signal ? "brandManage" : "brandReadOnly")}</p>
      <div className="admin-form-actions">
        <Link prefetch={false} className="admin-button" href={entry.navigation.topicsHref}>{t("topics")}</Link>
        <Link prefetch={false} className="admin-button" href={entry.navigation.dataHref}>{t("data")}</Link>
        <Link prefetch={false} className="admin-button" href={entry.navigation.signalHref}>Signal</Link>
      </div>
    </article>)}</div> : <div className="signal-empty"><div><h3>{t("emptyTitle")}</h3><p>{t("emptyBody")}</p></div></div>}
  </section>;
}
