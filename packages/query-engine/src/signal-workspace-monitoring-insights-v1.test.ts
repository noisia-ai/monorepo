import assert from 'node:assert/strict';
import test from 'node:test';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import {
  buildWorkspaceMonitoringInsightCandidatesV1,
  buildWorkspaceMonitoringInsightRequestV1,
  workspaceMonitoringInsightWindowsV1,
  workspaceMonitoringInsightConfigurationV1,
  workspaceMonitoringMonthlyInsightsV1,
  parseWorkspaceMonitoringInsightReceiptV1
} from './signal-workspace-monitoring-insights-v1';

const workspace='00000000-0000-4000-8000-000000000001';
const window={start:'2026-10-01',end:'2026-10-30',days:30 as const};
const metrics={denominator:12,scope_digest:'sha256:'+'1'.repeat(64),metadata_digest:'sha256:'+'2'.repeat(64),
  population:{map_id:workspace,map_digest:'sha256:'+'3'.repeat(64),input_revision:'1',policy_revision:1},
  source_coverage:{sentiment_known:10,thread_id_known:0,content_type_known:0,engagement_known_root_posts:0,llm_eligible_roots:12},
  summary:{mentions:12,root_posts:0,comments:0,unknown_roles:12},
  series:[{period_start:'2026-10-30',mentions:12,sentiment:{positive:6,neutral:3,negative:1,classified:10}}],
  sentiment:{positive:6,neutral:3,negative:1,unclassified:2},platforms:[{key:'web',count:12}],
  attention:{root_posts:0,total_interactions:0,active_root_posts:0,active_ratio:null},drivers:[],limitations:[]};

test('native monthly windows are actual thirty-day ranges, not the selected page period',()=>{
 assert.deepEqual(workspaceMonitoringInsightWindowsV1({from:'2026-08-01',through:'2026-10-30'}),{
  current:window,previous:{start:'2026-09-01',end:'2026-09-30',days:30},partial:false});
 assert.equal(workspaceMonitoringInsightWindowsV1({from:'2026-10-29',through:'2026-10-30'})?.partial,true);
});
test('unknown source fields do not become zero-valued depth, concentration or attention insights',()=>{
 const candidates=buildWorkspaceMonitoringInsightCandidatesV1({current:metrics,previous:null});
 assert.ok(candidates.some(item=>item.kind==='volume_momentum'));
 assert.ok(candidates.some(item=>item.kind==='sentiment_balance'));
 assert.ok(!candidates.some(item=>['conversation_depth','conversation_concentration','attention_momentum'].includes(item.kind)));
 assert.ok(candidates.every(item=>item.evidence.mention_ids.length===0));
});
test('one aggregate request is sealed and budgeted with no mention text or legacy corpus',()=>{
 const packet={contract_version:'signal-workspace-monitoring-insight-packet-v1' as const,workspace_id:workspace,
  timezone:'America/Sao_Paulo',locale:'es-MX' as const,cadence:'rolling_30_days' as const,scope_segment:'all' as const,window,
  comparison_window:null,partial:true,current:metrics,previous:null,
  candidates:buildWorkspaceMonitoringInsightCandidatesV1({current:metrics,previous:null})};
 const request=buildWorkspaceMonitoringInsightRequestV1(packet,workspaceMonitoringInsightConfigurationV1(workspace));
 const providerBody=JSON.parse(request.request_body);
 const schema=providerBody.output_config.format.schema;
 const unsupported=new Set(['minimum','maximum','multipleOf','minLength','maxLength','maxItems']);
 const structuralSchema=(value:unknown):void=>{
  if(Array.isArray(value)){value.forEach(structuralSchema);return;}
  if(!value||typeof value!=='object')return;
  const node=value as Record<string,unknown>;
  for(const [key,child] of Object.entries(node)){
   assert.equal(unsupported.has(key),false,'raw Anthropic schema rejects unsupported constraint '+key);
   if(key==='minItems')assert.ok(child===0||child===1,'only minItems zero/one is supported');
   structuralSchema(child);
  }
  if(node.type==='object')assert.equal(node.additionalProperties,false);
 };
 structuralSchema(schema);
 assert.equal(request.configuration.schema_digest,digest(schema),'policy seals the schema actually emitted on the wire');
 assert.equal((request.configuration as Record<string,unknown>).strict_schema_digest,'sha256:8f0d73a4e2e5459f51127b650c4b09dd634f31422b117fa5b4a9b28ab36d9956','the original strict local contract remains sealed');
 assert.match(schema.properties.items.items.properties.short_title.description,/80/);
 assert.equal(schema.properties.items.minItems,1);
 assert.equal(schema.properties.items.items.properties.limitations.minItems,1);
 const reorder=(value:unknown):unknown=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).reverse().map(([key,child])=>[key,reorder(child)])):value;
 const reread=buildWorkspaceMonitoringInsightRequestV1(reorder(packet) as typeof packet,workspaceMonitoringInsightConfigurationV1(workspace));
 assert.equal(reread.request_body,request.request_body,'JSONB object ordering cannot change a paid request during replay');
 assert.equal(reread.request_digest,request.request_digest);
 assert.ok(request.reserved_micro_usd>0&&request.reserved_micro_usd<2_000_000);
 assert.ok(!request.request_body.includes('study_corpus_id'));
 assert.ok(!request.request_body.includes('mention_ids'));
 assert.ok(!request.request_body.includes(workspace));
 assert.equal(workspaceMonitoringMonthlyInsightsV1({...packet,current:{...metrics,source_coverage:{...metrics.source_coverage,llm_eligible_roots:0}}}).items.length,packet.candidates.length,
  'metric-only access retains deterministic cards without granting LLM authority');
 const raw=JSON.stringify({model:'claude-sonnet-4-6',role:'assistant',stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:60},
  content:[{type:'text',text:JSON.stringify({contract_version:'signal-monthly-insight-editorial-v1',candidate_hash:request.packet_digest,
   summary:'The observed conversation has a positive balance.',items:[{candidate_id:packet.candidates[0]!.id,priority:1,
    short_title:'Observed conversation',explanation:'The packet describes the available activity.',why_it_matters:'It establishes a measured baseline.',
    confidence:'low',limitations:['Aggregates do not establish causes.']}]})}]});
 const parsed=parseWorkspaceMonitoringInsightReceiptV1(request,raw);
 assert.equal(parsed.usage.input_tokens,100);assert.equal(parsed.editorial.items.length,1);
 assert.throws(()=>parseWorkspaceMonitoringInsightReceiptV1(request,raw.replace('end_turn','max_tokens')));
 const envelope=JSON.parse(raw),output=JSON.parse(envelope.content[0].text);
 for(const [field,limit] of [['summary',400],['short_title',80],['explanation',280],['why_it_matters',220],['limitations',180]] as const){
  const oversized=structuredClone(output);
  if(field==='summary')oversized.summary='a'.repeat(limit+1);
  else if(field==='limitations')oversized.items[0].limitations=['a'.repeat(limit+1)];
  else oversized.items[0][field]='a'.repeat(limit+1);
  assert.throws(()=>parseWorkspaceMonitoringInsightReceiptV1(request,JSON.stringify({...envelope,content:[{type:'text',text:JSON.stringify(oversized)}]})),field+' keeps its strict local bound');
 }
 for(const invalid of [{...output,items:[]},{...output,items:Array.from({length:8},()=>output.items[0])},
  {...output,items:[{...output.items[0],priority:0}]},{...output,items:[{...output.items[0],priority:8}]},
  {...output,items:[{...output.items[0],limitations:['a','b','c','d']}]}])
  assert.throws(()=>parseWorkspaceMonitoringInsightReceiptV1(request,JSON.stringify({...envelope,content:[{type:'text',text:JSON.stringify(invalid)}]})));

});
