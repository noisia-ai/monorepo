import { forbidden, unauthorized } from "@/lib/api/responses";
import { canAccessStudio } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser, listQueryIterationsForCorpus } from "@/lib/data/corpora";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
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

  return Response.json({
    data: await listQueryIterationsForCorpus(corpus.id)
  });
}
