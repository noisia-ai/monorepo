import type {SignalListeningAccessV1} from '@noisia/db';
import {signalListeningDiscoveryAdvanceJobV1,drainSignalListeningDiscoveryAdvancesOnceV1,
  type ListeningDiscoveryAdvanceStoresV1} from './signal-listening-discovery-auto-loop';
import {createListeningDiscoveryNumericStorageBindingsV1} from './signal-listening-discovery-numeric-storage';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import type {ListeningOrphanNumericResultV1} from './signal-listening-orphan-regroup';

type Database=SignalListeningAccessV1['database'];
export type ListeningDiscoveryAutomationOptionsV1={database?:Database;stores?:ListeningDiscoveryAdvanceStoresV1;
 storage?:WorkspaceEngineStorageV1;env?:Record<string,string|undefined>;should_stop?:()=>boolean;
 run?:typeof signalListeningDiscoveryAdvanceJobV1;interval_ms?:number;run_immediately?:boolean};
/** Automatic continuation ONLY of an already admitted parent. Native pending
 * selection and CAS remain authoritative; a wakeup confers no processing right. */
export async function drainSignalListeningDiscoveryAutomationOnceV1(options:ListeningDiscoveryAutomationOptionsV1={}){
 const env=options.env??process.env;
 if(env.NOISIA_LISTENING_DISCOVERY_ENABLED!=='true'||options.should_stop?.())return{candidates:0,advanced:0,failed:0};
 const database=options.database??(await import('../db/client')).pool;
 let stores=options.stores;
 if(!stores){
  const ready=(await database.query(`SELECT to_regclass('signal_listening_discovery_advances') IS NOT NULL ready`)).rows[0]?.ready;
  if(!ready)return{candidates:0,advanced:0,failed:0};
  const db=await import('@noisia/db');
  const storage=options.storage??createWorkspaceEngineStorageV1();
  stores=db.createSignalListeningDiscoveryAdvanceStoreV1<ListeningOrphanNumericResultV1>({database,
   ...createListeningDiscoveryNumericStorageBindingsV1(storage)});
 }
 const args={database,stores,enabled:true,provider_available:Boolean(env.NOISIA_LISTENING_DISCOVERY_ANTHROPIC_API_KEY?.trim()),should_stop:options.should_stop};
 if(!options.run)return drainSignalListeningDiscoveryAdvancesOnceV1(args);
 // Injecting a worker changes no admission contract: the same native candidate
 // scan and scoped stores still decide whether any identity is eligible.
 if(!stores.pending)throw Error('listening_discovery_advance_pending_adapter_missing');
 const rows=await stores.pending({database,limit:20});let advanced=0,failed=0;
 for(const row of rows){if(options.should_stop?.())break;
  try{if((await options.run(row.execution_id,args)).status==='enqueued')advanced++;}catch{failed++;}}
 return{candidates:rows.length,advanced,failed};
}
export function startSignalListeningDiscoveryAutomationV1(options:ListeningDiscoveryAutomationOptionsV1={}){
 const interval=options.interval_ms??2500;
 if(!Number.isSafeInteger(interval)||interval<10||interval>60000)throw Error('listening_discovery_advance_interval_invalid');
 let closed=false,active:Promise<unknown>|undefined;
 const drainNow=()=>{
  if(closed)return Promise.resolve();if(active)return active;
  active=drainSignalListeningDiscoveryAutomationOnceV1({...options,should_stop:()=>closed||Boolean(options.should_stop?.())})
   .catch(()=>console.warn('[listening-discovery] automatic advance unavailable')).finally(()=>{active=undefined;});return active;
 };
 const timer=setInterval(()=>{void drainNow();},interval);timer.unref?.();
 if(options.run_immediately!==false)void drainNow();
 return{drainNow,async close(){closed=true;clearInterval(timer);await active;}};
}
