import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import "@/app/signal-v2/signal-v2.css";
import { ClientBrandWorkspaceShell } from "@/components/brands/ClientBrandWorkspaceShell";
import { requirePortalUser } from "@/lib/auth/guards";
import { loadClientBrandWorkspaceEntryV1 } from "@/lib/data-os/workspace-management-entry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientBrandManagementLayout({ params, children }: {
  params: Promise<{ outputId: string }>; children: ReactNode;
}) {
  const { outputId } = await params;
  const session = await requirePortalUser(`/signal/${encodeURIComponent(outputId)}/manage/topics`);
  const entry = await loadClientBrandWorkspaceEntryV1(session.appUser, outputId);
  if (!entry) notFound();
  return <ClientBrandWorkspaceShell key={entry.requestScope} entry={{ name: entry.name, navigation: entry.navigation, requestScope: entry.requestScope }}
    userName={session.appUser.fullName ?? session.appUser.email ?? "Noisia"}>{children}</ClientBrandWorkspaceShell>;
}
