/** Guarded, idempotent catalog update. Run on the private MFP runner before any evaluation. */
import { readFile } from 'node:fs/promises';
// The guarded remote harness is JavaScript and intentionally has no public TS package.
// @ts-expect-error private runner JS entrypoint
import { main, openDatabase } from '../dev-corpus/guard.mjs';
import { loadSignalTopicCatalogStoreV1, updateSignalTopicStoreV1 } from '../../infrastructure/db/signal-topic-catalog';
import { plannedConceptUpdates, sha256, type ProposedConcept } from './concepts-v2';

await main(async()=>{
  const path=process.env.NOISIA_MFP_CONCEPTS_V2_FILE ?? '.data/dev-corpus/voyage-real/concepts-proposed-v2.json';
  const bytes=await readFile(path);
  const proposed=JSON.parse(bytes.toString('utf8')) as ProposedConcept[];
  const selection=JSON.parse(await readFile(process.env.NOISIA_MFP_SELECTION_FILE ?? '.data/dev-corpus/voyage-real/gold-selection.json','utf8')) as
    {concepts:Array<{concept_key:string}>};
  const identity=JSON.parse(await readFile('.data/dev-corpus/voyage-real/identity.json','utf8')) as {fixture_key:string;workspace_id:string;internal_user_id:string};
  if(identity.fixture_key!=='rental-corpus-voyage-v1')throw new Error('mfp_eval_fixture_identity_invalid');
  const pool=await openDatabase();
  try {
    const keys=selection.concepts.map(c=>c.concept_key);
    const before=await loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    const planned=plannedConceptUpdates(proposed,before.topics,keys);
    const digest=sha256(bytes);
    for(const [index,update] of planned.entries()) {
      if(update.unchanged)continue;
      await updateSignalTopicStoreV1({pool,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,
        term_key:update.concept_key,idempotency_key:`mfp-eval-concepts-v2-${digest.slice(0,20)}-${index}`,
        input:{...update.input,expected_definition_revision:update.expected_definition_revision,
          expected_definition_digest:update.expected_definition_digest}});
    }
    const after=await loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    if(plannedConceptUpdates(proposed,after.topics,keys).some(c=>!c.unchanged))throw new Error('mfp_eval_concepts_not_current');
    console.log(JSON.stringify({stage:'eval_concepts_v2_installed',concepts:planned.length,updated:planned.filter(c=>!c.unchanged).length,
      input_sha256:digest,workspace_scoped:true,provider_calls:0}));
  } finally {await pool.end();}
});
