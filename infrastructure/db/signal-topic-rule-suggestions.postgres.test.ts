import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {adaptSignalTopicRuleSuggestionToDraftV1,prepareSignalTopicRuleSuggestionContextV1,
  signalTopicEvaluationDigestV2 as digest} from "@noisia/query-engine";
import {receiveSimulatedSignalTopicRuleSuggestionV1 as receive,loadSignalTopicRuleSuggestionV1 as load,
  saveSignalTopicRuleSuggestionDraftV1 as save} from "./signal-topic-rule-suggestions";
import {loadSignalTopicContractDraftV1,runSignalTopicContractDraftTrialV1,signalTopicRuleDraftInternal as core,
  type SignalTopicContractDraftClient} from "./signal-topic-contract-drafts";
import {createSignalTopicRuleCohortV1,loadSignalTopicRuleCohortV1} from "./signal-topic-rule-cohorts";
import type {SignalTopicEvaluationActorV2} from "./signal-topic-evaluation-v2";

type Fixture={workspace_id:string;actor:SignalTopicEvaluationActorV2;run_key:string;candidate_key:string;second_candidate_key:string};
type JsonRow=Record<string,any>;
/** Supplied-client local proof only. The operator owns SERIALIZABLE + migrations + outer
 * ROLLBACK. This helper never connects, loads env, applies DDL or commits. Its own rows and
 * deliberate rights/content mutations are additionally rolled back to nested savepoints. */
export async function proveSignalTopicRuleSuggestionsPostgresV1(client:SignalTopicContractDraftClient,fixture:Fixture){
  assert.notEqual(fixture.candidate_key,fixture.second_candidate_key,"proof requires two distinct real candidates");
  await client.query("SAVEPOINT topic_suggestion_proof");
  const checked:Record<string,string>={},suffix=randomUUID();let readQueries=0,stage="initial";
  const scope={workspace_id:fixture.workspace_id,actor:fixture.actor,run_key:fixture.run_key,candidate_key:fixture.candidate_key};
  const queryable:SignalTopicContractDraftClient={async query<T>(sql:string,values?:unknown[]){
    assert.match(sql.trim(),/^(?:SELECT|WITH)\b/u);assert.doesNotMatch(sql,
      /\b(?:INSERT|UPDATE|DELETE|SAVEPOINT|COMMIT|BEGIN|set_config|pg_advisory|tsquery|to_tsvector)\b/u);
    readQueries++;return client.query<T>(sql,values);
  }};
  async function cas(candidate_key:string){const args={...scope,candidate_key};await core.authorize(client,args);
    const source=await core.sourceFor(client,args),draft=await loadSignalTopicContractDraftV1({queryable:client,...args});
    return{expected_candidate_revision:source.revision,expected_candidate_state_token:source.state_token,
      expected_draft_revision:draft?.revision??0,expected_draft_digest:draft?.draft_digest??null};}
  async function rejected(name:string,action:()=>Promise<unknown>,codes:string[]){
    stage=name;await client.query("SAVEPOINT topic_suggestion_negative");
    try{await assert.rejects(action,(error:unknown)=>{const code=(error as{code?:string}).code;
      assert.ok(code&&codes.includes(code),`${name}: unexpected error code ${code}`);checked[name]=code;return true;});}
    finally{await client.query("ROLLBACK TO SAVEPOINT topic_suggestion_negative");await client.query("RELEASE SAVEPOINT topic_suggestion_negative");}
  }
  try{
    const template={status:"suggested" as const,lexical:{any:["football"],all:[],not:[]},
      filters:{languages:[],markets:[],scopes:[]},explanation:"Explicitly simulated local fixture; not provider output.",citation_count:3};
    const initial=await cas(scope.candidate_key),receiveArgs={client,...scope,...initial,idempotency_key:`suggestion-proof:${suffix}`,fixture:template};
    stage="receive";const receipt=await receive(receiveArgs);
    assert.equal(receipt.origin,"local_fixture");assert.equal(receipt.provider_execution,false);
    assert.deepEqual([receipt.provider_calls,receipt.input_tokens,receipt.output_tokens,receipt.cost_micro_usd],[0,0,0,0]);
    assert.equal(receipt.evidence.available,3);assert.equal(receipt.is_stale,false);
    const replay=await receive(receiveArgs);assert.equal(replay.receipt_id,receipt.receipt_id);assert.equal(replay.idempotent_replay,true);
    const original=structuredClone(receipt.adaptation);
    const readArgs={queryable,...scope,receipt_id:receipt.receipt_id};
    assert.equal((await load(readArgs))!.receipt_digest,receipt.receipt_digest);
    assert.equal((await load({queryable,...scope}))!.receipt_id,receipt.receipt_id);
    assert.equal(await load({...readArgs,receipt_id:randomUUID()}),null);
    assert.ok(!JSON.stringify(await load(readArgs)).includes('"excerpt"'));
    checked.receive_reopen_replay="passed";
    await rejected("foreign_actor",()=>load({...readArgs,actor:{...fixture.actor,id:randomUUID()}}),["topic_rule_draft_forbidden"]);
    await rejected("foreign_workspace",()=>load({...readArgs,workspace_id:randomUUID()}),["topic_rule_draft_forbidden","topic_rule_candidate_not_found"]);
    await rejected("wrong_run",()=>load({...readArgs,run_key:`foreign-${suffix}`}),["topic_rule_candidate_not_found"]);
    assert.equal(await load({...readArgs,candidate_key:fixture.second_candidate_key}),null);
    await rejected("receipt_request_conflict",()=>receive({...receiveArgs,fixture:{...template,explanation:"Another fixture"}}),["topic_rule_suggestion_idempotency_conflict"]);
    await rejected("source_cas",()=>receive({...receiveArgs,idempotency_key:`wrong-source:${suffix}`,
      expected_candidate_state_token:digest("wrong-state")}),["topic_rule_suggestion_source_stale"]);
    await rejected("draft_cas",()=>receive({...receiveArgs,idempotency_key:`wrong-draft:${suffix}`,
      expected_draft_revision:999,expected_draft_digest:digest("wrong-draft")}),["topic_rule_suggestion_draft_stale"]);

    const stored=(await client.query<{row:JsonRow}>(`SELECT to_jsonb(receipt.*) row FROM signal_topic_rule_suggestion_receipts receipt
      WHERE receipt.id=$1::uuid`,[receipt.receipt_id])).rows[0]!.row;
    function seal(row:JsonRow){
      row.fixture_digest=digest(row.fixture);row.request.fixture=row.fixture;row.request_digest=digest(row.request);
      row.context.source.session_key=`topic-rule-fixture:${digest({requestDigest:row.request_digest,key:row.idempotency_key}).slice(7,39)}`;
      row.context.brand_os.source=structuredClone(row.context.source);row.context.traces.forEach((trace:JsonRow)=>{trace.source=structuredClone(row.context.source);});
      row.prepared_context=prepareSignalTopicRuleSuggestionContextV1(row.context);
      row.context_digest=digest(row.context);row.prepared_context_digest=digest(row.prepared_context);
      row.adaptation=adaptSignalTopicRuleSuggestionToDraftV1({suggestion:row.adaptation.suggestion,context:row.context});
      row.output_digest=digest(row.adaptation.suggestion);
      row.receipt_digest=digest({origin:"local_fixture",request_digest:row.request_digest,fixture_digest:row.fixture_digest,
        output_digest:row.output_digest,context_digest:row.context_digest,suggestion_digest:row.adaptation.suggestion_digest,
        prepared_context_digest:row.prepared_context_digest,rights_digest:row.rights_digest,authority_digest:row.authority_digest});
    }
    async function forge(name:string,change:(row:JsonRow)=>void,afterSeal=false){
      const row=structuredClone(stored);row.id=randomUUID();row.idempotency_key=`forged-${name}:${suffix}`;
      if(!afterSeal)change(row);seal(row);if(afterSeal){change(row);row.prepared_context_digest=digest(row.prepared_context);
        row.receipt_digest=digest({origin:"local_fixture",request_digest:row.request_digest,fixture_digest:row.fixture_digest,
          output_digest:row.output_digest,context_digest:row.context_digest,suggestion_digest:row.adaptation.suggestion_digest,
          prepared_context_digest:row.prepared_context_digest,rights_digest:row.rights_digest,authority_digest:row.authority_digest});}
      await rejected(name,()=>client.query(`INSERT INTO signal_topic_rule_suggestion_receipts
        SELECT * FROM jsonb_populate_record(NULL::signal_topic_rule_suggestion_receipts,$1::jsonb)`,[JSON.stringify(row)]),["23514"]);
    }
    await forge("forged_excerpt",row=>{row.context.traces[0].mentions.find((mention:JsonRow)=>mention.status==="available").excerpt="Invented unrelated evidence";});
    await forge("forged_prepared_identity",row=>{row.prepared_context.bootstrap.candidate.label="Invented pinned identity";},true);
    await forge("forged_prepared_metadata",row=>{row.prepared_context.history[0].mentions[0].market="ZZ";},true);
    if(stored.context.brand_os.elements.length){
      for(const field of ["display_text","scope","locale","evidence_count"]){await forge(`forged_brand_${field}`,row=>{
        const element=row.context.brand_os.elements[0];element[field]=field==="evidence_count"?element.evidence_count+1:
          field==="display_text"?"Invented brand text":field==="locale"?(element.locale==="es-MX"?"en-US":"es-MX"):
            element.scope==="workspace"?"brand":"workspace";});}
    }else checked.brand_metadata_forgery="not_tested_empty_server_selection";
    await forge("forged_provider_origin",row=>{row.origin="provider_completed";},true);
    await forge("forged_provider_cost",row=>{row.cost_micro_usd=1;},true);
    // Deliberately bypass the pure parser in these negative fixtures, then re-seal every
    // dependent digest. Rejection must come from the database literal/canonical guard.
    for(const [name,literals] of [["punctuation",["---"]],["controls",["word\u0001"]],
      ["whitespace",[" Voice  assistant "]],["duplicates",["Echo","Echo"]],["order",["Echo","Alexa"]],
      ["explanation_controls",["word\u0001"]]] as const){
      const row=structuredClone(stored);row.id=randomUUID();row.idempotency_key=`forged-lexical-${name}:${suffix}`;seal(row);
      if(name==="explanation_controls")row.fixture.explanation=literals[0];else row.fixture.lexical.any=[...literals];
      row.request.fixture=row.fixture;row.fixture_digest=digest(row.fixture);row.request_digest=digest(row.request);
      row.context.source.session_key=`topic-rule-fixture:${digest({requestDigest:row.request_digest,key:row.idempotency_key}).slice(7,39)}`;
      row.context.brand_os.source=structuredClone(row.context.source);row.context.traces.forEach((trace:JsonRow)=>{trace.source=structuredClone(row.context.source);});
      row.context_digest=digest(row.context);row.prepared_context=prepareSignalTopicRuleSuggestionContextV1(row.context);
      row.prepared_context_digest=digest(row.prepared_context);row.adaptation.provenance.source=structuredClone(row.context.source);
      row.adaptation.provenance.context_digest=row.context_digest;row.adaptation.suggestion.lexical=row.fixture.lexical;
      row.adaptation.suggestion.explanation=row.fixture.explanation;
      row.adaptation.rule_spec.lexical=row.fixture.lexical;row.adaptation.spec_digest=digest(row.adaptation.rule_spec);
      row.adaptation.suggestion_digest=digest({suggestion:row.adaptation.suggestion,provenance:row.adaptation.provenance});
      row.output_digest=digest(row.adaptation.suggestion);
      row.receipt_digest=digest({origin:"local_fixture",request_digest:row.request_digest,fixture_digest:row.fixture_digest,
        output_digest:row.output_digest,context_digest:row.context_digest,suggestion_digest:row.adaptation.suggestion_digest,
        prepared_context_digest:row.prepared_context_digest,rights_digest:row.rights_digest,authority_digest:row.authority_digest});
      await rejected(name==="explanation_controls"?"forged_explanation_controls":`forged_lexical_${name}`,()=>client.query(`INSERT INTO signal_topic_rule_suggestion_receipts
        SELECT * FROM jsonb_populate_record(NULL::signal_topic_rule_suggestion_receipts,$1::jsonb)`,[JSON.stringify(row)]),["23514"]);
    }
    for(const operation of ["UPDATE","DELETE"] as const){await rejected(`receipt_${operation.toLowerCase()}`,()=>client.query(
      operation==="UPDATE"?"UPDATE signal_topic_rule_suggestion_receipts SET request=request WHERE id=$1::uuid":
        "DELETE FROM signal_topic_rule_suggestion_receipts WHERE id=$1::uuid",[receipt.receipt_id]),["55000"]);}

    // Keep a genuine insufficient result; it must never become an empty ordinary matcher.
    stage="insufficient";const insufficient=await receive({...receiveArgs,idempotency_key:`insufficient:${suffix}`,
      fixture:{status:"insufficient_evidence",explanation:"Simulated insufficient evidence, no matcher."}});
    await rejected("insufficient_cannot_save",()=>save({client,...scope,...initial,receipt_id:insufficient.receipt_id,
      idempotency_key:`insufficient-save:${suffix}`,action:"save",lexical:template.lexical,filters:template.filters}),["topic_rule_suggestion_insufficient_evidence"]);

    stage="save";const saveArgs={client,...scope,...initial,receipt_id:receipt.receipt_id,idempotency_key:`save:${suffix}`,
      action:"save" as const,lexical:template.lexical,filters:template.filters};
    const first=await save(saveArgs);assert.equal(first.draft.revision,initial.expected_draft_revision+1);
    assert.equal((await save(saveArgs)).link_id,first.link_id);
    stage="edit";const editArgs={...saveArgs,...await cas(scope.candidate_key),idempotency_key:`edit:${suffix}`,
      lexical:{any:[" Echo ","Alexa","Echo"," Voice  assistant "],all:[],not:[]}};
    const edited=await save(editArgs);assert.deepEqual(edited.draft.rule_spec.lexical.any,["Alexa","Echo","Voice assistant"]);
    const canonicalReplay=await save({...editArgs,lexical:edited.draft.rule_spec.lexical});assert.equal(canonicalReplay.link_id,edited.link_id);
    stage="restore";const restore=await save({client,...scope,...await cas(scope.candidate_key),receipt_id:receipt.receipt_id,
      idempotency_key:`restore:${suffix}`,action:"restore",restore_draft_id:first.draft.draft_id});
    assert.equal(restore.draft.revision,edited.draft.revision+1);assert.deepEqual(restore.draft.rule_spec,first.draft.rule_spec);
    assert.equal(restore.draft.predecessor_draft_id,edited.draft.draft_id);
    assert.deepEqual((await load(readArgs))!.adaptation,original);assert.equal((await load(readArgs))!.draft_changed,true);
    assert.equal((await save(saveArgs)).draft.draft_id,first.draft.draft_id);
    checked.save_edit_canonical_replay_restore="passed";
    await rejected("bridge_stale_draft",()=>save({...saveArgs,idempotency_key:`old-save:${suffix}`}),["topic_rule_suggestion_draft_stale"]);
    for(const operation of ["UPDATE","DELETE"] as const){await rejected(`link_${operation.toLowerCase()}`,()=>client.query(
      operation==="UPDATE"?"UPDATE signal_topic_rule_suggestion_draft_links SET request=request WHERE id=$1::uuid":
        "DELETE FROM signal_topic_rule_suggestion_draft_links WHERE id=$1::uuid",[first.link_id]),["55000"]);}

    // An injected transport failure after the ordinary INSERT proves the bridge savepoint
    // rolls both operations back. It is not a provider or database authority callback.
    const failLink:SignalTopicContractDraftClient={async query<T>(sql:string,values?:unknown[]){
      if(sql.startsWith("INSERT INTO signal_topic_rule_suggestion_draft_links"))throw Object.assign(new Error("fixture link failure"),{code:"fixture_link_failure"});
      return client.query<T>(sql,values);
    }};
    const beforeFailure=await cas(scope.candidate_key);
    stage="bridge_atomic_link_failure";
    await assert.rejects(save({...saveArgs,...beforeFailure,client:failLink,idempotency_key:`atomic:${suffix}`}),{code:"fixture_link_failure"});
    // This check intentionally precedes any helper-owned rollback: only the bridge's
    // savepoint can have removed the ordinary draft whose link failed.
    assert.deepEqual(await cas(scope.candidate_key),beforeFailure);
    checked.bridge_atomic_link_failure="fixture_link_failure";

    const source=await core.sourceFor(client,scope),cited=receipt.adaptation.provenance.evidence[0]!;
    const member=(await client.query<{mention_id:string;data_source_id:string}>(`SELECT membership.mention_id::text,mention.data_source_id::text
      FROM signal_topic_evaluation_v2_cluster_memberships membership JOIN mentions mention ON mention.id=membership.mention_id
      WHERE membership.snapshot_id=$1::uuid AND membership.workspace_id=$2::uuid AND signal_semantic_context_digest_json_v2(
        jsonb_build_object('snapshot',$3::text,'member_ref',membership.member_ref,'source',membership.source_record_digest))=$4`,
    [source.snapshot_id,fixture.workspace_id,source.snapshot_digest,cited.evidence_ref])).rows[0]!;
    assert.ok(member);
    for(const mutation of ["rights","content"] as const){stage=`current_${mutation}`;await client.query("SAVEPOINT topic_suggestion_rights");
      try{
        const changed=await client.query(mutation==="rights"?"UPDATE data_sources SET status='paused' WHERE id=$1::uuid":
          "UPDATE mentions SET text_clean=text_clean||' changed fixture content' WHERE id=$1::uuid",[mutation==="rights"?member.data_source_id:member.mention_id]);
        assert.equal(changed.rowCount,1);
        const read=await load(readArgs);assert.ok(read!.evidence.unavailable>=1);assert.equal(read!.is_stale,true);
        const old=await receive(receiveArgs);assert.equal(old.receipt_id,receipt.receipt_id);assert.equal(old.idempotent_replay,true);
        assert.deepEqual(old.adaptation,original);assert.equal(old.receipt_digest,receipt.receipt_digest);
        await rejected(`${mutation}_blocks_new_link`,()=>save({...saveArgs,...beforeFailure,idempotency_key:`changed-${mutation}:${suffix}`}),
          ["topic_rule_suggestion_source_stale"]);
        checked[`current_${mutation}_historical_projection`]="passed";
      }finally{await client.query("ROLLBACK TO SAVEPOINT topic_suggestion_rights");await client.query("RELEASE SAVEPOINT topic_suggestion_rights");}
    }
    assert.equal((await load(readArgs))!.evidence.available,receipt.evidence.available);
    stage="trial";const trial=await runSignalTopicContractDraftTrialV1({client,workspace_id:fixture.workspace_id,actor:fixture.actor,
      ...await cas(scope.candidate_key),draft_id:restore.draft.draft_id,idempotency_key:`trial:${suffix}`,
      expected_draft_digest:restore.draft.draft_digest,
      max_memberships:100,example_limit:2,timeout_ms:15000});
    assert.equal(trial.counts.considered,Math.min(100,trial.counts.total));assert.equal(trial.counts.not_tested,trial.counts.total-trial.counts.considered);
    stage="second_candidate";const secondScope={...scope,candidate_key:fixture.second_candidate_key},secondCAS=await cas(secondScope.candidate_key);
    const secondReceipt=await receive({client,...secondScope,...secondCAS,idempotency_key:`second-receive:${suffix}`,
      fixture:{...template,lexical:{any:["ChatGPT"],all:[],not:[]}}});
    const second=await save({client,...secondScope,...secondCAS,receipt_id:secondReceipt.receipt_id,idempotency_key:`second-save:${suffix}`,
      action:"save",lexical:{any:["ChatGPT"],all:[],not:[]},filters:template.filters});
    stage="cohort";const priorCohort=await loadSignalTopicRuleCohortV1({queryable:client,...scope});
    const cohort=await createSignalTopicRuleCohortV1({client,...scope,expected_cohort_revision:priorCohort?.cohort_revision??0,
      expected_cohort_digest:priorCohort?.cohort_digest??null,idempotency_key:`cohort:${suffix}`,
      sources:[{candidate_key:scope.candidate_key,draft_id:restore.draft.draft_id,...await cas(scope.candidate_key)},
        {candidate_key:secondScope.candidate_key,draft_id:second.draft.draft_id,...await cas(secondScope.candidate_key)}].map(row=>
          ({...row,expected_draft_digest:row.expected_draft_digest!}))});
    assert.equal(cohort.binding.rules.length,2);assert.equal(cohort.is_stale,false);
    return{checks:checked,read_queries:readQueries,reader_dml:0,reader_fts:0,provider_calls:0,cost_micro_usd:0,
      origin:"local_fixture",citation_count:receipt.evidence.stored,brand_os_status:receipt.adaptation.provenance.brand_os_status,
      draft_revision_delta:restore.draft.revision-initial.expected_draft_revision,trial_counts:trial.counts,
      cohort_rule_count:cohort.binding.rules.length,actual_concurrency_tested:false,helper_rows_rolled_back:true};
  }catch(error){if(error&&typeof error==="object")Object.assign(error,{proof_stage:stage});throw error;}
  finally{await client.query("ROLLBACK TO SAVEPOINT topic_suggestion_proof");await client.query("RELEASE SAVEPOINT topic_suggestion_proof");}
}
test("suggestion PostgreSQL proof requires a supplied local client and outer rollback",{skip:true},()=>{});
