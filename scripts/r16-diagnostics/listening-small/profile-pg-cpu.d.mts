export type AvailabilityV1 = 'observed' | 'partial' | 'unavailable';
export interface ProcStatV1 {
  pid: number; comm: string; state: string;
  utime_ticks: string; stime_ticks: string; starttime_ticks: string;
}
export interface CgroupSampleV1 {
  status: AvailabilityV1; reason_codes: string[]; version: 'v1' | 'v2' | null;
  scope: 'private-root' | null; usage_ns: string | null; user_ns: string | null; system_ns: string | null;
}
export interface PostgresSampleV1 {
  status: AvailabilityV1; reason_codes: string[]; clk_tck: string; postmaster_pid: number;
  pids: ProcStatV1[]; missing_pids: number[]; pid_limit_hit: boolean;
}
export interface PgCpuSnapshotV1 {
  status: AvailabilityV1; reason_codes: string[];
  sequence?: number; label?: string;
  ownership_binding_sha256?: string | null;
  bracket?: { start_ns: string; end_ns: string; wall_started_at: string; wall_ended_at: string };
  cgroup?: CgroupSampleV1; postgres?: PostgresSampleV1;
}
export interface PgCpuComparisonV1 {
  elapsed_ns: { minimum: string; maximum: string } | null;
  cgroup: { status: AvailabilityV1; reason_codes: string[]; usage_ns: string | null;
    user_ns: string | null; system_ns: string | null; version?: 'v1' | 'v2'; scope?: string };
  postgres: { status: AvailabilityV1; reason_codes: string[]; coverage: 'sampled_lower_bound';
    matched_cpu_ns: string | null; matched_pids: { pid: number; starttime_ticks: string; cpu_ticks: string; cpu_ns: string }[];
    unobserved_short_lived_processes_possible: true };
}
export interface PgCpuProfileV1 {
  contract: 'r16-pg-cpu-profile-v1'; target_sha: string; status: AvailabilityV1; reason_codes: string[];
  collector: { os_script_sha256: string; inspect_format_sha256: string; docker_endpoint: 'unix:///var/run/docker.sock' };
  ownership: null | { marker_sha256: string; container_id_sha256: string; image_id: string;
    started_at: string; postgres_system_identifier_sha256: string };
  limits: Readonly<Record<string, number>>;
  window: { start_ns: string; end_ns: string; wall_started_at: string; wall_ended_at: string;
    scope: 'collector_not_workload_use_named_snapshot_brackets' };
  snapshots: PgCpuSnapshotV1[]; delta: PgCpuComparisonV1 | null;
  consecutive_pairs: (PgCpuComparisonV1 & { before_sequence: number; after_sequence: number })[];
  waits: { status: 'unavailable'; reason_codes: string[] };
  sql_attribution: { status: 'unavailable'; reason_codes: string[] };
  overhead: { cgroup_includes_server_background_and_sampler: true; sampler_cpu_subtracted: false;
    docker_exec_per_sample: true; snapshot_reads_not_simultaneous: true };
  cleanup: { status: 'completed' | 'unavailable'; timers_cancelled: true; child_commands_awaited: boolean };
}
/** Marker must be mode0600 at targetRoot/.data/piloto-masivo/r16/labs/benchmark-pg17/pg-cpu-owned-marker.json.
 * It attests prior fresh-lab ownership AND existing native PG17 accreditation; this helper performs no SQL.
 * contract=r16-pg-cpu-owned-lab-v1, github_run_id/attempt/job, target_sha, container_id(full64hex),
 * container_started_at, container_image_id(sha256:64hex), loopback_port(string),
 * postgres_system_identifier_sha256, fresh_lab_owned=true, postgres_accredited=true.
 */
export function startPgCpuProfileV1(options: {
  targetRoot: string; targetSha: string; markerPath?: string;
  intervalMs?: 0 | 250; maxDurationMs?: number;
}): Promise<{
  snapshot(label: string): Promise<PgCpuSnapshotV1>;
  stop(reason?: string): Promise<PgCpuProfileV1>;
}>;
/** Pure parser, safe for Node's own /proc/self/task/<pid>/stat reader too. No OS reads. */
export function parseProcStatV1(text: string): ProcStatV1;
export function parseOsSampleV1(raw: string): { cgroup: CgroupSampleV1; postgres: PostgresSampleV1 };
export function compareSnapshotsV1(before: PgCpuSnapshotV1, after: PgCpuSnapshotV1): PgCpuComparisonV1;
export const PG_CPU_LIMITS_V1: Readonly<Record<string, number>>;
export const PG_CPU_INSPECT_FORMAT_V1: string;
