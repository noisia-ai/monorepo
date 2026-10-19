import { z, ZodError } from "zod";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { evaluateAssessmentNoiseEligibility } from "@/lib/corpus/assessment-noise";
import { advanceCorpusRevision } from "@/lib/corpus/revision";
import { getCorpusForUser } from "@/lib/data/corpora";
import { pool } from "@/lib/db";

const requestSchema = z.object({
  mode: z.enum(["preview", "apply"]),
  expected_revision: z.number().int().positive()
});

type CorpusRow = {
  corpus_revision: number;
  latest_assessed_revision: number | null;
  locked_by_analysis_id: string | null;
};

type AssessmentRow = {
  id: string;
  corpus_revision: number;
  population_size: number;
  sample_size: number;
  sample_strategy: string;
  status: string;
  model: string | null;
  pipeline_version: string;
};

type CountRow = {
  included_count: number;
  classified_included_count: number;
  noise_included_count: number;
};

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

    const body = requestSchema.parse(await request.json());
    const applying = body.mode === "apply";
    const client = await pool.connect();

    try {
      await client.query(
        applying
          ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
          : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );

      const corpusResult = await client.query<CorpusRow>(
        `
          SELECT corpus_revision, latest_assessed_revision, locked_by_analysis_id
          FROM study_corpora
          WHERE id = $1::uuid
          ${applying ? "FOR UPDATE" : ""}
        `,
        [corpus.id]
      );
      const currentCorpus = corpusResult.rows[0];
      if (!currentCorpus) {
        await client.query("ROLLBACK");
        return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
      }

      const assessmentResult = await client.query<AssessmentRow>(
        `
          SELECT
            id,
            corpus_revision,
            population_size,
            sample_size,
            sample_strategy,
            status,
            model,
            pipeline_version
          FROM corpus_assessments
          WHERE study_corpus_id = $1::uuid
            AND corpus_revision = $2
            AND status = 'completed'
          ORDER BY completed_at DESC NULLS LAST, started_at DESC
          LIMIT 1
        `,
        [corpus.id, currentCorpus.corpus_revision]
      );
      const assessment = assessmentResult.rows[0] ?? null;

      const countsResult = assessment
        ? await client.query<CountRow>(
            `
              SELECT
                (count(*) FILTER (WHERE m.inclusion_status = 'included'))::int AS included_count,
                (count(cam.mention_id) FILTER (WHERE m.inclusion_status = 'included'))::int
                  AS classified_included_count,
                (count(cam.mention_id) FILTER (
                  WHERE m.inclusion_status = 'included' AND cam.relevance = 'noise'
                ))::int AS noise_included_count
              FROM mentions m
              LEFT JOIN corpus_assessment_mentions cam
                ON cam.mention_id = m.id
               AND cam.corpus_assessment_id = $2::uuid
              WHERE m.study_corpus_id = $1::uuid
            `,
            [corpus.id, assessment.id]
          )
        : { rows: [{ included_count: 0, classified_included_count: 0, noise_included_count: 0 }] };
      const counts: CountRow = countsResult.rows[0] ?? {
        included_count: 0,
        classified_included_count: 0,
        noise_included_count: 0
      };

      const eligibility = evaluateAssessmentNoiseEligibility({
        expectedRevision: body.expected_revision,
        currentRevision: currentCorpus.corpus_revision,
        latestAssessedRevision: currentCorpus.latest_assessed_revision,
        lockedByAnalysisId: currentCorpus.locked_by_analysis_id,
        assessment: assessment
          ? {
              id: assessment.id,
              corpusRevision: assessment.corpus_revision,
              status: assessment.status,
              sampleStrategy: assessment.sample_strategy,
              populationSize: assessment.population_size,
              sampleSize: assessment.sample_size
            }
          : null,
        includedCount: counts.included_count,
        classifiedIncludedCount: counts.classified_included_count,
        noiseIncludedCount: counts.noise_included_count
      });

      if (!eligibility.ok) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: eligibility.code, message: eligibility.message },
          { status: 409 }
        );
      }

      if (!applying) {
        await client.query("COMMIT");
        return Response.json({
          ok: true,
          mode: "preview",
          impact: {
            assessment_id: eligibility.impact.assessmentId,
            corpus_revision: eligibility.impact.corpusRevision,
            included_count: eligibility.impact.includedCount,
            excluded_count: eligibility.impact.excludedCount,
            retained_count: eligibility.impact.retainedCount,
            noise_percentage: eligibility.impact.noisePercentage
          },
          reversible: true,
          raw_records_retained: true
        });
      }

      const actionId = crypto.randomUUID();
      const instruction = `Excluir ruido certificado por el diagnostico r${currentCorpus.corpus_revision}`;
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
          VALUES ($1::uuid, $2::uuid, 'assessment_noise', $3, $4::jsonb, 0, $5::uuid)
        `,
        [
          actionId,
          corpus.id,
          instruction,
          JSON.stringify({
            source: "corpus_assessment",
            assessment_id: assessment!.id,
            corpus_revision: currentCorpus.corpus_revision,
            relevance: "noise",
            sample_strategy: assessment!.sample_strategy,
            model: assessment!.model,
            pipeline_version: assessment!.pipeline_version
          }),
          session.appUser.id
        ]
      );

      const updated = await client.query<{ id: string }>(
        `
          UPDATE mentions m
          SET inclusion_status = 'excluded',
              exclusion_reason = $1,
              cleanup_action_id = $2::uuid,
              updated_at = now()
          FROM corpus_assessment_mentions cam
          WHERE cam.corpus_assessment_id = $3::uuid
            AND cam.mention_id = m.id
            AND cam.relevance = 'noise'
            AND m.study_corpus_id = $4::uuid
            AND m.inclusion_status = 'included'
          RETURNING m.id
        `,
        [instruction, actionId, assessment!.id, corpus.id]
      );
      const excludedCount = updated.rowCount ?? 0;

      if (excludedCount !== eligibility.impact.excludedCount) {
        throw new Error(
          `Assessment noise set changed during cleanup: expected ${eligibility.impact.excludedCount}, updated ${excludedCount}.`
        );
      }

      await client.query(
        "UPDATE cleanup_actions SET mention_count = $1 WHERE id = $2::uuid",
        [excludedCount, actionId]
      );
      const newRevision = await advanceCorpusRevision(corpus.id, client);
      await client.query("COMMIT");

      return Response.json({
        ok: true,
        mode: "apply",
        cleanup_action_id: actionId,
        excluded_count: excludedCount,
        retained_count: eligibility.impact.retainedCount,
        previous_revision: currentCorpus.corpus_revision,
        corpus_revision: newRevision,
        reversible: true,
        raw_records_retained: true
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string })?.code === "40001") {
        return Response.json(
          {
            error: "revision_conflict",
            message: "El corpus cambio durante la limpieza. Actualiza y vuelve a previsualizar."
          },
          { status: 409 }
        );
      }
      console.error("[assessment-noise] failed", error);
      return Response.json(
        { error: "cleanup_failed", message: "No se pudo excluir el ruido diagnosticado." },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);

    console.error("[assessment-noise] unexpected failure", error);
    return Response.json(
      { error: "cleanup_failed", message: "No se pudo excluir el ruido diagnosticado." },
      { status: 500 }
    );
  }
}
