import {validateSignalListeningConfigurationV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalListeningConfigurationV1} from '../../packages/query-engine/src/index';
import type {WorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';

/** Local simulator preflight. It never checks or changes a real provider account.
 * Native authorization/admission/rights checks still execute inside the H2 job. */
export async function assertR16ListeningSyntheticPreflightV1(args:{
 storage:WorkspaceEngineStorageV1;storage_url:string;configuration:SignalListeningConfigurationV1;
 configuration_digest:string;env:NodeJS.ProcessEnv;
}){
 if(args.env.NOISIA_SIGNAL_LISTENING_ENABLED!=='true'||args.env.NOISIA_JEV_PROVIDER_ENABLED!=='true'
  ||args.env.NOISIA_JEV_STREAMING_V2_ENABLED!=='true')throw Error('r16_listening_explicit_flags_required');
 const url=new URL(args.storage_url);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('r16_listening_storage_not_local');
 const cfg=validateSignalListeningConfigurationV1(args.configuration);
 if(cfg.model!=='jev-1.13.0'||digest(cfg)!==args.configuration_digest)throw Error('r16_listening_frozen_configuration_changed');
 if(typeof args.storage.assertReady!=='function')throw Error('r16_listening_storage_preflight_missing');
 // This is the production private-bucket/readiness check via the real local
 // HTTP Storage adapter, not a synthetic success or an omitted preflight.
 await args.storage.assertReady();
}
