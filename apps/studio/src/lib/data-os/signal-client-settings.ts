import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import { pool } from "@/lib/db";

export type SignalClientSettingsV1 = {
  workspace: {
    name: string;
    status: string;
    timezone: string;
  };
  data: {
    active_sources: number;
    visible_sources: Array<{
      name: string;
      provider: string;
      cadence: string;
      freshness: string;
    }>;
    overall_freshness: string;
  };
  profiles: Array<{
    kind: string;
    version: number;
  }>;
  access: {
    level: "workspace";
    state: "allowed";
  };
  report: {
    key: "triggers-barriers";
    state: string;
    revision: number | null;
  };
};

export async function loadSignalClientSettingsV1(
  workspace: ResolvedSignalWorkspace
): Promise<SignalClientSettingsV1> {
  const [sources, profiles, report] = await Promise.all([
    pool.query<{
      name: string;
      provider: string;
      cadence: string | null;
      freshness: string | null;
      visibility: string;
      status: string;
    }>(`
      SELECT source.name, source.provider, source.visibility, source.status,
        COALESCE(policy.cadence, 'manual') AS cadence,
        COALESCE(watermark.source_freshness_state, 'not_available') AS freshness
      FROM data_sources source
      LEFT JOIN signal_refresh_policies policy
        ON policy.workspace_id = source.workspace_id
       AND policy.data_source_id = source.id
      LEFT JOIN LATERAL (
        SELECT water.source_freshness_state
        FROM signal_data_watermarks water
        WHERE water.workspace_id = source.workspace_id
          AND water.data_source_id = source.id
        ORDER BY water.accepted_at DESC, water.id DESC
        LIMIT 1
      ) watermark ON true
      WHERE source.workspace_id = $1::uuid
        AND source.status <> 'archived'
      ORDER BY lower(source.name), source.id
    `, [workspace.id]),
    pool.query<{ kind: string; version: number }>(`
      SELECT kind, version
      FROM signal_taxonomy_profiles
      WHERE workspace_id = $1::uuid
        AND status = 'active'
      ORDER BY kind, version DESC
    `, [workspace.id]),
    pool.query<{ state: string | null; revision: number | null }>(`
      SELECT release.status AS state, release.report_revision AS revision
      FROM signal_workspace_reports report
      LEFT JOIN signal_workspace_report_current_releases pointer
        ON pointer.workspace_id = report.workspace_id
       AND pointer.report_key = report.report_key
      LEFT JOIN signal_workspace_releases release
        ON release.id = pointer.release_id
       AND release.workspace_id = report.workspace_id
       AND release.report_key = report.report_key
      WHERE report.workspace_id = $1::uuid
        AND report.report_key = 'triggers-barriers'
      LIMIT 1
    `, [workspace.id])
  ]);
  const active = sources.rows.filter((source) => source.status === "active");
  const visible = active.filter((source) => source.visibility === "client");
  return {
    workspace: {
      name: workspace.name,
      status: workspace.status,
      timezone: workspace.timezone
    },
    data: {
      active_sources: active.length,
      visible_sources: visible.map((source) => ({
        name: source.name,
        provider: source.provider,
        cadence: source.cadence ?? "manual",
        freshness: source.freshness ?? "not_available"
      })),
      overall_freshness: worstFreshness(active.map((source) => source.freshness))
    },
    profiles: profiles.rows.map((profile) => ({
      kind: profile.kind,
      version: Number(profile.version)
    })),
    access: { level: "workspace", state: "allowed" },
    report: {
      key: "triggers-barriers",
      state: report.rows[0]?.state ?? "not_available",
      revision: report.rows[0]?.revision == null ? null : Number(report.rows[0].revision)
    }
  };
}

function worstFreshness(states: Array<string | null>) {
  if (states.some((state) => state === "failed")) return "failed";
  if (states.some((state) => state === "stale")) return "stale";
  if (states.some((state) => state === "partial")) return "partial";
  if (states.some((state) => state === "fresh")) return "fresh";
  return "not_available";
}
