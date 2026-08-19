import { redirect } from "next/navigation";

import { canonicalAppUrl } from "@/lib/auth/redirects";
import { getSearchParam, resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function AuthContinuePage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const params = await resolveSearchParams(searchParams);
  const next = getSearchParam(params, "next");
  const continueUrl = next
    ? `/auth/continue/complete?next=${encodeURIComponent(next)}`
    : "/auth/continue/complete";

  redirect(canonicalAppUrl(continueUrl));
}
