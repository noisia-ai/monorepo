import type {SignalListeningConfigurationV1} from '@noisia/query-engine';
import type {SignalListeningHumanExpectedV1} from '@noisia/db';

export type SignalListeningHumanEditContextV1={contract_version:'signal-listening-human-edit-context-v1';expected:SignalListeningHumanExpectedV1;
 configuration:SignalListeningConfigurationV1;can_edit:boolean;human_snapshot_id:string|null};
export type SignalMentionListeningLabelsV1={
 binding:{snapshot_id:string;configuration_id:string;generation_id:string;map_id:string;snapshot_digest:string;human_snapshot_id:string|null};
 labels:Array<{question_key:string;name:string;names?:{original:string;en:string;es:string};domain:'category'|'adjacent'|'outside';scope:'all'|'consumer_category';
  effective_belongs:boolean|null;probability:number|null;human_belongs:boolean|null;human_decision_id:string|null;label_source:string}>;
};
