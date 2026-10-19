import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { loadSignalAcquisitionPlanProductV1 } from "@/lib/data-os/signal-acquisition-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (loaded.session.appUser.userType!=="noisia_internal") {
    return Response.json({ error: "forbidden",message: "Acquisition readiness requires an internal operator." },{
      status: 403,headers: { "Cache-Control": "private, no-store" }
    });
  }
  try {
    const plan = await loadSignalAcquisitionPlanProductV1({
      workspace: loaded.workspace,actor: loaded.session.appUser
    });
    return Response.json({
      contract_version: plan.contract_version,state: plan.state,
      current_plan: plan.current_plan,draft_plan: plan.draft_plan,
      readiness: plan.readiness,
      drift: plan.current_plan?.blockers ?? []
    },{ headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "acquisition_readiness_unavailable",message: "Acquisition readiness is unavailable." },{
      status: 409,headers: { "Cache-Control": "private, no-store" }
    });
  }
}
