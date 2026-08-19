import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { signalStrategicCostUpperBoundMicroUsdV1 } from "@noisia/query-engine";
import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_STRATEGIC_BUDGET_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_STRATEGIC_BUDGET_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

test("0075 enforces exact strategic settlement and TypeScript/PostgreSQL parity", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file)
        && file <= "0075_signal_strategic_budget_integrity.sql")
      .sort();
    for (const file of files) await client.query(await readFile(join(migrationDir, file), "utf8"));
    await client.query(await readFile(join(
      migrationDir, "0075_signal_strategic_budget_integrity.sql"
    ), "utf8"));

    const definition = await client.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid,true) AS definition
      FROM pg_constraint
      WHERE conrelid='signal_strategic_budget_reservations'::regclass
        AND conname='signal_strategic_budget_settlement_within_reservation'
    `);
    assert.equal(definition.rowCount, 1);
    assert.match(definition.rows[0]!.definition, /actual_usd <= reservation_usd/u);

    await client.query("SET session_replication_role=replica");
    try {
      await client.query(`INSERT INTO signal_strategic_budget_reservations (
        id,run_control_id,workspace_id,operation_key,reservation_usd,actual_usd,
        status,idempotency_key
      ) VALUES (
        '75000000-0000-4000-8000-000000000001',
        '75000000-0000-4000-8000-000000000002',
        '75000000-0000-4000-8000-000000000003',
        'exact-boundary',0.602001,0.602001,'settled',
        'sha256:'||repeat('a',64)
      )`);
      await assert.rejects(client.query(`UPDATE signal_strategic_budget_reservations
        SET actual_usd=0.602002
        WHERE id='75000000-0000-4000-8000-000000000001'`), hasState("23514"));
    } finally {
      await client.query("SET session_replication_role=origin");
    }

    const fixtures = exactCostFixtures();
    await client.query("SET session_replication_role=replica");
    let sql: pg.QueryResult<{ ordinal: number; micro_usd: string }>;
    try {
      await client.query(`CREATE TEMP TABLE exact_cost_fixtures (
        ordinal integer PRIMARY KEY,
        run_control_id uuid NOT NULL DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL DEFAULT gen_random_uuid(),
        input_tokens bigint NOT NULL,
        output_tokens bigint NOT NULL,
        input_rate numeric(14,6) NOT NULL,
        output_rate numeric(14,6) NOT NULL
      )`);
      await client.query(`INSERT INTO exact_cost_fixtures (
        ordinal,input_tokens,output_tokens,input_rate,output_rate
      ) SELECT ordinal,input_tokens,output_tokens,input_rate,output_rate
      FROM jsonb_to_recordset($1::jsonb) AS fixture(
        ordinal int,input_tokens bigint,output_tokens bigint,
        input_rate numeric,output_rate numeric
      )`, [JSON.stringify(fixtures)]);
      await client.query(`INSERT INTO signal_strategic_run_controls (
        id,workspace_id,tb_analysis_id,snapshot_id,binding_id,policy_bundle_id,
        policy_compilation_id,governance_evaluation_id,population_id,
        preflight_digest,request_digest,snapshot_authority_digest,
        policy_definition_hash,compiled_plan_hash,membership_digest,
        governance_digest,provenance_digest,watermark_hash,usage_purposes,
        sample_algorithm,sample_seed,sample_count,sample_digest,
        execution_plan_version,execution_plan_digest,execution_plan,
        planned_provider_calls,planned_input_tokens,planned_output_tokens,
        provider,provider_config_digest,model_version,prompt_version,pricing_version,
        input_usd_per_million_tokens,output_usd_per_million_tokens,
        estimated_cost_usd,hard_cap_usd,status,created_by_user_id,idempotency_key
      ) SELECT
        fixture.run_control_id,fixture.workspace_id,gen_random_uuid(),gen_random_uuid(),
        gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
        gen_random_uuid(),'sha256:'||repeat('a',64),'sha256:'||repeat('b',64),
        'sha256:'||repeat('c',64),'sha256:'||repeat('d',64),
        'sha256:'||repeat('e',64),'sha256:'||repeat('f',64),
        'sha256:'||repeat('1',64),'sha256:'||repeat('2',64),
        'sha256:'||repeat('3',64),ARRAY['llm-processing','strategic-analysis']::text[],
        'canonical-root-sha256-rank-v1','sha256:'||repeat('4',64),1,
        'sha256:'||repeat('5',64),'signal-strategic-provider-budget-plan-v1',
        'sha256:'||repeat('6',64),'{"calls":[]}'::jsonb,1,1,0,
        'anthropic','sha256:'||repeat('7',64),'fixture-model','fixture-prompt',
        'fixture-pricing',fixture.input_rate,fixture.output_rate,0,999999,
        'running',gen_random_uuid(),'sha256:'||repeat(md5(
          'control-'||fixture.ordinal::text),2)
      FROM exact_cost_fixtures fixture`);
      await client.query(`INSERT INTO signal_strategic_budget_reservations (
        run_control_id,workspace_id,operation_key,reservation_usd,
        reserved_input_tokens,reserved_output_tokens,status,idempotency_key
      ) SELECT run_control_id,workspace_id,'fixture-'||ordinal::text,999999,
        input_tokens,output_tokens,'reserved','sha256:'||repeat(md5(
          'reservation-'||ordinal::text),2)
      FROM exact_cost_fixtures`);
      sql = await client.query<{ ordinal: number; micro_usd: string }>(`
        SELECT fixture.ordinal,
          (settle_signal_strategic_budget_v1(
            fixture.run_control_id,
            'sha256:'||repeat(md5('reservation-'||fixture.ordinal::text),2),
            fixture.input_tokens,fixture.output_tokens
          )*1000000)::numeric(30,0)::text AS micro_usd
        FROM exact_cost_fixtures fixture ORDER BY fixture.ordinal
      `);
    } finally {
      await client.query("SET session_replication_role=origin");
    }
    assert.equal(sql.rowCount, fixtures.length);
    for (const [index, fixture] of fixtures.entries()) {
      const exact = signalStrategicCostUpperBoundMicroUsdV1({
        input_tokens: fixture.input_tokens,
        output_tokens: fixture.output_tokens,
        input_usd_per_million_tokens: fixture.input_rate,
        output_usd_per_million_tokens: fixture.output_rate
      });
      assert.equal(exact.toString(), sql.rows[index]!.micro_usd,
        `TypeScript/PostgreSQL exact cost mismatch at fixture ${fixture.ordinal}`);
    }
    await client.query("SET session_replication_role=replica");
    try {
      await client.query(`INSERT INTO signal_strategic_budget_reservations (
        run_control_id,workspace_id,operation_key,reservation_usd,
        reserved_input_tokens,reserved_output_tokens,status,idempotency_key
      ) SELECT run_control_id,workspace_id,'overrun-proof',0.000001,1,0,
        'reserved','sha256:'||repeat('8',64)
      FROM exact_cost_fixtures WHERE ordinal=3`);
      await assert.rejects(client.query(`SELECT settle_signal_strategic_budget_v1(
        (SELECT run_control_id FROM exact_cost_fixtures WHERE ordinal=3),
        'sha256:'||repeat('8',64),1,0
      )`), hasState("P0001"));
      const overrun = await client.query<{ status: string; actual_usd: string | null }>(`
        SELECT status,actual_usd::text FROM signal_strategic_budget_reservations
        WHERE idempotency_key='sha256:'||repeat('8',64)
      `);
      assert.deepEqual(overrun.rows, [{ status: "reserved", actual_usd: null }]);
    } finally {
      await client.query("SET session_replication_role=origin");
    }
  } finally {
    await client.end();
  }
});

function exactCostFixtures() {
  const fixtures = [
    { input_tokens: 301, output_tokens: 301, input_rate: "0.001", output_rate: "0.999" },
    { input_tokens: 1, output_tokens: 0, input_rate: "0.000001", output_rate: "15" },
    { input_tokens: 200_000, output_tokens: 120, input_rate: "3", output_rate: "15" },
    { input_tokens: 602_000, output_tokens: 0, input_rate: "0.000001", output_rate: "1" }
  ];
  let state = 0x75c0ffee;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  for (let index = 0; index < 1_000; index += 1) {
    fixtures.push({
      input_tokens: next() % 2_000_000,
      output_tokens: next() % 200_000,
      input_rate: decimalFromMillionths(1 + next() % 25_000_000),
      output_rate: decimalFromMillionths(1 + next() % 75_000_000)
    });
  }
  return fixtures.map((fixture, index) => ({ ordinal: index + 1, ...fixture }));
}

function decimalFromMillionths(value: number) {
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function hasState(code: string) {
  return (error: unknown) => (error as { code?: string }).code === code;
}

function requireDisposableLocalDatabase(url: string) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
      || !/(test|qa|fixture|tmp|local|smoke)/iu.test(parsed.pathname)) {
    throw new Error("0075 integration requires an explicitly disposable local database.");
  }
}
