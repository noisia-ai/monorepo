import { redirect } from "next/navigation";

import { postLoginPath } from "@/lib/auth/redirects";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getSearchParam, resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function AuthContinuePage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const session = await getAuthenticatedAppUser();
  const params = await resolveSearchParams(searchParams);
  const next = getSearchParam(params, "next");

  if (!session) {
    redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }

  redirect(postLoginPath(session.appUser.primaryRole, next));
}
