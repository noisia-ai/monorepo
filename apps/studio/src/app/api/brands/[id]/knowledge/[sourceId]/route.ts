import { and, eq } from "drizzle-orm";
import { brandKnowledgeSources } from "@noisia/db";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { db } from "@/lib/db";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id, sourceId } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const title = cleanText(body?.title, 180);
  const rawText = cleanText(body?.raw_text, 50000);
  const sourceKind = cleanText(body?.source_kind, 80) || "brand_brief";

  if (!title || !rawText) {
    return Response.json(
      { error: "validation_error", message: "Título y contenido son obligatorios." },
      { status: 422 }
    );
  }

  const [row] = await db
    .update(brandKnowledgeSources)
    .set({
      title,
      rawText,
      sourceKind,
      extractedPayload: {
        summary: rawText.slice(0, 1200),
        source: "manual_editor",
        recommended_use: ["query_composition", "analysis_context", "signal_editorial"]
      },
      status: "processed",
      errorMessage: null,
      updatedAt: new Date()
    })
    .where(and(eq(brandKnowledgeSources.id, sourceId), eq(brandKnowledgeSources.brandId, brand.id)))
    .returning();

  if (!row) {
    return Response.json(
      { error: "not_found", message: "Knowledge source not found for this brand." },
      { status: 404 }
    );
  }

  return Response.json({ data: row });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id, sourceId } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const [row] = await db
    .delete(brandKnowledgeSources)
    .where(and(eq(brandKnowledgeSources.id, sourceId), eq(brandKnowledgeSources.brandId, brand.id)))
    .returning({ id: brandKnowledgeSources.id });

  if (!row) {
    return Response.json(
      { error: "not_found", message: "Knowledge source not found for this brand." },
      { status: 404 }
    );
  }

  return Response.json({ data: row });
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
