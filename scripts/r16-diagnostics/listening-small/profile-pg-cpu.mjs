// CI-owned lab only. No SQL, credentials, host /proc, GUCs, or authority changes.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const PG_CPU_LIMITS_V1 = Object.freeze({ duration_ms: 300000, interval_ms: 250,
  snapshots: 1202, postgres_pids: 256, command_ms: 2000, command_kill_grace_ms: 100, command_close_grace_ms: 500, command_start_reserve_ms: 2600, command_bytes: 262144,
  sample_bytes: 3145728, artifact_bytes: 4194304, marker_bytes: 4096 });
const NAME = 'r16-benchmark-pg17';
const MARKER = '.data/piloto-masivo/r16/labs/benchmark-pg17/pg-cpu-owned-marker.json';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const unavailable = reason => ({ status: 'unavailable', reason_codes: [reason] });
const n = value => { if (!uint(value)) throw Error('counter_invalid'); return BigInt(value); };

// Select only nonsecret identity fields. Never serialize Config.Env or Config.Cmd.
export const PG_CPU_INSPECT_FORMAT_V1 = '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"restarting":{{json .State.Restarting}},"restart_count":{{json .RestartCount}},"image":{{json .Config.Image}},"image_id":{{json .Image}},"started_at":{{json .State.StartedAt}},"pid_mode":{{json .HostConfig.PidMode}},"privileged":{{json .HostConfig.Privileged}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"db_ok":{{ $ok := false }}{{range .Config.Env}}{{if eq . "POSTGRES_DB=noisia_mfp_ci"}}{{$ok = true}}{{end}}{{end}}{{$ok}},"user_ok":{{ $ok := false }}{{range .Config.Env}}{{if eq . "POSTGRES_USER=postgres"}}{{$ok = true}}{{end}}{{end}}{{$ok}},"mounts":[{{range $i,$m := .Mounts}}{{if $i}},{{end}}{"type":{{json $m.Type}},"name":{{json $m.Name}},"destination":{{json $m.Destination}}}{{end}}],"ports":{{json (index .NetworkSettings.Ports "5432/tcp")}}}';

// This finite command also has an in-container timeout. Only fixed OS files are read.
// Namespace-root verification prevents accidentally reporting host-wide cgroup CPU.
const OS_SCRIPT = String.raw`set -eu
export LC_ALL=C
printf 'R16PGCPU 1\n'
printf 'HZ '; getconf CLK_TCK
printf 'VERSION '; cat /var/lib/postgresql/data/PG_VERSION
read -r pm < /var/lib/postgresql/data/postmaster.pid
printf 'POSTMASTER %s\n' "$pm"
if [ "$(cat /proc/self/cgroup)" = '0::/' ] && awk '$4=="/" && $5=="/sys/fs/cgroup" && / - cgroup2 / {ok++} END{exit !(ok==1)}' /proc/self/mountinfo; then
  if [ -r /sys/fs/cgroup/cpu.stat ]; then
    printf 'CGROUP v2 private-root\n'
    awk '$1=="usage_usec" || $1=="user_usec" || $1=="system_usec" {print "CPU " $1 " " $2}' /sys/fs/cgroup/cpu.stat
  else printf 'CGROUP unavailable counters_missing\n'; fi
else
  cg=''
  for d in /sys/fs/cgroup/cpuacct /sys/fs/cgroup/cpu,cpuacct; do
    if [ -r "$d/cpuacct.usage" ] && awk -F: '$2 ~ /(^|,)cpuacct(,|$)/ && $3=="/" {ok++} END{exit !(ok==1)}' /proc/self/cgroup && awk -v d="$d" '$4=="/" && $5==d && / - cgroup / {ok++} END{exit !(ok==1)}' /proc/self/mountinfo; then cg="$d"; break; fi
  done
  if [ -n "$cg" ]; then printf 'CGROUP v1 private-root\nUSAGE '; cat "$cg/cpuacct.usage"
  else printf 'CGROUP unavailable namespace_unknown\n'; fi
fi
count=0
for d in /proc/[0-9]*; do
  if ! IFS= read -r comm < "$d/comm" 2>/dev/null; then continue; fi
  [ "$comm" = postgres ] || continue
  count=$((count+1)); if [ "$count" -gt 256 ]; then printf 'LIMIT\n'; break; fi
  if IFS= read -r line < "$d/stat" 2>/dev/null; then printf 'PGSTAT %s\n' "$line"
  else printf 'MISSING %s\n' "$(basename "$d")"; fi
done
printf 'END\n'`;

/** Pure Linux /proc/<pid>/stat parser. All tick counters remain decimal strings. */
export function parseProcStatV1(text) {
  if (typeof text !== 'string' || text.length > 8192 || text.includes('\n')) throw Error('proc_stat_invalid');
  const match = /^([1-9][0-9]*) \((.*)\) ([^]*)$/.exec(text);
  if (!match) throw Error('proc_stat_invalid');
  const fields = match[3].trim().split(/\s+/);
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]) ||
    ![fields[11], fields[12], fields[19]].every(uint)) throw Error('proc_stat_invalid');
  return { pid, comm: match[2], state: fields[0], utime_ticks: fields[11], stime_ticks: fields[12], starttime_ticks: fields[19] };
}

export function parseOsSampleV1(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > PG_CPU_LIMITS_V1.command_bytes) throw Error('os_sample_invalid');
  const lines = raw.trimEnd().split('\n');
  if (lines.shift() !== 'R16PGCPU 1' || lines.pop() !== 'END') throw Error('os_sample_invalid');
  const values = {}, counters = {}, pids = [], missing = [], seen = new Set(); let limited = false;
  for (const line of lines) {
    if (line.startsWith('PGSTAT ')) {
      const p = parseProcStatV1(line.slice(7));
      if (p.comm !== 'postgres' || seen.has(p.pid) || pids.length >= 256) throw Error('os_sample_invalid');
      seen.add(p.pid); pids.push(p);
    } else if (line.startsWith('CPU ')) {
      const m = /^CPU (usage_usec|user_usec|system_usec) ([0-9]+)$/.exec(line);
      if (!m || counters[m[1]] !== undefined || !uint(m[2])) throw Error('os_sample_invalid'); counters[m[1]] = m[2];
    } else if (/^MISSING [1-9][0-9]*$/.test(line)) {
      const pid = Number(line.slice(8)); if (!Number.isSafeInteger(pid) || missing.includes(pid) || missing.length >= 256) throw Error('os_sample_invalid'); missing.push(pid);
    } else if (line === 'LIMIT' && !limited) limited = true;
    else {
      const m = /^(HZ|VERSION|POSTMASTER|CGROUP|USAGE) (.+)$/.exec(line);
      if (!m || values[m[1]] !== undefined) throw Error('os_sample_invalid'); values[m[1]] = m[2];
    }
  }
  if (!uint(values.HZ) || n(values.HZ) === 0n || values.VERSION !== '17' || !/^[1-9][0-9]*$/.test(values.POSTMASTER ?? '') || !Number.isSafeInteger(Number(values.POSTMASTER))) throw Error('os_identity_invalid');
  let cgroup;
  if (values.CGROUP === 'v2 private-root' && ['usage_usec', 'user_usec', 'system_usec'].every(k => uint(counters[k]))) {
    cgroup = { status: 'observed', reason_codes: [], version: 'v2', scope: 'private-root', usage_ns: String(n(counters.usage_usec) * 1000n), user_ns: String(n(counters.user_usec) * 1000n), system_ns: String(n(counters.system_usec) * 1000n) };
  } else if (values.CGROUP === 'v1 private-root' && uint(values.USAGE)) {
    cgroup = { status: 'observed', reason_codes: ['user_system_split_unavailable'], version: 'v1', scope: 'private-root', usage_ns: values.USAGE, user_ns: null, system_ns: null };
  } else {
    cgroup = { ...unavailable(values.CGROUP === 'unavailable namespace_unknown' ? 'namespace_unknown' : 'cgroup_counters_missing'), version: null, scope: null, usage_ns: null, user_ns: null, system_ns: null };
  }
  const reasons = []; if (missing.length) reasons.push('pid_read_missing'); if (limited) reasons.push('pid_limit');
  if (!pids.some(p => p.pid === Number(values.POSTMASTER))) reasons.push('postmaster_pid_missing');
  return { cgroup, postgres: { status: !pids.length ? 'unavailable' : reasons.length ? 'partial' : 'observed', reason_codes: !pids.length ? [...reasons, 'no_postgres_pids'] : reasons,
    clk_tck: values.HZ, postmaster_pid: Number(values.POSTMASTER), pids, missing_pids: missing, pid_limit_hit: limited } };
}

/** No wait-time attribution: per-PID CPU is only an observed lower bound. */
export function compareSnapshotsV1(before, after) {
  const elapsed = before.bracket && after.bracket ? {
    minimum: String(n(after.bracket.start_ns) > n(before.bracket.end_ns) ? n(after.bracket.start_ns) - n(before.bracket.end_ns) : 0n),
    maximum: String(n(after.bracket.end_ns) - n(before.bracket.start_ns)),
  } : null;
  let cgroup = { ...unavailable('cgroup_endpoint_unavailable'), usage_ns: null, user_ns: null, system_ns: null };
  const a = before.cgroup, b = after.cgroup;
  if (a?.status === 'observed' && b?.status === 'observed') {
    if (a.version !== b.version || a.scope !== b.scope) cgroup.reason_codes = ['cgroup_scope_changed'];
    else if (['usage_ns', 'user_ns', 'system_ns'].some(k => a[k] !== null && b[k] !== null && n(b[k]) < n(a[k]))) cgroup.reason_codes = ['cgroup_counter_regression'];
    else cgroup = { status: 'observed', reason_codes: [], version: a.version, scope: 'container_server_background_and_sampler',
      ...Object.fromEntries(['usage_ns', 'user_ns', 'system_ns'].map(k => [k, a[k] === null || b[k] === null ? null : String(n(b[k]) - n(a[k]))])) };
  }
  const reasons = [], matched = []; const ap = before.postgres, bp = after.postgres;
  if (!ap?.clk_tck || !bp?.clk_tck) reasons.push('postgres_endpoint_unavailable');
  else if (ap.clk_tck !== bp.clk_tck) reasons.push('clk_tck_changed');
  else if (ap.postmaster_pid !== bp.postmaster_pid || ap.pids.find(p => p.pid === ap.postmaster_pid)?.starttime_ticks !== bp.pids.find(p => p.pid === bp.postmaster_pid)?.starttime_ticks) reasons.push('postmaster_changed');
  else {
    const old = new Map(ap.pids.map(p => [p.pid, p])), fresh = new Map(bp.pids.map(p => [p.pid, p]));
    for (const pid of new Set([...old.keys(), ...fresh.keys()])) {
      const x = old.get(pid), y = fresh.get(pid);
      if (!x || !y) { reasons.push('pid_missing_endpoint'); continue; }
      if (x.starttime_ticks !== y.starttime_ticks) { reasons.push('pid_reused'); continue; }
      if (n(y.utime_ticks) < n(x.utime_ticks) || n(y.stime_ticks) < n(x.stime_ticks)) { reasons.push('pid_counter_regression'); continue; }
      const ticks = n(y.utime_ticks) - n(x.utime_ticks) + n(y.stime_ticks) - n(x.stime_ticks);
      matched.push({ pid, starttime_ticks: x.starttime_ticks, cpu_ticks: String(ticks), cpu_ns: String(ticks * 1000000000n / n(ap.clk_tck)) });
    }
    reasons.push(...ap.reason_codes, ...bp.reason_codes);
  }
  return { elapsed_ns: elapsed, cgroup, postgres: { status: !matched.length ? 'unavailable' : reasons.length ? 'partial' : 'observed',
    reason_codes: [...new Set(reasons.length || matched.length ? reasons : ['no_matched_pids'])], coverage: 'sampled_lower_bound',
    matched_cpu_ns: matched.length ? String(matched.reduce((sum, p) => sum + n(p.cpu_ns), 0n)) : null, matched_pids: matched,
    unobserved_short_lived_processes_possible: true } };
}

const realExecution = { spawn, kill: (pid, signal) => process.kill(pid, signal), schedule: setTimeout, cancel: clearTimeout };
// Exported for synthetic child-event tests only; production call sites use fixed argv.
export function runBoundedCommandForTestV1(command, args, deps = realExecution, { timeoutMs = 2000, maxBytes = 262144, cwd } = {}) {
  return new Promise(resolve => {
    let child, timeout, escalation, closeDeadline, reason = null, size = 0, stderrBytes = 0, chunks = [], settled = false;
    const kill = signal => { if (child?.pid) { try { deps.kill(-child.pid, signal); } catch { /* already gone */ } } };
    const abort = why => {
      if (reason || settled) return; reason = why; chunks = []; kill('SIGTERM');
      escalation = deps.schedule(() => {
        kill('SIGKILL');
        closeDeadline = deps.schedule(() => finish(null, false), 500);
      }, 100);
    };
    const finish = (code, reaped = true) => {
      if (settled) return; settled = true; deps.cancel(timeout); deps.cancel(escalation); deps.cancel(closeDeadline);
      resolve({ status: !reason && code === 0 ? 'ok' : 'unavailable', reason: reason ?? (code === 0 ? null : 'command_exit'),
        stdout: !reason && code === 0 ? Buffer.concat(chunks).toString('utf8') : '', exit_code: code, stderr_bytes: stderrBytes,
        cleanup: { reaped, status: reaped ? 'completed' : 'unavailable' } });
    };
    try {
      child = deps.spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C', LC_ALL: 'C' } });
      child.stdout.on('data', data => { size += data.length; if (size > maxBytes) abort('command_byte_limit'); else if (!reason) chunks.push(Buffer.from(data)); });
      child.stderr.on('data', data => { stderrBytes += data.length; if (stderrBytes > maxBytes) abort('command_byte_limit'); });
      child.on('error', () => { if (child.pid) abort('command_child_error'); else { reason ??= 'command_spawn'; finish(null); } });
      child.on('close', code => finish(code)); timeout = deps.schedule(() => abort('command_timeout'), timeoutMs);
    } catch { reason = 'command_spawn'; finish(null); }
  });
}

const realDeps = { env: process.env, platform: process.platform, realpath, lstat, readFile,
  execute: (command, args, options) => runBoundedCommandForTestV1(command, args, realExecution, options),
  nowNs: () => process.hrtime.bigint(), wall: () => new Date().toISOString(), schedule: setTimeout, cancel: clearTimeout };

// Injection seam for pure tests; never used to bypass CI in the production export.
export function createPgCpuProfilerForTestV1(deps) {
  return async function start({ targetRoot, targetSha, markerPath = path.join(targetRoot, MARKER), intervalMs = 250, maxDurationMs = 300000 }) {
    if (!/^[a-f0-9]{40}$/.test(targetSha ?? '') || typeof targetRoot !== 'string' || !path.isAbsolute(targetRoot) ||
      markerPath !== path.join(targetRoot, MARKER) || ![0, 250].includes(intervalMs) || !Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 300000) throw Error('pg_cpu_options_invalid');
    const env = deps.env, samples = [], reasons = new Set(); let owner, ownerHash, stopped = false, terminal, timer, deadline, pending = Promise.resolve(), sampleBytes = 0, cleanupUnknown = false;
    const started = deps.nowNs(), wallStarted = deps.wall();
    const add = reason => reasons.add(reason);
    async function execute(command, args, options) {
      // Reserve the full command + TERM/KILL/reap budget before EVERY child.
      // This is checked again between inspect and exec, not just at sample start.
      if (deps.nowNs() - started + 2600000000n > BigInt(maxDurationMs) * 1000000n) throw Error('deadline');
      return deps.execute(command, args, options);
    }
    async function readMarker() {
      const ws = await deps.realpath(env.GITHUB_WORKSPACE);
      if (await deps.realpath(targetRoot) !== targetRoot || !targetRoot.startsWith(`${ws}${path.sep}`) || await deps.realpath(markerPath) !== markerPath) throw Error('marker_path_invalid');
      const st = await deps.lstat(markerPath);
      if (st.isSymbolicLink() || !st.isFile() || (st.mode & 0o777) !== 0o600 || st.size > 4096) throw Error('marker_file_invalid');
      const raw = await deps.readFile(markerPath, 'utf8'); if (Buffer.byteLength(raw) > 4096) throw Error('marker_file_invalid');
      const m = JSON.parse(raw);
      if (m.contract !== 'r16-pg-cpu-owned-lab-v1' || m.github_run_id !== env.GITHUB_RUN_ID || m.github_run_attempt !== env.GITHUB_RUN_ATTEMPT || m.github_job !== env.GITHUB_JOB ||
        m.target_sha !== targetSha || m.fresh_lab_owned !== true || m.postgres_accredited !== true || !/^[0-9a-f]{64}$/.test(m.container_id) || !/^sha256:[0-9a-f]{64}$/.test(m.container_image_id) ||
        !/^[0-9a-f]{64}$/.test(m.postgres_system_identifier_sha256) || !/^[1-9][0-9]{0,4}$/.test(m.loopback_port) || Number(m.loopback_port) > 65535 ||
        typeof m.container_started_at !== 'string' || !Number.isFinite(Date.parse(m.container_started_at))) throw Error('marker_identity_invalid');
      const hash = sha256(raw); if (ownerHash && hash !== ownerHash) throw Error('marker_changed'); return { m, hash };
    }
    async function inspectOwner() {
      const { m, hash } = await readMarker();
      const r = await execute('docker', ['--host=unix:///var/run/docker.sock', 'inspect', '--format', PG_CPU_INSPECT_FORMAT_V1, owner ? owner.container_id : NAME], { timeoutMs: 2000, maxBytes: 16384 });
      if (r.cleanup?.reaped === false) { cleanupUnknown = true; throw Error('inspect_unavailable'); }
      if (r.status !== 'ok') throw Error('inspect_unavailable'); const i = JSON.parse(r.stdout);
      if (i.id !== m.container_id || i.name !== `/${NAME}` || i.running !== true || i.restarting !== false || i.restart_count !== 0 || i.image !== 'pgvector/pgvector:pg17' || i.image_id !== m.container_image_id || i.started_at !== m.container_started_at ||
        !['', 'private'].includes(i.pid_mode) || i.privileged !== false || i.project !== 'r16bench-benchmark-pg17' || i.service !== 'postgres' || i.db_ok !== true || i.user_ok !== true || !Array.isArray(i.mounts) ||
        i.mounts.length !== 1 || i.mounts[0].type !== 'volume' || i.mounts[0].name !== 'r16bench-benchmark-pg17_postgres-data' || i.mounts[0].destination !== '/var/lib/postgresql/data' ||
        !Array.isArray(i.ports) || i.ports.length !== 1 || i.ports[0].HostIp !== '127.0.0.1' || i.ports[0].HostPort !== m.loopback_port) throw Error('container_identity_mismatch');
      owner = m; ownerHash = hash;
    }
    function errorCode(error) { return ['deadline', 'marker_path_invalid', 'marker_file_invalid', 'marker_identity_invalid', 'marker_changed', 'inspect_unavailable', 'container_identity_mismatch'].includes(error?.message) ? error.message : 'collection_unavailable'; }
    async function collect(label) {
      if (cleanupUnknown) { add('child_cleanup_unavailable'); return unavailable('child_cleanup_unavailable'); }
      if (samples.length >= 1202 || sampleBytes >= 3145728) { add('sample_limit'); return unavailable('sample_limit'); }
      if (deps.nowNs() - started > BigInt(maxDurationMs) * 1000000n) { add('deadline'); return unavailable('deadline'); }
      const bracket = { start_ns: String(deps.nowNs()), wall_started_at: deps.wall(), end_ns: null, wall_ended_at: null };
      let sample;
      try {
        if (!owner) throw Error('ownership_unavailable');
        await inspectOwner(); // Recheck before EVERY exec. Exec by immutable ID, never by name.
        const result = await execute('docker', ['--host=unix:///var/run/docker.sock', 'exec', owner.container_id, 'timeout', '--signal=TERM', '--kill-after=0.1s', '1s', 'sh', '-c', OS_SCRIPT], { timeoutMs: 2000, maxBytes: 262144 });
        if (result.cleanup?.reaped === false) cleanupUnknown = true;
        if (result.status !== 'ok') throw Error('os_command_unavailable');
        const parsed = parseOsSampleV1(result.stdout);
        sample = { status: parsed.cgroup.status === 'observed' && parsed.postgres.status === 'observed' ? 'observed' : parsed.cgroup.status === 'unavailable' && parsed.postgres.status === 'unavailable' ? 'unavailable' : 'partial',
          reason_codes: [...parsed.cgroup.reason_codes, ...parsed.postgres.reason_codes], ...parsed };
      } catch (error) { const code = errorCode(error); add(code); sample = unavailable(code); }
      bracket.end_ns = String(deps.nowNs()); bracket.wall_ended_at = deps.wall();
      sample = { sequence: samples.length, label, bracket, ownership_binding_sha256: ownerHash ?? null, ...sample };
      const bytes = Buffer.byteLength(JSON.stringify(sample));
      if (sampleBytes + bytes > 3145728) { add('sample_byte_limit'); return unavailable('sample_byte_limit'); }
      samples.push(sample); sampleBytes += bytes; return sample;
    }
    function snapshot(label) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(label ?? '')) return Promise.reject(Error('snapshot_label_invalid'));
      if (stopped) return Promise.resolve(unavailable('collector_stopped'));
      const task = pending.then(() => collect(label)); pending = task.then(() => undefined, () => undefined); return task;
    }
    async function stop(reason = 'completed') {
      if (terminal) return terminal;
      stopped = true; deps.cancel(timer); deps.cancel(deadline);
      terminal = (async () => {
        await pending;
        if (owner && !cleanupUnknown) await collect('collector_stop');
        if (cleanupUnknown) add('child_cleanup_unavailable');
        if (reason !== 'completed') add(['deadline', 'sample_limit'].includes(reason) ? reason : 'caller_stopped');
        const delta = samples.length >= 2 ? compareSnapshotsV1(samples[0], samples.at(-1)) : null;
        const pairs = samples.slice(1).map((s, i) => ({ before_sequence: i, after_sequence: i + 1, ...compareSnapshotsV1(samples[i], s) }));
        const observed = samples.some(s => s.status !== 'unavailable');
        const envelope = { contract: 'r16-pg-cpu-profile-v1', target_sha: targetSha,
          status: !observed ? 'unavailable' : reasons.size || samples.some(s => s.status !== 'observed') ? 'partial' : 'observed', reason_codes: [...reasons],
          collector: { os_script_sha256: sha256(OS_SCRIPT), inspect_format_sha256: sha256(PG_CPU_INSPECT_FORMAT_V1), docker_endpoint: 'unix:///var/run/docker.sock' },
          ownership: owner ? { marker_sha256: ownerHash, container_id_sha256: sha256(owner.container_id), image_id: owner.container_image_id, started_at: owner.container_started_at, postgres_system_identifier_sha256: owner.postgres_system_identifier_sha256 } : null,
          limits: { ...PG_CPU_LIMITS_V1, configured_duration_ms: maxDurationMs, configured_interval_ms: intervalMs },
          window: { start_ns: String(started), end_ns: String(deps.nowNs()), wall_started_at: wallStarted, wall_ended_at: deps.wall(), scope: 'collector_not_workload_use_named_snapshot_brackets' },
          snapshots: samples, delta, consecutive_pairs: pairs,
          waits: unavailable('not_collected_no_sql'), sql_attribution: unavailable('not_collected_no_sql'),
          overhead: { cgroup_includes_server_background_and_sampler: true, sampler_cpu_subtracted: false, docker_exec_per_sample: true, snapshot_reads_not_simultaneous: true },
          cleanup: { status: cleanupUnknown ? 'unavailable' : 'completed', timers_cancelled: true, child_commands_awaited: !cleanupUnknown } };
        // Pair details are bounded separately; never grow the artifact cap after data.
        if (Buffer.byteLength(JSON.stringify(envelope)) > 4194304) {
          envelope.consecutive_pairs = []; envelope.status = observed ? 'partial' : 'unavailable';
          envelope.reason_codes.push('artifact_pair_details_omitted');
        }
        return envelope;
      })(); return terminal;
    }
    const ci = deps.platform === 'linux' && env.GITHUB_ACTIONS === 'true' && env.CI === 'true' && env.RUNNER_OS === 'Linux' &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') && /^[A-Za-z0-9_-]+$/.test(env.GITHUB_JOB ?? '') && path.isAbsolute(env.GITHUB_WORKSPACE ?? '');
    if (!ci) add('ci_scope_unavailable');
    else try {
      await readMarker();
      const git = await execute('git', ['rev-parse', 'HEAD'], { cwd: targetRoot, timeoutMs: 2000, maxBytes: 128 });
      if (git.cleanup?.reaped === false) cleanupUnknown = true;
      if (git.status !== 'ok' || git.stdout.trim() !== targetSha) throw Error('source_identity_unavailable');
      await inspectOwner(); await snapshot('collector_start');
    } catch (error) { add(errorCode(error)); }
    if (owner && !reasons.size) {
      const tick = async () => { if (stopped) return; await snapshot('interval'); if (!stopped) timer = deps.schedule(tick, intervalMs); };
      if (intervalMs) timer = deps.schedule(tick, intervalMs);
      deadline = deps.schedule(() => { void stop('deadline'); }, maxDurationMs);
    }
    return { snapshot, stop };
  };
}

export const startPgCpuProfileV1 = createPgCpuProfilerForTestV1(realDeps);
