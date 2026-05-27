import { forbidden, unauthorized } from "@/lib/api/responses";
import { canAccessStudio } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser, listMentionsForCorpus } from "@/lib/data/corpora";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canAccessStudio(session.appUser.primaryRole)) {
    return forbidden();
  }

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 50);

  const result = await listMentionsForCorpus(corpus.id, {
    inclusionStatus: searchParams.get("inclusion_status") ?? undefined,
    platform: searchParams.get("platform") ?? undefined,
    sentiment: searchParams.get("sentiment") ?? undefined,
    dateFrom: searchParams.get("date_from") ?? undefined,
    dateTo: searchParams.get("date_to") ?? undefined,
    cleanupKind: searchParams.get("cleanup_kind") ?? undefined,
    exclusionReason: searchParams.get("exclusion_reason") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    page,
    pageSize
  });

  return Response.json(result);
}
