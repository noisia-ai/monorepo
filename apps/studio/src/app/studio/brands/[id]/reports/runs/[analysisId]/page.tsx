import { notFound } from "next/navigation";

import TbAnalysisReviewPage from "@/app/studio/corpora/[id]/analysis/[analysisId]/page";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Workspace-native Review entrypoint. The mature T&B Review surface remains a
 * shared server component while authority is resolved through workspace/report
 * identity; the browser never supplies an execution corpus as authority.
 */
export default async function StrategicRunReviewPage({
  params
}: {
  params: Promise<{ id: string; analysisId: string }>;
}) {
  const { id, analysisId } = await params;
  const session = await requireStudioUser(`/studio/brands/${id}/reports/runs/${analysisId}`);
  const workspace = await getAdminBrandWorkspace(session.appUser, id);
  if (!workspace?.summary.workspaceId) notFound();

  const scoped = await pool.query<{ study_corpus_id: string }>(
    `SELECT analysis.study_corpus_id::text
     FROM tb_analyses analysis
     JOIN signal_strategic_run_controls control
       ON control.workspace_id=analysis.workspace_id
      AND control.tb_analysis_id=analysis.id
      AND control.snapshot_id=analysis.snapshot_id
     WHERE analysis.id=$1::uuid
       AND analysis.workspace_id=$2::uuid
       AND analysis.report_key='triggers-barriers'
       AND analysis.strategic_contract_version='signal-tb-strategic-v2'`,
    [analysisId, workspace.summary.workspaceId]
  );
  const corpusId = scoped.rows[0]?.study_corpus_id;
  if (!corpusId) notFound();

  return TbAnalysisReviewPage({
    params: Promise.resolve({ id: corpusId, analysisId })
  });
}
