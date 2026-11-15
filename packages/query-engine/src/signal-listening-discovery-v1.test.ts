import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildListeningDiscoveryEvidenceV1, decideListeningDiscoveryStopV1,
  LISTENING_DISCOVERY_POLICY_V1, listeningDiscoveryPolicyDigestV1, listeningDiscoveryPopulationDigestV1,
  type ListeningDiscoveryRootV1,
} from './signal-listening-discovery-v1';

const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const vector = (first = 1, second = 0) => [first, second, ...new Array<number>(1022).fill(0)];
const root = (id: number, a: number | null, b: number | null, category = true): ListeningDiscoveryRootV1 => ({
  root_id: `root-${String(id).padStart(4, '0')}`, input_sha256: digest(`text-${id}`), in_category: category,
  vector: vector(), evaluations: [a === null ? null : { topic_key: 'a', probability: a },
    b === null ? null : { topic_key: 'b', probability: b }].filter((row): row is NonNullable<typeof row> => row !== null),
});
function build(roots: ListeningDiscoveryRootV1[], round = 1, map = 'map-1') {
  return buildListeningDiscoveryEvidenceV1({ workspace_id: 'workspace-1', vector_space_digest: digest('voyage'),
    map_digest: digest(map), expected_root_count: roots.length,
    expected_population_digest: listeningDiscoveryPopulationDigestV1(roots), round, topic_keys: ['b', 'a', 'unasked'], roots });
}

test('uses asked denominators, includes 0.7, keeps unknown topics unmeasured and orphans category-scoped', () => {
  const result = build([root(1, 0.7, null), root(2, 0.69, 0.1), root(3, null, 0.9, false), root(4, 0.1, 0.2, false)]);
  assert.equal(result.root_count, 4); assert.equal(result.category_root_count, 2);
  assert.deepEqual(result.orphan_root_ids, ['root-0002']); assert.equal(result.orphan_rate, 0.5);
  assert.deepEqual(result.topics.map(row => [row.topic_key, row.asked, row.approved, row.acceptance_rate]), [
    ['a', 3, 1, 1 / 3], ['b', 3, 1, 1 / 3], ['unasked', 0, 0, null],
  ]);
  assert.equal(result.topics[2]!.centroid, null);
  assert.equal(result.topics[2]!.centroid_status, 'no_confirmed_members');
});

test('twin evidence needs support, records distinct denominators and deduplicates affected roots', () => {
  assert.equal(build(Array.from({ length: 19 }, (_, i) => root(i, 1, 1))).twins.length, 0);
  const rows = [...Array.from({ length: 20 }, (_, i) => root(i, 1, 1)),
    ...Array.from({ length: 10 }, (_, i) => root(i + 20, 1, null))];
  const evidence = build(rows);
  assert.deepEqual(evidence.twins, [{ left: 'a', right: 'b', jointly_asked: 20, jointly_approved: 20,
    union_approved: 30, jaccard: 2 / 3, coapproval: 1 }]);
  assert.equal(evidence.twin_root_count, 20); assert.equal(evidence.twin_root_rate, 2 / 3);
  const third = rows.map(row => ({ ...row, evaluations: [...row.evaluations, { topic_key: 'c', probability: 1 }] }));
  const all = buildListeningDiscoveryEvidenceV1({ workspace_id: 'workspace-1', vector_space_digest: digest('voyage'),
    map_digest: digest('map'), expected_population_digest: listeningDiscoveryPopulationDigestV1(third),
    expected_root_count: 30, topic_keys: ['a', 'b', 'c'], roots: third, round: 1 });
  assert.equal(all.twins.length, 3); assert.equal(all.twin_root_count, 30);
});

test('centroids use only approved members and normalize document vectors first', () => {
  const rows = [root(1, 1, 0), root(2, 1, 0), root(3, 0, 1)];
  rows[0]!.vector = vector(100, 0); rows[1]!.vector = vector(0, 1); rows[2]!.vector = vector(-1, 0);
  const result = build(rows);
  assert.ok(Math.abs(result.topics[0]!.centroid![0]! - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(result.topics[0]!.centroid![1]! - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(result.topics[0]!.confirmed_root_ids, ['root-0001', 'root-0002']);
  rows[1]!.vector = vector(-1, 0);
  assert.equal(build(rows).topics[0]!.centroid_status, 'cancelled_vectors');
  assert.equal(build(rows).topics[0]!.centroid, null);
});

test('evidence and example sampling are invariant to input order without mutating input', () => {
  const rows = Array.from({ length: 45 }, (_, i) => root(i, i % 2, (i + 1) % 2));
  const before = JSON.stringify(rows), expected = build(rows);
  const reversed = [...rows].reverse().map(row => ({ ...row, evaluations: [...row.evaluations].reverse() }));
  assert.deepEqual(build(reversed), expected); assert.equal(JSON.stringify(rows), before);
  assert.equal(expected.topics[0]!.accepted_examples.length, 8);
  assert.equal(new Set(expected.topics[0]!.accepted_examples).size, 8);
});

test('population lineage rejects a missing root, altered input or category membership', () => {
  const rows = [root(1, 1, 0), root(2, 0, 1)];
  const base = { workspace_id: 'workspace', vector_space_digest: digest('space'), map_digest: digest('map'),
    expected_population_digest: listeningDiscoveryPopulationDigestV1(rows), expected_root_count: 2,
    topic_keys: ['a', 'b'], round: 1 };
  assert.throws(() => buildListeningDiscoveryEvidenceV1({ ...base, roots: rows.slice(1) }), /input_invalid/u);
  for (const field of [{ input_sha256: digest('changed') }, { in_category: false }]) {
    assert.throws(() => buildListeningDiscoveryEvidenceV1({ ...base, roots: [{ ...rows[0]!, ...field }, rows[1]!] }), /population_changed/u);
  }
});

test('zero candidates preserve the census and category orphan denominator without inventing negative votes',()=>{
  const empty={...root(1,null,null),evaluations:[]};
  const evidence=build([empty]);assert.equal(evidence.root_count,1);assert.equal(evidence.category_root_count,1);
  assert.deepEqual(evidence.orphan_root_ids,[empty.root_id]);assert.equal(evidence.orphan_rate,1);assert.equal(evidence.root_input_sha256[empty.root_id],empty.input_sha256);
  assert.ok(evidence.topics.every(t=>t.asked===0&&t.approved===0&&t.acceptance_rate===null&&t.centroid===null&&t.centroid_status==='no_confirmed_members'
    &&t.accepted_examples.length===0&&t.rejected_examples.length===0));
  const mixed=build([empty,root(2,.9,.1),{...root(3,null,null,false),evaluations:[]}]);
  assert.equal(mixed.root_count,3);assert.equal(mixed.category_root_count,2);assert.deepEqual(mixed.orphan_root_ids,[empty.root_id]);
  assert.equal(mixed.topics[0]!.asked,1);assert.equal(mixed.topics[0]!.approved,1);assert.equal(mixed.topics[0]!.acceptance_rate,1);
  assert.equal(mixed.topics[1]!.asked,1);assert.equal(mixed.topics[1]!.approved,0);assert.equal(mixed.topics[1]!.acceptance_rate,0);
});

test('rejects duplicate, missing, unknown and invalid evaluations and incompatible vectors', () => {
  const valid = root(1, 1, 0);
  const invalid = [
    { ...valid, evaluations:null as never }, { ...valid, evaluations: [...valid.evaluations, valid.evaluations[0]!] },
    { ...valid, evaluations: [{ topic_key: 'unknown', probability: 1 }] },
    { ...valid, evaluations: [{ topic_key: 'a', probability: NaN }] },
    { ...valid, evaluations: [{ topic_key: 'a', probability: null as never }] },
    { ...valid, evaluations: [{ topic_key: 'a', probability: 1.01 }] },
    { ...valid, vector: [1, 2] }, { ...valid, vector: new Array<number>(1024).fill(0) },
    { ...valid, vector: [Infinity, ...new Array<number>(1023).fill(0)] },
  ];
  for (const row of invalid) assert.throws(() => build([row]), /listening_discovery_/u);
  assert.throws(() => build([valid, valid]), /root_invalid/u);
});

test('seals every numeric policy field independent of object property order', () => {
  assert.equal(listeningDiscoveryPolicyDigestV1(LISTENING_DISCOVERY_POLICY_V1),
    listeningDiscoveryPolicyDigestV1({ ...LISTENING_DISCOVERY_POLICY_V1 }));
  for (const field of ['approval', 'twin_jaccard', 'twin_coapproval', 'stop_absolute_improvement'] as const) {
    assert.notEqual(listeningDiscoveryPolicyDigestV1({ ...LISTENING_DISCOVERY_POLICY_V1, [field]: 0.33 }),
      listeningDiscoveryPolicyDigestV1(LISTENING_DISCOVERY_POLICY_V1));
  }
  assert.throws(() => listeningDiscoveryPolicyDigestV1({ ...LISTENING_DISCOVERY_POLICY_V1, max_rounds: 4 as 3 }), /policy_invalid/u);
});

test('stop requires both rates to stagnate, stops an unchanged map and caps at three rounds', () => {
  const rows = Array.from({ length: 100 }, (_, i) => root(i, i < 20 ? 1 : 0, i < 20 ? 1 : 0));
  const first = build(rows), second = build(rows, 2, 'map-2'), third = build(rows, 3, 'map-3');
  assert.deepEqual(decideListeningDiscoveryStopV1({ current: first, previous: null }), { stop: false, reason: 'continue' });
  assert.deepEqual(decideListeningDiscoveryStopV1({ current: second, previous: first }), { stop: true, reason: 'stagnation' });
  assert.deepEqual(decideListeningDiscoveryStopV1({ current: { ...second, orphan_rate: first.orphan_rate! - 0.02 }, previous: first }),
    { stop: false, reason: 'continue' });
  assert.deepEqual(decideListeningDiscoveryStopV1({ current: { ...second, twin_root_rate: first.twin_root_rate! - 0.02 }, previous: first }),
    { stop: false, reason: 'continue' });
  assert.deepEqual(decideListeningDiscoveryStopV1({ current: { ...second, map_digest: first.map_digest }, previous: first }),
    { stop: true, reason: 'map_unchanged' });
  assert.deepEqual(decideListeningDiscoveryStopV1({ current: third, previous: second }), { stop: true, reason: 'max_rounds' });
});

test('cannot compare different populations, vector spaces, policies, workspaces or skipped rounds', () => {
  const rows = [root(1, 1, 0)], first = build(rows), second = build(rows, 2, 'map-2');
  for (const change of [{ population_digest: digest('other') }, { vector_space_digest: digest('other') },
    { workspace_id: 'other' }, { root_count: 2 }, { category_root_count: 0 }, { policy_digest: digest('other') }, { round: 3 }]) {
    assert.throws(() => decideListeningDiscoveryStopV1({ current: { ...second, ...change }, previous: first }), /listening_discovery_/u);
  }
  assert.throws(() => decideListeningDiscoveryStopV1({ current: second, previous: null }), /previous_round_missing/u);
});

test('empty category has no invented zero rates or unnecessary additional round', () => {
  const current = build([root(1, 1, 0, false)]);
  assert.equal(current.orphan_rate, null); assert.equal(current.twin_root_rate, null);
  assert.deepEqual(decideListeningDiscoveryStopV1({ current, previous: null }), { stop: true, reason: 'no_category_population' });
});

test('human decisions change confirmed members without inventing JEV asked or approved probabilities',()=>{
 const rows=[root(1,.9,null),root(2,.1,null),root(3,null,null)];
 const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
 rows.forEach((r,i)=>{r.vector=vector(i?0:1,i?1:0);r.evaluations=[{topic_key:'a',probability:i===2?null:i===0?.9:.1,human_belongs:i!==0,human_decision_id:ids[i]}]as unknown as ListeningDiscoveryRootV1['evaluations'];});
 const result=build(rows),a=result.topics.find(t=>t.topic_key==='a')!;
 assert.equal(a.asked,2);assert.equal(a.approved,1);assert.equal(a.acceptance_rate,.5);assert.deepEqual(a.confirmed_root_ids,[rows[1]!.root_id,rows[2]!.root_id]);
 assert.deepEqual(a.centroid,vector(0,1));assert.deepEqual(result.orphan_root_ids,[rows[0]!.root_id]);assert.deepEqual(a.accepted_examples,[rows[0]!.root_id]);assert.deepEqual(a.rejected_examples,[rows[1]!.root_id]);
 assert.equal((a as {human_approved?:number}).human_approved,2);assert.equal((a as {human_removed?:number}).human_removed,1);
 for(const bad of [{topic_key:'a',probability:null},{topic_key:'a',probability:null,human_belongs:true},{topic_key:'a',probability:NaN,human_belongs:true,human_decision_id:ids[0]}])
  assert.throws(()=>build([{...rows[0]!,evaluations:[bad]as never}]),/evaluation_invalid/);
});
