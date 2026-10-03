import { z } from 'zod';
const uuid=z.string().uuid(), digest=z.string().regex(/^sha256:[a-f0-9]{64}$/u), natural=z.number().int().nonnegative();
const fence=z.object({expected_binding_revision:natural,expected_selection_revision:natural,
 expected_snapshot_id:uuid.nullable(),expected_legacy_generation_id:uuid.nullable()});
export const signalTopicConsolidationActivationCommandV1=z.discriminatedUnion('action',[
 fence.extend({action:z.literal('activate'),snapshot_id:uuid,snapshot_digest:digest,revision_digest:digest,
  selected_concept_keys:z.array(z.string().min(1).max(256)).max(120)}).strict(),
 fence.extend({action:z.literal('rollback'),activation_operation_id:uuid}).strict(),
 fence.extend({action:z.literal('select'),term_key:z.string().regex(/^consolidated_[a-f0-9]{64}$/u),definition_digest:digest,selected:z.boolean()}).strict(),
]);
const selection=z.record(z.string(),z.object({selected:z.boolean(),definition_digest:digest,definition_revision:z.number().int().positive(),
 generation_id:uuid.nullable(),semantic_identity_digest:digest.optional()}).passthrough());
export const signalTopicConsolidationBindingSchemaV1=z.object({snapshot_id:uuid.nullable(),legacy_generation_id:uuid.nullable(),
 binding_revision:natural,selection_revision:natural,selection,operation_id:uuid.nullable()}).strict();
export type SignalTopicConsolidationBindingV1=z.infer<typeof signalTopicConsolidationBindingSchemaV1>;
export type SignalTopicConsolidationActivationCommandV1=z.infer<typeof signalTopicConsolidationActivationCommandV1>;
export const signalTopicConsolidationSnapshotReceiptSchemaV1=z.object({snapshot_id:uuid,snapshot_digest:digest,denominator:z.number().int().positive(),replayed:z.boolean(),activation:z.literal('pending')}).strict();
export const signalTopicConsolidationMutationReceiptSchemaV1=z.object({operation_id:uuid,binding:signalTopicConsolidationBindingSchemaV1,replayed:z.boolean()}).strict();

const signalTopicConsolidationCatalogConceptSchemaV1=z.object({
 concept_key:z.string().min(1).max(256),concept_id:uuid,kind:z.enum(['topic','narrative']),locale:z.string().min(1).max(35),
 semantic_identity_digest:digest,term_key:z.string().regex(/^consolidated_[a-f0-9]{64}$/u),label:z.string().min(1).max(160),
 definition:z.string().min(1).max(1500),definition_digest:digest,definition_revision:z.number().int().positive(),
 created_at:z.string().datetime(),updated_at:z.string().datetime()}).strict()
 .refine(item=>item.definition_digest===item.semantic_identity_digest && item.term_key===`consolidated_${item.semantic_identity_digest.slice(7)}`,
  {message:'Consolidation semantic identity mismatch'});

export const signalTopicConsolidationServingSnapshotSchemaV1=z.object({id:uuid,revision_id:uuid,revision_digest:digest,snapshot_digest:digest,
 source_engine_execution_id:uuid,preparation_run_id:uuid,input_revision:z.string().regex(/^[0-9]+$/u),current_revision:z.string().regex(/^[0-9]+$/u),
 source_valid:z.boolean(),expected_group_count:z.number().int().min(1).max(5000),
 catalog:z.array(signalTopicConsolidationCatalogConceptSchemaV1).min(1).max(120)}).strict();

export const signalTopicConsolidationActivationStatusSchemaV1=z.object({
 contract_version:z.literal('signal-topic-consolidation-activation-status-v1'),workspace_id:uuid,can_activate:z.boolean(),active_revision:z.number().int().positive().nullable(),
 binding:signalTopicConsolidationBindingSchemaV1,revisions:z.array(z.object({
  revision_id:uuid,revision:z.number().int().positive(),revision_digest:digest,validated_at:z.string().datetime(),
  snapshot_id:uuid.nullable(),snapshot_digest:digest.nullable(),source_valid:z.boolean().nullable(),
  catalog:z.array(signalTopicConsolidationCatalogConceptSchemaV1).min(1).max(120).nullable()
 }).strict().superRefine((revision,context)=>{
  const empty=revision.snapshot_id===null&&revision.snapshot_digest===null&&revision.source_valid===null&&revision.catalog===null;
  const prepared=revision.snapshot_id!==null&&revision.snapshot_digest!==null&&revision.source_valid!==null&&revision.catalog!==null;
  if(!empty&&!prepared)context.addIssue({code:z.ZodIssueCode.custom,message:'Consolidation activation revision is incomplete'});
 })).max(10)
}).strict().superRefine((status,context)=>{
 if((status.binding.snapshot_id===null)!==(status.active_revision===null))context.addIssue({code:z.ZodIssueCode.custom,message:'Consolidation active revision is incomplete'});
});
export type SignalTopicConsolidationActivationStatusV1=z.infer<typeof signalTopicConsolidationActivationStatusSchemaV1>;
