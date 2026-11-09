import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {signalWorkspaceEmbeddingDigestV1 as digest} from "@noisia/query-engine";
import {getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1,
  importMassLabelingInterestsV2,proposeMassLabelingStudyLexiconV1} from "../signal-mass-labeling-study-policy";
import {loadSignalWorkspaceTopicsOverviewV1,loadMassLabelingConsumerEvidenceV1} from "../signal-workspace-topics-serving";

/** Runs inside the caller's rollback-only synthetic full-population fixture. */
export async function assertMassLabelingStudyPolicyV1(args: {
  database: Pool; workspace_id: string; actor_user_id: string; map_id: string; foreign_actor: string;
  root_id: string; input_digest: string;
}) {
  const access={database:args.database,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id};
  const initial=await getMassLabelingStudyPolicyV1(access);
  assert.equal(initial.interest_threshold,.85);
  assert.equal(initial.revision,0);
  assert.equal(initial.can_edit,true);
  const policy={...access,expected_revision:0,category:"bicycles",lexicon_terms:initial.lexicon_terms,
    candidate_language:"original" as const,interest_threshold:.85,
    interests:[{key:"cycling_safety",name:"Cycling safety",definition:"Personal cycling safety and road precautions.",active:true}]};
  const saved=await updateMassLabelingStudyPolicyV1(policy);
  assert.equal(saved.revision,1);
  assert.equal(saved.lexicon_provenance,"brand_os","editing category or interests keeps editorial lexical proposal available");
  const editorial=await proposeMassLabelingStudyLexiconV1({...access,expected_revision:1,category:"bicycles",
    lexicon_terms:[...initial.lexicon_terms,"bicycle","bicycles"],source_digest:digest("editorial lexical evidence")});
  assert.equal(editorial.revision,2);
  assert.equal(editorial.lexicon_provenance,"editorial");
  const cacheClient=await args.database.connect();
  try {
    const cached=(await cacheClient.query(`SELECT cache.root_id,cache.matched,
      signal_mass_labeling_category_matches_v1(mention.text_clean,policy.lexicon_terms) expected
      FROM signal_mass_labeling_category_matches cache
      JOIN signal_mass_labeling_study_policies policy ON policy.workspace_id=cache.workspace_id AND policy.revision=cache.policy_revision
      JOIN mentions mention ON mention.workspace_id=cache.workspace_id AND mention.id=cache.root_id
      WHERE cache.workspace_id=$1 AND cache.policy_revision=$2 ORDER BY cache.root_id`,[args.workspace_id,editorial.revision])).rows;
    assert.equal(cached.length,3,"saving a lexicon materializes the complete frozen population");
    assert.ok(cached.every(row=>row.matched===row.expected));
    assert.equal((await cacheClient.query("SELECT has_table_privilege('anon','signal_mass_labeling_category_matches','SELECT') yes")).rows[0].yes,false);
  } finally {cacheClient.release();}
  const replay=await proposeMassLabelingStudyLexiconV1({...access,expected_revision:1,category:"bicycles",
    lexicon_terms:["altered"],source_digest:digest("other editorial evidence")});
  assert.equal(replay.revision,2);
  policy.lexicon_terms=editorial.lexicon_terms;
  await assert.rejects(updateMassLabelingStudyPolicyV1(policy),/study_policy_conflict/);
  await assert.rejects(updateMassLabelingStudyPolicyV1({...policy,actor_user_id:args.foreign_actor}),/study_policy_forbidden/);
  const receipt={root_id:args.root_id,input_digest:args.input_digest,probability:.84,
    request_digest:digest("r14 interests request"),response_digest:digest("r14 interests response"),
    usage:{input_tokens:120,output_tokens:0}};
  const interest={interest_key:"cycling_safety",name:policy.interests[0]!.name,
    definition:policy.interests[0]!.definition,results:[receipt]};
  const queryRoots=await args.database.connect();
  try {
    const roots=(await queryRoots.query<{root_id:string;input_digest:string}>("SELECT root_id,input_digest FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id",[args.workspace_id,args.map_id])).rows;
    interest.results=roots.map(r=>({...receipt,...r,probability:r.root_id===args.root_id?.84:.85}));
  } finally {queryRoots.release();}
  const imported=await importMassLabelingInterestsV2({...access,map_id:args.map_id,interests:[interest]});
  assert.equal(imported.interest_results,3);
  await importMassLabelingInterestsV2({...access,map_id:args.map_id,interests:[interest]});
  await assert.rejects(importMassLabelingInterestsV2({...access,map_id:args.map_id,interests:[{
    ...interest,results:[{...receipt,probability:.99}]}]}),/study_interest_receipt_conflict/);
  const strict=await loadSignalWorkspaceTopicsOverviewV1(access);
  assert.equal(strict!.terms.find(t=>t.term_key==="cycling_safety")!.mention_count,2);
  await updateMassLabelingStudyPolicyV1({...policy,expected_revision:2,interest_threshold:.8});
  const relaxed=await loadSignalWorkspaceTopicsOverviewV1(access);
  assert.equal(relaxed!.terms.find(t=>t.term_key==="cycling_safety")!.mention_count,3);
  assert.notEqual(strict!.scope_digest,relaxed!.scope_digest);
  const example=await loadMassLabelingConsumerEvidenceV1({...access,choice:"trigger",expected_scope_digest:relaxed!.scope_digest});
  assert.equal(example.items.length,1);
  assert.equal(example.items[0]!.mention_id,args.root_id);
  await updateMassLabelingStudyPolicyV1({...policy,expected_revision:3,lexicon_terms:["absent category token"]});
  const excluded=await loadSignalWorkspaceTopicsOverviewV1(access);
  assert.equal(excluded!.consumer_indicators!.eligible,relaxed!.consumer_indicators!.eligible);
  assert.equal(excluded!.consumer_indicators!.category_matched,0);
  assert.equal(excluded!.consumer_indicators!.category_excluded,excluded!.consumer_indicators!.eligible);
  assert.equal(excluded!.consumer_indicators!.trigger,0);
  const revisions=await args.database.connect();
  try {
    const materialized=(await revisions.query(`SELECT policy_revision,count(*)::int roots,bool_or(matched) any_match
      FROM signal_mass_labeling_category_matches WHERE workspace_id=$1 AND policy_revision>0 GROUP BY policy_revision ORDER BY policy_revision`,[args.workspace_id])).rows;
    assert.deepEqual(materialized.map(row=>row.roots),[3,3,3,3]);
    assert.equal(materialized.at(-1)!.any_match,false,"new lexical revision is ready atomically with settings");
    assert.equal(materialized[1]!.any_match,true,"older lexical revisions preserve their original matches");
  } finally {revisions.release();}
  assert.equal((await loadMassLabelingConsumerEvidenceV1({...access,choice:"trigger"})).items.length,0);
  await assert.rejects(loadMassLabelingConsumerEvidenceV1({...access,choice:"trigger",expected_scope_digest:relaxed!.scope_digest}),/workspace_topics_scope_changed/);

  const query=await args.database.connect();
  try {
    for(const [body,terms,yes] of [["I prefer bicycles",["bicycles"],true],
      ["BICYCLE!",["bicycle"],true],["bicycles",["bicycle"],false],
      ["#cerveja",["cerveja"],true],["futebol",["beer","cerveja"],false],
      ["a cerveja gelada",["cerveja gelada"],true],["中文",["中文"],true]] as const) {
      const result=(await query.query("SELECT signal_mass_labeling_category_matches_v1($1,$2::text[]) yes",[body,terms])).rows[0];
      assert.equal(result.yes,yes);
    }
    const scope=(await query.query<{organization_id:string;brand_id:string}>("SELECT organization_id,brand_id FROM signal_workspaces WHERE id=$1",[args.workspace_id])).rows[0]!;
    const commentActor=randomUUID(),viewerActor=randomUUID(),readAdmin=randomUUID(),analyst=randomUUID();
    for(const [id,kind,role,grant] of [[commentActor,"client","client_admin","comment"],[viewerActor,"client","client_viewer","read"],
      [readAdmin,"client","client_admin","read"],[analyst,"noisia_internal","analyst",null]] as const){
      await query.query("INSERT INTO users(id,email,user_type,primary_role,status,organization_id) VALUES($1,$2,$3,$4,'active',$5)",
        [id,`${id}@example.invalid`,kind,role,scope.organization_id]);
      if(grant)await query.query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,$3)",[id,scope.brand_id,grant]);
    }
    const commentAccess={...access,actor_user_id:commentActor};
    assert.equal((await getMassLabelingStudyPolicyV1(commentAccess)).can_edit,true,"editorial permission is independent from paid processing");
    await updateMassLabelingStudyPolicyV1({...policy,...commentAccess,expected_revision:4,lexicon_terms:["absent category token"]});
    await assert.rejects(importMassLabelingInterestsV2({...commentAccess,map_id:args.map_id,interests:[]}),/study_policy_forbidden/);
    assert.equal((await getMassLabelingStudyPolicyV1({...access,actor_user_id:analyst})).can_edit,true);
    await updateMassLabelingStudyPolicyV1({...policy,actor_user_id:analyst,expected_revision:5,lexicon_terms:["absent category token"]});
    for(const actor_user_id of [viewerActor,readAdmin]){
      assert.equal((await getMassLabelingStudyPolicyV1({...access,actor_user_id})).can_edit,false);
      await assert.rejects(updateMassLabelingStudyPolicyV1({...policy,actor_user_id,expected_revision:6}),/study_policy_forbidden/);
    }
    await query.query("UPDATE user_brand_access SET revoked_at=now() WHERE user_id=$1",[commentActor]);
    await assert.rejects(updateMassLabelingStudyPolicyV1({...policy,...commentAccess,expected_revision:6}),/study_policy_forbidden/);
    assert.equal((await query.query("SELECT has_table_privilege('anon','signal_mass_labeling_study_policies','SELECT') yes")).rows[0].yes,false);
  } finally {query.release();}
}
