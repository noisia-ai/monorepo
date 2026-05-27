import { cleanupActions } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";

/**
 * Inserts the cleanup_actions row and queues a worker job to do the actual
 * UPDATEs (one per pattern, with progress reporting). The UI polls job
 * progress so the user sees real percentage instead of a fake spinner.
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

  let body: { instruction?: string; patterns?: string[]; reasoning?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "validation", message: "Body inválido." }, { status: 400 });
  }

  const instruction = (body.instruction ?? "").trim().slice(0, 2000);
  const patterns = (body.patterns ?? [])
    .map((p) => String(p).trim())
    .filter((p) => p.length >= 2)
    .slice(0, 20);
  const reasoning = (body.reasoning ?? "").slice(0, 500);

  if (patterns.length === 0) {
    return Response.json({ error: "validation", message: "Sin patrones para aplicar." }, { status: 422 });
  }

  const [action] = await db
    .insert(cleanupActions)
    .values({
      studyCorpusId: corpus.id,
      kind: "claude_instruction",
      instruction,
      patterns,
      claudeNotes: reasoning,
      mentionCount: 0,
      createdByUserId: session.appUser.id
    })
    .returning({ id: cleanupActions.id });

  if (!action) {
    return Response.json({ error: "db_error", message: "No se pudo registrar la acción." }, { status: 500 });
  }

  const queue = getQueryEngineQueue();
  const job = await queue.add(
    "cleanup_apply",
    {
      corpusId: corpus.id,
      cleanupActionId: action.id,
      patterns,
      instruction
    },
    { attempts: 1, removeOnComplete: { age: 60 * 60 } }
  );

  return Response.json(
    { job_id: job.id, cleanup_action_id: action.id, patterns_count: patterns.length, status: "queued" },
    { status: 202 }
  );
}
