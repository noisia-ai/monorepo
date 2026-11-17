import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  parseProcStatV1, parseOsSampleV1, compareSnapshotsV1, createPgCpuProfilerForTestV1,
  runBoundedCommandForTestV1, PG_CPU_LIMITS_V1, PG_CPU_INSPECT_FORMAT_V1,
} from './profile-pg-cpu.mjs';

const sha = 'a'.repeat(40), id = 'b'.repeat(64), image = `sha256:${'c'.repeat(64)}`;
const root = '/workspace/target';
const markerPath = `${root}/.data/piloto-masivo/r16/labs/benchmark-pg17/pg-cpu-owned-marker.json`;
const marker = { contract: 'r16-pg-cpu-owned-lab-v1', github_run_id: '123', github_run_attempt: '1',
  github_job: 'profile', target_sha: sha, container_id: id, container_started_at: '2026-11-16T01:00:00Z',
  container_image_id: image, loopback_port: '54321', postgres_system_identifier_sha256: 'd'.repeat(64),
  fresh_lab_owned: true, postgres_accredited: true };
const inspect = { id, name: '/r16-benchmark-pg17', running: true, restarting: false, restart_count: 0,
  pid_mode: '', privileged: false, image: 'pgvector/pgvector:pg17', image_id: image, started_at: marker.container_started_at,
  project: 'r16bench-benchmark-pg17', service: 'postgres', db_ok: true, user_ok: true,
  mounts: [{ type: 'volume', name: 'r16bench-benchmark-pg17_postgres-data', destination: '/var/lib/postgresql/data' }],
  ports: [{ HostIp: '127.0.0.1', HostPort: '54321' }] };
function stat(pid = 7, u = '100', s = '20', start = '30', comm = 'postgres') {
  const fields = Array(22).fill('0'); fields[0] = 'S'; fields[11] = u; fields[12] = s; fields[19] = start;
  return `${pid} (${comm}) ${fields.join(' ')}`;
}
function raw(u = '100', usage = '1000') {
  return `R16PGCPU 1\nHZ 100\nVERSION 17\nPOSTMASTER 7\nCGROUP v2 private-root\nCPU usage_usec ${usage}\nCPU user_usec 600\nCPU system_usec 400\nPGSTAT ${stat(7, u)}\nEND\n`;
}
function fixture(changes = {}) {
  const calls = [], timers = [], killed = [];
  let ns = 0n;
  const deps = {
    env: { GITHUB_ACTIONS: 'true', CI: 'true', RUNNER_OS: 'Linux', GITHUB_WORKSPACE: '/workspace',
      GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'profile' }, platform: 'linux',
    nowNs: () => (ns += 1000000n), wall: () => '2026-11-16T02:00:00.000Z',
    realpath: async p => p, lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true, mode: 0o100600, size: 1500 }),
    readFile: async () => JSON.stringify(marker),
    schedule: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, cancel: t => killed.push(t),
    execute: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === 'git') return { status: 'ok', stdout: `${sha}\n`, exit_code: 0 };
      if (args.includes('inspect')) return { status: 'ok', stdout: JSON.stringify(inspect), exit_code: 0 };
      return { status: 'ok', stdout: raw(), exit_code: 0 };
    }, ...changes,
  };
  return { deps, calls, timers, killed, start: opts => createPgCpuProfilerForTestV1(deps)({ targetRoot: root, targetSha: sha, intervalMs: 0, ...opts }) };
}
test('proc stat parser preserves large integer ticks and parenthesized comm', () => {
  const p = parseProcStatV1(stat(7, '9007199254740993', '20', '123', 'a ) b'));
  assert.equal(p.comm, 'a ) b'); assert.equal(p.utime_ticks, '9007199254740993'); assert.equal(p.starttime_ticks, '123');
});
test('proc stat parser rejects missing, malformed and negative identity/counters without echoing input', () => {
  for (const bad of ['', 'secret', stat(0), stat(7, '-1'), stat(7, 'NaN')]) assert.throws(() => parseProcStatV1(bad), /^Error: proc_stat_invalid$/);
});
test('OS sample converts v2 usec exactly and never reads SQL', () => {
  const s = parseOsSampleV1(raw('9007199254740993', '9007199254740993'));
  assert.equal(s.cgroup.usage_ns, '9007199254740993000'); assert.equal(s.postgres.pids[0].utime_ticks, '9007199254740993');
  assert.equal(s.postgres.status, 'observed');
});
test('v1 usage is ns and unavailable split is explicit', () => {
  const s = parseOsSampleV1(raw().replace(/CGROUP v2 private-root\nCPU[^]*?PGSTAT/, 'CGROUP v1 private-root\nUSAGE 123456789\nPGSTAT'));
  assert.equal(s.cgroup.usage_ns, '123456789'); assert.equal(s.cgroup.user_ns, null);
});
test('namespace, missing and PID limits are unknown rather than zero', () => {
  const s = parseOsSampleV1(raw().replace(/CGROUP[^]*?PGSTAT/, 'CGROUP unavailable namespace_unknown\nMISSING 8\nLIMIT\nPGSTAT'));
  assert.equal(s.cgroup.status, 'unavailable'); assert.equal(s.cgroup.usage_ns, null);
  assert.equal(s.postgres.status, 'partial'); assert.deepEqual(s.postgres.missing_pids, [8]); assert.equal(s.postgres.pid_limit_hit, true);
});
test('OS sample rejects duplicate PID, missing END, unknown fields and non-postgres comm', () => {
  for (const bad of [raw().replace('END', `PGSTAT ${stat()}\nEND`), raw().replace('END', ''), raw().replace('END', 'SECRET foo\nEND'), raw().replace('(postgres)', '(node)')]) assert.throws(() => parseOsSampleV1(bad));
});
function snap(u, usage, overrides = {}) { return { sequence: 0, label: 'x', bracket: { start_ns: '10', end_ns: '20' }, ...parseOsSampleV1(raw(u, usage)), ...overrides }; }
test('delta has exact cgroup CPU and bracketed per-PID lower bound', () => {
  const a = snap('100', '1000'), b = snap('125', '2000', { bracket: { start_ns: '100', end_ns: '120' } });
  const d = compareSnapshotsV1(a, b);
  assert.equal(d.cgroup.usage_ns, '1000000'); assert.equal(d.postgres.matched_cpu_ns, '250000000');
  assert.equal(d.elapsed_ns.minimum, '80'); assert.equal(d.elapsed_ns.maximum, '110'); assert.equal(d.postgres.coverage, 'sampled_lower_bound');
});
test('PID reuse and disappearing process do not manufacture zero CPU', () => {
  const a = snap('100', '1000'), b = snap('125', '2000');
  a.postgres.pids.push(parseProcStatV1(stat(8))); b.postgres.pids.push(parseProcStatV1(stat(8, '120', '20', '31')));
  assert.equal(compareSnapshotsV1(a, b).postgres.status, 'partial');
  assert.ok(compareSnapshotsV1(a, b).postgres.reason_codes.includes('pid_reused'));
  b.postgres.pids.pop(); assert.ok(compareSnapshotsV1(a, b).postgres.reason_codes.includes('pid_missing_endpoint'));
  b.postgres.pids[0].starttime_ticks = '32'; assert.equal(compareSnapshotsV1(a, b).postgres.matched_cpu_ns, null);
  assert.ok(compareSnapshotsV1(a, b).postgres.reason_codes.includes('postmaster_changed'));
});
test('counter regression, clock HZ mismatch and cgroup changes are unavailable', () => {
  const a = snap('100', '2000'), b = snap('90', '1000');
  assert.equal(compareSnapshotsV1(a, b).cgroup.usage_ns, null); assert.equal(compareSnapshotsV1(a, b).postgres.matched_cpu_ns, null);
  b.postgres.clk_tck = '250'; assert.ok(compareSnapshotsV1(a, b).postgres.reason_codes.includes('clk_tck_changed'));
  b.cgroup.version = 'v1'; assert.equal(compareSnapshotsV1(a, b).cgroup.status, 'unavailable');
});
test('non-CI and non-Linux never run any command or read a marker', async () => {
  for (const changes of [{ platform: 'darwin' }, { env: { GITHUB_ACTIONS: 'true' } }, { env: {} }]) {
    const f = fixture({ ...changes, readFile: async () => { throw Error('must not read'); } });
    const h = await f.start(); const r = await h.stop(); assert.equal(r.status, 'unavailable'); assert.equal(f.calls.length, 0);
  }
});
test('marker path traversal, symlinks, permissions and wrong target all fail before Docker', async () => {
  for (const changes of [
    { realpath: async p => p === root ? '/elsewhere' : p },
    { lstat: async () => ({ isSymbolicLink: () => true }) },
    { lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true, size: 100, mode: 0o100644 }) },
    { readFile: async () => JSON.stringify({ ...marker, target_sha: 'e'.repeat(40) }) },
  ]) { const f = fixture(changes); assert.equal((await (await f.start()).stop()).status, 'unavailable'); assert.equal(f.calls.filter(c => c[0] === 'docker').length, 0); }
});
test('valid marker requires exact inspect identity, labels, mount, image, DB and loopback before exec', async () => {
  for (const patch of [{ project: 'foreign' }, { service: 'redis' }, { running: false }, { pid_mode: 'host' }, { privileged: true }, { restart_count: 1 }, { id: 'e'.repeat(64) }, { db_ok: false }, { mounts: [] }, { ports: [{ HostIp: '0.0.0.0', HostPort: '54321' }] }]) {
    const f = fixture(); const original = f.deps.execute;
    f.deps.execute = (cmd, args) => cmd === 'docker' && args.includes('inspect') ? Promise.resolve({ status: 'ok', stdout: JSON.stringify({ ...inspect, ...patch }) }) : original(cmd, args);
    const r = await (await f.start()).stop(); assert.equal(r.status, 'unavailable'); assert.equal(f.calls.some(c => c[1].includes('exec')), false);
  }
});
test('inspect format never returns environment, command, SQL or passwords', () => {
  assert.ok(PG_CPU_INSPECT_FORMAT_V1.includes('POSTGRES_DB=noisia_mfp_ci'));
  assert.equal(PG_CPU_INSPECT_FORMAT_V1.includes('json .Config.Env'), false);
  assert.equal(PG_CPU_INSPECT_FORMAT_V1.includes('Password'), false);
});
test('each snapshot reinspects and exec uses immutable ID, read-only timeout bounded shell', async () => {
  const f = fixture(); const h = await f.start(); const s = await h.snapshot('before_classification_serving');
  assert.equal(s.label, 'before_classification_serving'); const r = await h.stop();
  const execs = f.calls.filter(c => c[1].includes('exec')); assert.ok(execs.length >= 3);
  for (const [, args] of execs) { assert.equal(args[0], '--host=unix:///var/run/docker.sock'); assert.equal(args[2], id); assert.equal(args[3], 'timeout'); assert.ok(!args.join(' ').includes('psql')); }
  assert.equal(r.waits.status, 'unavailable'); assert.equal(r.sql_attribution.status, 'unavailable');
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= PG_CPU_LIMITS_V1.artifact_bytes);
});
test('marker mutation and container replacement stop sampling without another exec', async () => {
  const f = fixture(); const h = await f.start(); const before = f.calls.filter(c => c[1].includes('exec')).length;
  f.deps.readFile = async () => JSON.stringify({ ...marker, github_job: 'changed' });
  const s = await h.snapshot('after_classification_serving'); assert.equal(s.status, 'unavailable');
  await h.stop(); assert.equal(f.calls.filter(c => c[1].includes('exec')).length, before);
});
test('stop is idempotent, cancels timers, no sampling after terminal', async () => {
  const f = fixture(); const h = await f.start({ intervalMs: 250 });
  assert.ok(f.timers.some(t => t.ms === 250)); const a = await h.stop(), count = f.calls.length;
  assert.deepEqual(await h.stop(), a); assert.equal((await h.snapshot('after_stop')).reason_codes[0], 'collector_stopped');
  assert.equal(f.calls.length, count); assert.ok(f.killed.length >= 2);
});
test('invalid options fail with no execution; caps cannot be expanded', async () => {
  for (const options of [{ intervalMs: 10 }, { maxDurationMs: 300001 }, { maxDurationMs: 0 }, { targetSha: 'bad' }, { markerPath: '/tmp/foreign' }]) {
    const f = fixture(); await assert.rejects(f.start(options)); assert.equal(f.calls.length, 0);
  }
});
test('command failure hides raw stderr/stdout and returns unavailable', async () => {
  const f = fixture({ execute: async () => { throw Error('secret SQL password'); } });
  const r = await (await f.start()).stop(); assert.equal(r.status, 'unavailable'); assert.ok(!JSON.stringify(r).includes('secret'));
});
test('production entry point is inert locally without env spoofing', async () => {
  const { startPgCpuProfileV1 } = await import('./profile-pg-cpu.mjs');
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux') {
    const r = await (await startPgCpuProfileV1({ targetRoot: root, targetSha: sha })).stop(); assert.equal(r.status, 'unavailable');
  }
});
test('bounded executor kills only its own process group on byte cap and awaits close', async () => {
  const child = new EventEmitter(); child.pid = 23456; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const kills = [], timers = [];
  const p = runBoundedCommandForTestV1('docker', ['inspect'], {
    spawn: () => child, kill: (pid, signal) => kills.push([pid, signal]),
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.at(-1); }, cancel: () => {},
  }, { maxBytes: 10, timeoutMs: 2000 });
  child.stdout.emit('data', Buffer.from('secret-too-long')); child.emit('close', null, 'SIGTERM');
  const r = await p; assert.equal(r.status, 'unavailable'); assert.equal(r.stdout, ''); assert.deepEqual(kills, [[-23456, 'SIGTERM']]);
});
test('bounded executor timeout escalates only own group and suppresses stderr', async () => {
  const child = new EventEmitter(); child.pid = 23457; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const kills = [], timers = []; const p = runBoundedCommandForTestV1('docker', [], {
    spawn: () => child, kill: (pid, signal) => kills.push([pid, signal]),
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.at(-1); }, cancel: () => {},
  });
  child.stderr.emit('data', Buffer.from('password')); timers[0].fn(); timers[1].fn(); child.emit('close', null, 'SIGKILL');
  const r = await p; assert.equal(r.reason, 'command_timeout'); assert.equal(r.stdout, '');
  assert.deepEqual(kills, [[-23457, 'SIGTERM'], [-23457, 'SIGKILL']]);
});
test('unreaped child has bounded settlement and cleanup explicitly unavailable', async () => {
  const child = new EventEmitter(); child.pid = 23458; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const timers = [], kills = []; const p = runBoundedCommandForTestV1('docker', [], {
    spawn: () => child, kill: (pid, signal) => kills.push([pid, signal]),
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.at(-1); }, cancel: () => {},
  });
  timers[0].fn(); timers[1].fn(); timers[2].fn();
  const r = await p; assert.equal(r.cleanup.status, 'unavailable'); assert.equal(r.cleanup.reaped, false);
  assert.deepEqual(kills, [[-23458, 'SIGTERM'], [-23458, 'SIGKILL']]);
});
test('deadline stops further execs and a queued interval cannot restart after stop', async () => {
  const f = fixture(); const h = await f.start({ intervalMs: 250, maxDurationMs: 20000 });
  const deadline = f.timers.find(t => t.ms === 20000); deadline.fn();
  const r = await h.stop(); assert.ok(r.reason_codes.includes('deadline'));
  const calls = f.calls.length; await f.timers.find(t => t.ms === 250).fn();
  assert.equal(f.calls.length, calls);
});
test('sample count cap is preregistered, bounded, and preserves missing rather than zero', async () => {
  const f = fixture({ nowNs: () => 1n }); const h = await f.start();
  for (let i = 0; i < 1205; i++) await h.snapshot('manual');
  const r = await h.stop(); assert.ok(r.snapshots.length <= 1202); assert.ok(r.reason_codes.includes('sample_limit'));
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= PG_CPU_LIMITS_V1.artifact_bytes);
});
test('unreaped command fences all later collection and cleanup is never claimed', async () => {
  const f = fixture(); const h = await f.start(); const original = f.deps.execute;
  f.deps.execute = async (cmd, args) => args.includes('exec') ? { status: 'unavailable', stdout: '', cleanup: { reaped: false } } : original(cmd, args);
  await h.snapshot('bad_child'); const calls = f.calls.length;
  const s = await h.snapshot('after_bad_child'); assert.equal(s.reason_codes[0], 'child_cleanup_unavailable');
  const r = await h.stop(); assert.equal(f.calls.length, calls); assert.equal(r.cleanup.status, 'unavailable'); assert.equal(r.cleanup.child_commands_awaited, false);
});
test('invalid snapshot label never echoes SQL and marker bytes never enter output', async () => {
  const f = fixture(); const h = await f.start(); await assert.rejects(h.snapshot('SELECT secret'), /^Error: snapshot_label_invalid$/);
  const r = await h.stop(); assert.ok(!JSON.stringify(r).includes('github_job')); assert.ok(!JSON.stringify(r).includes('POSTGRES_PASSWORD'));
});
test('remaining full child budget is rechecked between inspect and exec', async () => {
  let clock = 0n; const f = fixture({ nowNs: () => clock }); const h = await f.start();
  const original = f.deps.execute, count = f.calls.filter(c => c[1].includes('exec')).length;
  f.deps.execute = async (cmd, args, options) => {
    const result = await original(cmd, args, options);
    if (args.includes('inspect')) clock = 299000000000n;
    return result;
  };
  const s = await h.snapshot('near_deadline'); assert.deepEqual(s.reason_codes, ['deadline']);
  await h.stop(); assert.equal(f.calls.filter(c => c[1].includes('exec')).length, count);
});
