"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { WorkspaceShell, WorkspaceSkipLink, WorkspaceTopbar, WorkspaceProductBrand,
  WorkspaceTopbarActions, WorkspaceAccount, WorkspaceNavigation, WorkspaceNavLink, WorkspaceMain } from "@/components/workspace/WorkspaceShell";
import type { ClientBrandWorkspaceEntryV1 } from "@/lib/data-os/workspace-management-entry";

export function ClientBrandWorkspaceShell({ entry, current, children, userName }: {
  entry: Pick<ClientBrandWorkspaceEntryV1, "name" | "navigation" | "requestScope">;
  current?: "topics" | "data"; children: ReactNode; userName?: string;
}) {
  const t = useTranslations("ClientWorkspaceEntry"), pathname = usePathname();
  const active = current ?? (pathname?.endsWith("/data") ? "data" : "topics");
  return <WorkspaceShell className="client-brand-workspace">
    <WorkspaceSkipLink href="#client-workspace-main">{t("skip")}</WorkspaceSkipLink>
    <WorkspaceTopbar><WorkspaceProductBrand href="/signal" product="Signal" />
      <WorkspaceTopbarActions>{userName ? <WorkspaceAccount label={userName.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join("").toUpperCase()} name={userName} /> : null}</WorkspaceTopbarActions>
    </WorkspaceTopbar>
    <div className="client-brand-workspace__body">
      <WorkspaceNavigation aria-label={t("navigation")} className="client-brand-workspace__navigation">
        <strong>{entry.name}</strong>
        <WorkspaceNavLink href={entry.navigation.topicsHref} active={active === "topics"} label={t("topics")} />
        <WorkspaceNavLink href={entry.navigation.dataHref} active={active === "data"} label={t("data")} />
        <WorkspaceNavLink href={entry.navigation.signalHref} label="Signal" />
        <WorkspaceNavLink href="/signal" label={t("allBrands")} />
      </WorkspaceNavigation>
      <WorkspaceMain id="client-workspace-main" key={entry.requestScope}>{children}</WorkspaceMain>
    </div>
  </WorkspaceShell>;
}
