import type {PoolClient} from "pg";
import {inspectFacetContextChangeV1} from "./signal-mention-facets";

/** SQL covers registered CE/facet changes. The existing selective inspector also
 * catches a governed entity edit not yet registered by a new labeling run.
 * Narrative-only edits and affected roots outside the sealed sample do not
 * invalidate numerical membership here. Other context/rights fences remain. */
export async function signalDiscoveryProjectionContextCurrentV1(queryable:Pick<PoolClient,"query">,workspaceId:string,engineId:string){
 const row=(await queryable.query<{root_ids:string[]}>(`SELECT input_snapshot->'discovery_population'->'root_ids' root_ids
  FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract='workspace-topic-engine-v1'
   AND jsonb_typeof(input_snapshot->'discovery_population')='object'`,[engineId,workspaceId])).rows[0];
 if(!row)return true; // The caller's existing source guard owns missing/legacy executions.
 const change=await inspectFacetContextChangeV1(queryable,workspaceId);
 if(!change.changed)return true;
 const selected=new Set(row.root_ids);
 return !change.affected.some(root=>selected.has(root));
}
