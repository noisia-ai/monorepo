import { readFile, writeFile, open } from 'node:fs/promises';
import { openDatabase, main } from './guard.mjs';
await main(async()=>{
  const identity=JSON.parse(await readFile('.data/dev-corpus/identity.json','utf8'));const pool=await openDatabase();
  try {
    const {loadSignalWorkspaceCorpusPreparationStoreV1}=await import('../../infrastructure/db/signal-workspace-corpus-preparation-management');
    const {loadSignalSemanticResolutionGovernedContextV1}=await import('../../infrastructure/db/signal-semantic-resolution');
    const {signalWorkspaceEmbeddingDigestV1:digest}=await import('../../packages/query-engine/src/signal-workspace-embeddings-v1');
    const prepared=await loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    if(!prepared.is_current||!prepared.latest_completed)throw new Error('mfp_current_preparation_required');
    const context=await loadSignalSemanticResolutionGovernedContextV1(pool,identity.workspace_id);
    await writeFile('.data/dev-corpus/governed-entity-context.json',JSON.stringify({entities:context.identities.filter(entity=>entity.scope!=='reference').map(entity=>({
      entity_id:entity.entity_id,kind:entity.scope,name:entity.entity_label,aliases:entity.aliases,disambiguation:null
    }))}),{mode:0o600,flag:'wx'});
    const file=await open('.data/dev-corpus/roots.jsonl','wx',0o600);let cursor:string|null=null,count=0;
    try {
      for(;;){
        const {rows}: {rows: Array<{root_id:string;asset_sha256:string;[key:string]:unknown}>}=await pool.query(`SELECT item.root_id::text,asset.full_text AS text,item.asset_sha256,mention.title,mention.platform,
          mention.content_type,author.display_name AS author,mention.language,mention.published_at,mention.provider_record_id
          FROM signal_corpus_preparation_items item JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
            AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
          JOIN mentions mention ON mention.id=item.root_id LEFT JOIN authors author ON author.id=mention.author_id
          WHERE item.workspace_id=$1 AND item.run_id=$2 AND item.disposition='eligible'
            AND ($3::uuid IS NULL OR item.root_id>$3::uuid) ORDER BY item.root_id LIMIT 500`,[identity.workspace_id,prepared.latest_completed.id,cursor]);
        if(!rows.length)break;
        for(const row of rows)await file.write(JSON.stringify({...row,input_digest:digest({text_sha256:row.asset_sha256,title:row.title,platform:row.platform,content_type:row.content_type,author:row.author})})+'\n');
        count+=rows.length;cursor=rows.at(-1)!.root_id;
      }
    }finally{await file.close();}
    console.log(JSON.stringify({status:'roots_exported',roots:count,gold:'unlabeled',context_source:'governed_brand_os'}));
  }finally{await pool.end();}
});
