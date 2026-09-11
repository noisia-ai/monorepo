import {createHash} from 'node:crypto';
import type {SignalSemanticContextQueryable} from './signal-semantic-context-proposal';

export type SignalBrandOsCanonicalSnapshotV1={name:string;description:string|null;organization_id:string;
  industry:string|null;industry_sub:string|null;countries:string[];aliases:string[];
  competitors:Array<{name:string;seed_id:string}>;knowledge_count:number};
/** Shared unchanged with Brand OS reconciliation: identity has one hash domain. */
export function buildSignalBrandOsCanonicalSnapshotV1(value:SignalBrandOsCanonicalSnapshotV1):SignalBrandOsCanonicalSnapshotV1{
  return {...value,countries:[...value.countries],aliases:[...value.aliases],
    competitors:[...value.competitors].sort((left,right)=>left.name.toLocaleLowerCase('und').localeCompare(right.name.toLocaleLowerCase('und'))
      ||left.seed_id.localeCompare(right.seed_id))};
}
function stableJson(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,entry])=>`${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function signalBrandOsCanonicalSnapshotHashV1(value:SignalBrandOsCanonicalSnapshotV1){
  return `sha256:${createHash('sha256').update(stableJson(buildSignalBrandOsCanonicalSnapshotV1(value))).digest('hex')}`;
}
export async function readSignalBrandOsCanonicalSnapshotV1(args:{queryable:SignalSemanticContextQueryable;brand_id:string;organization_id:string}){
  return(await args.queryable.query<SignalBrandOsCanonicalSnapshotV1>(`
    SELECT COALESCE(brand.display_name,brand.name) AS name,brand.description,
      brand.organization_id::text,brand.industry,brand.industry_sub,brand.countries,
      COALESCE(brand.brand_seed_handles,ARRAY[]::text[]) AS aliases,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('name',seed.canonical_name,'seed_id',seed.id::text)
        ORDER BY lower(seed.canonical_name),seed.id)
        FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
        WHERE competitor.brand_id=brand.id AND competitor.status='current' AND seed.active),'[]'::jsonb) AS competitors,
      (SELECT count(*)::int FROM brand_knowledge_sources source
        WHERE source.brand_id=brand.id AND source.study_corpus_id IS NULL
          AND source.status IN('processed','profiled','active')) AS knowledge_count
    FROM brands brand WHERE brand.id=$1::uuid AND brand.organization_id=$2::uuid
  `,[args.brand_id,args.organization_id])).rows[0]??null;
}
