import { redirect } from "next/navigation";

import { canAccessPortal, canAccessStudio } from "@/lib/auth/roles";
import { loginPath } from "@/lib/auth/redirects";
import { getAuthenticatedAppUser } from "@/lib/auth/session";

export async function requireStudioUser(next: string) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    redirect(loginPath(next));
  }

  if (!canAccessStudio(session.appUser.primaryRole)) {
    redirect(`/unauthorized?next=${encodeURIComponent(next)}`);
  }

  return session;
}

export async function requirePortalUser(next = "/portal") {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    redirect(loginPath(next));
  }

  if (!canAccessPortal(session.appUser.primaryRole)) {
    redirect(`/unauthorized?next=${encodeURIComponent(next)}`);
  }

  return session;
}
