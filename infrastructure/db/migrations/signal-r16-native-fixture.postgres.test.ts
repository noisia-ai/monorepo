import assert from 'node:assert/strict';
import test from 'node:test';
import { runMassLabelingAcceptanceFixtureV1 } from './signal-mass-labeling-acceptance.synthetic.fixture';

test('native test hook returns an authorized three-root run before the provider is called', {
  skip: process.env.NOISIA_R16_NATIVE_FIXTURE_PG !== 'true', timeout: 120_000,
}, async () => {
  let callbackCalls = 0;
  await runMassLabelingAcceptanceFixtureV1('product', { beforeProcessing: async context => {
    callbackCalls++;
    const { rows: [row] } = await context.database.query(`SELECT current_database() database,
        run.actor_user_id,run.workspace_id,admission.target_id,admission.action,admission.provider,admission.model,
        mass.map_id,mass.smoke_root_limit,source.root_count,actor.status actor_status
      FROM signal_labeling_runs run
      JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id AND mass.workspace_id=run.workspace_id
      JOIN signal_mass_labeling_maps source ON source.id=mass.map_id AND source.workspace_id=mass.workspace_id
      JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id
        AND admission.target_id=run.id AND admission.workspace_id=run.workspace_id
      JOIN users actor ON actor.id=run.actor_user_id WHERE run.id=$1`, [context.run_id]);
    assert.match(String(row.database), /^noisia_mfp_recovery_[a-f0-9]{32}$/u);
    assert.equal(row.actor_user_id, context.actor_user_id);
    assert.equal(row.workspace_id, context.workspace_id);
    assert.equal(row.map_id, context.map_id);
    assert.equal(row.target_id, context.run_id);
    assert.equal(row.actor_status, 'active');
    assert.equal(row.root_count, 3);
    assert.equal(row.smoke_root_limit, 1000);
    assert.equal(row.action, 'mass_labeling_jev');
    assert.equal(row.provider, 'typesafe');
    assert.equal(row.model, 'jev-1.13.0');
    const calls = await context.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1', [context.run_id]);
    assert.equal(calls.rows[0]?.n, 0);
  } });
  assert.equal(callbackCalls, 1);
});
