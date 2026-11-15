import type{StudyRuntimeStoreV1,StudyRuntimeLeaseV1,StudyRuntimeNumericComputedV1}from'../../services/workers/src/workers/signal-study-runtime';
import type{LabelingRawPageStorageV1}from'./signal-labeling-raw-pages';
import type{ListeningDiscoveryNumericStorageV1}from'./signal-listening-discovery-advance';
import type{StudyDatabaseV1}from'./signal-study-core';
import{claimSignalStudyExecutionV1,renewSignalStudyExecutionV1,releaseSignalStudyExecutionV1,readSignalStudyRuntimeSourceV1}from'./signal-study-executions';
import{reconcileSignalStudyReceiptsV1,readSignalStudyStepV1,planSignalStudyStepV1,markSignalStudyStepSentV1,persistSignalStudyReceiptV1,settleSignalStudyStepV1,commitSignalStudyStepV1,markSignalStudyUnknownV1,type SignalStudyRawStorageV1}from'./signal-study-steps';
import{readSignalStudyNumericCheckpointV1,persistSignalStudyNumericV1}from'./signal-study-numeric-checkpoints';
import{prepareSignalStudyJevBatchV1}from'./signal-study-jev-batches';
import{readSignalStudyJevBatchCheckpointV1}from'./signal-study-jev-checkpoints';
import{finishSignalStudyExecutionV1}from'./signal-study-serving';
/** Only the orchestrator's provider availability can remove a capability. It
 * never supplies policy, money, request shapes, user identity or a source cut. */
export function createSignalStudyRuntimeStoreV1(options:{database:StudyDatabaseV1;raw_storage:SignalStudyRawStorageV1;raw_pages:LabelingRawPageStorageV1;
 numeric_storage:ListeningDiscoveryNumericStorageV1;numeric_storage_for_result:(lease:StudyRuntimeLeaseV1,result:StudyRuntimeNumericComputedV1)=>ListeningDiscoveryNumericStorageV1;
 analysis_enabled:()=>boolean;sonnet_provider_available:()=>boolean;jev_provider_available:()=>boolean}):StudyRuntimeStoreV1{
 const database=options.database;
 return{
  claim:async execution_id=>{await reconcileSignalStudyReceiptsV1({database,execution_id,storage:options.raw_storage});if(!options.analysis_enabled()||!options.sonnet_provider_available())return null;const lease=await claimSignalStudyExecutionV1({database,execution_id});if(!lease)await reconcileSignalStudyReceiptsV1({database,execution_id,storage:options.raw_storage});return lease;},renew:lease=>options.analysis_enabled()?renewSignalStudyExecutionV1({database,lease}):Promise.resolve(false),release:lease=>releaseSignalStudyExecutionV1({database,lease}),source:lease=>options.analysis_enabled()?readSignalStudyRuntimeSourceV1({database,lease}):Promise.resolve(null),
  numericCheckpoint:(lease,plan)=>readSignalStudyNumericCheckpointV1({database,lease,plan,storage:options.numeric_storage}),persistNumeric:(lease,plan,computed)=>persistSignalStudyNumericV1({database,lease,plan,computed,storage:options.numeric_storage_for_result(lease,computed)}),
  prepareJevBatch:(lease,plan)=>options.analysis_enabled()&&options.sonnet_provider_available()?prepareSignalStudyJevBatchV1({database,lease,plan,provider_available:options.jev_provider_available()}):Promise.resolve(null),jevBatchCheckpoint:(lease,batch_id)=>readSignalStudyJevBatchCheckpointV1({database,lease,batch_id,raw_pages:options.raw_pages}),
  step:(lease,plan)=>readSignalStudyStepV1({database,lease,plan}),plan:(lease,plan)=>options.analysis_enabled()&&options.sonnet_provider_available()?planSignalStudyStepV1({database,lease,plan}):Promise.resolve(null),markSent:(lease,plan)=>markSignalStudyStepSentV1({database,lease,plan,provider_available:options.analysis_enabled()&&options.sonnet_provider_available()}),
  persistReceipt:(lease,plan,receipt)=>persistSignalStudyReceiptV1({database,lease,plan,receipt,storage:options.raw_storage}),settle:(lease,plan)=>settleSignalStudyStepV1({database,lease,plan}),commit:(lease,plan,value,value_digest)=>options.analysis_enabled()?commitSignalStudyStepV1({database,lease,plan,value,value_digest}):Promise.resolve(false),unknown:(lease,plan,code)=>markSignalStudyUnknownV1({database,lease,plan,code}),
  finish:(lease,output,output_digest)=>options.analysis_enabled()?finishSignalStudyExecutionV1({database,lease,output,output_digest}):Promise.resolve(false),
 };
}
