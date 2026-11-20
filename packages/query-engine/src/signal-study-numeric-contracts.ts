/** Data-only Study numeric boundary. DB and Studio may import these types
 * without importing a worker, child_process, storage client or runtime driver. */
import type{buildSignalStudyMotiveFitPlanV1}from'./signal-study-evidence';
import type{signalWorkspaceMassLabelingConfigV3}from'./signal-workspace-engine-v1';
type StudyNumericLeaseV1={execution_id:string;workspace_id:string;execution_token:string;source_digest:string;configuration_digest:string;human_revision_digest:string};
type StudyNumericPlanV1={key:string;kind:'numeric';request_body:string;request_sha256:string;source_digest:string;fit_plan_digest:string};

export type StudyNumericContextV1={workspace_id:string;execution_id:string;study_digest:string;source_digest:string;cut_digest:string;
 fit_plan_digest:string;proof_census_digest:string;context_digest:string;embedding_config_digest:string;embedding_space_digest:string;
 input_revision:number;root_count:number;source_preparation_run_ids:string[];preparation_unknown_root_ids:string[];sampling_seed:string};
export type StudyNumericRowV1={root_id:string;text:string;vector:number[];proof_json:string;proof_digest:string;vector_json:string};
export type StudyNumericAdapterV1={
 /** Resolve native owner and replay the exact fit plan from the frozen cut and
  * committed axes. Header count alone is never proof of membership or rights. */
 load(args:{lease:StudyNumericLeaseV1;numeric_plan:StudyNumericPlanV1;fit_plan:ReturnType<typeof buildSignalStudyMotiveFitPlanV1>}):Promise<StudyNumericContextV1|null>;
 /** SQL proof2 is derived AFTER axes: no self-referential hash in Source proof1.
  * The native joins prove root→asset→exact UTF16 fragment→paid raw call/vector,
  * model/config/context/rights and real/nullable embedding preparation lineage.
  * Select IDs/octet lengths BEFORE hydration; never silently omit an oversize root. */
 read(args:{lease:StudyNumericLeaseV1;context:StudyNumericContextV1;after_root_id?:string;limit:number;max_working_bytes:number}):Promise<{
  proof_census_digest:string;roots:StudyNumericRowV1[];next_root_id:string|null}>;
 assertCurrent(args:{lease:StudyNumericLeaseV1;context:StudyNumericContextV1}):Promise<void>;
};
export type StudyNumericManifestV1={contract_version:'signal-study-numeric-v1';workspace_id:string;execution_id:string;study_digest:string;
 source_digest:string;cut_digest:string;request_sha256:string;fit_plan_digest:string;numeric_config:ReturnType<typeof signalWorkspaceMassLabelingConfigV3>;
 numeric_config_digest:string;seed_digest:string;embedding_space_digest:string;proof_census_digest:string;source_proofs_sha256:string;
 source_preparation_run_ids:string[];preparation_unknown_root_ids:string[];preparation_unknown_count:number;root_count:number;grouped_count:number;unassigned_count:number;
 status:'empty'|'insufficient_population'|'completed';input_manifest_sha256:string;output_manifest_sha256:string|null;
 groups:Array<{key:string;root_ids:string[]}>;unassigned_root_ids:string[];
 artifacts:Array<{name:string;sha256:string;size_bytes:number}>};
