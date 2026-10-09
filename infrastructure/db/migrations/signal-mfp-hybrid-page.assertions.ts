import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {labelerDigestV1,hybridJevMembershipIdentityV1,mapHybridJevAnswerV1} from "@noisia/query-engine";
import {createHybridMembershipStageStoreV1,type HybridStageResultV1} from "../signal-hybrid-runs";
import {hybridJevCallProposalV1,runHybridMembershipTickV1} from "../../../services/workers/src/workers/signal-hybrid-membership";
import {JevProviderErrorV1,type JevRequestV1} from "../../../services/workers/src/providers/typesafe-jev";
import type {ConceptForJudgeV1} from "@noisia/query-engine";
const sha=(s:string)=>`sha256:${createHash("sha256").update(s).digest("hex")}`;
/** Real migrated tables and normal store operations; only provider/storage are simulated. */
export async function verifyHybridJevPageContinuationV1(a:{client:PoolClient;database:Pool;workspace:string;
 actor:string;source:string;batch:string;prep:string;context:string;facetDigest:string;facets:unknown;
 entity:unknown;facetCall:string;route:string;concept:ConceptForJudgeV1;admit(action:string,target:string):Promise<string>}){
 const {client,workspace}=a,started=Date.now();
 const phase=(name:string)=>console.log(JSON.stringify({gate:"h1_pg_page_probe",phase:name,elapsed_ms:Date.now()-started}));
 await client.query("SET LOCAL statement_timeout='20s'");
 phase("clone_roots_started");
 const cloneRoots=async(count:number,offset:number)=>{
  const rows=Array.from({length:count},(_,i)=>{const text=`Synthetic page bicycle brake discussion ${offset+i}`;
    return {id:randomUUID(),text,asset:sha(text)};});
  const json=JSON.stringify(rows);
  await client.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,
   external_id,source_system,text_hash,text_clean,text_length,published_at,platform,inclusion_status)
   SELECT x.id,$1,$2,x.id,x.id::text,x.id::text,'fixture',x.asset,x.text,length(x.text),now(),'web','included'
   FROM jsonb_to_recordset($3::jsonb)x(id uuid,text text,asset text)`,[workspace,a.source,json]);
  await client.query(`INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,import_batch_id,data_source_id)
   SELECT $1,x.id,$2,$3 FROM jsonb_to_recordset($4::jsonb)x(id uuid)`,[workspace,a.batch,a.source,json]);
  await client.query(`INSERT INTO signal_corpus_text_assets(workspace_id,text_sha256,chunk_policy_version,full_text)
   SELECT $1,x.asset,'corpus-text-chunks-v1',x.text FROM jsonb_to_recordset($2::jsonb)x(asset text,text text)`,[workspace,json]);
  await client.query(`UPDATE signal_corpus_preparation_runs SET input_revision=(SELECT input_revision
   FROM signal_corpus_preparation_input_state WHERE workspace_id=$1) WHERE id=$2`,[workspace,a.prep]);
  await client.query(`INSERT INTO signal_corpus_preparation_items(workspace_id,run_id,root_id,asset_sha256,
   disposition,root_metadata,provenance,fingerprint)
   SELECT $1,$2,x.id,x.asset,'eligible','{}','[]',$3 FROM jsonb_to_recordset($4::jsonb)x(id uuid,asset text)`,[workspace,a.prep,sha("page"),json]);
  await client.query(`INSERT INTO signal_mention_facet_labels(workspace_id,root_id,input_digest,labeler_digest,
   entity_context_digest,facet_schema_version,status,facets,relevance,effective_entities_digest,call_id)
   SELECT $1,f.root_id,f.input_digest,$2,$3,'mention-facets-v1','labeled',$4::jsonb,'relevant',
   signal_labeling_digest_v1($5::jsonb),$6 FROM signal_mention_facets_current_v1 f
   WHERE f.workspace_id=$1 AND f.root_id=ANY($7::uuid[])`,[workspace,a.facetDigest,a.context,
    JSON.stringify(a.facets),JSON.stringify([a.entity]),a.facetCall,rows.map(r=>r.id)]);
 };
 await cloneRoots(662,0);phase("clone_roots_completed");
 const identity=hybridJevMembershipIdentityV1(),version=randomUUID();
 await client.query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,schema_digest,
  labeler_digest,identity) VALUES($1,'membership','typesafe','jev-1.13.0',$2,$3,$4,$5::jsonb)`,
 [version,identity.prompt_digest,identity.schema_digest,labelerDigestV1(identity),JSON.stringify(identity)]);
 const createRun=async()=>{
  const id=randomUUID(),admission=await a.admit("concept_membership_jev",id);
  await client.query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,preparation_run_id,
   entity_context_digest,entity_context_version_no,status,estimated_micro_usd,idempotency_key,request_digest,
   actor_user_id,membership_snapshot,processing_admission_id)
   VALUES($1,$2,'membership',$3,$4,$5,1,'queued',1,$6,$7,$8,$9::jsonb,$10)`,[id,workspace,version,a.prep,
    a.context,`page-${id}`,sha(id),a.actor,JSON.stringify({hybrid_stage:"jev",route_digest:a.route,concepts:[a.concept],preview:false}),admission]);
  return id;
 };
 const raw=new Map<string,string>(),store=createHybridMembershipStageStoreV1("jev",{database:a.database,
  storeRaw:async r=>{const key=`private/page/${r.call_id}`;raw.set(key,r.raw_text);return key;},loadRaw:async r=>raw.get(r.storage_key)!});
 const reply=(request:JevRequestV1)=>({http_status:200,latency_ms:1,body:JSON.stringify({model:request.model,
  usage:{input_tokens:10,output_tokens:0},answers:{membership:{type:"noul",noul:0.1}}})});
 const id=await createRun(),run=(await store.claim(id))!;
 for(;;){const inputs=await store.inputs(run);if(!inputs.length)break;
  await store.reserve(run,inputs.flatMap(input=>input.evaluated_concepts.map(c=>hybridJevCallProposalV1(run,input,c,0.042))));}
 phase("reservations_completed");const calls=await store.calls(run);assert.equal(calls.length,662);
 const prior=calls.slice(0,340),priorRequests=new Set(prior.map(call=>JSON.stringify(call.request)));
 await store.markSubmitting(run,prior);
 await store.persistRawPage(run,prior.map(call=>({call,raw:JSON.stringify(reply(call.request as JevRequestV1))})));
 await store.settlePage(run,prior.map(call=>({call,usage:{input_tokens:10,output_tokens:0,cache_read_input_tokens:0,
  cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}},settled_micro_usd:1})));
 const seed=prior.map(call=>{const input=call.inputs[0]!,concept=input.evaluated_concepts[0]!;
  const parsed=JSON.parse(reply(call.request as JevRequestV1).body);
  const result:HybridStageResultV1={root_id:input.root_id,root_fingerprint:input.root_fingerprint,
   concept_key:concept.concept_key,definition_digest:concept.definition_digest,entity_context_digest:input.entity_context_digest,
   effective_entities_digest:input.effective_entities_digest,jev:mapHybridJevAnswerV1(input,parsed),jev_call_id:call.id,
   claude:null,claude_call_id:null,rationale:null};return {call,results:[result]};});
 phase("seed_apply_started");await store.apply(run,seed);await store.release(run);phase("seed_apply_completed");
 const census=async()=> (await client.query(`SELECT count(*)::int calls,
  count(*)FILTER(WHERE status='settled')::int settled,count(*)FILTER(WHERE status='reserved')::int reserved,
  count(*)FILTER(WHERE status='unknown')::int unknown,count(*)FILTER(WHERE results_applied)::int applied,
  count(*)FILTER(WHERE raw_storage_key IS NOT NULL)::int durable_raw,COALESCE(sum(settled_micro_usd),0)::int cost
  FROM signal_labeling_calls WHERE run_id=$1`,[id])).rows[0];
 assert.deepEqual(await census(),{calls:662,settled:340,reserved:322,unknown:0,applied:340,durable_raw:340,cost:340});
 const oldRows=(await client.query("SELECT * FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) ORDER BY id",[prior.map(c=>c.id)])).rows;
 let sent=0,interrupt=true;const seen=new Set<string>(),apply=store.apply,settle=store.settlePage,pages:number[]=[];
 store.reserve=async()=>{throw new Error("prior reservations must be reused");};
 store.settlePage=async(r,p)=>{pages.push(p.length);return settle(r,p);};
 store.apply=async(r,p)=>{if(interrupt){interrupt=false;throw new Error("synthetic application interruption");}return apply(r,p);};
 const provider={evaluate:async(request:JevRequestV1)=>{const key=JSON.stringify(request);
  assert.ok(!priorRequests.has(key));assert.ok(!seen.has(key));seen.add(key);sent++;return reply(request);}};
 const tick=()=>runHybridMembershipTickV1({run_id:id,stage:"jev",store,jevPrice:0.042,jev:provider});
 phase("resume_started");await assert.rejects(tick(),/synthetic application interruption/u);phase("resume_interrupted_durable");
 assert.deepEqual(await census(),{calls:662,settled:540,reserved:122,unknown:0,applied:340,durable_raw:540,cost:540});
 phase("replay_started");await tick();phase("replay_completed");assert.equal(sent,200,"durable 200-call page replays without transport");
 await tick();phase("continuation_completed");assert.equal(sent,322);assert.deepEqual(pages,[200,200,122]);
 assert.deepEqual(await census(),{calls:662,settled:662,reserved:0,unknown:0,applied:662,durable_raw:662,cost:662});
 await tick();assert.equal(sent,322,"completed run never resubmits");
 assert.deepEqual((await client.query("SELECT * FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) ORDER BY id",[prior.map(c=>c.id)])).rows,oldRows);
 assert.equal((await client.query(`SELECT count(*)::int n FROM signal_hybrid_membership_decisions
  WHERE workspace_id=$1 AND jev_call_id=ANY($2::uuid[])`,[workspace,calls.map(c=>c.id)])).rows[0].n,662);
 // Real lease loss: persist the sent response, cancel queued work, apply nothing under the lost token.
 phase("lease_loss_started");await cloneRoots(2,662);const lossId=await createRun();let attempts=0;
 const lossStore=createHybridMembershipStageStoreV1("jev",{database:a.database,
  storeRaw:async r=>{const key=`private/page/${r.call_id}`;raw.set(key,r.raw_text);return key;},loadRaw:async r=>raw.get(r.storage_key)!});
 const lossProvider={evaluate:async(request:JevRequestV1,cancellation?:{signal?:AbortSignal})=>{
  attempts++;if(attempts===1){await client.query("UPDATE signal_labeling_runs SET lease_token=$2 WHERE id=$1",[lossId,randomUUID()]);
   await new Promise(resolve=>setTimeout(resolve,30));return reply(request);}
  return await new Promise<ReturnType<typeof reply>>((_resolve,reject)=>cancellation!.signal!.addEventListener("abort",()=>reject(new JevProviderErrorV1("jev_send_canceled","definitely_not_sent")),{once:true}));
 }};
 const renew=lossStore.renew;
 lossStore.renew=async r=>{if(attempts)await renew(r);};
 await assert.rejects(runHybridMembershipTickV1({run_id:lossId,stage:"jev",store:lossStore,jevPrice:0.042,
  jev:lossProvider,lease_renewal_ms:5}),/labeling_lease_lost/u);
 phase("lease_loss_observed");const lost=(await client.query(`SELECT count(*)FILTER(WHERE raw_storage_key IS NOT NULL)::int raw,
  count(*)FILTER(WHERE status='settled')::int settled,count(*)FILTER(WHERE results_applied)::int applied,
  count(*)FILTER(WHERE status='failed')::int definitely_not_sent FROM signal_labeling_calls WHERE run_id=$1`,[lossId])).rows[0];
 assert.deepEqual(lost,{raw:1,settled:0,applied:0,definitely_not_sent:1});
 await client.query("UPDATE signal_labeling_runs SET lease_until=now()-interval '1 second' WHERE id=$1",[lossId]);
 await runHybridMembershipTickV1({run_id:lossId,stage:"jev",store:lossStore,jevPrice:0.042,
  jev:{evaluate:async()=>{throw new Error("lost-lease raw must replay without transport");}}});
 assert.equal((await client.query("SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND status='settled' AND results_applied",[lossId])).rows[0].n,1);
 phase("lease_replay_completed");const unknownId=await createRun();let unknownAttempts=0;
 const unknownProvider={evaluate:async()=>{unknownAttempts++;throw new JevProviderErrorV1("synthetic_unknown","outcome_unknown");}};
 await assert.rejects(runHybridMembershipTickV1({run_id:unknownId,stage:"jev",store:lossStore,jevPrice:0.042,jev:unknownProvider}),/synthetic_unknown/u);
 await runHybridMembershipTickV1({run_id:unknownId,stage:"jev",store:lossStore,jevPrice:0.042,jev:unknownProvider});
 phase("unknown_replay_completed");assert.equal(unknownAttempts,1);assert.equal((await client.query(`SELECT count(*)::int n FROM signal_labeling_calls
  WHERE run_id=$1 AND status='unknown' AND settled_micro_usd IS NULL AND NOT results_applied`,[unknownId])).rows[0].n,1);
}
