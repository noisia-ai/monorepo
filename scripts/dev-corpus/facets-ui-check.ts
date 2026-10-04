/** Opt-in on the existing private MFP corpus. No DDL, providers or durable data changes. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {main,openDatabase} from "./guard.mjs";
import {loadMentionFacetBrowserV1,overrideMentionFacetsBatchV1,loadFacetEntityContextV1,
  type LabelingDatabaseV1} from "../../infrastructure/db/signal-mention-facets";

await main(async()=>{
  if(!process.argv.includes("--rollback-check"))throw Error("mfp_rollback_check_required");
  const identity=JSON.parse(await readFile(".data/dev-corpus/identity.json","utf8"));
  const pool=await openDatabase(),client=await pool.connect();
  let phase="preflight",transaction=false,serial=0;
  const stack:string[]=[];
  const query=async(text:string,values?:unknown[])=>{
    if(/^BEGIN\b/i.test(text)){const name=`facet_ui_${++serial}`;stack.push(name);return client.query(`SAVEPOINT ${name}`);}
    if(text==="COMMIT")return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
    if(text==="ROLLBACK"){const name=stack.pop()!;await client.query(`ROLLBACK TO SAVEPOINT ${name}`);return client.query(`RELEASE SAVEPOINT ${name}`);}
    return client.query(text,values);
  };
  const database={query,connect:async()=>({query,release(){}})} as unknown as LabelingDatabaseV1;
  const access={database,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id};
  const census=async()=> (await client.query(`SELECT
    (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id=$1) calls,
    (SELECT COALESCE(sum(settled_micro_usd),0)::text FROM signal_labeling_calls WHERE workspace_id=$1) settled,
    (SELECT count(*)::int FROM signal_mention_facet_overrides WHERE workspace_id=$1) overrides,
    (SELECT count(*)::int FROM signal_entity_context_versions WHERE workspace_id=$1) versions,
    (SELECT count(*)::int FROM mentions WHERE workspace_id=$1) mentions,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.id)::text,'')) FROM signal_licensing_policy_usages u WHERE workspace_id=$1) rights,
    (SELECT md5(COALESCE(brand_seed_handles::text,'')) FROM brands WHERE id=$2) aliases,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM competitors c WHERE brand_id=$2) competitors`,
    [identity.workspace_id,identity.brand_id])).rows[0];
  try {
    const baseline=await census();
    assert.equal((await client.query(`SELECT count(*)::int n FROM signal_labeling_runs WHERE workspace_id=$1 AND status IN('queued','running')`,[identity.workspace_id])).rows[0].n,0);
    await client.query("BEGIN");transaction=true;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[identity.workspace_id]);
    phase="browser";
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
    phase="batch_corrections";
    const corrected=await overrideMentionFacetsBatchV1({...access,overrides:roots.map(root_id=>({root_id,dimension:"voice",value:{value:"institution",confidence:"high",abstained:false}}))});
    assert.equal(corrected.updated,3);
    for(const root_id of roots){const updated=await loadMentionFacetBrowserV1({...access,root_id});
      assert.equal(updated.items.length,1);assert.equal(updated.items[0]!.facets?.voice.value,"institution");assert.ok(updated.items[0]!.human_dimensions.includes("voice"));}
    phase="context_pending_human_preserved";
    await client.query("SAVEPOINT alias_change");
    await client.query("UPDATE brands SET brand_seed_handles=COALESCE(brand_seed_handles,ARRAY[]::text[])||ARRAY['x'] WHERE id=$1",[identity.brand_id]);
    const stale=await loadMentionFacetBrowserV1({...access,root_id:roots[0]});
    assert.equal(stale.items[0]!.status,"pending");assert.equal(stale.items[0]!.facets?.voice.value,"institution");
    if(!page.items[0]!.human_dimensions.includes("act"))assert.equal(stale.items[0]!.facets?.act.abstained,true);
    await client.query("ROLLBACK TO SAVEPOINT alias_change");await client.query("RELEASE SAVEPOINT alias_change");
    phase="context_review";
    const ce=await loadFacetEntityContextV1(client,identity.workspace_id);
    const competitor=ce.entities.find(item=>item.kind==="competitor");assert.ok(competitor,"fixture_competitor_required");
    await overrideMentionFacetsBatchV1({...access,overrides:[{root_id:roots[0]!,dimension:"entities",value:{value:[{entity_id:competitor.entity_id,kind:"competitor",salience:"secondary"}],confidence:"high",abstained:false}}]});
    await client.query("SAVEPOINT retire_entity");
    await client.query("UPDATE competitors SET status='retired',effective_to=clock_timestamp() WHERE id=$1 AND brand_id=$2",[competitor.entity_id,identity.brand_id]);
    const review=await loadMentionFacetBrowserV1({...access,root_id:roots[0]});
    assert.equal(review.items[0]!.requires_context_review,true);assert.equal(review.items[0]!.status,"error");assert.equal(review.items[0]!.facets,null);
    await overrideMentionFacetsBatchV1({...access,overrides:[
      {root_id:roots[0]!,dimension:"entities",value:{value:[],confidence:"high",abstained:false}},
      {root_id:roots[0]!,dimension:"unrelated_reason",value:"off_topic"}]});
    const repaired=await loadMentionFacetBrowserV1({...access,root_id:roots[0]});assert.equal(repaired.items[0]!.requires_context_review,false);
    assert.equal(repaired.items[0]!.relevance,"unrelated");assert.equal(repaired.items[0]!.facets?.voice.value,"institution");
    await client.query("ROLLBACK TO SAVEPOINT retire_entity");await client.query("RELEASE SAVEPOINT retire_entity");
    phase="revoked_text_rights";
    await client.query("UPDATE signal_licensing_policy_usages SET decision='prohibited' WHERE workspace_id=$1 AND usage_purpose='client-text-or-excerpt'",[identity.workspace_id]);
    const withheld=await loadMentionFacetBrowserV1({...access,limit:3});assert.equal(withheld.items.length,0);assert.equal(withheld.distributions.length,0);
    phase="rollback";
    await client.query("ROLLBACK");transaction=false;
    assert.deepEqual(await census(),baseline);
    console.log(JSON.stringify({status:"passed",browser:true,dimensions:9,batch_corrections:3,human_survives_stale:true,
      context_review_and_repair:true,revoked_text_withheld:true,rollback_verified:true,new_provider_calls:0}));
  } catch(error) {
    console.error(JSON.stringify({status:"failed",phase,sql_code:error&&typeof error==="object"&&"code" in error?String(error.code):null}));
    throw error;
  } finally {
    if(transaction)await client.query("ROLLBACK");
    client.release();await pool.end();
  }
});
