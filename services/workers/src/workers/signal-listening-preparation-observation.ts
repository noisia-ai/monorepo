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
 |{kind:'feed_budget';free_bytes:number;headroom_bytes:number;available_bytes:number;slots:number;ready_slots:number;reserved_calls:number;max_calls:number}
 |{kind:'compile_clip';outcome:'native'|'legacy'|'deferred'|'closed'|'empty'|'threw';read_calls:number|null;selected_calls:number|null;compiled_calls:number|null;returned_calls:number|null;workspace_clip:boolean;
   limit_calls:number|null;max_calls:number;minimum_calls:number|null;covered_limit:number|null;native_prefix:boolean|null;
   available_bytes:number;compiled_bytes:number|null;quote_metadata_bytes:number|null;window_tie:boolean;physical_tie:boolean;provider_tie:boolean;native_tie:boolean;bootstrap_tie:boolean;
   stop:'unreached'|'input_exhausted'|'call_limit'|'compile_memory'|'invalidated'|'aborted'|'preparation_deferred'|'closed'}
 |{kind:'native_prefix_clip';prepared_calls:number;slot_limit:number;fitted_calls:number;workspace_bytes:number|null;memory_bytes:number;draft_bytes:number;
   probes:number;response_max_bytes:number;response_unfit_probes:number;slot_clip:boolean;memory_clip:boolean;outcome:'native'|'legacy_escape'}
 |{kind:'native_selector_clip';candidate_calls:number;slot_limit:number;bootstrap_limit:number|null;limit_calls:number;selected_calls:number;
   memory_before_bytes:number;call_bytes:number;response_bytes:number|null;probes:number;response_max_bytes:number;response_unfit_probes:number;
   slot_tie:boolean;candidate_tie:boolean;bootstrap_tie:boolean;memory_clip:boolean;phase:boolean}
 |{kind:'draft_discard';point:'pre_native'|'post_legacy'};
