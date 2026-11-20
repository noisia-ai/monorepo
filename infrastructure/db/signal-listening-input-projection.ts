import type {PoolClient} from 'pg';
import type {SignalListeningInputV1} from '@noisia/query-engine';
import {selectLabelingInputPrefixV1,type LabelingInputBoundsV1} from './signal-labeling-input-bounds';

/** Internal read-local state, not an authorization seal. The bounded adapter
 * creates it from native pending rows and consumes it on the SAME RR client.
 * It is never retained by a run or exported by the DB package API. */
export type ListeningInputProjectionRowV1={root_id:string;working_bytes:string;projection:null|{
 input_digest:string;question_keys:string[];question_digests:Record<string,string>;scope_basis:Record<string,string>;
}};
export async function hydrateListeningInputProjectionV1(c:Pick<PoolClient,'query'>,
 scope:{workspace_id:string;map_id:string;configuration_digest:string},rows:ListeningInputProjectionRowV1[],bounds:LabelingInputBoundsV1):Promise<SignalListeningInputV1[]>{
 // Keep the canonical JS validator/contiguous prefix/first-oversize behavior.
 // SQL's prefix only limits projection payload; it does not replace this guard.
 const selected=selectLabelingInputPrefixV1(rows,bounds);if(!selected.length)return[];
 const byRoot=new Map(rows.map(row=>[row.root_id,row.projection]));
 if(selected.some(id=>!byRoot.get(id)))throw Error('labeling_input_metadata_invalid');
 // Body is exactly i.text in native population0326, not mentions.text_clean.
 // Metadata has already resolved native identity, sent and human decisions;
 // these values cannot change inside the caller's RR/read-only snapshot.
 const body=(await c.query<{root_id:string;body:string;published_at:Date|string;platform:string|null}>(
  `/* labeling_listening_input_body_v1 */ SELECT i.root_id,i.text body,m.published_at,m.platform
   FROM signal_mass_labeling_items i JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id
   WHERE i.workspace_id=$1 AND i.map_id=$2 AND i.root_id=ANY($3::uuid[])
    AND m.canonical_mention_id=m.id AND m.inclusion_status='included' ORDER BY i.root_id`,
  [scope.workspace_id,scope.map_id,selected])).rows;
 if(body.length!==selected.length||body.some((row,i)=>row.root_id!==selected[i]))throw Error('labeling_input_metadata_invalid');
 return body.map(row=>{
  const projection=byRoot.get(row.root_id)!;
  return{root_id:row.root_id,input_digest:projection.input_digest,text:row.body,title:null,platform:row.platform,
   content_type:null,author:null,published_at:new Date(row.published_at).toISOString(),language:null,map_id:scope.map_id,
   configuration_digest:scope.configuration_digest,question_keys:projection.question_keys,question_digests:projection.question_digests,scope_basis:projection.scope_basis};
 });
}
