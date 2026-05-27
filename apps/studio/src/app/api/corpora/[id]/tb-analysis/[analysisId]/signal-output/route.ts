import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { publishedOutputs } from "@noisia/db";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser, getTbAnalysisForCorpus } from "@/lib/data/corpora";
import { db } from "@/lib/db";
import { buildSignalPayload, normalizeSignalManifest } from "@/lib/signal/build";
import { defaultSignalManifest } from "@/lib/signal/manifest";

const bodySchema = z.object({
  title: z.string().min(3).max(140),
  headline: z.string().min(3).max(220).optional().nullable(),
  summary: z.string().min(3).max(700).optional().nullable(),
  manifest: z.record(z.boolean()).optional(),
  action: z.enum(["save_draft", "publish"]).default("save_draft")
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id, analysisId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const state = await getTbAnalysisForCorpus(corpus.id, analysisId);
  if (!state) {
    return Response.json({ error: "not_found", message: "Analysis not found." }, { status: 404 });
  }

  if (!["approved_by_im", "approved_by_kam"].includes(state.analysis.status)) {
    return Response.json(
      {
        error: "analysis_not_approved",
        message: "Primero aprueba la síntesis antes de preparar Signal."
      },
      { status: 409 }
    );
  }

  const manifest = normalizeSignalManifest({
    ...defaultSignalManifest,
    ...parsed.data.manifest
  });
  const payload = buildSignalPayload({
    state,
    corpus,
    manifest,
    headline: parsed.data.headline,
    summary: parsed.data.summary
  });
  const isPublish = parsed.data.action === "publish";

  // TODO mejora-futura: versionar cada publish como snapshot inmutable.
  // MVP mantiene un output narrativo por analisis y actualiza el payload.
  const [output] = await db
    .insert(publishedOutputs)
    .values({
      tbAnalysisId: state.analysis.id,
      studyCorpusId: corpus.id,
      brandId: corpus.brandId,
      themeId: corpus.themeId,
      methodologySlug: corpus.methodologySlug ?? "triggers-barriers",
      outputType: "narrative_dashboard",
      status: isPublish ? "published" : "draft",
      title: parsed.data.title,
      headline: parsed.data.headline,
      summary: parsed.data.summary,
      manifest,
      payload,
      createdByUserId: session.appUser.id,
      publishedByUserId: isPublish ? session.appUser.id : null,
      publishedAt: isPublish ? new Date() : null,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [publishedOutputs.tbAnalysisId, publishedOutputs.outputType],
      set: {
        status: isPublish ? "published" : "draft",
        title: parsed.data.title,
        headline: parsed.data.headline,
        summary: parsed.data.summary,
        manifest,
        payload,
        publishedByUserId: isPublish ? session.appUser.id : null,
        publishedAt: isPublish ? new Date() : null,
        archivedAt: null,
        updatedAt: new Date()
      }
    })
    .returning({
      id: publishedOutputs.id,
      status: publishedOutputs.status,
      title: publishedOutputs.title
    });

  return Response.json({ ok: true, output });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id, analysisId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const [output] = await db
    .select({
      id: publishedOutputs.id,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      status: publishedOutputs.status,
      manifest: publishedOutputs.manifest,
      publishedAt: publishedOutputs.publishedAt
    })
    .from(publishedOutputs)
    .where(and(eq(publishedOutputs.tbAnalysisId, analysisId), eq(publishedOutputs.outputType, "narrative_dashboard")))
    .limit(1);

  return Response.json({ output: output ?? null });
}
