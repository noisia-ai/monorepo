/** Guarded, idempotent catalog update. Run on the private MFP runner before any evaluation. */
import { readFile } from 'node:fs/promises';
// The guarded remote harness is JavaScript and intentionally has no public TS package.
// @ts-expect-error private runner JS entrypoint
import { main, openDatabase } from '../dev-corpus/guard.mjs';
import { createSignalTopicStoreV1,loadSignalTopicCatalogStoreV1,updateSignalTopicStoreV1 } from '../../infrastructure/db/signal-topic-catalog';
import { signalTopicTermKeyV1 } from '../../packages/query-engine/src/signal-topic-catalog-v1';
import { MFP_EVAL_CONCEPT_SCOPE,plannedConceptUpdates,proposedConceptInput,validateProposedConceptSelection,sha256,type ProposedConcept } from './concepts-v2';
import { loadMfpEvalIdentity } from './fixture-identity';

void main(async()=>{
  const path=process.env.NOISIA_MFP_CONCEPTS_V2_FILE ?? '.data/dev-corpus/voyage-real/concepts-proposed-v2.json';
  const bytes=await readFile(path);
  const proposed=JSON.parse(bytes.toString('utf8')) as ProposedConcept[];
  const selection=JSON.parse(await readFile(process.env.NOISIA_MFP_SELECTION_FILE ?? '.data/dev-corpus/voyage-real/gold-selection.json','utf8')) as
    {concepts:Array<{concept_key:string}>};
  const identity=await loadMfpEvalIdentity();
  const pool=await openDatabase();
  try {
    const keys=selection.concepts.map(c=>c.concept_key);
    const before=await loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    validateProposedConceptSelection(proposed,keys);
    if(proposed.some(item=>signalTopicTermKeyV1(item.concept_key)!==item.concept_key))throw new Error('mfp_eval_concept_key_not_slug_stable');
    const digest=sha256(bytes);
    let created=0;
    for(const [index,item] of proposed.entries()){
      if(before.topics.some(topic=>topic.term_key===item.concept_key))continue;
      const finalInput=proposedConceptInput(item,MFP_EVAL_CONCEPT_SCOPE);
      const result=await createSignalTopicStoreV1({pool,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,
        idempotency_key:`mfp-eval-concepts-v2-${digest.slice(0,20)}-create-${index}`,
        input:{...finalInput,label:item.concept_key}});
      if(result.term_key!==item.concept_key)throw new Error('mfp_eval_created_concept_key_mismatch');
      created++;
    }
    const withCreated=await loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    const planned=plannedConceptUpdates(proposed,withCreated.topics,keys);
    for(const [index,update] of planned.entries()) {
      if(update.unchanged)continue;
      await updateSignalTopicStoreV1({pool,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,
        term_key:update.concept_key,idempotency_key:`mfp-eval-concepts-v2-${digest.slice(0,20)}-${index}-any-rental-scope-v1`,
        input:{...update.input,expected_definition_revision:update.expected_definition_revision,
          expected_definition_digest:update.expected_definition_digest}});
    }
    const after=await loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    if(plannedConceptUpdates(proposed,after.topics,keys).some(c=>!c.unchanged))throw new Error('mfp_eval_concepts_not_current');
    if(after.topics.length!==before.topics.length+created||before.topics.some(old=>{
      const current=after.topics.find(topic=>topic.term_key===old.term_key);
      return !current||current.definition_digest!==old.definition_digest||current.definition_revision!==old.definition_revision;
    }))throw new Error('mfp_eval_unrelated_catalog_changed');
    console.log(JSON.stringify({stage:'eval_concepts_v2_installed',concepts:planned.length,created,
      updated:planned.filter(c=>!c.unchanged).length,catalog_before:before.topics.length,catalog_after:after.topics.length,
      definition_digests:keys.map(key=>after.topics.find(topic=>topic.term_key===key)!.definition_digest),
      input_sha256:digest,workspace_scoped:true,provider_calls:0}));
  } finally {await pool.end();}
});
