import type {JevProviderV1} from './typesafe-jev';

const nativeFetchIdentity=globalThis.fetch;
const providers=new WeakMap<object,()=>boolean>(),syntheticFetches=new WeakSet<object>(),factories=new WeakSet<object>(),stores=new WeakSet<object>();
/** Constructor-only, code-reviewed registrations. Never inferred from fields,
 * max_response_bytes, JSON, a raw witness or an arbitrary injected callback. */
export function registerJevPhaseProviderV3(provider:JevProviderV1,ready:()=>boolean):void{providers.set(provider,ready);}
export function isJevPhaseProviderV3(provider:JevProviderV1):boolean{return providers.get(provider)?.()===true;}
export function registerJevPhaseSyntheticFetchV3(fetch:typeof globalThis.fetch):void{syntheticFetches.add(fetch);}
export function isJevPhaseTransportV3(fetch?:typeof globalThis.fetch):boolean{return fetch===undefined?globalThis.fetch===nativeFetchIdentity:syntheticFetches.has(fetch);}
export function registerJevPhaseSyntheticFactoryV3(factory:object):void{factories.add(factory);}
export function isJevPhaseSyntheticFactoryV3(factory:object):boolean{return factories.has(factory);}

/** Native SQL/RAW adapter and its audited wrappers retain their explicit
 * resource protocol. An arbitrary injected store/spread does not inherit it. */
export function registerJevPhaseStoreV3(store:object):void{stores.add(store);}
export function isJevPhaseStoreV3(store:object):boolean{return stores.has(store);}
