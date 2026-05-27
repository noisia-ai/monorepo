import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { createCorpusSnapshot } from "@/lib/corpus/snapshots";
import { getCorpusForUser } from "@/lib/data/corpora";

/**
 * Create a manual snapshot of the current 'included' mention set.
 * Used from the maintenance panel.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  let label = "";
  try {
    const body = (await request.json()) as { label?: string };
    label = (body.label ?? "").trim().slice(0, 120);
  } catch {
    // no body
  }
  if (label.length === 0) {
    label = `Snapshot ${new Date().toISOString().slice(0, 10)}`;
  }

  const result = await createCorpusSnapshot({
    corpusId: corpus.id,
    label,
    kind: "manual",
    userId: session.appUser.id
  });

  if (!result) {
    return Response.json({ error: "db_error", message: "No se pudo crear snapshot." }, { status: 500 });
  }

  return Response.json(
    { ok: true, snapshot_id: result.id, mention_count: result.mention_count },
    { status: 201 }
  );
}
