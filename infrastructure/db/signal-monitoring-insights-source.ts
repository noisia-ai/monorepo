import type {PoolClient} from 'pg';
import {
 buildWorkspaceMonitoringInsightCandidatesV1,workspaceMonitoringInsightWindowsV1,
 signalWorkspaceEmbeddingDigestV1 as digest,entityContextDigestV1,
 type WorkspaceInsightMetricsV1,type WorkspaceMonitoringInsightPacketV1,type SignalConversationSegmentV1,
} from '@noisia/query-engine';
import * as native from './signal-workspace-topics-serving';
import {loadFacetEntityContextV1} from './signal-mention-facets';

export type MonitoringInsightContextV1={workspace_id:string;actor_user_id:string;
 conversation_segment:SignalConversationSegmentV1;locale:'es-MX'|'en-US'};
export type MonitoringInsightProofV1={input_revision:string;metadata_revision:string;enabled:boolean;timezone:string;map_identity:string;entity_context_digest:string;entity_not_after:string|null;observed_at:string};
export type MonitoringInsightSnapshotV1={packet:WorkspaceMonitoringInsightPacketV1|null;proof:MonitoringInsightProofV1;not_after:string|null};
/** PostgreSQL +infinity is an absent upper bound, never an invalid JS date.
 * Keep malformed/negative-infinite dates closed instead of removing a limit. */
export function monitoringInsightDeadlineMillisV1(value:unknown):number{
 if(value==='infinity'||value===Infinity)return Infinity;
 const deadline=value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;
 if(!Number.isFinite(deadline))throw Error('monitoring_insights_deadline_invalid');
 return deadline;
}
export function monitoringInsightNotAfterV1(values:readonly unknown[]):string|null{
 const deadline=Math.min(Infinity,...values.filter(value=>value!==null&&value!==undefined).map(monitoringInsightDeadlineMillisV1));
 return deadline===Infinity?null:new Date(deadline).toISOString();
}
export async function readMonitoringInsightProofV1(client:Pick<PoolClient,'query'>,workspace:string):Promise<MonitoringInsightProofV1>{
 const row=(await client.query<Omit<MonitoringInsightProofV1,'entity_context_digest'>>(`SELECT COALESCE(state.input_revision,0)::text input_revision,
  COALESCE(epoch.revision,0)::text metadata_revision,w.timezone,
  signal_monitoring_insights_map_identity_v1(w.id) map_identity,
  EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=w.id AND feature='monitoring_insights') enabled,
  (SELECT min(boundary)::text FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
   CROSS JOIN LATERAL(VALUES(competitor.effective_from),(competitor.effective_to)) bounds(boundary)
   WHERE competitor.brand_id=w.brand_id AND competitor.status='current' AND seed.active AND boundary>clock_timestamp()) entity_not_after,
  clock_timestamp()::text observed_at
  FROM signal_workspaces w LEFT JOIN signal_corpus_preparation_input_state state ON state.workspace_id=w.id
  LEFT JOIN signal_monitoring_insight_input_state epoch ON epoch.workspace_id=w.id WHERE w.id=$1`,[workspace])).rows[0];
 if(!row)throw Error('monitoring_insights_workspace_unavailable');
 // Canonical identity is shared with native mapCurrent. This reads only small
 // governed identity rows, never inspectFacetContextChange's affected roots.
 const context=await loadFacetEntityContextV1(client,workspace,{identity_only:true});
 return{...row,entity_context_digest:entityContextDigestV1(context)};
}
export const monitoringInsightProofKeyV1=(proof:MonitoringInsightProofV1)=>digest({input_revision:proof.input_revision,
 metadata_revision:proof.metadata_revision,enabled:proof.enabled,timezone:proof.timezone,map_identity:proof.map_identity,entity_context_digest:proof.entity_context_digest});

/** Only private processing callers take these locks, after policy/day/actor locks.
 * The epoch trigger runs after existing corpus revision statement triggers. */
export async function lockMonitoringInsightInputsV1(client:PoolClient,workspace:string){
 await client.query('SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1 FOR UPDATE',[workspace]);
 await client.query(`INSERT INTO signal_monitoring_insight_input_state(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`,[workspace]);
 await client.query('SELECT workspace_id FROM signal_monitoring_insight_input_state WHERE workspace_id=$1 FOR UPDATE',[workspace]);
}
function aggregateOnly(value:WorkspaceInsightMetricsV1):WorkspaceInsightMetricsV1{
 // The native widget includes rights-filtered excerpts. They never enter this
 // cache, run, queue or provider packet, even when the actor can read them.
 return{denominator:value.denominator,scope_digest:value.scope_digest,metadata_digest:value.metadata_digest,
  population:value.population,source_coverage:value.source_coverage,
  summary:{mentions:value.summary.mentions,root_posts:value.summary.root_posts,comments:value.summary.comments,unknown_roles:value.summary.unknown_roles},
  series:value.series.map(row=>({period_start:row.period_start,mentions:row.mentions,sentiment:row.sentiment})),
  sentiment:value.sentiment,platforms:value.platforms.map(row=>({key:row.key,count:row.count})),
  attention:{root_posts:value.attention.root_posts,total_interactions:value.attention.total_interactions,
   active_root_posts:value.attention.active_root_posts,active_ratio:value.attention.active_ratio},
  drivers:value.drivers.map(row=>({mention_count:row.mention_count})),limitations:value.limitations};
}
export async function buildMonitoringInsightSnapshotV1(client:PoolClient,args:MonitoringInsightContextV1,mode:'preview'|'dispatch'):Promise<MonitoringInsightSnapshotV1>{
 const proof=await readMonitoringInsightProofV1(client,args.workspace_id);
 // Both windows share one native population/metadata CTE, with text disabled.
 // Dispatch's RC entrypoint is separate from the strict RR serving entrypoint.
 const windows=mode==='preview'
  ?await native.loadSignalWorkspaceMonitoringWindowsWithClientV1(client,args)
  :await native.loadSignalWorkspaceMonitoringWindowsForDispatchWithClientV1(client,args);
 const not_after=monitoringInsightNotAfterV1([windows?.source_not_after,proof.entity_not_after]);
 if(!windows)return{packet:null,proof,not_after};
 const dates=workspaceMonitoringInsightWindowsV1({from:windows.available_dates.date_from,through:windows.anchor_date});
 if(!dates||!windows.current?.monitoring.denominator)return{packet:null,proof,not_after};
 const current=aggregateOnly(windows.current.monitoring);
 const previous=dates.previous&&windows.previous?aggregateOnly(windows.previous.monitoring):null;
 const candidates=buildWorkspaceMonitoringInsightCandidatesV1({current,previous});
 if(!candidates.length)return{packet:null,proof,not_after};
 return{proof,not_after,packet:{contract_version:'signal-workspace-monitoring-insight-packet-v1',workspace_id:args.workspace_id,
  locale:args.locale,timezone:proof.timezone,scope_segment:args.conversation_segment,cadence:'rolling_30_days',
  window:dates.current,comparison_window:dates.previous,partial:dates.partial,current,previous,candidates}};
}
