import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {
  assertBoundedMentionsCatalogV1,
  boundedMentionsParityV1,
  boundedMentionsSourceV1,
  installBoundedMentionsV1,
  orderedRecordHexSha256V1,
} from './signal-listening-flat-prefix.oracle';
import {
  boundedPopulationRootSetHashV1,
  extractCurrentBoundedMentionsV1,
  sanitizeBoundedPopulationPlanV1,
} from './signal-listening-bounded-population-plan.synthetic.fixture';
import {
  flatPrefixLedgerSqlV1,
  releaseFlatPrefixClientV1,
  withFlatPrefixFullFixtureV1,
  withFlatPrefixReadOnlyV1,
} from './signal-listening-flat-prefix.synthetic.fixture';

const native=process.env.NOISIA_R16_BOUNDED_MENTIONS_COMPARE_PG==='true';
const pure=process.env.NOISIA_R16_BOUNDED_MENTIONS_COMPARE_PURE==='true';
assert.ok(!(native&&pure),'native and pure bounded-mentions modes must stay separate');
const artifactRelative='.data/piloto-masivo/r16/bounded-mentions-compare-native-evidence/bounded-mentions-compare.json';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');

type MetricNode=Record<string,unknown>;
function targetMetrics(explain:unknown){
  const found:Array<{node:MetricNode;path:string}>=[];
  let visited=0;
  const visit=(value:unknown,depth=0,path='Plan',insideItemsCte=false)=>{
    assert.ok(depth<=32,'plan traversal depth cap');
    if(Array.isArray(value)){assert.ok(value.length<=512,'plan traversal array cap');for(let index=0;index<value.length;index++)visit(value[index],depth+1,`${path}[${index}]`,insideItemsCte);return;}
    if(!value||typeof value!=='object')return;
    const node=value as MetricNode;
    const inItems=insideItemsCte||node['Subplan Name']==='CTE items';
    if(Object.hasOwn(node,'Node Type'))assert.ok(++visited<=512,'plan node-count cap');
    if(inItems&&node['Relation Name']==='mentions'&&node.Alias==='m')found.push({node,path});
    if(Object.hasOwn(node,'Plan'))visit(node.Plan,depth+1,`${path}.Plan`,inItems);
    if(Array.isArray(node.Plans))visit(node.Plans,depth+1,`${path}.Plans`,inItems);
    if(Array.isArray(node.Workers))visit(node.Workers,depth+1,`${path}.Workers`,inItems);
  };
  visit(explain);
  assert.equal(found.length,1,'derive exactly the target mentions m relation access from the raw plan');
  const {node,path}=found[0]!;
  const number=(key:string)=>{const value=node[key];assert.ok(typeof value==='number'&&Number.isFinite(value)&&value>=0,key+' must be a finite nonnegative plan metric');return value;};
  const actualRows=number('Actual Rows'),actualLoops=number('Actual Loops');
  assert.ok(actualLoops>0,'target node must have executed at least once');
  const filterRowsReported=typeof node['Rows Removed by Filter']==='number';
  const indexRowsReported=typeof node['Rows Removed by Index Recheck']==='number';
  const filteredRows=typeof node['Rows Removed by Filter']==='number'?number('Rows Removed by Filter'):0;
  const recheckedRows=typeof node['Rows Removed by Index Recheck']==='number'?number('Rows Removed by Index Recheck'):0;
  const bufferKeys=['Shared Hit Blocks','Shared Read Blocks','Shared Dirtied Blocks','Shared Written Blocks',
    'Local Hit Blocks','Local Read Blocks','Local Dirtied Blocks','Local Written Blocks','Temp Read Blocks','Temp Written Blocks'];
  const buffers=Object.fromEntries(bufferKeys.map(key=>[key,typeof node[key]==='number'?number(key):0]));
  const reportedBufferKeys=bufferKeys.filter(key=>typeof node[key]==='number');
  const reportedBufferFields=reportedBufferKeys.length;
  assert.ok(reportedBufferFields>0,'BUFFERS must report at least one metric on the target node');
  return{
    target:'bounded_mentions_m',
    selector:'source CTE items subplan with mentions relation alias m',
    path,
    node_type:node['Node Type'],
    actual_rows:actualRows,
    actual_loops:actualLoops,
    rows_removed_by_filter:filteredRows,
    rows_removed_by_filter_reported:filterRowsReported,
    rows_removed_by_index_recheck:recheckedRows,
    rows_removed_by_index_recheck_reported:indexRowsReported,
    tuple_visits:(actualRows+filteredRows+recheckedRows)*actualLoops,
    buffers,
    reported_buffer_keys:reportedBufferKeys,
    reported_buffer_fields:reportedBufferFields,
  };
}

async function persistEvidence(value:Record<string,unknown>){
  const expected=resolve(process.cwd(),artifactRelative);
  const configured=process.env.R16_BOUNDED_MENTIONS_COMPARE_EVIDENCE_DIR;
  assert.equal(resolve(configured??''),resolve(process.cwd(),'.data/piloto-masivo/r16/bounded-mentions-compare-native-evidence'));
  await mkdir(resolve(expected,'..'),{recursive:true,mode:0o700});
  const bytes=Buffer.from(JSON.stringify(value));
  assert.ok(bytes.byteLength>0&&bytes.byteLength<=2*1024*1024,'native JSON evidence cap');
  const file=await open(expected,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
}

async function pair(c:PoolClient,base:unknown[],roots:ReadonlyArray<string|null>|null,purpose:string,effective:string){
  const params=[...base.slice(0,4),roots,purpose];
  const raw14=await boundedMentionsParityV1(c,params);
  const effective20=await boundedMentionsParityV1(c,params,effective);
  return{purpose,root_count:roots?.length??null,raw14,effective20};
}

if(pure){
  test('0333 candidate is the exact reversible one-clause delta from native0332',async()=>{
    const source=await readFile(new URL('./0332_signal_listening_flat_prefix_preimages.sql',import.meta.url),'utf8');
    const candidate=await readFile(new URL('./0333_signal_listening_bounded_mentions.sql',import.meta.url),'utf8');
    const binding=boundedMentionsSourceV1(source,candidate);
    assert.equal(Buffer.byteLength(candidate)-Buffer.byteLength(source),17);
    assert.equal(candidate.replace(' AND m.id=ANY($5)',''),source);
    assert.equal(binding.source_sql.length,8859);
    assert.equal(binding.candidate_sql.length,8876);
  });

  test('0333 extractor binds its literal SQL and preserves the 0332 old source',async()=>{
    const candidate=await readFile(new URL('./0333_signal_listening_bounded_mentions.sql',import.meta.url),'utf8');
    const extracted=extractCurrentBoundedMentionsV1(candidate);
    assert.equal(extracted.source_version,'0333');
    assert.equal(extracted.sql_sha256,'c88515724bacd82cb61b8b87ac18808483ed8a972437260bd3b64c05ec181090');
    assert.throws(()=>extractCurrentBoundedMentionsV1(candidate.replace('AND m.id=ANY($5)','AND m.id=$5')));
  });

  test('target-plan scan selects the source CTE items access without an operator or filter gate',()=>{
    const plan=[{Plan:{'Node Type':'Nested Loop','Plans':[
      {'Node Type':'Nested Loop','Subplan Name':'CTE items','Plans':[
        {'Node Type':'Seq Scan','Relation Name':'signal_mass_labeling_items','Alias':'i','Actual Rows':3508,'Actual Loops':1,'Shared Hit Blocks':300},
        {'Node Type':'Bitmap Heap Scan','Relation Name':'mentions','Alias':'m','Actual Rows':3508,'Actual Loops':1,'Shared Hit Blocks':75,
          Plans:[{'Node Type':'Bitmap Index Scan','Index Name':'mentions_id_idx','Actual Rows':3508,'Actual Loops':1,'Shared Hit Blocks':200}]},
      ]},
      {'Node Type':'Index Scan','Relation Name':'mentions','Alias':'m','Filter':'text_clean IS NOT NULL','Actual Rows':32768,'Actual Loops':1,'Shared Hit Blocks':500},
    ]}}];
    const target=targetMetrics(plan);
    assert.equal(target.target,'bounded_mentions_m');
    assert.equal(target.selector,'source CTE items subplan with mentions relation alias m');
    assert.equal(target.path,'Plan[0].Plan.Plans[0].Plans[1]');
    assert.equal(target.tuple_visits,3508);
    assert.equal(target.buffers['Shared Hit Blocks'],75);
  });

  test('3508-root cohort hash is order independent and rejects duplicate roots',()=>{
    const roots=Array.from({length:3508},(_,index)=>`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
    const value=boundedPopulationRootSetHashV1(roots);
    assert.equal(value,boundedPopulationRootSetHashV1([...roots].reverse()));
    assert.throws(()=>boundedPopulationRootSetHashV1([...roots,roots[0]!]));
    for(const records of [[],['00'],['00','ff','ca']])
      assert.equal(orderedRecordHexSha256V1(records),sha(records.join('\n')),'incremental digest preserves empty, singleton and ordered newline-delimited bytes');
  });

  test('3508 bounded fixture destroys an uncertain client when BEGIN fails',async()=>{
    const primary=Error('begin failed'),released:boolean[]=[];
    const c={query:async(sql:string)=>{if(sql.startsWith('BEGIN'))throw primary;return{rows:[]};},release:(destroy:boolean)=>released.push(destroy)} as unknown as PoolClient;
    let caught:unknown;
    try{await withFlatPrefixReadOnlyV1(c,async()=>{},'bounded_3508_of_32768');}catch(error){caught=error;}finally{releaseFlatPrefixClientV1(c);}
    assert.equal(caught,primary);
    assert.deepEqual(released,[true]);
  });
}

test('native bounded mentions filter preserves output and limits the selected mention access',{
  skip:!native,
  timeout:2_250_000,
},async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','native bounded mentions comparison is authorized only in CI');
  assert.notEqual(process.env.NOISIA_R16_BOUNDED_MENTIONS_COMPARE_PURE,'true');
  const configured=process.env.R16_BOUNDED_MENTIONS_COMPARE_EVIDENCE_DIR;
  assert.equal(resolve(configured??''),resolve(process.cwd(),'.data/piloto-masivo/r16/bounded-mentions-compare-native-evidence'));
  let installed:Awaited<ReturnType<typeof installBoundedMentionsV1>>|undefined;
  let selectedCount=0,selectedHash='',evidence:Record<string,unknown>|undefined;
  await withFlatPrefixFullFixtureV1({
    async install(c){installed=await installBoundedMentionsV1(c);},
    bounded:{
      async callback(_database,body){await body();},
      roster(roots){selectedCount=roots.length;assert.equal(selectedCount,3508);selectedHash=boundedPopulationRootSetHashV1(roots);},
      async state(c,params,runId){
        const ledger=(await c.query(flatPrefixLedgerSqlV1,[params[0],runId])).rows[0];
        const run=(await c.query('SELECT status,lease_token IS NULL released FROM signal_labeling_runs WHERE id=$1',[runId])).rows[0];
        const answers=(await c.query(`SELECT count(*)::int rows,count(DISTINCT root_id)::int roots,
          count(*) FILTER(WHERE question_key NOT IN('voice','promotion') OR NOT(root_id=ANY($3::uuid[])))::int outside
          FROM signal_listening_answers WHERE workspace_id=$1 AND run_id=$2`,[params[0],runId,params[4]])).rows[0];
        const corpus=(await c.query(`SELECT count(*)::int rows,count(DISTINCT root_id)::int roots
          FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2`,[params[0],params[2]])).rows[0];
        return{ledger,run,answers,corpus};
      },
    },
    async read({c,params,setup}){
      assert.ok(installed,'bounded aliases must be installed before the RO transaction');
      assert.equal(params.length,6);
      const roots=params[4] as string[];
      assert.equal(selectedCount,3508);
      assert.equal(roots.length,3508);
      assert.equal(boundedPopulationRootSetHashV1(roots),selectedHash,'reuse the exact product-selected allowlist for both arms');
      assert.deepEqual(setup.corpus,{rows:32768,roots:32768},'confirm the actual map contains 32768 distinct roots');
      assert.deepEqual(setup.answers,{rows:7016,roots:3508,outside:0},'confirm two base answers per selected root and no unselected answers');
      assert.equal((setup.ledger as Record<string,unknown>).calls,3508);
      assert.equal((setup.ledger as Record<string,unknown>).applied,3508);
      assert.equal((setup.ledger as Record<string,unknown>).roots,3508);
      assert.equal((setup.ledger as Record<string,unknown>).reserved_micro_usd,'0');
      assert.equal((setup.ledger as Record<string,unknown>).unknown_micro_usd,'0');
      assert.equal((setup.run as Record<string,unknown>).status,'running');
      assert.equal((setup.run as Record<string,unknown>).released,true);
      const snapshot=(await c.query('SELECT pg_current_snapshot()::text value')).rows[0].value;
      await assertBoundedMentionsCatalogV1(c,installed.before);
      const started=performance.now();
      const purposes=['llm-processing','client-derived-metrics'] as const;
      const parity:Array<Record<string,unknown>>=[];
      for(const purpose of purposes){
        parity.push(await pair(c,params,roots,purpose,installed.effective));
        parity.push(await pair(c,params,null,purpose,installed.effective));
        parity.push(await pair(c,params,[],purpose,installed.effective));
        parity.push(await pair(c,params,[roots[0]!,roots[0]!,null,roots[1]!],purpose,installed.effective));
        const boundaries=(await c.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id LIMIT 4097',[params[0],params[2]])).rows.map(row=>row.root_id as string);
        assert.equal(boundaries.length,4097);assert.equal(new Set(boundaries).size,4097);
        parity.push(await pair(c,params,boundaries.slice(0,4096),purpose,installed.effective));
        parity.push(await pair(c,params,boundaries,purpose,installed.effective));
        parity.push(await pair(c,params,[randomUUID()],purpose,installed.effective));
        parity.push(await pair(c,params,[...roots.slice(0,3),randomUUID()],purpose,installed.effective));
      }
      const physicalParams=[...params.slice(0,4),roots,params[5]];
      const explain=async(sql:string)=>{
        const result=await c.query('EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) '+sql,physicalParams);
        const raw=result.rows[0]?.['QUERY PLAN'];
        const sqlIdentifiers=new Set([
          ...[...installed!.source_sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/giu)].map(match=>match[1]!),
          ...[...installed!.source_sql.matchAll(/\b([a-z_][a-z0-9_]*) AS(?: MATERIALIZED)?\(/giu)].map(match=>match[1]!),
          ...[...installed!.source_sql.matchAll(/\b([a-z_][a-z0-9_]*)\(/gu)].map(match=>match[1]!),
        ]);
        const relationNames=[...new Set([...installed!.source_sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/giu)].map(match=>match[1]!))];
        const indexRows=await c.query(`SELECT index_class.relname name
          FROM pg_index i JOIN pg_class table_class ON table_class.oid=i.indrelid
          JOIN pg_namespace n ON n.oid=table_class.relnamespace
          JOIN pg_class index_class ON index_class.oid=i.indexrelid
          WHERE n.nspname='public' AND table_class.relname=ANY($1::text[])
          ORDER BY index_class.relname`,[relationNames]);
        const identifiers=new Set([...sqlIdentifiers,...indexRows.rows.map(row=>row.name as string)]);
        const sanitized=sanitizeBoundedPopulationPlanV1(raw,identifiers);
        return{sanitized,metrics:targetMetrics(raw)};
      };
      const oldPlan=await explain(installed.source_sql),newPlan=await explain(installed.candidate_sql);
      const readMs=performance.now()-started;
      assert.ok(readMs<=300000,'fresh 32k/3508 differential read budget exceeded');
      assert.deepEqual((await c.query('SELECT pg_current_snapshot()::text value')).rows[0],{value:snapshot});
      await assertBoundedMentionsCatalogV1(c,installed.before);
      const candidateTargetReduced=Number(newPlan.metrics.tuple_visits)<=3508&&Number(newPlan.metrics.tuple_visits)<Number(oldPlan.metrics.tuple_visits);
      evidence={
        contract:'r16-bounded-mentions-compare-v1',status:'observed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',
        corpus_count:Number((setup.corpus as Record<string,number>).roots),root_count:selectedCount,root_set_sha256:selectedHash,
        fixture_state:{
          corpus_rows:Number((setup.corpus as Record<string,number>).rows),corpus_roots:Number((setup.corpus as Record<string,number>).roots),
          selected_roots:selectedCount,answer_rows:Number((setup.answers as Record<string,number>).rows),
          answer_roots:Number((setup.answers as Record<string,number>).roots),answer_outside:Number((setup.answers as Record<string,number>).outside),
          ledger_calls:Number((setup.ledger as Record<string,number>).calls),ledger_applied:Number((setup.ledger as Record<string,number>).applied),
          ledger_roots:Number((setup.ledger as Record<string,number>).roots),
          synthetic_spend_micro_usd:String((setup.ledger as Record<string,unknown>).synthetic_spend_micro_usd),
          reserved_micro_usd:String((setup.ledger as Record<string,unknown>).reserved_micro_usd),
          unknown_micro_usd:String((setup.ledger as Record<string,unknown>).unknown_micro_usd),
          run_status:String((setup.run as Record<string,unknown>).status),lease_released:(setup.run as Record<string,unknown>).released===true,
        },
        source_binding:{
          source_sha256:installed.source_sha256,candidate_sha256:installed.candidate_sha256,
          source_sql_sha256:sha(installed.source_sql),candidate_sql_sha256:sha(installed.candidate_sql),
          public_prosrc_sha256:sha(installed.before.native.find(row=>row.proname==='signal_listening_population_roots_v1')!.prosrc as string),
          old_alias_prosrc_sha256:sha(installed.before.aliases.find(row=>row.proname==='r16_bounded_old')!.prosrc as string),
          new_alias_prosrc_sha256:sha(installed.before.aliases.find(row=>row.proname==='r16_bounded_new')!.prosrc as string),
          effective_prosrc_sha256:sha(installed.before.effective[0]!.prosrc as string),
        },
        parity,physical_purpose:'llm-processing',physical_read_ms:readMs,
        old_plan:{plan:oldPlan.sanitized.plan,nodes:oldPlan.sanitized.nodes,bytes:oldPlan.sanitized.bytes,sanitized_sha256:oldPlan.sanitized.sanitized_sha256,target_access:oldPlan.metrics},
        new_plan:{plan:newPlan.sanitized.plan,nodes:newPlan.sanitized.nodes,bytes:newPlan.sanitized.bytes,sanitized_sha256:newPlan.sanitized.sanitized_sha256,target_access:newPlan.metrics},
        buffer_scope:'per target node as reported by PostgreSQL; parent counters may include descendants, and counters are never summed across nodes or categories',
        candidate_target_reduced:candidateTargetReduced,
        gates:{source_binding:true,cohort_binding:true,raw14_parity:true,effective20_parity:true,snapshot_binding:true,catalog_unchanged:true,bounded_target_access:candidateTargetReduced,closure_confirmed:true},
        limitations:['new synthetic cohort; not the lost 3508 original IDs','fresh 32k physical plan only; historical path has existing 4096 parity coverage','no CPU, causality, generalized speedup, H1, adoption, or full benchmark claim'],
      };
    },
  },'bounded_3508_of_32768');
  assert.ok(evidence,'fixture, read-only comparison, storage teardown and original lease cleanup must all complete');
  await persistEvidence(evidence);
  assert.equal(evidence.candidate_target_reduced,true,'retain the measured plans, then reject the candidate if selected target tuple visits did not strictly decrease');
});
