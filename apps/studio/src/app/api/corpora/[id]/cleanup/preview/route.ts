import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  let instruction = "";
  try {
    const body = (await request.json()) as { instruction?: string };
    instruction = (body.instruction ?? "").trim().slice(0, 2000);
  } catch {
    // no body
  }

  if (instruction.length < 8) {
    return Response.json(
      { error: "validation", message: "La instrucción es muy corta." },
      { status: 422 }
    );
  }

  const queue = getQueryEngineQueue();
  const job = await queue.add(
    "cleanup_preview",
    { corpusId: corpus.id, instruction, requestedByUserId: session.appUser.id },
    { attempts: 1, removeOnComplete: { age: 60 * 60 } }
  );

  return Response.json({ job_id: job.id, status: "queued" }, { status: 202 });
}
