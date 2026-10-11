import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { parseCsv, csv } from './csv.mjs';
import { matchingEntities, hash } from './gold.mjs';
import { main } from './guard.mjs';
await main(async()=>{
  const [directory, contextPath, output='.data/dev-corpus', conflictMode]=process.argv.slice(2);
  if(conflictMode && conflictMode!=='--exclude-conflicting-source-ids')throw new Error('mfp_sample_conflict_mode_invalid');
  if(!directory||!contextPath)throw new Error('mfp_sample_arguments_required');
  const context=JSON.parse(await readFile(contextPath,'utf8'));
  const sourceFiles=(await readdir(directory)).filter(name=>name.endsWith('.csv')&&!name.startsWith('_')).sort();
  let header; const unique=new Map(),provenance=[], conflicts=new Map();
  for(const file of sourceFiles){
    const raw=await readFile(resolve(directory,file),'utf8'),parsed=parseCsv(raw);
    if(!parsed.header.includes('Content of posts')||!parsed.header.includes('id'))continue;
    if(header&&JSON.stringify(header)!==JSON.stringify(parsed.header))throw new Error('mfp_sample_headers_differ');
    header=parsed.header;provenance.push({file:basename(file),sha256:hash(raw),rows:parsed.records.length});
    for(const [index,row] of parsed.records.entries()){
      if(!row['Content of posts']?.trim())continue;
      const key=String(row.id??'').trim();
      if(!key)throw new Error('mfp_sample_provider_id_missing');
      const location={file:basename(file),row:index+2};
      const excluded=conflicts.get(key);
      if(excluded){excluded.rows.push(location);continue;}
      const prior=unique.get(key);
      if(prior){
        if(JSON.stringify(prior.row)!==JSON.stringify(row)){
          if(!conflictMode)throw new Error('mfp_sample_provider_id_conflict');
          conflicts.set(key,{id:key,reason:'same_provider_id_with_different_source_row',rows:[...prior.locations,location]});
          unique.delete(key);continue;
        }
        prior.locations.push(location);
        continue;
      }
      unique.set(key,{row,key,locations:[location]});
    }
  }
  const rows=[...unique.values()].sort((a,b)=>a.key.localeCompare(b.key));
  if(rows.length<1200)throw new Error('mfp_sample_insufficient_unique_rows');
  // Enrichment is a lexical candidate pool only, never certified human gold.
  const candidates=rows.filter(item=>matchingEntities(`${item.row.Title} ${item.row['Content of posts']}`,context.entities).length>=2).slice(0,100);
  const firstIds=new Set(candidates.map(item=>item.key));
  const load1=[...candidates,...rows.filter(item=>!firstIds.has(item.key)).slice(0,1000-candidates.length)];
  const chosen=new Set(load1.map(item=>item.key));
  const novel=rows.filter(item=>!chosen.has(item.key)).slice(0,200);
  const revisions=load1.slice(30,50).map(item=>({...item.row,'Content of posts':`${item.row['Content of posts']}\n[Development fixture revision 2]`}));
  await mkdir(output,{recursive:true,mode:0o700});
  await writeFile(`${output}/load1.csv`,csv(header,load1.map(item=>item.row)),{mode:0o600,flag:'wx'});
  await writeFile(`${output}/load2.csv`,csv(header,[...novel.map(item=>item.row),...load1.slice(0,30).map(item=>item.row),...revisions]),{mode:0o600,flag:'wx'});
  await writeFile(`${output}/sampling-manifest.json`,JSON.stringify({version:'mfp-sampling-v1',source_files:provenance,
    sampling:'provider-id-order-with-lexical-enrichment',
    conflict_policy:conflictMode?'exclude_entire_conflicting_provider_id':'reject',
    excluded_source_ids:[...conflicts.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    excluded_source_rows:[...conflicts.values()].reduce((sum,item)=>sum+item.rows.length,0),
    output_hashes:{load1:hash(csv(header,load1.map(item=>item.row))),load2:hash(csv(header,[...novel.map(item=>item.row),...load1.slice(0,30).map(item=>item.row),...revisions]))},
    columns:header.length,load1_unique_ids:load1.length,load2_unique_ids:novel.length+30+revisions.length,load1:1000,load2:{new:200,duplicate:30,modified_fixture:20},
    modified_fixture_ids:revisions.map(row=>row.id),gold_comparisons:'unverified_candidates',candidate_count:candidates.length,
    note:'Twenty revised rows deliberately append a fixture marker; they are development edits, not provider-original text.'},null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:'sampled',load1:1000,load2:250,comparison_candidates:candidates.length,human_comparisons_verified:0}));
});
