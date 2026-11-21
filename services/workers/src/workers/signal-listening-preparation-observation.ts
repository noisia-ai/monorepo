/** Optional diagnostics only. Fixed enums and scalars; never request bodies,
 * root/call identifiers, authority, memory custody or an admission decision. */
export type SignalListeningSurveyOutcomeV1='profile'|'stale'|'deferred'|'ready'|'legacy'|'closed'|'threw';
export type SignalListeningPreparationEpochCauseV1='base_apply'|'profile_load'|'derived_profile'|'bootstrap_pending_apply'|'reserved'|'covered_reservation'|'bootstrap_end';
export type SignalListeningNativeSelectorObservationV1='not_observed'|'fatal'|'admission_aborted'|'cancellation_aborted'|'preparation_invalid'|'closed'|'bootstrap_wait'|'zero_selected'|'selected';
export type SignalListeningPreparationObservationV1=
 |{kind:'survey_result';outcome:SignalListeningSurveyOutcomeV1;duration_ms:number;plan_rows:number;
   post_rr_invalid:boolean|null;epoch_changed:boolean;bootstrap_changed:boolean;stopped:boolean;aborted:boolean}
 |{kind:'survey_selection';outcome:'ready'|'wait_for_apply'|'closed'|'threw';duration_ms:number;selected_rows:number}
 |{kind:'survey_short_circuit';outcome:'legacy'|'closed'}
 |{kind:'survey_profile_load';outcome:'loaded'|'missing'|'threw';duration_ms:number}
 |{kind:'epoch_advanced';cause:SignalListeningPreparationEpochCauseV1;count:number}
 |{kind:'native_admission';outcome:'committed'|'legacy'|'threw';duration_ms:number;
   proposed_calls:number;selected_calls:number;validated_calls:number;returned_calls:number|null;
   selector_called:boolean;validation_called:boolean;selector_observation:SignalListeningNativeSelectorObservationV1}
 |{kind:'draft_discard';point:'pre_native'|'post_legacy'};
