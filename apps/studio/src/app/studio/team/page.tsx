import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { TeamManager } from "@/components/team/TeamManager";
import { canManageTeam } from "@/lib/auth/roles";
import { requireStudioUser } from "@/lib/auth/guards";
import { listOrganizationsForAdmin, listPendingInvitations, listTeamMembers } from "@/lib/data/team";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const t = await getTranslations("Team");
  const session = await requireStudioUser("/studio/team");

  // Sólo Noisia admin gestiona el equipo (analistas no).
  if (!canManageTeam(session.appUser.primaryRole)) {
    redirect("/unauthorized?next=/studio/team");
  }

  const [members, invitations, organizations] = await Promise.all([
    listTeamMembers(),
    listPendingInvitations(),
    listOrganizationsForAdmin()
  ]);

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        eyebrow={t("eyebrow")}
        subtitle={t("subtitle")}
        title={t("title")}
      />

      <TeamManager
        currentUserId={session.appUser.id}
        members={members.map((m) => ({
          ...m,
          lastLoginAt: m.lastLoginAt ? m.lastLoginAt.toISOString() : null,
          createdAt: m.createdAt.toISOString()
        }))}
        invitations={invitations.map((i) => ({
          ...i,
          expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
          createdAt: i.createdAt.toISOString()
        }))}
        organizations={organizations.map((o) => ({
          id: o.id,
          name: o.displayName ?? o.legalName,
          slug: o.slug,
          legalName: o.legalName,
          hqCountry: o.hqCountry,
          industryPrimary: o.industryPrimary,
          status: o.status,
          usersCount: o.usersCount,
          pendingInvitationsCount: o.pendingInvitationsCount,
          brandsCount: o.brandsCount,
          activeBrandsCount: o.activeBrandsCount,
          activeCorporaCount: o.activeCorporaCount,
          themesCount: o.themesCount
        }))}
      />
    </div>
  );
}
