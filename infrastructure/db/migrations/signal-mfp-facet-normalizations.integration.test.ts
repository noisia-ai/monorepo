import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { facetForcedAbstentionsSqlV1 } from '../signal-facet-normalizations';

test('MFP forced abstention is visible only for the exact applied label and disappears after human replacement', {
 skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:30_000,
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
 const c=await pool.connect();
 try {
  await c.query('BEGIN');await c.query('SET LOCAL search_path=pg_temp,public,extensions');
  await c.query(`CREATE TEMP TABLE signal_mention_facet_overrides(workspace_id text,root_id text,dimension text,superseded_at timestamptz);
   CREATE TEMP TABLE signal_mention_facet_labels(workspace_id text,root_id text,input_digest text,labeler_digest text,entity_context_digest text,call_id text);
   CREATE TEMP TABLE signal_labeling_calls(id text,workspace_id text,results jsonb,results_applied boolean)`);
  const result={root_id:'root',input_digest:'input',entity_context_digest:'context',normalizations:[{dimension:'asunto',reason:'exceeds_word_limit',action:'abstained',max_words:12}]};
  await c.query("INSERT INTO signal_mention_facet_labels VALUES('workspace','root','input','labeler','context','call')");
  await c.query("INSERT INTO signal_labeling_calls VALUES('call','workspace',$1,true)",[JSON.stringify([result])]);
  const read=async(context='context')=>(await c.query(`SELECT ${facetForcedAbstentionsSqlV1('f')} value FROM
   (SELECT 'workspace'::text workspace_id,'root'::text root_id,'input'::text input_digest,'labeler'::text labeler_digest,$1::text entity_context_digest,
    '{"asunto":{"abstained":true}}'::jsonb facets) f`,[context])).rows[0].value;
  assert.deepEqual(await read(),['asunto']);
  assert.deepEqual(await read('stale-context'),[]);
  await c.query("UPDATE signal_labeling_calls SET results_applied=false");assert.deepEqual(await read(),[]);
  await c.query("UPDATE signal_labeling_calls SET results_applied=true,results=$1",[JSON.stringify([{...result,normalizations:[]}])]);assert.deepEqual(await read(),[],'model abstention has no forced-system trace');
  await c.query("UPDATE signal_labeling_calls SET results=$1",[JSON.stringify([result])]);
  await c.query("INSERT INTO signal_mention_facet_overrides VALUES('workspace','root','asunto',NULL)");assert.deepEqual(await read(),[]);
  await c.query("UPDATE signal_mention_facet_overrides SET superseded_at=now()");assert.deepEqual(await read(),['asunto']);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
