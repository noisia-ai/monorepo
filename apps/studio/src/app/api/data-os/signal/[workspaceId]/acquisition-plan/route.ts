import { z } from "zod";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  loadSignalAcquisitionPlanProductV1,
  reconcileSignalAcquisitionPlanDraftV1,
  withSignalAcquisitionTransactionV1
} from "@/lib/data-os/signal-acquisition-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reconcile = z.object({
  expected_current_version: z.number().int().positive().nullable(),
  expected_brand_os_revision: z.number().int().positive().nullable()
}).strict();

export async function GET(_request: Request,context: { params: Promise<{ workspaceId: string }> }) {
  const loaded = await managed(await context.params);
  if ("response" in loaded) return loaded.response;
  try {
    const result = await loadSignalAcquisitionPlanProductV1({
      workspace: loaded.workspace,actor: loaded.session.appUser
    });
    return Response.json(result,{ headers: privateHeaders() });
  } catch { return rejected("acquisition_plan_unavailable"); }
}

export async function POST(request: Request,context: { params: Promise<{ workspaceId: string }> }) {
  const loaded = await managed(await context.params);
  if ("response" in loaded) return loaded.response;
  const key = idempotencyKey(request);
  if (!key) return missingKey();
  const parsed = reconcile.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return invalid(parsed.error.flatten());
  try {
    const result = await withSignalAcquisitionTransactionV1((queryable) => (
      reconcileSignalAcquisitionPlanDraftV1({ queryable,workspace: loaded.workspace,
        actor: loaded.session.appUser,idempotencyKey: key,
        expectedCurrentVersion: parsed.data.expected_current_version,
        expectedBrandOsRevision: parsed.data.expected_brand_os_revision })
    ));
    return Response.json(result,{ headers: privateHeaders() });
  } catch { return rejected("acquisition_plan_reconcile_rejected"); }
}

async function managed(params: { workspaceId: string }) {
  const loaded = await loadSignalWorkspaceContextForManagement(params.workspaceId);
  if ("response" in loaded) return loaded;
  if (loaded.session.appUser.userType!=="noisia_internal") return {
    response: Response.json({ error: "forbidden",message: "Acquisition management requires an internal operator." },{ status: 403 })
  } as const;
  return loaded;
}
function privateHeaders() { return { "Cache-Control": "private, no-store" }; }
function idempotencyKey(request: Request) { const key=request.headers.get("Idempotency-Key")?.trim()??"";return key.length>=8&&key.length<=500?key:null; }
function missingKey(){return Response.json({error:"idempotency_key_required",message:"Idempotency-Key is required."},{status:400,headers:privateHeaders()});}
function invalid(details:unknown){return Response.json({error:"invalid_acquisition_command",message:"The acquisition command is invalid.",details},{status:422,headers:privateHeaders()});}
function rejected(code:string){return Response.json({error:code,message:"The acquisition operation could not be applied to the current workspace state."},{status:409,headers:privateHeaders()});}
