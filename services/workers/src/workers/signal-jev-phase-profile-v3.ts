import {JEV_LISTENING_METADATA_SLOTS_V3,JEV_LISTENING_METADATA_FIXED_BYTES_V3,JEV_LISTENING_QUERY_FRAME_BYTES_V3} from './signal-jev-listening-metadata-v3';
import type {JevProviderV1} from '../providers/typesafe-jev';
import {isJevPhaseProviderV3} from '../providers/jev-phase-provider-v3';
import {registerJevPhaseClosedBindingV3,resolveJevPhaseClosedBindingV3,type JevPhaseBudgetParametersV3,type JevPhaseClosedBindingV3} from './signal-jev-response-budget-v3';
import {jevLegacyPhaseMaximumFlushBytesV3,jevPhaseQuestionSlotsV3} from './signal-jev-phase-geometry-v3';
import type {JevStreamingExecutionV2} from './signal-jev-streaming-window';

/** P is EXACTLY the inherited legacy capture policy, throughout evaluate,
 * cooldown, finally and synchronous receipt snapshot/scanning. No H is chosen
 * or certified. This explicit mode makes inherited transport debt visible. */
export function jevLegacyCaptureProfileV3(provider:JevProviderV1,e:JevStreamingExecutionV2):JevPhaseBudgetParametersV3|null{
  if(!isJevPhaseProviderV3(provider))return null;
  return jevLegacyCaptureParametersV3(provider.max_response_bytes,e);
}
/** Numerical sizing only, never registers/infers a runtime capability. */
export function jevLegacyCaptureParametersV3(B:number|undefined,e:JevStreamingExecutionV2):JevPhaseBudgetParametersV3|null{
  if(!Number.isSafeInteger(B)||!B||B<16384||B>2*1024*1024)return null;
  const P=24*B+65536;if(P>8*1024*1024)return null;
  // Thirty-two fixed64-byte engine slots/call cover token(1), CallState(6), weak
  // entry(3), quote(5), quote-set entry(2), stream quote entry(3), reserved/
  // retained/flushing/quarantine list entries+handoff arrays(12); per-flush rows+validation arrays have 16-byte
  // refs/member. Twenty-three snapshot/view/backing/row/quarantine slots/call are charged
  // separately. One P pays additional exact UTF8 packing buffers during the
  // strictly synchronous, first-party non-reentrant receive callback; no
  // await/observer occurs before P→R. Remaining64KiB pays owner/scalar tables.
  // The additional metadata scope slots are prepaid even if every Native
  // row falls back to its unchanged Legacy F. Five possible query frames cost
  // 25 bytes per flush, never a per-row hidden subtraction.
  const ledger=e.window_size*(32+23+JEV_LISTENING_METADATA_SLOTS_V3)*64+e.max_flushes*(16*e.flush_size+1024)+65536+P+JEV_LISTENING_METADATA_FIXED_BYTES_V3;
  const maxF=jevLegacyPhaseMaximumFlushBytesV3(B,P,256);
  // Unsupported/small memory profiles keep the complete original protocol;
  // never reject a formerly legal call merely to enable this optimization.
  if(ledger+P+2*(65536+JEV_LISTENING_QUERY_FRAME_BYTES_V3+maxF)>e.max_buffered_bytes)return null;
  return Object.freeze({capture_mode:'legacy_capture',body_bound_bytes:B,ledger_bytes:ledger,
    max_capture_bytes:P,max_retained_bytes:P,max_raw_wrapper_bytes:P,max_row_flush_bytes:maxF,
    flush_fixed_bytes:65536+JEV_LISTENING_QUERY_FRAME_BYTES_V3,raw_member_overhead_bytes:2048,max_page_bytes:32*1024*1024,
    max_pending_calls:e.window_size,max_active_flushes:e.max_flushes,max_flush_rows:e.flush_size});
}
export function jevResponseMinimumHeadroomV3(provider:JevProviderV1,e:JevStreamingExecutionV2,enabled=false):number{
  const p=enabled?jevLegacyCaptureProfileV3(provider,e):null;
  return p?p.ledger_bytes+p.max_capture_bytes+2*(p.flush_fixed_bytes+p.max_row_flush_bytes):
    (provider.max_response_bytes??2*1024*1024)*24+65536;
}
export function createJevListeningPhaseBindingV3(provider:JevProviderV1,e:JevStreamingExecutionV2,mapper:object,recovery=false):JevPhaseClosedBindingV3|undefined{
  if(recovery)return undefined;const p=jevLegacyCaptureProfileV3(provider,e);if(!p)return undefined;
  return registerJevPhaseClosedBindingV3({provider_owner:provider,mapper_owner:mapper,parameters:p});
}

/** Initial hydration is unpaid and may select LEGACY after its bounded calls
 * are known. Do not reject formerly legal large inputs to force this mode.
 * Once the owner exists, all fresh input/Native work uses its shared live
 * counter and both G escrows; this helper never grants a paid response lease. */
export function jevResponseInitialHeadroomV3(provider:JevProviderV1,e:JevStreamingExecutionV2,retained:number|undefined,enabled:boolean):number{
 const legacy=(provider.max_response_bytes??2*1024*1024)*24+65536;
 if(retained===undefined||!enabled)return legacy;
 const phase=jevResponseMinimumHeadroomV3(provider,e,true);return retained+phase<=e.max_buffered_bytes?phase:legacy;
}

/** Same mode decision for initial sizing/page feed and stream owner. No shape
 * is inspected without a registered provider+mapper identity. This is unpaid
 * selection only; later claims still recompute from the fresh shared counter. */
export function selectJevPhaseInitialBindingV3(binding:JevPhaseClosedBindingV3|undefined,provider:JevProviderV1,e:JevStreamingExecutionV2,mapper:object,
 calls:ReadonlyArray<{request:unknown;inputs:readonly unknown[];raw_body?:string|null}>,retained:number):JevPhaseClosedBindingV3|undefined{
 const p=resolveJevPhaseClosedBindingV3({binding,provider_owner:provider,mapper_owner:mapper,recovery_only:calls.some(call=>Boolean(call.raw_body))});
 if(!p||p.capture_mode!=='legacy_capture'||!calls.length||calls.length>e.window_size||p.max_pending_calls!==e.window_size||p.max_flush_rows!==e.flush_size||p.max_active_flushes!==e.max_flushes)return undefined;
 const F=Math.max(...calls.map(call=>jevLegacyPhaseMaximumFlushBytesV3(p.body_bound_bytes,p.max_raw_wrapper_bytes,jevPhaseQuestionSlotsV3(call))));
 return retained+p.ledger_bytes+p.max_capture_bytes+2*(p.flush_fixed_bytes+F)<=e.max_buffered_bytes?binding:undefined;
}
