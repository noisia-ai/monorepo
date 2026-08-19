import Link from "next/link";
import {
  ArrowRight,
  ClockCountdown,
  FileText,
  Gear,
  ShieldCheck,
  Stack,
  Trash,
  UsersThree
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  AdminResourceSection,
  AdminSettingsRow,
  AdminStatus,
  AdminWorkspaceHeader
} from "@/components/admin/AdminWorkspacePrimitives";
import { DeleteBrandButton } from "@/components/brands/AdminEntityActions";
import { requireStudioUser } from "@/lib/auth/guards";
import { canManageTeam } from "@/lib/auth/roles";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";

export const dynamic = "force-dynamic";

export default async function BrandSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    requireStudioUser(`/studio/brands/${id}/settings`)
  ]);
  const workspace = await getAdminBrandWorkspace(session.appUser, id);
  if (!workspace) notFound();
  const { summary } = workspace;
  const report = workspace.reports.find((item) => item.reportKey === "triggers-barriers") ?? null;

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={(
          <Link className="admin-button" href={`/studio/brands/${summary.brandId}/brand-os`} prefetch={false}>
            {t("settings.actions.editBrand")}<ArrowRight aria-hidden size={14} />
          </Link>
        )}
        eyebrow={`${summary.brandName} · ${t("settings.eyebrow")}`}
        icon={<Gear aria-hidden size={21} weight="fill" />}
        subtitle={t("settings.subtitle")}
        title={t("settings.title")}
      />

      <div className="admin-settings-stack admin-settings-stack--workspace">
        <AdminResourceSection subtitle={t("settings.workspace.subtitle")} title={t("settings.workspace.title")}>
          <div className="admin-settings-list">
            <AdminSettingsRow icon={<ShieldCheck aria-hidden size={17} />} title={t("settings.workspace.status")} value={<AdminStatus state={summary.workspaceStatus === "active" ? "good" : "warning"}>{summary.workspaceStatus ? t(`states.${summary.workspaceStatus}`) : t("states.not_available")}</AdminStatus>} />
            <AdminSettingsRow icon={<ClockCountdown aria-hidden size={17} />} title={t("settings.workspace.timezone")} value={summary.timezone ?? "—"} />
            <AdminSettingsRow icon={<Stack aria-hidden size={17} />} title={t("settings.workspace.population")} value={summary.populationVersion ? t("settings.workspace.populationVersion", { version: summary.populationVersion }) : "—"} />
            <AdminSettingsRow icon={<UsersThree aria-hidden size={17} />} title={t("settings.workspace.access")} value={t("settings.workspace.people", { count: workspace.activeAccessCount })} />
          </div>
        </AdminResourceSection>

        <AdminResourceSection subtitle={t("settings.report.subtitle")} title={t("settings.report.title")}>
          <div className="admin-settings-list">
            <AdminSettingsRow icon={<FileText aria-hidden size={17} />} title={t("settings.report.registry")} value={<AdminStatus state={report?.status === "active" ? "good" : "warning"}>{report?.status ? t(`states.${report.status}`) : "—"}</AdminStatus>} />
            <AdminSettingsRow title={t("settings.report.current")} value={report?.currentRevision ? `r${report.currentRevision}` : "—"} />
            <AdminSettingsRow title={t("settings.report.review")} value={report?.runsNeedingReview ?? 0} />
            <AdminSettingsRow title={t("settings.report.compatibility")} value={workspace.compatibilityCorporaCount} />
          </div>
        </AdminResourceSection>

        <AdminResourceSection
          actions={<Link className="admin-button" href={`/studio/brands/${summary.brandId}/data`} prefetch={false}>{t("settings.cadence.manage")}<ArrowRight aria-hidden size={14} /></Link>}
          subtitle={t("settings.cadence.subtitle")}
          title={t("settings.cadence.title")}
        >
          {workspace.sources.length === 0 ? (
            <div className="admin-empty admin-empty--compact"><strong>{t("settings.cadence.empty")}</strong></div>
          ) : (
            <div className="admin-settings-list">
              {workspace.sources.map((source) => (
                <AdminSettingsRow
                  description={source.provider}
                  icon={<ClockCountdown aria-hidden size={17} />}
                  key={source.id}
                  title={source.name}
                  value={<span className="admin-status-stack">{t(`settings.cadence.values.${source.cadence ?? "manual"}`)}<AdminStatus state={source.status === "active" ? "good" : "warning"}>{t(`states.${source.status}`)}</AdminStatus></span>}
                />
              ))}
            </div>
          )}
        </AdminResourceSection>

        <AdminResourceSection subtitle={t("settings.profiles.subtitle")} title={t("settings.profiles.title")}>
          {workspace.profiles.length === 0 ? (
            <div className="admin-empty admin-empty--compact"><strong>{t("settings.profiles.empty")}</strong></div>
          ) : (
            <div className="admin-settings-list">
              {workspace.profiles.map((profile) => (
                <AdminSettingsRow
                  icon={<Stack aria-hidden size={17} />}
                  key={`${profile.kind}:${profile.version}`}
                  title={profile.kind}
                  value={<span className="admin-status-stack">v{profile.version}<AdminStatus state={profile.status === "active" ? "good" : "warning"}>{t(`states.${profile.status}`)}</AdminStatus></span>}
                />
              ))}
            </div>
          )}
        </AdminResourceSection>

        <AdminResourceSection subtitle={t("settings.access.subtitle")} title={t("settings.access.title")}>
          <div className="admin-settings-list">
            <AdminSettingsRow
              action={canManageTeam(session.appUser.primaryRole) ? <Link className="admin-button" href="/studio/team" prefetch={false}>{t("settings.access.manage")}<ArrowRight aria-hidden size={14} /></Link> : undefined}
              icon={<UsersThree aria-hidden size={17} />}
              title={t("settings.access.workspaceAccess")}
              value={t("settings.workspace.people", { count: workspace.activeAccessCount })}
            />
          </div>
        </AdminResourceSection>

        <AdminResourceSection className="admin-section--danger" subtitle={t("settings.archive.subtitle")} title={t("settings.archive.title")}>
          <div className="admin-settings-list">
            <AdminSettingsRow action={<DeleteBrandButton brandId={summary.brandId} brandName={summary.brandName} />} icon={<Trash aria-hidden size={17} />} title={t("settings.archive.actionTitle")} />
          </div>
        </AdminResourceSection>
      </div>
    </div>
  );
}
