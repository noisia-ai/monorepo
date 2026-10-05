import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { users } from "@noisia/db";
import { db } from "@/lib/db";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { requirePortalUser } from "@/lib/auth/guards";
import { revokeAllClientBrandAccess } from "@/lib/auth/org-sync";
import {
  founderRecoveryAllowed,
  founderRecoveryConfigFromEnvironment
} from "@/lib/auth/founder-recovery";

export const dynamic = "force-dynamic";

async function activateFounderAccess() {
  "use server";

  const session = await getAuthenticatedAppUser();
  if (!session) notFound();
  const config = founderRecoveryConfigFromEnvironment();
  const subject = {
    email: session.appUser.email,
    kindeEmail: session.kindeUser.email ?? "",
    kindeId: session.kindeUser.id,
    primaryRole: session.appUser.primaryRole,
    userType: session.appUser.userType,
    organizationId: session.appUser.organizationId,
    status: session.appUser.status
  };
  if (!founderRecoveryAllowed(subject, config)) notFound();

  await db.transaction(async (tx) => {
    const [current] = await tx.select({
      id: users.id,
      email: users.email,
      primaryRole: users.primaryRole,
      userType: users.userType,
      organizationId: users.organizationId,
      status: users.status
    }).from(users).where(eq(users.id, session.appUser.id)).for("update");
    if (!current || !founderRecoveryAllowed({
      ...current,
      kindeEmail: subject.kindeEmail,
      kindeId: subject.kindeId
    }, config)) throw new Error("Founder access recovery state changed");

    await tx.update(users).set({
      primaryRole: "noisia_admin",
      userType: "noisia_internal",
      organizationId: null
    }).where(eq(users.id, current.id));
    await revokeAllClientBrandAccess(current.id, tx);
  });

  redirect("/studio");
}

export default async function FounderRecoveryPage() {
  const session = await requirePortalUser("/founder-recovery");
  const t = await getTranslations("FounderRecovery");
  if (!founderRecoveryAllowed({
    email: session.appUser.email,
    kindeEmail: session.kindeUser.email ?? "",
    kindeId: session.kindeUser.id,
    primaryRole: session.appUser.primaryRole,
    userType: session.appUser.userType,
    organizationId: session.appUser.organizationId,
    status: session.appUser.status
  }, founderRecoveryConfigFromEnvironment())) notFound();

  return <main className="admin-workspace-page">
    <h1>{t("title")}</h1>
    <p>{t("description")}</p>
    <form action={activateFounderAccess}>
      <button type="submit">{t("activate")}</button>
    </form>
  </main>;
}
