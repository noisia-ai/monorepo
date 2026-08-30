import Link from "next/link";
import { ArrowRight, IdentificationCard } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  AdminStatus,
  AdminWorkspaceHeader
} from "@/components/admin/AdminWorkspacePrimitives";
import { BrandEditForm } from "@/components/brands/BrandEditForm";
import { CompetitorManager } from "@/components/brands/CompetitorManager";
import { FullEvidenceTopicEvaluationStatus } from "@/components/brands/FullEvidenceTopicEvaluationStatus";
import { KnowledgeBaseManager } from "@/components/brands/KnowledgeBaseManager";
import { SemanticContextPackManager } from "@/components/brands/SemanticContextPackManager";
import { TopicEvaluationManager } from "@/components/brands/TopicEvaluationManager";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { listOrganizationsForPicker } from "@/lib/data/team";

export const dynamic = "force-dynamic";

export default async function BrandOsWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    requireStudioUser(`/studio/brands/${id}/brand-os`)
  ]);
  const [brand, workspace, organizations] = await Promise.all([
    getBrandDetailForUser(session.appUser, id),
    getAdminBrandWorkspace(session.appUser, id),
    listOrganizationsForPicker()
  ]);
  if (!brand || !workspace) notFound();

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={(
          <Link className="admin-button" href={`/studio/brands/${brand.id}`} prefetch={false}>
            {t("brandOs.back")}<ArrowRight aria-hidden size={14} />
          </Link>
        )}
        eyebrow={t("brandOs.eyebrow")}
        icon={<IdentificationCard aria-hidden size={21} weight="fill" />}
        subtitle={t("brandOs.subtitle")}
        title={t("brandOs.title", { brand: brand.displayName ?? brand.name })}
      />

      <BrandEditForm
        brand={{ ...brand, timezone: workspace.summary.timezone ?? "UTC" }}
        organizations={organizations.map((organization) => ({
          id: organization.id,
          name: organization.name ?? organization.legalName
        }))}
      />

      <CompetitorManager brandId={brand.id} competitors={brand.competitors} />
      <KnowledgeBaseManager brandId={brand.id} sources={brand.knowledgeSources} />
      {workspace.summary.workspaceId ? (
        <>
          <SemanticContextPackManager workspaceId={workspace.summary.workspaceId} />
          <TopicEvaluationManager workspaceId={workspace.summary.workspaceId} />
          <FullEvidenceTopicEvaluationStatus workspaceId={workspace.summary.workspaceId} />
        </>
      ) : null}

      <section className="admin-section workspace-resource-section">
        <header className="admin-section__head">
          <div>
            <h2>{t("brandOs.compatibility.title")}</h2>
            <p>{t("brandOs.compatibility.subtitle")}</p>
          </div>
          <Link className="admin-button" href={`/studio/corpora/new?brand=${brand.id}`} prefetch={false}>
            {t("brandOs.compatibility.newStudy")}<ArrowRight aria-hidden size={14} />
          </Link>
        </header>
        {brand.corpora.length === 0 ? (
          <div className="admin-empty"><strong>{t("brandOs.compatibility.emptyTitle")}</strong><p>{t("brandOs.compatibility.emptyBody")}</p></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>{t("brandOs.compatibility.study")}</th><th>{t("brandOs.compatibility.method")}</th><th>{t("brandOs.compatibility.status")}</th><th /></tr></thead>
              <tbody>{brand.corpora.map((corpus) => (
                <tr key={corpus.id}>
                  <td><div className="admin-table__primary"><strong>{corpus.name ?? corpus.businessQuestion ?? t("brandOs.compatibility.unnamed")}</strong><small>{corpus.businessQuestion}</small></div></td>
                  <td>{corpus.methodologyName}</td>
                  <td><AdminStatus>{corpus.status}</AdminStatus></td>
                  <td><Link className="admin-button" href={`/studio/corpora/${corpus.id}/engine`} prefetch={false}>{t("brandOs.compatibility.open")}<ArrowRight aria-hidden size={14} /></Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
