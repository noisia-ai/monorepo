import { redirect } from "next/navigation";

import { canAccessPortal, canAccessStudio } from "@/lib/auth/roles";
import { loginPath, sessionRefreshPath } from "@/lib/auth/redirects";
import { resolveAuthenticatedAppSession } from "@/lib/auth/session";

export async function requireStudioUser(next: string) {
  const { lifecycle, session } = await resolveAuthenticatedAppSession();

  if (!session) {
    if (lifecycle === "refresh_required") {
      redirect(sessionRefreshPath(next));
    }
    redirect(loginPath(next));
  }

  if (session.appUser.status === "suspended") {
    redirect(`/unauthorized?reason=suspended`);
  }

  if (!canAccessStudio(session.appUser.primaryRole)) {
    redirect(`/unauthorized?next=${encodeURIComponent(next)}`);
  }

  return session;
}

export async function requirePortalUser(next = "/portal") {
  const { lifecycle, session } = await resolveAuthenticatedAppSession();

  if (!session) {
    if (lifecycle === "refresh_required") {
      redirect(sessionRefreshPath(next));
    }
    redirect(loginPath(next));
  }

  if (session.appUser.status === "suspended") {
    redirect(`/unauthorized?reason=suspended`);
  }

  if (!canAccessPortal(session.appUser.primaryRole)) {
    redirect(`/unauthorized?next=${encodeURIComponent(next)}`);
  }

  return session;
}
