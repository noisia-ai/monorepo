/** Opt-in on the existing private MFP corpus. No DDL, providers or durable data changes. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {main,openDatabase} from "./guard.mjs";
import {loadMentionFacetBrowserV1,overrideMentionFacetsBatchV1,loadFacetEntityContextV1,
  type LabelingDatabaseV1} from "../../infrastructure/db/signal-mention-facets";

await main(async()=>{
  if(!process.argv.includes("--rollback-check"))throw Error("mfp_rollback_check_required");
  const identity=JSON.parse(await readFile(".data/dev-corpus/identity.json","utf8"));
  const pool=await openDatabase(),client=await pool.connect();
  const {retireSignalCompetitorsV1}=await import("../../apps/studio/src/lib/data-os/signal-competitor-lifecycle");
  let phase="preflight",transaction=false,serial=0;
  const explainOnly=process.argv.includes("--explain-only");
  const plans:Record<string,unknown>={};
  const reportPhase=(next:string)=>{phase=next;console.log(JSON.stringify({phase}));};
  const sanitizePlan=(value:unknown):unknown=>{
    if(typeof value==="string")return value.replace(/'(?:[^']|'')*'/g,"'[redacted]'")
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,"[uuid]");
    if(Array.isArray(value))return value.map(sanitizePlan);
    if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitizePlan(item)]));
    return value;
  };
  const stack:string[]=[];
  const query=async(text:string,values?:unknown[])=>{
    if(/^BEGIN\b/i.test(text)){const name=`facet_ui_${++serial}`;stack.push(name);return client.query(`SAVEPOINT ${name}`);}
    if(text==="COMMIT")return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
    if(text==="ROLLBACK"){const name=stack.pop()!;await client.query(`ROLLBACK TO SAVEPOINT ${name}`);return client.query(`RELEASE SAVEPOINT ${name}`);}
    if(/^WITH display_roots/.test(text)) {
      const kind=text.includes("SELECT dimension,value")?"distributions":"page";
      if(!plans[kind]) {
        reportPhase(`explain_${kind}`);
        const result=await client.query(`EXPLAIN (FORMAT JSON) ${text}`,values);
        plans[kind]=sanitizePlan(result.rows[0]?.["QUERY PLAN"]);
        await writeFile(".data/dev-corpus/facets-ui-plans.json",JSON.stringify({format:"postgres-explain-json",analyze:false,plans},null,2),{mode:0o600});
        console.log(JSON.stringify({phase:`plan_${kind}_saved`,private_artifact:".data/dev-corpus/facets-ui-plans.json"}));
        if(explainOnly)throw Error("mfp_explain_only_complete");
      }
      reportPhase(`execute_${kind}`);
    }
    return client.query(text,values);
  };
  const database={query,connect:async()=>({query,release(){}})} as unknown as LabelingDatabaseV1;
  const access={database,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id};
  const census=async()=> (await client.query(`SELECT
    (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id=$1) calls,
    (SELECT COALESCE(sum(settled_micro_usd),0)::text FROM signal_labeling_calls WHERE workspace_id=$1) settled,
    (SELECT count(*)::int FROM signal_mention_facet_overrides WHERE workspace_id=$1) overrides,
    (SELECT count(*)::int FROM signal_entity_context_versions WHERE workspace_id=$1) versions,
    (SELECT count(*)::int FROM signal_governance_control_operations WHERE workspace_id=$1) operations,
    (SELECT count(*)::int FROM signal_competitor_lifecycle_events WHERE workspace_id=$1) lifecycle_events,
    (SELECT count(*)::int FROM mentions WHERE workspace_id=$1) mentions,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.id)::text,'')) FROM signal_licensing_policy_usages u WHERE workspace_id=$1) rights,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'')) FROM signal_licensing_policies p WHERE workspace_id=$1) licenses,
    (SELECT md5(COALESCE(brand_seed_handles::text,'')) FROM brands WHERE id=$2) aliases,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM competitors c WHERE brand_id=$2) competitors`,
    [identity.workspace_id,identity.brand_id])).rows[0];
  try {
    const baseline=await census();
    assert.equal((await client.query(`SELECT count(*)::int n FROM signal_labeling_runs WHERE workspace_id=$1 AND status IN('queued','running')`,[identity.workspace_id])).rows[0].n,0);
    await client.query("BEGIN");transaction=true;
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[identity.workspace_id]);
    reportPhase("browser");
    const page=await loadMentionFacetBrowserV1({...access,limit:3});
    assert.equal(page.items.length,3);assert.ok(page.can_edit);assert.ok(page.distributions.length>0);
    assert.ok(page.items.every(item=>typeof item.text==="string"&&item.text.length>0));
    if(page.next_cursor){const next=await loadMentionFacetBrowserV1({...access,limit:3,cursor:page.next_cursor});
      assert.ok(next.items.every(item=>!page.items.some(previous=>previous.root_id===item.root_id)));}
    for(const dimension of ["relevance","entities","salience","voice","act","spam_or_bot","language","asunto","status"]){
      const bucket=page.distributions.find(item=>item.dimension===dimension);if(!bucket)continue;
      const filtered=await loadMentionFacetBrowserV1({...access,dimension,value:bucket.value,limit:3});assert.ok(filtered.items.length>0);
    }
    const roots=page.items.map(item=>item.root_id);
    reportPhase("batch_corrections");
    const corrected=await overrideMentionFacetsBatchV1({...access,overrides:roots.map(root_id=>({root_id,dimension:"voice",value:{value:"institution",confidence:"high",abstained:false}}))});
    assert.equal(corrected.updated,3);
    for(const root_id of roots){const updated=await loadMentionFacetBrowserV1({...access,root_id});
      assert.equal(updated.items.length,1);assert.equal(updated.items[0]!.facets?.voice.value,"institution");assert.ok(updated.items[0]!.human_dimensions.includes("voice"));}
    reportPhase("context_pending_human_preserved");
    await client.query("SAVEPOINT alias_change");
    await client.query("UPDATE brands SET brand_seed_handles=COALESCE(brand_seed_handles,ARRAY[]::text[])||ARRAY['x'] WHERE id=$1",[identity.brand_id]);
    const stale=await loadMentionFacetBrowserV1({...access,root_id:roots[0]});
    assert.equal(stale.items[0]!.status,"pending");assert.equal(stale.items[0]!.facets?.voice.value,"institution");
    if(!page.items[0]!.human_dimensions.includes("act"))assert.equal(stale.items[0]!.facets?.act.abstained,true);
    await client.query("ROLLBACK TO SAVEPOINT alias_change");await client.query("RELEASE SAVEPOINT alias_change");
    reportPhase("context_review");
    const ce=await loadFacetEntityContextV1(client,identity.workspace_id);
    const competitor=ce.entities.find(item=>item.kind==="competitor");assert.ok(competitor,"fixture_competitor_required");
    await overrideMentionFacetsBatchV1({...access,overrides:[{root_id:roots[0]!,dimension:"entities",value:{value:[{entity_id:competitor.entity_id,kind:"competitor",salience:"secondary"}],confidence:"high",abstained:false}}]});
    await client.query("SAVEPOINT retire_entity");
    reportPhase("context_review_retire");
    const retired=await retireSignalCompetitorsV1({brandId:identity.brand_id,
      actor:{id:identity.internal_user_id,userType:"noisia_internal",organizationId:null},
      idempotencyKey:"pg-facets-ui-retire",competitorIds:[competitor.entity_id],
      evidence:"MFP facet UI rollback lifecycle contract"},{database});
    assert.equal(retired.retired_count,1);
    reportPhase("context_review_read");
    const review=await loadMentionFacetBrowserV1({...access,root_id:roots[0]});
    assert.equal(review.items[0]!.requires_context_review,true);assert.equal(review.items[0]!.status,"error");assert.equal(review.items[0]!.facets,null);
    reportPhase("context_review_repair");
    await overrideMentionFacetsBatchV1({...access,overrides:[
      {root_id:roots[0]!,dimension:"entities",value:{value:[],confidence:"high",abstained:false}},
      {root_id:roots[0]!,dimension:"unrelated_reason",value:"off_topic"}]});
    const repaired=await loadMentionFacetBrowserV1({...access,root_id:roots[0]});assert.equal(repaired.items[0]!.requires_context_review,false);
    assert.equal(repaired.items[0]!.relevance,"unrelated");assert.equal(repaired.items[0]!.facets?.voice.value,"institution");
    await client.query("ROLLBACK TO SAVEPOINT retire_entity");await client.query("RELEASE SAVEPOINT retire_entity");
    reportPhase("revoked_text_rights");
    const {ensureSignalLicensingPolicyDraftV1,activateSignalDataGovernanceObjectV1}=await import("../../apps/studio/src/lib/data-os/signal-data-governance");
    const actor={id:identity.internal_user_id,userType:"noisia_internal",organizationId:null};
    const hash=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
    const licenses=(await client.query(`SELECT p.organization_id,p.policy_key,
      (SELECT max(v.policy_version)+1 FROM signal_licensing_policies v WHERE v.workspace_id=p.workspace_id AND v.policy_key=p.policy_key) next_version
      FROM signal_licensing_policies p WHERE p.workspace_id=$1 AND p.status='active'`,[identity.workspace_id])).rows;
    assert.ok(licenses.length>0,"fixture_active_license_required");
    for(const license of licenses){
      // Active usages are immutable. Activate a denied successor through the real
      // writer, retiring the bound predecessor and retaining its audit history.
      const draft=await ensureSignalLicensingPolicyDraftV1({queryable:client,organizationId:license.organization_id,actor,
        definition:{workspace_id:identity.workspace_id,policy_key:license.policy_key,policy_version:license.next_version,
          approval_evidence_hash:hash("facet-ui-rights-rollback"),usages:[{usage_purpose:"client-text-or-excerpt",decision:"prohibited"}]},
        idempotencyKey:hash(`facet-ui-rights-draft:${license.policy_key}`)});
      await activateSignalDataGovernanceObjectV1({queryable:client,workspaceId:identity.workspace_id,actor,
        objectKind:"licensing-policy",objectId:draft.policy_id,idempotencyKey:hash(`facet-ui-rights-activate:${license.policy_key}`)});
    }
    const withheld=await loadMentionFacetBrowserV1({...access,limit:3});assert.equal(withheld.items.length,0);assert.equal(withheld.distributions.length,0);
    reportPhase("rollback");
    await client.query("ROLLBACK");transaction=false;
    assert.deepEqual(await census(),baseline);
    console.log(JSON.stringify({status:"passed",browser:true,dimensions:9,batch_corrections:3,human_survives_stale:true,
      context_review_and_repair:true,revoked_text_withheld:true,rollback_verified:true,new_provider_calls:0}));
  } catch(error) {
    if(error instanceof Error&&error.message==="mfp_explain_only_complete") {
      await client.query("ROLLBACK");transaction=false;
      console.log(JSON.stringify({status:"planned",analyze:false,rolled_back:true,new_provider_calls:0}));
      return;
    }
    console.error(JSON.stringify({status:"failed",phase,sql_code:error&&typeof error==="object"&&"code" in error?String(error.code):null}));
    throw error;
  } finally {
    if(transaction)await client.query("ROLLBACK");
    client.release();await pool.end();
  }
});
