/** Independent regression oracle extracted from commit
 * 1dd59fed879ae5e8c51c3718e4f914f9578c1942, runtime Git blob
 * 0ab2c5da89bab3934bf106b365eec7ba46bf2791: classify (377–385),
 * dominance replacement (397–399), and jevBatch body (230–243).
 * Only parameter plumbing replaces those enclosing closures. This fixture must
 * not import the new dominance compiler or its protocol/replacement helpers. */
import{createHash}from'node:crypto';
import{signalStudyJevMotiveConfigurationV1}from'../../../../packages/query-engine/src/signal-study-jev-contracts';
import{buildSignalStudyMotiveRequestV1}from'../../../../packages/query-engine/src/signal-study-output';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'../../../../packages/query-engine/src/signal-workspace-embeddings-v1';
import type{SignalStudyExecutionConfigurationV1}from'../../../../packages/query-engine/src/signal-study-configuration';
import type{SignalStudyRootV1,SignalStudyMotiveV1,SignalStudyMembershipV1}from'../../../../packages/query-engine/src/signal-study-evidence';
import type{StudyRuntimeJevBatchPlanV1}from'./signal-study-runtime';
const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');

export function legacyDominancePlan1dd(args:{configuration:SignalStudyExecutionConfigurationV1;motives:SignalStudyMotiveV1[];
 roots:SignalStudyRootV1[];affected:string[];target:ReadonlySet<string>;
 header:Pick<StudyRuntimeJevBatchPlanV1,'execution_id'|'workspace_id'|'source_digest'|'stage_dependencies'>}):StudyRuntimeJevBatchPlanV1{
 const candidates=args.motives.filter(m=>args.affected.includes(m.key));
 const config=signalStudyJevMotiveConfigurationV1(args.configuration,candidates);
 const inputs=args.roots.filter(r=>args.target.has(r.root_id)).flatMap(root=>{const request=buildSignalStudyMotiveRequestV1(root,candidates,config);return request?[{root_id:root.root_id,request}]:[];});
 // This oracle's fixture has no question-cache entries. Preserve the original
 // exact JSON body and full (subset) stage configuration in the batch identity.
 const requests=inputs.map(({root_id,request})=>{const request_body=JSON.stringify(request);return{root_id,request_body,request_sha256:sha(request_body)};});
 const {execution_id,workspace_id,source_digest}=args.header,stage='dominance_membership';
 const body={contract_version:'signal-study-jev-batch-v1' as const,execution_id,workspace_id,source_digest,stage,model:'jev-1.13.0' as const,
  stage_configuration:config,stage_configuration_digest:digest(config),stage_dependencies:[...args.header.stage_dependencies].sort((a,b)=>(a.kind+a.key).localeCompare(b.kind+b.key)),requests};
 return{...body,plan_digest:digest(body)};
}

export function legacyDominanceReplacement1dd(memberships:SignalStudyMembershipV1[],reasked:SignalStudyMembershipV1[],target:ReadonlySet<string>,affected:string[]){
 return[...memberships.filter(row=>!target.has(row.root_id)||!affected.includes(row.motive_key)||row.human_locked),...reasked];
}
