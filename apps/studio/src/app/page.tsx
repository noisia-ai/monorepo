import { redirect } from "next/navigation";

import { loginPath } from "@/lib/auth/redirects";
import { defaultAuthenticatedPath } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getAuthenticatedAppUser();

  if (session) {
    redirect(defaultAuthenticatedPath(session.appUser.primaryRole));
  }

  redirect(loginPath("/studio"));
}
