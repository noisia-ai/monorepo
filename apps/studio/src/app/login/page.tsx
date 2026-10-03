import { redirect } from "next/navigation";

import { loginPath, postLoginPath, safeRelativePath } from "@/lib/auth/redirects";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const [session, params] = await Promise.all([
    getAuthenticatedAppUser(),
    resolveSearchParams(searchParams)
  ]);
  const next = safeRelativePath(params.next, "/studio");

  if (session) {
    redirect(postLoginPath(session.appUser.primaryRole, next));
  }

  redirect(loginPath(next));
}
