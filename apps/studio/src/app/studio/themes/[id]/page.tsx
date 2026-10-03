import { ArrowRight, GlobeSimple, SquaresFour, Tag } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import {
  AdminResourceSection,
  AdminSettingsRow,
  AdminStatus,
  AdminWorkspaceHeader,
  formatAdminDate
} from "@/components/admin/AdminWorkspacePrimitives";
import { DeleteThemeButton } from "@/components/brands/AdminEntityActions";
import { requireStudioUser } from "@/lib/auth/guards";
import type { AdminOperationalState } from "@/lib/data/admin-workspace";
import { getThemeDetailForUser } from "@/lib/data/themes";

export const dynamic = "force-dynamic";

export default async function ThemeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, t] = await Promise.all([getLocale(), getTranslations("AdminWorkspace.themes")]);
  const session = await requireStudioUser(`/studio/themes/${id}`);
  const theme = await getThemeDetailForUser(session.appUser, id);
  if (!theme) notFound();

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={<Link className="admin-button" href="/studio/themes" prefetch={false}>{t("detail.back")}</Link>}
        eyebrow={t("detail.eyebrow")}
        icon={<SquaresFour aria-hidden />}
        status={<AdminStatus state={themeState(theme.status)}>{t(`statuses.${theme.status}`)}</AdminStatus>}
        subtitle={theme.description || t("detail.noDescription")}
        title={theme.name}
      />

      <dl className="admin-summary-strip">
        <div><dt>{t("detail.summary.status")}</dt><dd>{t(`statuses.${theme.status}`)}</dd></div>
        <div><dt>{t("detail.summary.visibility")}</dt><dd>{theme.isPublic ? t("detail.public") : t("detail.private")}</dd></div>
        <div><dt>{t("detail.summary.focus")}</dt><dd>{theme.industryFocus?.length ?? 0}</dd></div>
        <div><dt>{t("detail.summary.studies")}</dt><dd>{theme.corpora.length}</dd></div>
      </dl>

      <div className="admin-two-column">
        <AdminResourceSection subtitle={t("detail.metadata.subtitle")} title={t("detail.metadata.title")}>
          <div className="admin-settings-list">
            <AdminSettingsRow description={theme.slug} icon={<Tag aria-hidden />} title={t("detail.metadata.slug")} />
            <AdminSettingsRow
              description={theme.geoFocus?.length ? theme.geoFocus.join(", ") : t("detail.notConfigured")}
              icon={<GlobeSimple aria-hidden />}
              title={t("detail.metadata.geo")}
            />
            <AdminSettingsRow
              description={theme.organizationName ?? theme.organizationSlug ?? t("internal")}
              icon={<SquaresFour aria-hidden />}
              title={t("detail.metadata.organization")}
            />
            <AdminSettingsRow
              description={formatAdminDate(theme.createdAt?.toISOString(), locale)}
              title={t("detail.metadata.created")}
            />
          </div>
        </AdminResourceSection>

        <AdminResourceSection className="admin-section--danger" subtitle={t("detail.remove.subtitle")} title={t("detail.remove.title")}>
          <div className="admin-section__body">
            <DeleteThemeButton themeId={theme.id} themeName={theme.name} isArchived={theme.status === "archived"} />
          </div>
        </AdminResourceSection>
      </div>

      <AdminResourceSection subtitle={t("detail.studies.subtitle")} title={t("detail.studies.title", { count: theme.corpora.length })}>
        {theme.corpora.length === 0 ? (
          <div className="admin-empty">
            <strong>{t("detail.studies.emptyTitle")}</strong>
            <p>{t("detail.studies.emptyBody")}</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>{t("detail.studies.columns.study")}</th><th>{t("detail.studies.columns.method")}</th><th>{t("detail.studies.columns.status")}</th><th>{t("detail.studies.columns.updated")}</th><th /></tr></thead>
              <tbody>
                {theme.corpora.map((corpus) => (
                  <tr key={corpus.id}>
                    <td><div className="admin-table__primary"><strong>{corpus.name ?? t("detail.studies.unnamed")}</strong><small>{corpus.businessQuestion ?? t("detail.studies.window", { months: corpus.targetWindowMonths ?? 0 })}</small></div></td>
                    <td>{corpus.methodologyName}</td>
                    <td><AdminStatus state={corpus.status === "corpus_approved" ? "good" : "warning"}>{corpus.status}</AdminStatus></td>
                    <td className="admin-table__muted">{formatAdminDate(corpus.updatedAt?.toISOString(), locale)}</td>
                    <td><Link className="admin-button admin-button--icon" href={`/studio/corpora/${corpus.id}/engine`} prefetch={false} title={t("detail.studies.open")}><ArrowRight aria-hidden size={15} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminResourceSection>
    </div>
  );
}

function themeState(status: string): AdminOperationalState {
  if (status === "active" || status === "published") return "good";
  if (status === "archived") return "not_available";
  return "warning";
}
