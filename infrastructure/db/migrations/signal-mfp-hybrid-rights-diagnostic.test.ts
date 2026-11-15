import assert from 'node:assert/strict';
import test from 'node:test';
import {projectHybridRightsPlanDiagnosticV1,redactHybridRightsDiagnosticV1,HYBRID_RIGHTS_DIAGNOSTIC_TABLES_V1,HYBRID_RIGHTS_DIAGNOSTIC_SETTINGS_V1} from './signal-mfp-hybrid-rights-diagnostic';
test('estimated and actual rights plans retain parent paths and costs but redact constants and private row identifiers',()=>{
 const uuid='00000000-0000-4000-8000-000000000001';
 const rows=projectHybridRightsPlanDiagnosticV1({'Node Type':'Nested Loop','Join Type':'Inner','Plan Width':24,'Plan Rows':1,'Total Cost':123,
  Output:["sensitive output text"],Settings:{unsafe:'sensitive setting'},Plans:[{'Node Type':'Index Scan','Parent Relationship':'Inner','Relation Name':'mentions',
   'Index Name':'idx_mentions_canonical_root','Index Cond':`((canonical_mention_id = requested.root_id) AND (workspace_id = '${uuid}'::uuid))`,
   Filter:"text_clean = 'sensitive ''quoted'' text'",'Actual Rows':1,'Actual Loops':340,'Actual Total Time':5.2}]});
 assert.deepEqual(rows[0],{path:'root',parent_path:null,node_type:'Nested Loop',join_type:'Inner',plan_rows:1,plan_width:24,total_cost:123});
 assert.equal(rows[1]!.parent_path,'root');assert.equal(rows[1]!.path,'root.0');assert.equal(rows[1]!.parent_relationship,'Inner');
 assert.equal(rows[1]!.index_cond,"((canonical_mention_id = requested.root_id) AND (workspace_id = '<literal>'::uuid))");
 assert.equal(rows[1]!.actual_loops,340);assert.equal(rows[1]!.actual_total_ms,5.2);
 const logged=JSON.stringify(rows);for(const secret of [uuid,'sensitive output','sensitive setting','sensitive ','quoted'])assert.equal(logged.includes(secret),false);
 assert.equal(redactHybridRightsDiagnosticV1('unquoted identifier '+uuid),'unquoted identifier <uuid>');
});
test('diagnostics omit unrecognized and nonscalar payloads rather than recursively printing them',()=>{
 const rows=projectHybridRightsPlanDiagnosticV1({'Node Type':{private:'must not appear'},Filter:['must not appear'],'Plan Rows':Infinity,
  'Inner Unique':true,'Rows Removed by Filter':99,'Secret':'must not appear',Plans:[{'Node Type':'CTE Scan','CTE Name':'eligible_batches'}]});
 assert.deepEqual(rows,[{path:'root',parent_path:null,inner_unique:true,rows_removed_by_filter:99},{path:'root.0',parent_path:'root',node_type:'CTE Scan',cte:'eligible_batches'}]);
 assert.equal(HYBRID_RIGHTS_DIAGNOSTIC_TABLES_V1.length,8);assert.equal(new Set(HYBRID_RIGHTS_DIAGNOSTIC_TABLES_V1).size,8);
 assert.ok(HYBRID_RIGHTS_DIAGNOSTIC_SETTINGS_V1.includes('statement_timeout'));assert.ok(HYBRID_RIGHTS_DIAGNOSTIC_SETTINGS_V1.includes('jit_above_cost'));
});
