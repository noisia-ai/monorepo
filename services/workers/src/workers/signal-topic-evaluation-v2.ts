import { runOfflineSignalTopicEvaluationV2,
  type SignalTopicEvidenceNavigationRequestV2,
  type SignalTopicEvidenceNavigationResultV2 } from "@noisia/query-engine";

/** R24 offline harness only. It is intentionally not registered in the Worker queue. A later
 * deployment gate must add an audited provider adapter and explicit execution configuration. */
export async function executeSignalTopicEvaluationV2OfflineFixture(args:{
  snapshot_digest:string;
  model:{next(input:{turn_index:number;prior_result_digests:string[]}):Promise<
    {kind:"tool";request:unknown}|{kind:"final";json:string}>};
  navigate:(request:SignalTopicEvidenceNavigationRequestV2)=>Promise<SignalTopicEvidenceNavigationResultV2>;
}){return runOfflineSignalTopicEvaluationV2(args);}
