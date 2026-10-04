import type { Pool, PoolClient } from 'pg';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {loadSignalWorkspaceEngineInputIdentityV1,SignalWorkspaceEngineError} from './signal-workspace-engine';
import {inspectFacetContextChangeV1} from './signal-mention-facets';
export type SignalIncrementalDiscoveryCandidatesV1={contract_version:'signal-incremental-discovery-candidates-v1';workspace_id:string;
 candidates:Array<{run_key:string;candidate_key:string;candidate_digest:string;label:string;definition:string;inclusion:string[];exclusion:string[]}>};
/** Only interpreted, currently bound emerging units are adoptable. A numeric neighbor is never membership. */
export async function readSignalIncrementalDiscoveryCandidatesWithClientV1(c:Pick<PoolClient,'query'>,args:{workspace_id:string;actor_user_id:string;execution_id?:string}):Promise<SignalIncrementalDiscoveryCandidatesV1>{
 const capability=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args});
 if(!capability.can_view)throw new SignalWorkspaceEngineError('topic_catalog_forbidden',403);
 const result:SignalIncrementalDiscoveryCandidatesV1={contract_version:'signal-incremental-discovery-candidates-v1',workspace_id:args.workspace_id,candidates:[]};
 const run=(await c.query<{id:string;context_digest:string;catalog_digest:string;root_ids:string[];valid:boolean}>(`SELECT e.id,
  e.input_snapshot->>'context_digest' context_digest,e.input_snapshot->>'catalog_digest' catalog_digest,
  e.input_snapshot->'discovery_population'->'root_ids' root_ids,signal_workspace_incremental_serving_current_v1(e.id)
   AND signal_workspace_incremental_execution_current_v1(e.id) AND e.input_revision=s.input_revision
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(e.input_snapshot->'discovery_population'->'root_ids') root(id)
    WHERE NOT EXISTS(SELECT 1 FROM signal_mention_facets_current_v1 facet WHERE facet.workspace_id=e.workspace_id AND facet.root_id=root.id::uuid
     AND facet.preparation_run_id=e.preparation_run_id AND facet.relevance='relevant' AND NOT facet.requires_context_review)) valid
  FROM signal_topic_catalog_executions e JOIN signal_corpus_preparation_input_state s USING(workspace_id)
  WHERE e.workspace_id=$1::uuid AND e.status='ready' AND e.input_snapshot ? 'numeric_descriptor' AND e.input_snapshot ? 'discovery_population'
   AND ($2::uuid IS NULL OR e.id=$2::uuid) ORDER BY e.created_at DESC,e.id DESC LIMIT 1`,[args.workspace_id,args.execution_id??null])).rows[0];
 if(!run?.valid)return result;
 const identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:c,...args,execution_id:run.id});
 if(identity.context_digest!==run.context_digest||identity.catalog_digest!==run.catalog_digest)return result;
 const selected=new Set(run.root_ids),change=await inspectFacetContextChangeV1(c,args.workspace_id);
 if(change.affected.some(id=>selected.has(id)))return result;
 result.candidates=(await c.query<SignalIncrementalDiscoveryCandidatesV1['candidates'][number]>(`SELECT DISTINCT
  'workspace-discovery:incremental:'||e.id::text run_key,binding.metadata#>>'{binding,unit_key}' candidate_key,
  binding.metadata#>>'{binding,proposal,cluster_digest}' candidate_digest,term.label,term.description definition,
  term.metadata#>'{topic,inclusion}' inclusion,term.metadata#>'{topic,exclusion}' exclusion
  FROM signal_topic_catalog_executions e JOIN signal_taxonomy_profiles profile ON profile.id=signal_workspace_incremental_operational_profile_v1(e.id)
  JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
  JOIN analysis_artifacts binding ON binding.engine_execution_id=e.id AND binding.workspace_id=e.workspace_id
   AND binding.metadata->>'contract_version'='workspace-incremental-unit-binding-v1'
   AND binding.metadata->>'catalog_profile_id'=profile.id::text
   AND binding.metadata#>>'{binding,term_key}'=term.term_key
   AND binding.metadata#>>'{binding,definition_digest}'=term.metadata#>>'{topic,definition_digest}'
  WHERE e.id=$1::uuid AND e.workspace_id=$2::uuid
   AND binding.metadata#>>'{binding,proposal,source,kind}'='incremental_editorial'
   AND binding.metadata#>>'{binding,proposal,status}' IN('coherent','mixed')
   AND term.metadata#>>'{topic,lifecycle}'<>'archived'
   AND EXISTS(SELECT 1 FROM signal_topic_classification_outbox d WHERE d.execution_id=e.id AND d.dispatch_kind='incremental_projection'
    AND d.status='completed' AND d.worker_job_id=binding.metadata->>'worker_job_id')
  ORDER BY candidate_key`,[run.id,args.workspace_id])).rows;
 return result;
}
export async function loadSignalIncrementalDiscoveryCandidatesV1(args:{database:Pick<Pool,'connect'>;workspace_id:string;actor_user_id:string}){
 const c=await args.database.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const result=await readSignalIncrementalDiscoveryCandidatesWithClientV1(c,args);await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
