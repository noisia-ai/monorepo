import assert from 'node:assert/strict';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {quoteSignalListeningPreparationV1} from '../signal-listening-preparation';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
const enabled=process.env.NOISIA_R16_MAP_INPUT_STATISTICS_PG==='true';
test('canonical map completion supplies current persistent root statistics before the first native Listening quote',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async f=>{
 const tables=['mentions','signal_mention_import_memberships','signal_mass_labeling_items'];
 const estimates=(await f.database.query(`SELECT relname,reltuples FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) ORDER BY relname`,[tables])).rows;
 assert.equal(estimates.length,3);
 for(const row of estimates)assert.equal(row.reltuples,3,row.relname+' must not retain an empty-table estimate after native map materialization');
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 const configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV2('defined_consumer_second_pass').configuration});
 const quote=await quoteSignalListeningPreparationV1({...access,configuration_id:configuration.id,map_id:f.map_id});
 assert.ok(quote.jev_estimated_upper_micro_usd>0);
 const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0]!.entity_context_digest;
 const population=(await f.database.query(`SELECT root_id,question_key,scope_state,answer FROM signal_listening_population_v1($1,$2,$3,$4) ORDER BY root_id,question_key`,[f.workspace_id,configuration.id,f.map_id,context])).rows;
 assert.equal(population.length,12);assert.equal(new Set(population.map(r=>r.root_id)).size,3);
 assert.equal(population.filter(r=>r.scope_state==='included').length,6);assert.equal(population.filter(r=>r.scope_state==='awaiting_base').length,6);
 assert.ok(population.every(r=>r.answer===null));assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE workspace_id=$1',[f.workspace_id])).rows[0]!.n,0,'quoting never sends or reserves classifier calls');
}}));
