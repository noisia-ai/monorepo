import assert from 'node:assert/strict';
import test from 'node:test';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalListeningQuestionDigestV1,buildSignalListeningJevRequestV1} from '@noisia/query-engine';
import {saveSignalListeningConfigurationV1,getSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {withSharedWireFixtureV1} from './signal-listening-statement-shared-wire.fixture';
test('publication localization protects new and changed topics while intact native legacy remains readable and reusable',{
 skip:process.env.NOISIA_R16_TOPIC_LOCALIZATION_PG!=='true',timeout:600000,
},async()=>withSharedWireFixtureV1(async f=>{
 const access={database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id},topic={key:'repair',type:'noul' as const,text:'Is repair discussed?',positive:'Synthetic repair experiences',negative:'Other matters',scope:'all' as const,origin:'brand_os' as const,human_locked:true},
 localization={original_language:'en',original:{name:'Repair',definition:'Synthetic repair experiences'},en:{name:'Repair',definition:'Synthetic repair experiences'},es:{name:'Reparación',definition:'Experiencias sintéticas de reparación'}};
 const proposed={...f.configuration,questions:[...f.configuration.questions,topic]};
 await assert.rejects(saveSignalListeningConfigurationV1({...access,expected_revision:1,provenance:'human',configuration:proposed}),/listening_topic_localization_required/);
 const complete=await saveSignalListeningConfigurationV1({...access,expected_revision:1,provenance:'human',configuration:{...proposed,questions:[...f.configuration.questions,{...topic,localization}]}});
 const input={text:'A synthetic bike repair',question_keys:[topic.key]};
 assert.deepEqual(buildSignalListeningJevRequestV1(input,complete.configuration),buildSignalListeningJevRequestV1(input,proposed));
 assert.equal(signalListeningQuestionDigestV1(complete.configuration,complete.configuration.questions.find(q=>q.key===topic.key)!),signalListeningQuestionDigestV1(proposed,topic));
 await assert.rejects(saveSignalListeningConfigurationV1({...access,expected_revision:2,provenance:'human',configuration:proposed}),/listening_topic_localization_required/);
 // This explicit SQL-only seed models already-existing history. It also records
 // the scope limit:0296 is unchanged; all product writes use the shared TS gate.
 const legacy={...complete.configuration,questions:[...complete.configuration.questions,{...topic,key:'legacy_repair'}]},raw=await f.database.connect();let legacyId:string;
 try{await raw.query('BEGIN');legacyId=(await raw.query(`INSERT INTO signal_listening_configurations(workspace_id,revision,configuration,configuration_digest,provenance,state,created_by_user_id)
  VALUES($1,3,$2::jsonb,$3,'human','published',$4) RETURNING id`,[access.workspace_id,JSON.stringify(legacy),digest(legacy),access.actor_user_id])).rows[0].id;
  await raw.query(`INSERT INTO signal_listening_questions(workspace_id,configuration_id,question_key,question_digest,definition,wire,prototype_embedding_id)
   SELECT $1,$2,q->>'key',signal_listening_question_digest_v1($3::jsonb,q),q,signal_listening_wire_v1($3::jsonb,q),(q->>'prototype_embedding_id')::uuid
   FROM jsonb_array_elements($3::jsonb->'questions') q`,[access.workspace_id,legacyId!,JSON.stringify(legacy)]);await raw.query('COMMIT');
 }catch(error){await raw.query('ROLLBACK');throw error;}finally{raw.release();}
 assert.equal((await getSignalListeningConfigurationV1({...access,configuration_id:legacyId!}))!.configuration.questions.find(q=>q.key==='legacy_repair')!.localization,undefined);
 const carried=await saveSignalListeningConfigurationV1({...access,expected_revision:3,provenance:'human',configuration:legacy});assert.equal(carried.revision,4);
 await assert.rejects(saveSignalListeningConfigurationV1({...access,expected_revision:4,provenance:'human',configuration:{...carried.configuration,questions:carried.configuration.questions.map(q=>q.key==='legacy_repair'?{...q,positive:'A changed synthetic definition'}:q)}}),/listening_topic_localization_required/);
 assert.equal((await getSignalListeningConfigurationV1({...access,configuration_id:f.configuration_id}))!.id,f.configuration_id);
}));
