import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { StudioNav } from "@/components/layout/StudioNav";
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
    <>
      <StudioNav activeSection="team" user={session.appUser} />
      <main className="app-content">
        <div className="studio-page">
          <header className="page-head">
            <div>
              <p className="vitals-eyebrow">{t("eyebrow")}</p>
              <h1 className="page-head-title">{t("title")}</h1>
              <p className="page-head-sub">{t("subtitle")}</p>
            </div>
          </header>

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
      </main>
    </>
  );
}
