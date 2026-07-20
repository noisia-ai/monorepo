import { z, ZodError } from "zod";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { advanceCorpusRevision } from "@/lib/corpus/revision";
import { pool } from "@/lib/db";

const bulkMentionSchema = z.object({
  mention_ids: z.array(z.string().uuid()).min(1).max(500),
  reason: z.string().trim().max(240).optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getAuthenticatedAppUser();
    if (!session) return unauthorized();
    if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

    const { id } = await context.params;
    const corpus = await getCorpusForUser(session.appUser, id);
    if (!corpus) {
      return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
    }

    const body = bulkMentionSchema.parse(await request.json());
    const actionId = crypto.randomUUID();
    const reason = body.reason?.trim() || "Exclusion manual desde browser de menciones";

    // TODO mejora-futura: convertir este reason libre en una taxonomia de limpieza
    // manual para poder auditar ruido por fuente y criterio humano.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO cleanup_actions (
            id,
            study_corpus_id,
            kind,
            instruction,
            patterns,
            mention_count,
            created_by_user_id
          )
          VALUES ($1::uuid, $2::uuid, 'manual_bulk', $3, $4::jsonb, 0, $5::uuid)
        `,
        [
          actionId,
          corpus.id,
          reason,
          JSON.stringify({ mention_ids: body.mention_ids, source: "mentions_browser" }),
          session.appUser.id
        ]
      );

      const updated = await client.query<{ id: string }>(
        `
          UPDATE mentions
          SET inclusion_status = 'excluded',
              exclusion_reason = $1,
              cleanup_action_id = $2::uuid,
              updated_at = now()
          WHERE study_corpus_id = $3::uuid
            AND id = ANY($4::uuid[])
            AND inclusion_status <> 'excluded'
          RETURNING id
        `,
        [reason, actionId, corpus.id, body.mention_ids]
      );

      await client.query(
        "UPDATE cleanup_actions SET mention_count = $1 WHERE id = $2::uuid",
        [updated.rowCount ?? 0, actionId]
      );
      const corpusRevision = (updated.rowCount ?? 0) > 0
        ? await advanceCorpusRevision(corpus.id, client)
        : null;
      await client.query("COMMIT");

      return Response.json({
        ok: true,
        cleanup_action_id: actionId,
        requested_count: body.mention_ids.length,
        excluded_count: updated.rowCount ?? 0,
        corpus_revision: corpusRevision
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[mentions-bulk] failed", error);
      return Response.json(
        { error: "bulk_failed", message: "No se pudieron excluir las menciones." },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    console.error("[mentions-bulk] unexpected failure", error);
    return Response.json(
      { error: "bulk_failed", message: "No se pudieron excluir las menciones." },
      { status: 500 }
    );
  }
}
