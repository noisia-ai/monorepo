import { z } from "zod";

import {
  decideSignalSemanticContextLocaleAuthorityProductV1,
  SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1,
  SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2
} from "@/lib/data-os/signal-semantic-context-publication-v2";
import {
  loadSignalWorkspaceContextForSemanticContextManagement,
  requireIdempotencyKey,
  semanticContextError,
  semanticContextResponse
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const key = z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const rationale = z.string().transform((value) => value.trim().normalize("NFC")).refine((value) => {
  const scalarCount = [...value].length;
  return scalarCount >= 1 && scalarCount <= 1000;
}, "rationale must contain between 1 and 1000 Unicode scalar values");
const command = z.discriminatedUnion("disposition", [
  z.object({
    generation_key: key,
    element_keys: z.array(key).min(1).max(15)
      .refine((keys) => new Set(keys).size === keys.length, "element_keys must be unique"),
    disposition: z.literal("global"),
    locale: z.null(),
    reason: z.enum(SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2),
    rationale,
    confirmation: z.literal(SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1)
  }).strict(),
  z.object({
    generation_key: key,
    element_keys: z.array(key).min(1).max(15)
      .refine((keys) => new Set(keys).size === keys.length, "element_keys must be unique"),
    disposition: z.literal("locale_specific"),
    locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u),
    reason: z.enum(SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2),
    rationale,
    confirmation: z.literal(SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1)
  }).strict()
]);

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const params = await context.params;
  const loaded = await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) {
    return semanticContextResponse({
      error: "idempotency_key_required",
      message: "Idempotency-Key is required."
    }, 400);
  }
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return semanticContextResponse({
      error: "invalid_semantic_context_locale_authority_decision",
      message: "The locale authority decision is invalid.",
      details: parsed.error.flatten()
    }, 422);
  }
  try {
    return semanticContextResponse(await decideSignalSemanticContextLocaleAuthorityProductV1({
      workspace: loaded.workspace,
      actor: loaded.session.appUser,
      idempotencyKey,
      generationKey: parsed.data.generation_key,
      elementKeys: parsed.data.element_keys,
      disposition: parsed.data.disposition,
      locale: parsed.data.locale,
      reason: parsed.data.reason,
      rationale: parsed.data.rationale,
      confirmation: parsed.data.confirmation
    }));
  } catch (error) {
    return semanticContextError(error, "semantic_context_locale_authority_decision_rejected");
  }
}
