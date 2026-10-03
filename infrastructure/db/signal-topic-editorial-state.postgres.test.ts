import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';

const urlFile = process.env.NOISIA_EDITORIAL_PG_URL_FILE;
const sql = readFileSync(new URL('./migrations/0178_signal_topic_editorial_catalog_contract.sql', import.meta.url), 'utf8');
const start = sql.indexOf('CREATE OR REPLACE FUNCTION signal_topic_editorial_state_guard_v1()');
const end = sql.indexOf('CREATE OR REPLACE FUNCTION signal_topic_editorial_admission_complete_v1()', start);
const guard = sql.slice(start, end)
 .replace('CREATE OR REPLACE FUNCTION signal_topic_editorial_state_guard_v1()', 'CREATE FUNCTION pg_temp.editorial_state_guard_fixture()')
 .replace('SET search_path=public,extensions,pg_temp', 'SET search_path=pg_temp,public,extensions');
// Only the schema lookup changes: temporary synthetic relations isolate this
// exact trigger body from real ledgers. All temp DDL/rows are rolled back.
test('42 growing checkpoints: set-based paid proof, append-only history, coverage and global result',
 { skip: !urlFile, timeout: 120_000 }, async t => {
 const pool = new pg.Pool({ connectionString: readFileSync(urlFile!, 'utf8').trim(), max: 1,
  ssl: process.env.NOISIA_EDITORIAL_PG_TLS === '1' ? { rejectUnauthorized: false } : undefined });
 const client = await pool.connect();
 const execution = randomUUID(), workspace = randomUUID(), token = randomUUID(), planDigest = `sha256:${'a'.repeat(64)}`;
 const outputs = Array.from({ length: 42 }, (_, batch_index) => ({ contract_version: 'signal-topic-editorial-screening-output-v1', batch_index,
  decisions: Array.from({ length: batch_index === 41 ? 12 : 40 }, (_, index) => ({ group_key: `open:${batch_index}-${index}`,
   disposition: 'noise', candidate: null, confidence: .99, rationale: 'Synthetic evidence only.', cited_ref_ids: [] })) }));
 const originalIds = outputs.map(() => randomUUID());
 const initial = { contract_version: 'signal-topic-editorial-runner-v1', execution_key: execution, plan_digest: planDigest,
  phase: 'screening', screening_outputs: [], global: null };
 const snapshot = async () => (await client.query('SELECT state_body FROM pg_temp.editorial_state_fixture')).rows[0].state_body;
 const save = async (state: unknown) => client.query('UPDATE pg_temp.editorial_state_fixture SET state_body=$1', [JSON.stringify(state)]);
 const reject = async (state: unknown, pattern: RegExp) => {
  await client.query('SAVEPOINT rejected_state');
  try { await assert.rejects(save(state), pattern); }
  finally { await client.query('ROLLBACK TO SAVEPOINT rejected_state'); await client.query('RELEASE SAVEPOINT rejected_state'); }
 };
 try {
  await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='60s'");
  await client.query(`CREATE TEMP TABLE signal_topic_editorial_requests(id uuid PRIMARY KEY,execution_id uuid,workspace_id uuid,
   phase text,batch_index integer,parent_request_id uuid,receipts jsonb,request_digest text);
   CREATE TEMP TABLE signal_topic_editorial_calls(id uuid PRIMARY KEY,request_id uuid,execution_id uuid,workspace_id uuid,
    status text,response_http_status integer,response_complete boolean,response_output jsonb);
   CREATE TEMP TABLE editorial_state_fixture(id uuid,workspace_id uuid,status text,execution_token uuid,execution_expires_at timestamptz,
    plan_digest text,plan jsonb,state_body text);
   CREATE TEMP TABLE editorial_state_outputs(batch_index integer,output jsonb);`);
  await client.query(guard);
  await client.query('CREATE TRIGGER editorial_state_fixture_guard BEFORE UPDATE ON pg_temp.editorial_state_fixture FOR EACH ROW EXECUTE FUNCTION pg_temp.editorial_state_guard_fixture()');
  await client.query(`INSERT INTO pg_temp.editorial_state_fixture VALUES($1,$2,'running',$3,clock_timestamp()+interval '1 hour',$4,$5,$6)`,
   [execution, workspace, token, planDigest, JSON.stringify({ batches: outputs.map(o => ({ batch_index: o.batch_index })) }), JSON.stringify(initial)]);
  const fixtures = outputs.map((output, i) => ({ id: originalIds[i], output }));
  await client.query(`INSERT INTO pg_temp.signal_topic_editorial_requests SELECT (value->>'id')::uuid,$2,$3,'screening',
    (value->'output'->>'batch_index')::integer,NULL,value->'output'->'decisions','synthetic-request-'||(value->'output'->>'batch_index')
   FROM jsonb_array_elements($1::jsonb);
   `, [JSON.stringify(fixtures), execution, workspace]);
  await client.query(`INSERT INTO pg_temp.signal_topic_editorial_calls SELECT gen_random_uuid(),(value->>'id')::uuid,$2,$3,'settled',200,true,value->'output'
   FROM jsonb_array_elements($1::jsonb)`, [JSON.stringify(fixtures), execution, workspace]);
  await client.query("INSERT INTO pg_temp.editorial_state_outputs SELECT (value->>'batch_index')::integer,value FROM jsonb_array_elements($1::jsonb)", [JSON.stringify(outputs)]);
  await t.test('unpaid, incomplete HTTP, foreign owner and wrong coverage cannot enter the first checkpoint', async () => {
   const first = { ...initial, screening_outputs: [outputs[0]] };
   for (const mutation of ["status='response_persisted'", 'response_complete=false', 'response_http_status=500', `workspace_id='${randomUUID()}'`]) {
    await client.query('SAVEPOINT unpaid_fixture');
    try { await client.query(`UPDATE pg_temp.signal_topic_editorial_calls SET ${mutation} WHERE request_id=$1`, [originalIds[0]]);
     await reject(first, /state_unpaid/u); }
    finally { await client.query('ROLLBACK TO SAVEPOINT unpaid_fixture'); }
   }
   const bad = structuredClone(first); bad.screening_outputs[0]!.decisions.pop();
   await client.query('SAVEPOINT coverage_fixture');
   try { await client.query('UPDATE pg_temp.signal_topic_editorial_calls SET response_output=$1 WHERE request_id=$2', [JSON.stringify(bad.screening_outputs[0]), originalIds[0]]);
    await reject(bad, /coverage_invalid/u); }
   finally { await client.query('ROLLBACK TO SAVEPOINT coverage_fixture'); }
  });
  await t.test('a settled repair child supplies the same original screening checkpoint', async () => {
   await client.query('SAVEPOINT repair_fixture');
   const child = randomUUID();
   await client.query(`INSERT INTO pg_temp.signal_topic_editorial_requests
    SELECT $1,execution_id,workspace_id,phase,batch_index,id,receipts,'synthetic-repair' FROM pg_temp.signal_topic_editorial_requests WHERE id=$2`, [child, originalIds[0]]);
   await client.query('UPDATE pg_temp.signal_topic_editorial_calls SET request_id=$1 WHERE request_id=$2', [child, originalIds[0]]);
   await save({ ...initial, screening_outputs: [outputs[0]] });
   await client.query('ROLLBACK TO SAVEPOINT repair_fixture');
  });
  await t.test('42 growing saves validate 1,652 decisions within the practical budget', async () => {
   const started = performance.now();
   await client.query(`DO $$ DECLARE item record;body jsonb;outputs jsonb:='[]';BEGIN
    SELECT state_body::jsonb INTO body FROM pg_temp.editorial_state_fixture;
    FOR item IN SELECT output,batch_index FROM pg_temp.editorial_state_outputs ORDER BY batch_index LOOP
     outputs:=outputs||jsonb_build_array(item.output);
     body:=jsonb_set(jsonb_set(body,'{screening_outputs}',outputs),'{phase}',to_jsonb(CASE WHEN item.batch_index=41 THEN 'global' ELSE 'screening' END));
     UPDATE pg_temp.editorial_state_fixture SET state_body=body::text;
    END LOOP;END;$$;`);
   const elapsed = Math.round(performance.now() - started); t.diagnostic(`42 growing checkpoints / 1652 groups: ${elapsed} ms`);
   assert.ok(elapsed < 60_000); assert.equal(JSON.parse(await snapshot()).screening_outputs.length, 42);
  });
  await t.test('retained outputs cannot disappear, change, duplicate, or gain an unproven duplicate decision', async () => {
   const state = JSON.parse(await snapshot());
   const missing = structuredClone(state); missing.screening_outputs.pop(); await reject(missing, /state_invalid/u);
   const changed = structuredClone(state); changed.screening_outputs[0].decisions[0].rationale = 'Changed'; await reject(changed, /state_invalid/u);
   const whitespace = structuredClone(state); whitespace.screening_outputs[0].decisions[0].rationale += ' '; await reject(whitespace, /state_invalid/u);
   const duplicate = structuredClone(state); duplicate.screening_outputs.push(duplicate.screening_outputs[0]); await reject(duplicate, /state_invalid/u);
   const multiplicity = structuredClone(state); multiplicity.screening_outputs[0].decisions.push(multiplicity.screening_outputs[0].decisions[0]); await reject(multiplicity, /state_invalid/u);
   const reordered = structuredClone(state); reordered.screening_outputs.reverse(); reordered.screening_outputs[0].decisions.reverse();
   await save(reordered); // Array order was never editorial identity.
  });
  await t.test('only an exactly linked settled global result completes the checkpoint', async () => {
   const state = JSON.parse(await snapshot()), result = { contract_version: 'signal-topic-editorial-global-result-v1', concepts: [],
    noise_group_keys: outputs.flatMap(o => o.decisions.map(d => d.group_key)), unresolved_group_keys: [] };
   const complete = { ...state, phase: 'completed', global: { request_digest: 'synthetic-global', result } };
   await reject(complete, /global_unpaid/u);
   const globalId = randomUUID();
   await client.query("INSERT INTO pg_temp.signal_topic_editorial_requests VALUES($1,$2,$3,'global',NULL,NULL,'[]','synthetic-global')", [globalId, execution, workspace]);
   await client.query("INSERT INTO pg_temp.signal_topic_editorial_calls VALUES($1,$2,$3,$4,'settled',200,true,$5)", [randomUUID(), globalId, execution, workspace, JSON.stringify(result)]);
   const changed = structuredClone(complete); changed.global.result.noise_group_keys.pop(); await reject(changed, /global_unpaid/u);
   const globalChild = randomUUID();
   await client.query(`INSERT INTO pg_temp.signal_topic_editorial_requests SELECT $1,execution_id,workspace_id,phase,batch_index,id,receipts,'synthetic-global-repair'
    FROM pg_temp.signal_topic_editorial_requests WHERE id=$2`, [globalChild, globalId]);
   await client.query('UPDATE pg_temp.signal_topic_editorial_calls SET request_id=$1 WHERE request_id=$2', [globalChild, globalId]);
   await save(complete); assert.equal(JSON.parse(await snapshot()).phase, 'completed');
   const revision = structuredClone(complete); revision.global.request_digest = 'changed'; await reject(revision, /state_invalid/u);
  });
 } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
