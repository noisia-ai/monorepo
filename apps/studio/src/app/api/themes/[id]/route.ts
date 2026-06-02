import { eq, sql } from "drizzle-orm";

import { studyCorpora, themes } from "@noisia/db";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getThemeDetailForUser } from "@/lib/data/themes";
import { db } from "@/lib/db";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id } = await params;
  const current = await getThemeDetailForUser(session.appUser, id);

  if (!current) {
    return Response.json(
      { error: "not_found", message: "Theme no encontrado o sin acceso." },
      { status: 404 }
    );
  }

  const permanent = new URL(request.url).searchParams.get("permanent") === "true";

  if (permanent) {
    if (current.status !== "archived") {
      return Response.json(
        { error: "archive_required", message: "Archiva el theme antes de borrarlo permanentemente." },
        { status: 422 }
      );
    }

    await permanentlyDeleteTheme(current.id);
    return Response.json({ data: { id: current.id, deleted: true }, mode: "permanent" });
  }

  const [corporaCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(studyCorpora)
    .where(eq(studyCorpora.themeId, current.id));

  if ((corporaCount?.total ?? 0) > 0) {
    const [updated] = await db
      .update(themes)
      .set({ status: "archived" })
      .where(eq(themes.id, current.id))
      .returning({ id: themes.id, status: themes.status });

    return Response.json({
      data: updated ?? { id: current.id, status: "archived" },
      mode: "archived",
      message: "El theme tiene corpora asociados; se archivó para conservar el historial."
    });
  }

  await permanentlyDeleteTheme(current.id);
  return Response.json({ data: { id: current.id, deleted: true }, mode: "deleted" });
}

async function permanentlyDeleteTheme(themeId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM published_outputs
      WHERE theme_id = ${themeId}
         OR study_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`
      DELETE FROM tb_analyses
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`
      DELETE FROM mentions
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`
      DELETE FROM import_batches
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`
      DELETE FROM query_iterations
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`
      DELETE FROM cleanup_actions
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`
      DELETE FROM corpus_snapshots
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`
      DELETE FROM brand_knowledge_sources
      WHERE study_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`
      DELETE FROM memory_brand
      WHERE source_corpus_id IN (SELECT id FROM study_corpora WHERE theme_id = ${themeId})
    `);
    await tx.execute(sql`DELETE FROM study_corpora WHERE theme_id = ${themeId}`);
    await tx.execute(sql`DELETE FROM themes WHERE id = ${themeId}`);
  });
}
