import type { LabelingDatabaseV1 } from "./signal-mention-facets";
import { measureMassLabelingSmokeV1 } from "./signal-mass-labeling";
import { publishMassLabelingProductResultV2 } from "./signal-mass-labeling-product";

/** Free completion work always uses the run's sealed actor and frozen inputs. */
export async function finalizeMassLabelingProductRunV2(args: { database: LabelingDatabaseV1; run_id: string }) {
  const client = await args.database.connect();
  let run: { workspace_id: string; actor_user_id: string; smoke_root_limit: number | null } | undefined;
  try {
    run = (await client.query<{ workspace_id: string; actor_user_id: string; smoke_root_limit: number | null }>(`SELECT run.workspace_id,run.actor_user_id,mass.smoke_root_limit
      FROM signal_labeling_runs run JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id AND mass.workspace_id=run.workspace_id
      JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
      JOIN signal_workspace_features feature ON feature.workspace_id=run.workspace_id AND feature.feature='mass_labeling'
      WHERE run.id=$1 AND run.status='completed' AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v2'`, [args.run_id])).rows[0];
  } finally { client.release(); }
  if (!run) return { finalized: false };
  if (run.smoke_root_limit !== null) {
    const measured = await measureMassLabelingSmokeV1({ ...args, ...run });
    return { finalized: true, stage: "smoke" as const, metrics: measured.metrics };
  }
  const publication = await publishMassLabelingProductResultV2(args);
  return { finalized: true, stage: "publication" as const, published: publication.published };
}

/** A completed provider page can survive a process exit before measuring or
 * publishing. Retry time is operational state, independent of paid receipts. */
export async function drainMassLabelingProductFinalizationV2(args: { database: LabelingDatabaseV1 }) {
  const client = await args.database.connect();
  let id: string | undefined;
  try {
    id = (await client.query<{ id: string }>(`WITH candidate AS (
      SELECT run.id FROM signal_labeling_runs run
      JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id AND mass.workspace_id=run.workspace_id
      JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
      JOIN signal_workspace_features feature ON feature.workspace_id=run.workspace_id AND feature.feature='mass_labeling'
      WHERE run.status='completed' AND run.next_poll_at<=clock_timestamp()
        AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v2'
        AND (mass.smoke_root_limit IS NOT NULL AND mass.smoke_metrics IS NULL
          OR mass.smoke_root_limit IS NULL AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_selections selection WHERE selection.workspace_id=run.workspace_id))
      ORDER BY run.next_poll_at,run.created_at,run.id LIMIT 1 FOR UPDATE OF run SKIP LOCKED
    ) UPDATE signal_labeling_runs run SET next_poll_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp()
      FROM candidate WHERE run.id=candidate.id RETURNING run.id`)).rows[0]?.id;
  } finally { client.release(); }
  return id ? finalizeMassLabelingProductRunV2({ ...args, run_id: id }) : { finalized: false };
}
