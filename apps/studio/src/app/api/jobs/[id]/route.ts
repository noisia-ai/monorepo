import { Job } from "bullmq";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canAccessStudio } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";
import { getTbAnalysisQueue } from "@/lib/queue/tb-analysis";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canAccessStudio(session.appUser.primaryRole)) {
    return forbidden();
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const queueName = url.searchParams.get("queue");
  const queue = queueName === "tb-analysis" ? getTbAnalysisQueue() : getQueryEngineQueue();
  const job = await Job.fromId(queue, id);

  if (!job) {
    return Response.json({ error: "not_found", message: "Job not found." }, { status: 404 });
  }

  const state = await job.getState();

  return Response.json({
    id: job.id,
    name: job.name,
    status: normalizeJobState(state),
    progress: typeof job.progress === "number" ? job.progress : 0,
    data: job.data,
    result: job.returnvalue ?? null,
    failed_reason: job.failedReason ?? null
  });
}

function normalizeJobState(state: string) {
  if (state === "active") {
    return "running";
  }

  return state;
}
