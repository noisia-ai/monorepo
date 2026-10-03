/** Memory-only optimization. Callers must independently revalidate lease, policy
 * and processing source authority before every reservation and send. The revision
 * fingerprints every context dependency; it is not the sealed semantic digest. */
const revisions = new WeakMap<object, Map<string, string>>();
export async function verifySignalTopicEditorialContextRevisionV1(args: {
  database: object; key: string; revision: string | null;
  validate: () => Promise<void>; reread: () => Promise<string | null>;
}): Promise<void> {
  if (!args.revision) throw new Error('topic_editorial_source_stale');
  let cache = revisions.get(args.database);
  if (cache?.get(args.key) === args.revision) return;
  // Never retain an older success across a failed revalidation.
  cache?.delete(args.key);
  await args.validate();
  if (await args.reread() !== args.revision) throw new Error('topic_editorial_source_stale');
  if (!cache) { cache = new Map(); revisions.set(args.database, cache); }
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(args.key, args.revision);
}
