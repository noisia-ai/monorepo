import { createHash } from 'node:crypto';

/** Local evidence for the automatic discovery loop. No provider, storage, or
 * methodology is invoked here. Counts always describe the sealed population. */
export type ListeningDiscoveryPolicyV1 = {
  contract_version: 'listening-discovery-policy-v1';
  approval: number;
  twin_jaccard: number;
  twin_coapproval: number;
  min_jointly_asked: number;
  min_jointly_approved: number;
  stop_absolute_improvement: number;
  max_rounds: 3;
  examples_per_stratum: number;
};

export const LISTENING_DISCOVERY_POLICY_V1: Readonly<ListeningDiscoveryPolicyV1> = Object.freeze({
  contract_version: 'listening-discovery-policy-v1', approval: 0.7,
  twin_jaccard: 0.6, twin_coapproval: 0.8, min_jointly_asked: 20,
  min_jointly_approved: 10, stop_absolute_improvement: 0.01,
  max_rounds: 3, examples_per_stratum: 8,
});

export type ListeningDiscoveryRootV1 = {
  root_id: string;
  /** SHA-256 of the exact prepared text bytes used for this root. */
  input_sha256: string;
  in_category: boolean;
  /** Existing Voyage document vector. Never a provider-generated centroid. */
  vector: number[];
  evaluations: Array<{ topic_key: string; probability: number }>;
};

export type ListeningDiscoveryEvidenceV1 = {
  contract_version: 'listening-discovery-evidence-v1';
  workspace_id: string;
  vector_space_digest: string;
  population_digest: string;
  policy_digest: string;
  map_digest: string;
  round: number;
  root_count: number;
  root_input_sha256: Record<string, string>;
  category_root_count: number;
  orphan_root_ids: string[];
  orphan_rate: number | null;
  twin_root_count: number;
  twin_root_rate: number | null;
  topics: Array<{
    topic_key: string; asked: number; approved: number; acceptance_rate: number | null;
    confirmed_root_ids: string[]; confirmed_members_digest: string;
    centroid: number[] | null;
    centroid_status: 'confirmed' | 'no_confirmed_members' | 'cancelled_vectors';
    accepted_examples: string[]; rejected_examples: string[];
  }>;
  twins: Array<{
    left: string; right: string; jointly_asked: number; jointly_approved: number;
    union_approved: number; jaccard: number; coapproval: number;
  }>;
};

const fail = (code: string): never => { throw new Error(code); };
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/u;
const sha = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const probability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

function validatePolicy(policy: ListeningDiscoveryPolicyV1): void {
  if (policy.contract_version !== 'listening-discovery-policy-v1' || policy.max_rounds !== 3
    || ![policy.approval, policy.twin_jaccard, policy.twin_coapproval, policy.stop_absolute_improvement]
      .every(value => probability(value) && value > 0)
    || ![policy.min_jointly_asked, policy.min_jointly_approved, policy.examples_per_stratum]
      .every(value => Number.isSafeInteger(value) && value > 0)
    || policy.min_jointly_approved > policy.min_jointly_asked || policy.examples_per_stratum > 40)
    fail('listening_discovery_policy_invalid');
}

/** Canonical explicit fields avoid changing policy identity with object key order. */
export function listeningDiscoveryPolicyDigestV1(policy: ListeningDiscoveryPolicyV1): string {
  validatePolicy(policy);
  return sha([policy.contract_version, policy.approval, policy.twin_jaccard, policy.twin_coapproval,
    policy.min_jointly_asked, policy.min_jointly_approved, policy.stop_absolute_improvement,
    policy.max_rounds, policy.examples_per_stratum]);
}

function examples(ids: string[], topic: string, stratum: string, seed: string, limit: number): string[] {
  return [...ids].map(id => ({ id, rank: sha([seed, topic, stratum, id]) }))
    .sort((a, b) => cmp(a.rank, b.rank) || cmp(a.id, b.id)).slice(0, limit).map(row => row.id);
}

export function buildListeningDiscoveryEvidenceV1(args: {
  workspace_id: string; vector_space_digest: string; map_digest: string; round: number;
  /** Must be the persisted census hash, not inferred from the successful calls. */
  expected_population_digest: string; expected_root_count: number;
  topic_keys: string[]; roots: ListeningDiscoveryRootV1[];
  policy?: ListeningDiscoveryPolicyV1;
}): ListeningDiscoveryEvidenceV1 {
  const policy = args.policy ?? LISTENING_DISCOVERY_POLICY_V1;
  const policyDigest = listeningDiscoveryPolicyDigestV1(policy);
  if (!keyPattern.test(args.workspace_id) || !digestPattern.test(args.vector_space_digest)
    || !digestPattern.test(args.map_digest) || !digestPattern.test(args.expected_population_digest)
    || !Number.isSafeInteger(args.round) || args.round < 1 || args.round > policy.max_rounds
    || !Number.isSafeInteger(args.expected_root_count) || args.expected_root_count < 1
    || args.roots.length !== args.expected_root_count || !args.topic_keys.length
    || new Set(args.topic_keys).size !== args.topic_keys.length
    || args.topic_keys.some(key => !keyPattern.test(key))) fail('listening_discovery_input_invalid');
  const keys = [...args.topic_keys].sort(cmp);
  const rows = [...args.roots].sort((a, b) => cmp(a.root_id, b.root_id));
  const inputByRoot = new Map(rows.map(row => [row.root_id, row.input_sha256]));
  const knownTopics = new Set(keys), seen = new Set<string>();
  const byTopic = new Map(keys.map(key => [key, {
    asked: new Set<string>(), approved: new Set<string>(), rejected: [] as string[],
    sum: new Array<number>(1024).fill(0),
  }]));
  const pairCounts = new Map<string, { jointly_asked: number; jointly_approved: number; roots: string[] }>();
  const orphanIds: string[] = [];
  let categoryCount = 0;
  for (const root of rows) {
    if (!keyPattern.test(root.root_id) || seen.has(root.root_id) || !digestPattern.test(root.input_sha256)
      || typeof root.in_category !== 'boolean' || root.vector.length !== 1024
      || root.vector.some(value => !Number.isFinite(value)) || !root.evaluations.length
      || new Set(root.evaluations.map(row => row.topic_key)).size !== root.evaluations.length)
      fail('listening_discovery_root_invalid');
    seen.add(root.root_id);
    const norm = Math.hypot(...root.vector);
    if (!Number.isFinite(norm) || norm === 0) fail('listening_discovery_vector_invalid');
    const evaluations = [...root.evaluations].sort((a, b) => cmp(a.topic_key, b.topic_key));
    let accepted = false;
    for (const evaluation of evaluations) {
      if (!knownTopics.has(evaluation.topic_key) || !probability(evaluation.probability))
        fail('listening_discovery_evaluation_invalid');
      const topic = byTopic.get(evaluation.topic_key)!;
      topic.asked.add(root.root_id);
      if (evaluation.probability >= policy.approval) {
        accepted = true; topic.approved.add(root.root_id);
        for (let dimension = 0; dimension < 1024; dimension++) topic.sum[dimension]! += root.vector[dimension]! / norm;
      } else topic.rejected.push(root.root_id);
    }
    if (root.in_category) { categoryCount++; if (!accepted) orphanIds.push(root.root_id); }
    // Usually four candidates: O(roots * candidates²), never roots * all topics².
    for (let left = 0; left < evaluations.length; left++) for (let right = left + 1; right < evaluations.length; right++) {
      const a = evaluations[left]!, b = evaluations[right]!, pairKey = `${a.topic_key}\0${b.topic_key}`;
      const pair = pairCounts.get(pairKey) ?? { jointly_asked: 0, jointly_approved: 0, roots: [] };
      pair.jointly_asked++;
      if (a.probability >= policy.approval && b.probability >= policy.approval) {
        pair.jointly_approved++; if (root.in_category) pair.roots.push(root.root_id);
      }
      pairCounts.set(pairKey, pair);
    }
  }
  const populationDigest = listeningDiscoveryPopulationDigestV1(rows);
  if (populationDigest !== args.expected_population_digest) fail('listening_discovery_population_changed');
  const twinRoots = new Set<string>();
  const twins: ListeningDiscoveryEvidenceV1['twins'] = [];
  for (const [pairKey, pair] of [...pairCounts].sort(([a], [b]) => cmp(a, b))) {
    const [left, right] = pairKey.split('\0') as [string, string];
    const union = byTopic.get(left)!.approved.size + byTopic.get(right)!.approved.size - pair.jointly_approved;
    const jaccard = union ? pair.jointly_approved / union : 0;
    const coapproval = pair.jointly_approved / pair.jointly_asked;
    if (pair.jointly_asked < policy.min_jointly_asked || pair.jointly_approved < policy.min_jointly_approved
      || (jaccard < policy.twin_jaccard && coapproval < policy.twin_coapproval)) continue;
    twins.push({ left, right, jointly_asked: pair.jointly_asked, jointly_approved: pair.jointly_approved,
      union_approved: union, jaccard, coapproval });
    for (const id of pair.roots) twinRoots.add(id);
  }
  return {
    contract_version: 'listening-discovery-evidence-v1', workspace_id: args.workspace_id,
    vector_space_digest: args.vector_space_digest, population_digest: populationDigest,
    policy_digest: policyDigest, map_digest: args.map_digest, round: args.round,
    root_count: rows.length, root_input_sha256: Object.fromEntries(inputByRoot),
    category_root_count: categoryCount, orphan_root_ids: orphanIds,
    orphan_rate: categoryCount ? orphanIds.length / categoryCount : null,
    twin_root_count: twinRoots.size, twin_root_rate: categoryCount ? twinRoots.size / categoryCount : null,
    twins,
    topics: keys.map(topic_key => {
      const topic = byTopic.get(topic_key)!, members = [...topic.approved].sort(cmp);
      const norm = Math.hypot(...topic.sum);
      const centroid = members.length && norm > 1e-12 ? topic.sum.map(value => value / norm) : null;
      return { topic_key, asked: topic.asked.size, approved: members.length,
        acceptance_rate: topic.asked.size ? members.length / topic.asked.size : null,
        confirmed_root_ids: members, confirmed_members_digest: sha(members.map(id => [id, inputByRoot.get(id)!])),
        centroid, centroid_status: centroid ? 'confirmed' : members.length ? 'cancelled_vectors' : 'no_confirmed_members',
        accepted_examples: examples(members, topic_key, 'accepted', populationDigest, policy.examples_per_stratum),
        rejected_examples: examples(topic.rejected, topic_key, 'rejected', populationDigest, policy.examples_per_stratum),
      };
    }),
  };
}

export function listeningDiscoveryPopulationDigestV1(roots: Array<Pick<ListeningDiscoveryRootV1, 'root_id' | 'input_sha256' | 'in_category'>>): string {
  return sha([...roots].sort((a, b) => cmp(a.root_id, b.root_id)).map(row => [row.root_id, row.input_sha256, row.in_category]));
}

export function decideListeningDiscoveryStopV1(args: {
  current: ListeningDiscoveryEvidenceV1; previous: ListeningDiscoveryEvidenceV1 | null;
  policy?: ListeningDiscoveryPolicyV1;
}): { stop: boolean; reason: 'max_rounds' | 'map_unchanged' | 'no_category_population' | 'stagnation' | 'continue' } {
  const { current, previous } = args, policy = args.policy ?? LISTENING_DISCOVERY_POLICY_V1;
  const policyDigest = listeningDiscoveryPolicyDigestV1(policy);
  if (current.policy_digest !== policyDigest || !Number.isSafeInteger(current.round)
    || current.round < 1 || current.round > policy.max_rounds) fail('listening_discovery_stop_invalid');
  if (previous && (previous.round !== current.round - 1 || previous.workspace_id !== current.workspace_id
    || previous.vector_space_digest !== current.vector_space_digest || previous.population_digest !== current.population_digest
    || previous.root_count !== current.root_count || previous.category_root_count !== current.category_root_count
    || previous.policy_digest !== policyDigest)) fail('listening_discovery_rounds_not_comparable');
  if (!previous && current.round !== 1) fail('listening_discovery_previous_round_missing');
  if (current.round === policy.max_rounds) return { stop: true, reason: 'max_rounds' };
  if (current.category_root_count === 0) return { stop: true, reason: 'no_category_population' };
  if (previous?.map_digest === current.map_digest) return { stop: true, reason: 'map_unchanged' };
  if (previous && [current.orphan_rate, current.twin_root_rate, previous.orphan_rate, previous.twin_root_rate]
    .some(value => value === null || !probability(value))) fail('listening_discovery_stop_rates_invalid');
  if (previous && previous.orphan_rate! - current.orphan_rate! < policy.stop_absolute_improvement
    && previous.twin_root_rate! - current.twin_root_rate! < policy.stop_absolute_improvement)
    return { stop: true, reason: 'stagnation' };
  return { stop: false, reason: 'continue' };
}
