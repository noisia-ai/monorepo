import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('./ci-benchmark.sh', import.meta.url));
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'r16-ci-benchmark-guards-'));

interface Fixture {
  root: string;
  log: string;
  run: (extraEnv?: Record<string, string>) => ReturnType<typeof spawnSync>;
  dockerLog: () => string;
  eventLog: () => string;
  cleanup: () => void;
}

function executable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function fixture(name: string, dockerMode = 'fresh', upMode = 'success'): Fixture {
  const root = path.join(tempRoot, name);
  const bin = path.join(root, 'bin');
  const scripts = path.join(root, 'scripts', 'r16');
  const lab = path.join(root, '.data', 'piloto-masivo', 'r16', 'labs', 'benchmark-pg17');
  const log = path.join(root, 'events.log');
  const dockerLogPath = path.join(root, 'docker.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(scripts, { recursive: true });
  writeFileSync(log, '');
  writeFileSync(dockerLogPath, '');
  writeFileSync(path.join(scripts, 'ci-benchmark.sh'), readFileSync(scriptPath));

  executable(path.join(bin, 'git'), '#!/bin/sh\n[ "$1 $2" = "rev-parse --show-toplevel" ] || exit 2\nprintf "%s\\n" "$R16_FIXTURE_ROOT"\n');
  executable(path.join(bin, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$R16_DOCKER_LOG"
if [ "$1" = info ]; then [ "$R16_DOCKER_MODE" != daemon-error ]; exit $?; fi
case "$1 $2" in
  "ps --all")
    [ "$R16_DOCKER_MODE" != query-error ] || exit 21
    case "$R16_DOCKER_MODE:$*" in
      container-project:*label=com.docker.compose.project*) printf 'container-id\\n' ;;
      container-name:*format*Names*) printf 'r16-benchmark-pg17\\n' ;;
      redis-container:*format*Names*) printf 'r16bench-benchmark-pg17-redis-1\\n' ;;
    esac
    ;;
  "volume ls")
    [ "$R16_DOCKER_MODE" != query-error ] || exit 22
    case "$R16_DOCKER_MODE:$*" in
      volume-project:*label=com.docker.compose.project*) printf 'r16bench-benchmark-pg17_postgres-data\\n' ;;
      volume-name:*format*Name*) printf 'r16bench-benchmark-pg17_postgres-data\\n' ;;
    esac
    ;;
  "network ls")
    [ "$R16_DOCKER_MODE" != query-error ] || exit 23
    case "$R16_DOCKER_MODE:$*" in
      network-project:*label=com.docker.compose.project*) printf 'r16bench-benchmark-pg17_default\\n' ;;
      network-name:*format*Name*) printf 'r16bench-benchmark-pg17_default\\n' ;;
    esac
    ;;
  *) exit 24 ;;
esac
`);
  executable(path.join(bin, 'corepack'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$R16_EVENT_LOG"\nprintf "# skipped 0\\n"\n');
  executable(path.join(scripts, 'lab-up.sh'), `#!/bin/sh
printf 'up\\n' >> "$R16_EVENT_LOG"
mkdir -p "$R16_FIXTURE_ROOT/.data/piloto-masivo/r16/labs/benchmark-pg17"
printf 'R16BENCH_POSTGRES_PASSWORD=fake\\n' > "$R16_FIXTURE_ROOT/.data/piloto-masivo/r16/labs/benchmark-pg17/private.env"
printf 'DATABASE_URL=postgresql://fake\\n' > "$R16_FIXTURE_ROOT/.data/piloto-masivo/r16/labs/benchmark-pg17/connection.env"
[ "$R16_UP_MODE" != failure ] || exit 42
`);
  executable(path.join(scripts, 'lab-down.sh'), '#!/bin/sh\nprintf "down:%s\\n" "$R16BENCH_RUN_ID" >> "$R16_EVENT_LOG"\n');

  return {
    root,
    log,
    run(extraEnv = {}) {
      return spawnSync('bash', [path.join(scripts, 'ci-benchmark.sh')], {
        cwd: tempRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          GITHUB_ACTIONS: 'true',
          R16_FIXTURE_ROOT: root,
          R16_DOCKER_LOG: dockerLogPath,
          R16_EVENT_LOG: log,
          R16_DOCKER_MODE: dockerMode,
          R16_UP_MODE: upMode,
          ...extraEnv,
        },
      });
    },
    dockerLog: () => readFileSync(dockerLogPath, 'utf8'),
    eventLog: () => readFileSync(log, 'utf8'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('refuses outside GitHub Actions without querying or mutating Docker', () => {
  const f = fixture('outside-ci');
  try {
    const result = f.run({ GITHUB_ACTIONS: 'false' });
    assert.notEqual(result.status, 0);
    assert.equal(f.dockerLog(), '');
    assert.equal(f.eventLog(), '');
  } finally { f.cleanup(); }
});

test('refuses an existing metadata directory before touching Docker or lab helpers', () => {
  const f = fixture('metadata');
  try {
    mkdirSync(path.join(f.root, '.data', 'piloto-masivo', 'r16', 'labs', 'benchmark-pg17'), { recursive: true });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(f.dockerLog(), '');
    assert.equal(f.eventLog(), '');
  } finally { f.cleanup(); }
});

test('refuses a metadata symlink before touching Docker or lab helpers', () => {
  const f = fixture('metadata-symlink');
  try {
    const labs = path.join(f.root, '.data', 'piloto-masivo', 'r16', 'labs');
    mkdirSync(labs, { recursive: true });
    symlinkSync(path.join(f.root, 'missing-target'), path.join(labs, 'benchmark-pg17'));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(f.dockerLog(), '');
    assert.equal(f.eventLog(), '');
  } finally { f.cleanup(); }
});

for (const mode of ['container-project', 'container-name', 'redis-container', 'volume-project', 'volume-name', 'network-project', 'network-name']) {
  test(`refuses the pre-existing Docker resource (${mode}) without startup or cleanup`, () => {
    const f = fixture(mode, mode);
    try {
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.equal(f.eventLog(), '');
      assert.match(f.dockerLog(), /info/);
    } finally { f.cleanup(); }
  });
}

for (const mode of ['daemon-error', 'query-error']) {
  test(`fails closed on Docker ${mode} without lab cleanup`, () => {
    const f = fixture(mode, mode);
    try {
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.equal(f.eventLog(), '');
      assert.notEqual(f.dockerLog(), '');
    } finally { f.cleanup(); }
  });
}

test('registers owned cleanup before a fresh lab startup that fails partway through', () => {
  const f = fixture('partial-startup', 'fresh', 'failure');
  try {
    const result = f.run();
    assert.equal(result.status, 42);
    assert.equal(f.eventLog(), 'up\ndown:benchmark-pg17\n');
  } finally { f.cleanup(); }
});

test('runs the unchanged CI pipeline and cleans only its fresh lab on success', () => {
  const f = fixture('fresh-success');
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const events = f.eventLog();
    assert.match(events, /pnpm --filter @noisia\/db db:smoke:migrations/);
    assert.match(events, /signal-client-workspace-entry\.batch-equivalence\.postgres\.test\.ts/);
    assert.match(events, /services\/workers\/src\/providers\/jev-account-rate-limit\.redis\.test\.ts/);
    assert.match(events, /scripts\/r16\/run-listening-ci\.ts/);
    assert.match(events, /up\n/);
    assert.match(events, /down:benchmark-pg17\n$/);
  } finally { f.cleanup(); }
});

test.after(() => rmSync(tempRoot, { recursive: true, force: true }));
