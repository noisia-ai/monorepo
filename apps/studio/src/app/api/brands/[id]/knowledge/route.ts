import { desc, eq } from "drizzle-orm";
import { brandKnowledgeSources } from "@noisia/db";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canCreateBrandOrTheme } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    return Response.json(
      { error: "not_found", message: "Brand not found or not accessible." },
      { status: 404 }
    );
  }

  const rows = await db
    .select()
    .from(brandKnowledgeSources)
    .where(eq(brandKnowledgeSources.brandId, brand.id))
    .orderBy(desc(brandKnowledgeSources.createdAt));

  return Response.json({ data: rows });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canCreateBrandOrTheme(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
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
    .insert(brandKnowledgeSources)
    .values({
      organizationId: brand.organizationId,
      brandId: brand.id,
      sourceKind,
      title,
      rawText,
      extractedPayload: {
        summary: rawText.slice(0, 1200),
        source: "manual_editor",
        recommended_use: ["query_composition", "analysis_context", "signal_editorial"]
      },
      status: "processed",
      createdByUserId: session.appUser.id
    })
    .returning();

  return Response.json({ data: row }, { status: 201 });
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
