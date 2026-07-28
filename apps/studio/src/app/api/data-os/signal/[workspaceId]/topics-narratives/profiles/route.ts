import { z } from "zod";

import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import { forbidden, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import {
  createSignalTaxonomyDraftV1,
  listSignalTaxonomyProfilesV1,
  loadSignalTaxonomyDiscoveryContextV1
} from "@/lib/data-os/signal-topics-narratives-admin";
import { loadSignalTaxonomyCoverageV1 } from "@/lib/data-os/signal-topics-narratives-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const termSchema = z.object({
  term_key: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  definition: z.string().min(1).max(800),
  statement: z.string().min(1).max(300).nullable().optional(),
  examples: z.array(z.string().min(1).max(500)).min(1).max(20),
  exclusions: z.array(z.string().min(1).max(500)).max(20).default([])
});

const proposalSchema = z.object({
  kind: z.enum(["topic", "narrative"]),
  terms: z.array(termSchema).min(1).max(100),
  provider: z.enum(["anthropic", "operator"]),
  model_version: z.string().min(1).max(160),
  prompt_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  expected_context_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u).optional()
});

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (
    !loaded.isInternalUser
    || !canManageCorpus(loaded.session.appUser.primaryRole)
  ) return forbidden();
  const kind = new URL(request.url).searchParams.get("discovery_context");
  const searchParams = new URL(request.url).searchParams;
  if (searchParams.get("coverage") === "true") {
    return Response.json(
      await loadSignalTaxonomyCoverageV1({
        workspace: loaded.workspace,
        include_emerging_candidates:
          searchParams.get("include_emerging_candidates") === "true"
      }),
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
  if (kind === "topic" || kind === "narrative") {
    return Response.json(
      await loadSignalTaxonomyDiscoveryContextV1(loaded.workspace, kind),
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
  return Response.json(
    await listSignalTaxonomyProfilesV1(loaded.workspace),
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (
    !loaded.isInternalUser
    || !canManageCorpus(loaded.session.appUser.primaryRole)
  ) return forbidden();
  const parsed = proposalSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const draft = await createSignalTaxonomyDraftV1({
      workspace: loaded.workspace,
      input: {
        ...parsed.data,
        terms: parsed.data.terms.map((term) => ({
          ...term,
          statement: term.statement ?? null
        }))
      }
    });
    return Response.json(draft, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    return Response.json({
      error: "invalid_filter",
      message: error instanceof Error ? error.message : "Invalid taxonomy proposal."
    }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
