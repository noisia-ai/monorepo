import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import type {Pool} from "pg";
import {signalTopicDefinitionSchemaV1} from "@noisia/query-engine";
import {adoptSignalTopicCandidateStoreV1} from "../signal-topic-catalog";
import {adoptedConsolidationConceptKeysV1} from "../signal-workspace-topics-serving";

test("MFP Signal replaces a consolidated concept after real adoption by key and run",{
  skip:process.env.NOISIA_MFP_ADOPTED_SERVING_PG_TEST!=="true",timeout:120_000
},async()=>{
  const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
  const pool:Pool=await openDatabase(),raw=await pool.connect();
  const oldFacets=process.env.NOISIA_MENTION_FACETS_ENABLED;
  const oldMembership=process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;
  process.env.NOISIA_MENTION_FACETS_ENABLED="true";
  process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED="true";
  try{
    await raw.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const f=(await raw.query<{workspace_id:string;revision_id:string;revision_digest:string;concept_key:string;actor_id:string}>(`
      SELECT revision.workspace_id::text,revision.id::text revision_id,revision.revision_digest,
        concept.concept_key,actor.id::text actor_id
      FROM signal_topic_consolidation_revisions revision
      JOIN signal_topic_consolidation_runs run ON run.id=revision.consolidation_run_id AND run.status='validated'
      JOIN signal_topic_editorial_concepts concept ON concept.revision_id=revision.id AND concept.kind='topic'
      CROSS JOIN LATERAL (SELECT id FROM users WHERE status='active' AND user_type='noisia_internal'
        AND primary_role IN('noisia_admin','founder','admin') ORDER BY id LIMIT 1) actor
      WHERE revision.status='validated'
        AND NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_revisions newer
          WHERE newer.consolidation_run_id=revision.consolidation_run_id AND newer.status='validated'
            AND newer.revision>revision.revision)
      ORDER BY revision.validated_at DESC LIMIT 1`)).rows[0];
    assert.ok(f,"requires a validated MFP editorial revision and internal admin");
    await raw.query(`INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by)
      VALUES($1,'mfp_discovery',$2),($1,'concept_membership',$2)
      ON CONFLICT(workspace_id,feature) DO NOTHING`,[f.workspace_id,f.actor_id]);
    let sequence=0;const stack:string[]=[];
    const query=async(sql:string,params?:unknown[])=>{
      if(sql.startsWith("BEGIN")){const key=`mfp_adoption_${++sequence}`;stack.push(key);return raw.query(`SAVEPOINT ${key}`);}
      if(sql==="COMMIT")return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if(sql==="ROLLBACK"){const key=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${key}`);
        return raw.query(`RELEASE SAVEPOINT ${key}`);}
      return raw.query(sql,params);
    };
    const database={connect:async()=>({query,release(){}})} as unknown as Pool;
    const before=await adoptedConsolidationConceptKeysV1(raw,f.workspace_id,f.revision_id,[]);
    assert.equal(before.size,0);
    const adopted=await adoptSignalTopicCandidateStoreV1({pool:database,workspace_id:f.workspace_id,
      actor_user_id:f.actor_id,idempotency_key:`mfp-adoption-${randomUUID()}`,input:{
        run_key:`workspace-discovery:${f.revision_id}`,candidate_key:f.concept_key,
        expected_revision_digest:f.revision_digest,scope:"all_conversations"}});
    const source=adopted.topics.find(topic=>topic.term_key===adopted.term_key)?.source;
    assert.equal(source?.candidate_key,f.concept_key,"real adoption stores the text concept key");
    assert.equal(source?.run_key,`workspace-discovery:${f.revision_id}`);
    const definitions=(await raw.query<{topic:unknown}>(
      "SELECT topic FROM signal_membership_concepts_v1 WHERE workspace_id=$1",[f.workspace_id])).rows
      .map(row=>signalTopicDefinitionSchemaV1.parse(row.topic));
    assert.ok(definitions.some(definition=>definition.term_key===adopted.term_key));
    const keys=await adoptedConsolidationConceptKeysV1(raw,f.workspace_id,f.revision_id,definitions);
    assert.ok(keys.has(f.concept_key),"Signal's real PG revision join identifies the adopted concept by text key");
    const foreignRevision=randomUUID();
    const unrelated=await adoptedConsolidationConceptKeysV1(raw,f.workspace_id,foreignRevision,definitions);
    assert.equal(unrelated.size,0,"an unrelated consolidation revision cannot hide a concept");
    await raw.query("ROLLBACK");
  }finally{
    await raw.query("ROLLBACK").catch(()=>undefined);raw.release();await pool.end();
    if(oldFacets===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=oldFacets;
    if(oldMembership===undefined)delete process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;else process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED=oldMembership;
  }
});
