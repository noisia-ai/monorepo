type Entry = { identity: string; digest: string; value: unknown };
const databases = new WeakMap<object, Map<string, Entry>>();
function freeze(value: unknown): void {
 if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
 for (const child of Object.values(value)) freeze(child);
 Object.freeze(value);
}
/** Database object is the tenant/connection boundary; no cache crosses pools.
 * Only fully source/digest-validated owner input may populate this cache. */
export function cacheSignalTopicEditorialPlanV1<T>(database: object, identity: string, digest: string, value: T): T {
 let entries = databases.get(database);
 if (!entries) { entries = new Map(); databases.set(database, entries); }
 for (const [key, entry] of entries) if (entry.identity === identity) entries.delete(key);
 const copy = structuredClone(value); freeze(copy);
 const key = JSON.stringify([identity, digest]);
 if (entries.size >= 4) entries.delete(entries.keys().next().value!);
 entries.set(key, { identity, digest, value: copy }); return copy;
}
export function readSignalTopicEditorialPlanCacheV1<T>(database: object, identity: string, digest: string): T | null {
 const entries = databases.get(database), key = JSON.stringify([identity, digest]), entry = entries?.get(key);
 if (!entry || !entries) return null;
 entries.delete(key); entries.set(key, entry); return entry.value as T;
}
export function clearSignalTopicEditorialPlanCacheV1(database: object, identity: string): void {
 const entries = databases.get(database);
 if (entries) for (const [key, entry] of entries) if (entry.identity === identity) entries.delete(key);
}
