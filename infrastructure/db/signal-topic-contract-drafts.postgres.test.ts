import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import {compileSignalTopicRuleSpecV1,signalTopicEvaluationDigestV2 as digest} from "@noisia/query-engine";
import {createSignalTopicContractDraftV1,runSignalTopicContractDraftTrialV1,loadSignalTopicContractDraftV1,
  SIGNAL_TOPIC_DRAFT_NORMALIZED_TEXT_SQL,type SignalTopicContractDraftClient} from "./signal-topic-contract-drafts";
import type {SignalTopicEvaluationActorV2} from "./signal-topic-evaluation-v2";
type DraftFixture={workspace_id:string;actor:SignalTopicEvaluationActorV2;run_key:string;candidate_key:string;
  expected_candidate_revision:number;expected_candidate_state_token:string};

/** Root/operator supplies an already-open local transaction and existing fixture. No connector,
 * environment loading, migration application, database creation or commit occurs in this helper. */
export async function proveSignalTopicContractDraftPostgresV1(client:SignalTopicContractDraftClient,fixture:DraftFixture){
  await proveSignalTopicDraftNormalizationPostgresV1(client);
  const suffix=randomUUID(),spec={contract_version:"signal-topic-rule-spec-v1",kind:"topic",label:"Football trial",
    definition:"Operator-authored lexical trial only.",lexical:{any:["football"],all:[],not:[]},
    filters:{languages:[],markets:[],scopes:[]}};
  const createArgs={client,...fixture,expected_draft_revision:0,expected_draft_digest:null,
    idempotency_key:`draft-proof:${suffix}`,rule_spec:spec};
  const draft=await createSignalTopicContractDraftV1(createArgs);
  const replay=await createSignalTopicContractDraftV1(createArgs);assert.equal(replay.draft_id,draft.draft_id);
  assert.equal(replay.idempotent_replay,true);
  const runArgs={client,...fixture,draft_id:draft.draft_id,expected_draft_revision:draft.revision,
    expected_draft_digest:draft.draft_digest,idempotency_key:`trial-proof:${suffix}`};
  const full=await runSignalTopicContractDraftTrialV1(runArgs);
  const bounded=await runSignalTopicContractDraftTrialV1({...runArgs,idempotency_key:`trial-cap:${suffix}`,max_memberships:100});
  assert.equal(bounded.counts.considered,Math.min(100,full.counts.total));
  assert.equal(bounded.counts.not_tested,full.counts.total-bounded.counts.considered);
  assert.equal(full.counts.considered,full.counts.unavailable+full.counts.filter_excluded+full.counts.matched+full.counts.abstained);
  const trialReplay=await runSignalTopicContractDraftTrialV1(runArgs);assert.equal(trialReplay.trial_id,full.trial_id);
  assert.equal(trialReplay.idempotent_replay,true);
  const loaded=await loadSignalTopicContractDraftV1({...fixture,queryable:client});assert.equal(loaded!.draft_id,draft.draft_id);
  return{draft_id:draft.draft_id,full:full.counts,bounded:bounded.counts,normalization_parity:true,replay:true};
}

/** Actual PostgreSQL negative cases, contained in the supplied caller's outer transaction.
 * Appends only the two draft ledgers; never calls a pool-owned editor or changes source rights.
 * Each rejected statement gets its own savepoint, and all helper rows are rolled back on exit. */
export async function proveSignalTopicContractDraftAdversarialPostgresV1(client:SignalTopicContractDraftClient,fixture:DraftFixture){
  await client.query("SAVEPOINT topic_rule_draft_adversarial");
  const checked:Record<string,string>={};
  async function rejected(name:string,action:()=>Promise<unknown>,codes:string[]){
    await client.query("SAVEPOINT topic_rule_draft_negative");
    try{await assert.rejects(action,(error:unknown)=>{
      const code=(error as{code?:string}).code;assert.ok(code&&codes.includes(code),`${name}: unexpected code ${code}`);
      checked[name]=code;return true;
    });}finally{await client.query("ROLLBACK TO SAVEPOINT topic_rule_draft_negative");
      await client.query("RELEASE SAVEPOINT topic_rule_draft_negative");}
  }
  try{
    const suffix=randomUUID(),prior=await loadSignalTopicContractDraftV1({...fixture,queryable:client});
    const createArgs={client,...fixture,expected_draft_revision:prior?.revision??0,expected_draft_digest:prior?.draft_digest??null,
      idempotency_key:`draft-adversarial:${suffix}`,rule_spec:{contract_version:"signal-topic-rule-spec-v1",kind:"topic",
        label:"Adversarial proof",definition:"Explicit lexical test only; not an adopted Topic.",
        lexical:{any:["football"],all:[],not:[]},filters:{languages:[],markets:[],scopes:[]}}};
    const draft=await createSignalTopicContractDraftV1(createArgs);
    assert.equal(draft.revision,(prior?.revision??0)+1);
    assert.equal((await createSignalTopicContractDraftV1(createArgs)).draft_id,draft.draft_id);
    const runArgs={client,...fixture,draft_id:draft.draft_id,expected_draft_revision:draft.revision,
      expected_draft_digest:draft.draft_digest,idempotency_key:`trial-adversarial:${suffix}`,max_memberships:100,example_limit:1};
    const trial=await runSignalTopicContractDraftTrialV1(runArgs),replayed=await runSignalTopicContractDraftTrialV1(runArgs);
    assert.equal(replayed.trial_id,trial.trial_id);assert.deepEqual(replayed.counts,trial.counts);
    assert.deepEqual(replayed.example_availability,{stored:trial.examples.length,available:trial.examples.length,unavailable:0});
    checked.append_create_replay="passed";
    await rejected("foreign_actor",()=>createSignalTopicContractDraftV1({...createArgs,
      actor:{...fixture.actor,id:randomUUID()}}),["topic_rule_draft_forbidden"]);
    await rejected("foreign_workspace",()=>createSignalTopicContractDraftV1({...createArgs,workspace_id:randomUUID()}),
      ["topic_rule_draft_forbidden","topic_rule_candidate_not_found"]);
    await rejected("draft_request_conflict",()=>createSignalTopicContractDraftV1({...createArgs,
      rule_spec:{...createArgs.rule_spec,label:"Divergent same-key rule"}}),["topic_rule_draft_idempotency_conflict"]);
    await rejected("trial_request_conflict",()=>runSignalTopicContractDraftTrialV1({...runArgs,max_memberships:99}),
      ["topic_rule_draft_idempotency_conflict"]);
    await rejected("draft_source_cas",()=>createSignalTopicContractDraftV1({...createArgs,
      idempotency_key:`draft-wrong-source:${suffix}`,expected_candidate_state_token:digest("wrong-source-state")}),
      ["topic_rule_candidate_stale"]);
    await rejected("trial_source_cas",()=>runSignalTopicContractDraftTrialV1({...runArgs,
      idempotency_key:`trial-wrong-source:${suffix}`,expected_candidate_state_token:digest("wrong-source-state")}),
      ["topic_rule_candidate_stale"]);
    await rejected("draft_predecessor_cas",()=>createSignalTopicContractDraftV1({...createArgs,
      idempotency_key:`draft-old-predecessor:${suffix}`}),["topic_rule_draft_stale"]);
    for(const [table,id] of [["signal_topic_contract_draft_versions",draft.draft_id],
      ["signal_topic_contract_draft_trial_receipts",trial.trial_id]] as const){
      await rejected(`${table}_update`,()=>client.query(`UPDATE ${table} SET idempotency_key=idempotency_key WHERE id=$1::uuid`,[id]),["55000"]);
      await rejected(`${table}_delete`,()=>client.query(`DELETE FROM ${table} WHERE id=$1::uuid`,[id]),["55000"]);
    }
    const stored=(await client.query<{receipt:Record<string,unknown>}>(`SELECT to_jsonb(receipt) receipt
      FROM signal_topic_contract_draft_trial_receipts receipt WHERE id=$1::uuid`,[trial.trial_id])).rows[0]!.receipt;
    async function forge(name:string,change:(row:Record<string,any>)=>void){
      const row=structuredClone(stored) as Record<string,any>;row.id=randomUUID();row.idempotency_key=`forged-${name}:${suffix}`;
      change(row);row.request_digest=digest(row.request);row.result_digest=digest(row.result);
      await rejected(name,()=>client.query(`INSERT INTO signal_topic_contract_draft_trial_receipts
        SELECT * FROM jsonb_populate_record(NULL::signal_topic_contract_draft_trial_receipts,$1::jsonb)`,[JSON.stringify(row)]),["23514"]);
    }
    await forge("forged_request_binding",(row)=>{row.request.expected_candidate_state_token=digest("forged");});
    await forge("forged_result_denominator",(row)=>{row.result.counts.total++;});
    await forge("forged_result_serving",(row)=>{row.result.serving=true;});
    await forge("forged_result_example",(row)=>{row.result.examples=[{evidence_ref:"invalid",outcome:"matched",excerpt:"invalid"}];});
    const next=await createSignalTopicContractDraftV1({...createArgs,idempotency_key:`draft-append:${suffix}`,
      expected_draft_revision:draft.revision,expected_draft_digest:draft.draft_digest});
    assert.equal(next.revision,draft.revision+1);
    await rejected("trial_stale_draft",()=>runSignalTopicContractDraftTrialV1({...runArgs,
      idempotency_key:`trial-old-draft:${suffix}`}),["topic_rule_draft_stale"]);
    const timeoutBefore=(await client.query<{value:string}>("SELECT current_setting('statement_timeout') value")).rows[0]!.value;
    await rejected("postgres_timeout_savepoint",async()=>{
      await client.query("SELECT set_config('statement_timeout','1ms',true)");await client.query("SELECT pg_sleep(0.025)");
    },["57014"]);
    assert.equal((await client.query<{value:string}>("SELECT current_setting('statement_timeout') value")).rows[0]!.value,timeoutBefore);
    assert.equal((await client.query<{alive:number}>("SELECT 1::int alive")).rows[0]!.alive,1);
    return{checks:checked,actual_concurrency_tested:false,source_mutated:false,helper_rows_rolled_back:true};
  }finally{await client.query("ROLLBACK TO SAVEPOINT topic_rule_draft_adversarial");
    await client.query("RELEASE SAVEPOINT topic_rule_draft_adversarial");}
}

export async function proveSignalTopicDraftNormalizationPostgresV1(client:SignalTopicContractDraftClient){
  const whitespace="\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  for(const value of ["Ａ café",`${whitespace}Ａ${whitespace}café${whitespace}`,"x\u200by", "x\u0085y"]){
    const expected=`sha256:${createHash("sha256").update(value.normalize("NFKC").replace(/\s+/gu," ").trim()).digest("hex")}`;
    const actual=(await client.query<{digest:string}>(`SELECT 'sha256:'||encode(digest(convert_to(
      ${SIGNAL_TOPIC_DRAFT_NORMALIZED_TEXT_SQL},'UTF8'),'sha256'),'hex') digest FROM (VALUES($1::text)) mention(text_clean)`,[value])).rows[0]!.digest;
    assert.equal(actual,expected,"PostgreSQL normalization must exactly match the frozen JS binding");
  }
  const spec={contract_version:"signal-topic-rule-spec-v1",kind:"topic",label:"Fixture",definition:"Authored semantics fixture",
    lexical:{any:["echo football","alexa campaign"],all:["experience"],not:["customer service"]},
    filters:{languages:["en"],markets:["MX"],scopes:["primary_brand"]}};
  const compiled=compileSignalTopicRuleSpecV1(spec,{placeholderOffset:4});
  for(const [text,market,filter,lexical] of [["Echo football experience","MX",true,true],
    ["Echo football excellent experience","MX",true,true],["Echo exciting football experience","MX",true,false],
    ["Alexa campaign experience customer service","MX",true,false],["Alexa campaign experience","US",false,true],
    ["Alexa campaign experience",null,false,true],[null,"MX",true,false]] as const){
    const actual=(await client.query<{filter:boolean;lexical:boolean}>(`SELECT COALESCE((${compiled.filter_predicate}),false) filter,
      COALESCE((${compiled.lexical_predicate}),false) lexical FROM (SELECT $1::text text_clean,$2::text language,
        $3::text market,$4::text scope) eligible`,[text,"en",market,"primary_brand",...compiled.values])).rows[0]!;
    assert.deepEqual(actual,{filter,lexical});
  }
}
test("Topic draft PostgreSQL proof requires an explicit supplied local client/outer transaction",{skip:true},()=>{});
