import { Job } from "bullmq";
import { isEngineRuntimeEnabled } from "@noisia/query-engine";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canAccessStudio } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getEngineAnalysisQueue } from "@/lib/queue/engine-analysis";
import { getQueryEngineQueue, isQueryEngineWorkerAlive } from "@/lib/queue/query-engine";
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
  const queue = queueName === "tb-analysis"
    ? getTbAnalysisQueue()
    : queueName === "engine-analysis"
      ? getEngineAnalysisQueue()
      : getQueryEngineQueue();
  const job = await Job.fromId(queue, id);

  if (!job) {
    return Response.json({ error: "not_found", message: "Job not found." }, { status: 404 });
  }

  const state = await job.getState();

  // worker_alive lets the client detect a "queued but nobody is consuming"
  // situation and fail fast instead of polling for minutes. We use an explicit
  // heartbeat key written by the worker because getWorkers()/CLIENT LIST is
  // unreliable on managed Redis (Upstash returns 0 even with a live worker).
  // tb-analysis is not instrumented, so we only assert liveness for query-engine.
  const workerAlive = queueName === "tb-analysis"
    ? true
    : queueName === "engine-analysis"
      ? isEngineRuntimeEnabled()
      : await isQueryEngineWorkerAlive();

  return Response.json({
    id: job.id,
    name: job.name,
    status: normalizeJobState(state),
    progress: typeof job.progress === "number" ? job.progress : 0,
    worker_alive: workerAlive,
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
