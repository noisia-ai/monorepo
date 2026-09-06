import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {readFileSync} from "node:fs";
import {signalTopicEvaluationDigestV2 as digest} from "@noisia/query-engine";
import {createSignalTopicRuleCohortV1,runSignalTopicRuleCohortTrialV1,
  loadSignalTopicRuleCohortV1,loadSignalTopicRuleCohortLatestTrialV1,loadSignalTopicRuleCohortSourcesV1,
  type SignalTopicRuleCohortSelectionV1,type SignalTopicRuleCohortSourceV1} from "./signal-topic-rule-cohorts";
import {createSignalTopicContractDraftV1,loadSignalTopicContractDraftV1,type SignalTopicContractDraftClient} from "./signal-topic-contract-drafts";
import {insertSignalTaxonomyDraftCoreV1} from "./signal-taxonomy-profile";
import type {SignalTopicEvaluationActorV2} from "./signal-topic-evaluation-v2";
type Fixture={workspace_id:string;actor:SignalTopicEvaluationActorV2;run_key:string;sources:SignalTopicRuleCohortSelectionV1[]};
type JsonRow=Record<string,any>;

/** Supplied-client integration only. No connector, environment, migration, BEGIN, COMMIT,
 * source mutation or provider call. All own fixtures are enclosed in a rollback savepoint. */
export async function proveSignalTopicRuleCohortAdversarialPostgresV1(client:SignalTopicContractDraftClient,fixture:Fixture){
  await client.query("SAVEPOINT topic_cohort_adversarial_proof");
  const checked:Record<string,string>={};let reads=0;const suffix=randomUUID();
  async function rejected(name:string,body:()=>Promise<unknown>,codes:string[]=["23514"]){
    await client.query("SAVEPOINT topic_cohort_negative");
    try{await assert.rejects(body,error=>{const code=(error as{code?:string}).code;
      assert.ok(code&&codes.includes(code),`${name}: unexpected code ${code}`);checked[name]=code;return true;});}
    finally{await client.query("ROLLBACK TO SAVEPOINT topic_cohort_negative");await client.query("RELEASE SAVEPOINT topic_cohort_negative");}
  }
  const queryable:SignalTopicContractDraftClient={async query<T>(sql:string,values?:unknown[]){
    assert.match(sql.trim(),/^(?:SELECT|WITH)\b/u);
    assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|SAVEPOINT|COMMIT|BEGIN|set_config|pg_advisory|tsquery|to_tsvector)\b/u);
    reads++;return client.query<T>(sql,values);
  }};
  try{
    const context={workspace_id:fixture.workspace_id,actor:fixture.actor,run_key:fixture.run_key};
    const before=(await client.query<{version:number}>(`SELECT COALESCE(MAX(version),0)::int version
      FROM signal_taxonomy_profiles WHERE workspace_id=$1::uuid AND kind='topic'`,[fixture.workspace_id])).rows[0]!.version;
    const allocatorFixture=async(label:string)=>insertSignalTaxonomyDraftCoreV1({client,workspace_id:fixture.workspace_id,kind:"topic",
      context_hash:digest({label,suffix}),terms:[{term_key:`proof-${label}`,label:"Allocator proof",definition:"D".repeat(1500),metadata:{proof:true}}],
      rules:{proof:true},rule_set_metadata:{proof:true},provider:"operator",model_version:"proof-only",prompt_hash:digest(label),
      model_metadata:{proof:true,provider_calls:0},profile_metadata:{proof:true},context_refs:[]});
    const unrelated=await allocatorFixture("before");assert.equal(unrelated.version,before+1);
    const prior=await loadSignalTopicRuleCohortV1({...context,queryable});
    const createArgs={...fixture,client,expected_cohort_revision:prior?.cohort_revision??0,
      expected_cohort_digest:prior?.cohort_digest??null,idempotency_key:`cohort-adversarial:${suffix}`};
    const cohort=await createSignalTopicRuleCohortV1(createArgs);
    assert.equal(cohort.profile_version,before+2);assert.equal(cohort.cohort_revision,(prior?.cohort_revision??0)+1);
    assert.equal((await createSignalTopicRuleCohortV1(createArgs)).cohort_id,cohort.cohort_id);
    const after=await allocatorFixture("after");assert.equal(after.version,before+3);
    checked.global_allocator_separate_from_family_revision="passed";
    const definitions=(await client.query<{definition:string}>(`SELECT term.description definition FROM taxonomy_terms term
      JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id WHERE profile.id=$1::uuid ORDER BY term.term_key`,[cohort.profile_id])).rows;
    assert.deepEqual(definitions.map(row=>row.definition),cohort.binding.rules.map(row=>row.rule_spec.definition));
    const args={...context,client,expected_cohort_revision:cohort.cohort_revision,expected_cohort_digest:cohort.cohort_digest,
      idempotency_key:`cohort-trial-adversarial:${suffix}`,max_memberships:100,example_limit:10};
    assert.equal(await loadSignalTopicRuleCohortLatestTrialV1({...context,queryable}),null);
    const trial=await runSignalTopicRuleCohortTrialV1(args),replay=await runSignalTopicRuleCohortTrialV1(args);
    assert.equal(replay.trial_id,trial.trial_id);assert.deepEqual(replay.counts,trial.counts);
    assert.equal((await loadSignalTopicRuleCohortLatestTrialV1({...context,queryable}))!.trial_id,trial.trial_id);
    checked.create_trial_replay_read="passed";
    await rejected("foreign_actor",()=>createSignalTopicRuleCohortV1({...createArgs,actor:{...fixture.actor,id:randomUUID()}}),["topic_rule_draft_forbidden"]);
    await rejected("foreign_workspace",()=>loadSignalTopicRuleCohortV1({...context,queryable,workspace_id:randomUUID()}),
      ["topic_rule_draft_forbidden","topic_rule_cohort_run_not_found"]);
    await rejected("foreign_run",()=>loadSignalTopicRuleCohortLatestTrialV1({...context,queryable,run_key:`foreign-${suffix}`}),["topic_rule_cohort_run_not_found"]);
    await rejected("same_key_request_conflict",()=>runSignalTopicRuleCohortTrialV1({...args,max_memberships:99}),["topic_rule_cohort_idempotency_conflict"]);
    await rejected("cohort_cas",()=>createSignalTopicRuleCohortV1({...createArgs,idempotency_key:`cohort-old-cas:${suffix}`}),["topic_rule_cohort_stale"]);
    await rejected("source_cas",()=>createSignalTopicRuleCohortV1({...createArgs,idempotency_key:`cohort-source-cas:${suffix}`,
      expected_cohort_revision:cohort.cohort_revision,expected_cohort_digest:cohort.cohort_digest,
      sources:fixture.sources.map((source,index)=>index===0?{...source,expected_candidate_state_token:digest("wrong-source")}:source)}),["topic_rule_cohort_source_stale"]);
    for(const [table,id] of [["signal_topic_rule_cohort_versions",cohort.cohort_id],["signal_topic_rule_cohort_trial_receipts",trial.trial_id]] as const){
      await rejected(`${table}_update`,()=>client.query(`UPDATE ${table} SET idempotency_key=idempotency_key WHERE id=$1::uuid`,[id]),["55000"]);
      await rejected(`${table}_delete`,()=>client.query(`DELETE FROM ${table} WHERE id=$1::uuid`,[id]),["55000"]);
    }
    const stored=(await client.query<{receipt:JsonRow}>(`SELECT to_jsonb(receipt) receipt FROM signal_topic_rule_cohort_trial_receipts receipt
      WHERE id=$1::uuid`,[trial.trial_id])).rows[0]!.receipt;
    async function forge(name:string,change:(row:JsonRow)=>void){const row=structuredClone(stored);
      row.id=randomUUID();row.idempotency_key=`cohort-forged-${name}:${suffix}`;change(row);
      row.request_digest=digest(row.request);row.result_digest=digest(row.result);
      await rejected(name,()=>client.query(`INSERT INTO signal_topic_rule_cohort_trial_receipts
        SELECT * FROM jsonb_populate_record(NULL::signal_topic_rule_cohort_trial_receipts,$1::jsonb)`,[JSON.stringify(row)]));}
    await forge("denominator",row=>row.result.counts.total++);
    await forge("request_binding",row=>row.request.expected_cohort_digest=digest("wrong"));
    await forge("result_extra_field",row=>row.result.precision=100);
    await forge("counts_extra_field",row=>row.result.counts.gold=1);
    await forge("pair_foreign",row=>row.result.pairs[0].left_candidate_key="foreign");
    await forge("pair_negative",row=>row.result.pairs[0].intersection=-1);
    await forge("pair_exceeds_shared",row=>row.result.pairs[0].intersection=row.result.counts.multiple_match+1);
    await forge("plan_missing",row=>row.result.rule_plans.pop());
    await forge("plan_duplicate",row=>row.result.rule_plans[1]=structuredClone(row.result.rule_plans[0]));
    await forge("plan_spec_digest",row=>row.result.rule_plans[0].spec_digest=digest("wrong-spec"));
    await forge("plan_hash_shape",row=>row.result.rule_plans[0].plan_hash="not-a-digest");
    const example={evidence_ref:digest("example"),outcome:"single_match",matched_candidate_keys:[cohort.binding.rules[0]!.candidate_key],
      excerpt:"Bounded test fixture",language:null,market:null,scope:null,month:"2026-05"};
    await forge("example_foreign",row=>row.result.examples=[{...example,matched_candidate_keys:["foreign"]}]);
    await forge("example_outcome",row=>row.result.examples=[{...example,outcome:"abstained"}]);
    await forge("example_duplicate",row=>row.result.examples=[{...example,matched_candidate_keys:[example.matched_candidate_keys[0],example.matched_candidate_keys[0]]}]);
    const storedCohort=(await client.query<{receipt:JsonRow}>(`SELECT to_jsonb(receipt) receipt FROM signal_topic_rule_cohort_versions receipt
      WHERE id=$1::uuid`,[cohort.cohort_id])).rows[0]!.receipt;
    const forged=structuredClone(storedCohort);forged.id=randomUUID();forged.idempotency_key=`cohort-forged-source:${suffix}`;
    forged.cohort_revision++;forged.predecessor_id=cohort.cohort_id;forged.binding.cohort_revision++;
    forged.binding.predecessor_digest=cohort.cohort_digest;forged.binding.rules[0].candidate_state_token=digest("forged-source");
    forged.request.expected_cohort_revision=cohort.cohort_revision;forged.request.expected_cohort_digest=cohort.cohort_digest;
    forged.request.sources[0].expected_candidate_state_token=digest("forged-source");
    forged.cohort_digest=digest(forged.binding);forged.request_digest=digest(forged.request);
    await rejected("sql_forged_current_source",()=>client.query(`INSERT INTO signal_topic_rule_cohort_versions
      SELECT * FROM jsonb_populate_record(NULL::signal_topic_rule_cohort_versions,$1::jsonb)`,[JSON.stringify(forged)]));
    const graph=(await client.query<{taxonomy_id:string;rule_set_id:string;model_version_id:string}>(`SELECT taxonomy_id::text,rule_set_id::text,model_version_id::text
      FROM signal_taxonomy_profiles WHERE id=$1::uuid`,[cohort.profile_id])).rows[0]!;
    for(const [table,id,column] of [["signal_taxonomy_profiles",cohort.profile_id,"id"],["tagging_rule_sets",graph.rule_set_id,"id"],
      ["tagging_model_versions",graph.model_version_id,"id"],["taxonomy_terms",graph.taxonomy_id,"taxonomy_id"]] as const){
      await rejected(`changed_${table}`,async()=>{const changed=await client.query(`UPDATE ${table}
          SET metadata=metadata||'{"cohort_proof_changed":true}'::jsonb WHERE ${column}=$1::uuid RETURNING 1 changed`,[id]);
        const expectedRows=table==="taxonomy_terms"?cohort.binding.rules.length:1;
        assert.equal(changed.rows.length,expectedRows,`graph_${table}_update_rows`);
        if(changed.rowCount!==null)assert.equal(changed.rowCount,expectedRows,`graph_${table}_update_row_count`);
        assert.equal((await loadSignalTopicRuleCohortV1({...context,queryable}))!.is_stale,true,`graph_${table}_catalog_stale`);
        assert.equal((await loadSignalTopicRuleCohortLatestTrialV1({...context,queryable}))!.is_stale,true,`graph_${table}_trial_stale`);
        await runSignalTopicRuleCohortTrialV1({...args,idempotency_key:`cohort-graph-${table}:${suffix}`});},["topic_rule_cohort_source_stale"]);
    }
    await client.query("SAVEPOINT cohort_draft_source_change");
    try{const first=cohort.binding.rules[0]!;await createSignalTopicContractDraftV1({client,...context,candidate_key:first.candidate_key,
      expected_candidate_revision:first.candidate_revision,expected_candidate_state_token:first.candidate_state_token,
      expected_draft_revision:first.draft_revision,expected_draft_digest:first.draft_digest,rule_spec:first.rule_spec,
      idempotency_key:`cohort-new-source-draft:${suffix}`});
      assert.deepEqual((await loadSignalTopicRuleCohortV1({...context,queryable}))!.stale_reasons,["source_changed"]);
      await rejected("new_source_draft_stale",()=>runSignalTopicRuleCohortTrialV1({...args,idempotency_key:`cohort-source-changed:${suffix}`}),["topic_rule_cohort_source_stale"]);
    }finally{await client.query("ROLLBACK TO SAVEPOINT cohort_draft_source_change");await client.query("RELEASE SAVEPOINT cohort_draft_source_change");}
    const successor=await createSignalTopicRuleCohortV1({...createArgs,expected_cohort_revision:cohort.cohort_revision,
      expected_cohort_digest:cohort.cohort_digest,idempotency_key:`cohort-successor:${suffix}`});
    assert.equal(successor.cohort_revision,cohort.cohort_revision+1);assert.equal(successor.profile_version,before+4);
    assert.equal(await loadSignalTopicRuleCohortLatestTrialV1({...context,queryable}),null);
    assert.equal((await runSignalTopicRuleCohortTrialV1(args)).is_latest_cohort,false);
    checked.latest_untested_null_and_historical_replay="passed";
    return{checked,checks:Object.keys(checked).length,read_queries:reads,reader_dml:0,reader_fts:0,
      global_allocator:{before,unrelated:unrelated.version,cohort:cohort.profile_version,after:after.version,successor:successor.profile_version},
      cohort_revision:cohort.cohort_revision,helper_rows_rolled_back:true};
  }finally{await client.query("ROLLBACK TO SAVEPOINT topic_cohort_adversarial_proof");await client.query("RELEASE SAVEPOINT topic_cohort_adversarial_proof");}
}

/** Reader-only companion. The root supplies the existing coherent local transaction and
 * any fixture changes; this helper never writes, starts a transaction or executes FTS. */
export async function proveSignalTopicRuleCohortSourcesPostgresV1(client:SignalTopicContractDraftClient,fixture:Omit<Fixture,"sources">){
  let readQueries=0;const queryable:SignalTopicContractDraftClient={async query<T>(sql:string,values?:unknown[]){
    assert.match(sql.trim(),/^(?:SELECT|WITH)\b/u);
    assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|SAVEPOINT|COMMIT|BEGIN|set_config|pg_advisory|tsquery|to_tsvector)\b/u);
    readQueries++;return client.query<T>(sql,values);
  }};
  const args={...fixture,queryable,limit:2},first=await loadSignalTopicRuleCohortSourcesV1(args);
  const items:SignalTopicRuleCohortSourceV1[]=[...first.items];let cursor=first.next_cursor,pages=1;
  while(cursor){assert.ok(pages<25,"bounded_fixture_page_count");const page=await loadSignalTopicRuleCohortSourcesV1({...args,cursor});
    assert.equal(page.total,first.total);assert.equal(page.run_key,fixture.run_key);assert.equal(page.snapshot_digest,first.snapshot_digest);
    items.push(...page.items);cursor=page.next_cursor;pages++;}
  assert.equal(items.length,first.total);assert.equal(new Set(items.map(row=>row.candidate_key)).size,items.length);
  const keys=items.slice(-14).map(row=>row.candidate_key),missing=`missing-${randomUUID()}`;
  const refreshed=await loadSignalTopicRuleCohortSourcesV1({...args,selected_candidate_keys:[...keys,missing]});
  assert.deepEqual(refreshed.selected.map(row=>row.candidate_key),keys);
  assert.deepEqual(refreshed.missing_selected_candidate_keys,[missing]);
  for(const source of refreshed.selected){
    const draft=await loadSignalTopicContractDraftV1({...fixture,queryable,candidate_key:source.candidate_key});
    assert.deepEqual(source.draft,draft?{draft_id:draft.draft_id,revision:draft.revision,draft_digest:draft.draft_digest,
      spec_digest:draft.spec_digest,is_stale:draft.is_stale}:null);
    assert.equal(source.eligibility,source.review_state==="rejected"?"rejected":!draft?"missing_draft":draft.is_stale?"stale_draft":"eligible");
  }
  await assert.rejects(loadSignalTopicRuleCohortSourcesV1({...args,actor:{...fixture.actor,id:randomUUID()}}),{code:"topic_rule_draft_forbidden"});
  await assert.rejects(loadSignalTopicRuleCohortSourcesV1({...args,run_key:`missing-${randomUUID()}`}),{code:"topic_rule_cohort_run_not_found"});
  await assert.rejects(loadSignalTopicRuleCohortSourcesV1({...args,workspace_id:randomUUID()}),(error:unknown)=>
    ["topic_rule_draft_forbidden","topic_rule_cohort_run_not_found"].includes((error as{code:string}).code));
  if(first.next_cursor){const payload=JSON.parse(Buffer.from(first.next_cursor,"base64url").toString("utf8"));
    for(const change of [{workspace_id:randomUUID()},{run_key:`other-${randomUUID()}`},{snapshot_digest:digest("other")}]){
      const badCursor=Buffer.from(JSON.stringify({...payload,...change})).toString("base64url");
      await assert.rejects(loadSignalTopicRuleCohortSourcesV1({...args,cursor:badCursor}),{code:"topic_rule_cohort_sources_cursor_invalid"});
    }
  }
  return{total:first.total,pages,selected:refreshed.selected.length,missing_selected:1,
    eligibility:items.reduce<Record<string,number>>((counts,row)=>{counts[row.eligibility]=(counts[row.eligibility]??0)+1;return counts;},{}),
    summary_digest:digest(items),read_queries:readQueries,reader_dml:0,reader_fts:0,current_draft_reader_parity:true};
}

test("PostgreSQL helper is supplied-client only and never manages a connection or outer commit",()=>{
  const source=readFileSync(new URL(import.meta.url),"utf8").split('test("PostgreSQL helper')[0]!;
  assert.doesNotMatch(source,/new Pool|DATABASE_URL|process\.env|\.connect\(|query\("(?:BEGIN|COMMIT)"/u);
  assert.match(source,/ROLLBACK TO SAVEPOINT topic_cohort_adversarial_proof/u);
});
