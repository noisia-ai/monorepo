import { z } from "zod";

import { loadDataOsCorpusContext } from "../../../_lib/load";
import { validationError } from "@/lib/api/responses";
import {
  getDataOsReviewQueue,
  parseDataOsReviewQueueFilters,
  reviewDataOsAssertion,
  reviewDataOsTag
} from "@/lib/data-os/serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewQueueSchema = z.object({
  action: z.enum(["approve", "reject", "needs_review"]),
  assertion_id: z.string().uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
  tag_id: z.string().uuid().optional()
}).refine((value) => Boolean(value.tag_id) !== Boolean(value.assertion_id), {
  message: "Provide exactly one of tag_id or assertion_id.",
  path: ["tag_id"]
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadDataOsCorpusContext(id);
  if ("response" in loaded) return loaded.response;

  const searchParams = new URL(request.url).searchParams;
  return Response.json(await getDataOsReviewQueue(loaded.corpus.id, parseDataOsReviewQueueFilters(searchParams)));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadDataOsCorpusContext(id);
  if ("response" in loaded) return loaded.response;

  const parsed = reviewQueueSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  const reviewed = parsed.data.assertion_id
    ? await reviewDataOsAssertion(loaded.corpus.id, {
        action: parsed.data.action,
        assertionId: parsed.data.assertion_id,
        notes: parsed.data.notes,
        reviewerUserId: loaded.session.appUser.id
      })
    : await reviewDataOsTag(loaded.corpus.id, {
        action: parsed.data.action,
        notes: parsed.data.notes,
        reviewerUserId: loaded.session.appUser.id,
        tagId: parsed.data.tag_id as string
      });

  if (!reviewed) {
    return Response.json(
      { error: "not_found", message: "Review target not found in this corpus." },
      { status: 404 }
    );
  }

  return Response.json({
    ...reviewed,
    target_type: parsed.data.assertion_id ? "assertion" : "tag"
  });
}
