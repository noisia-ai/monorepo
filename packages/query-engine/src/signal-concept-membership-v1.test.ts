import assert from "node:assert/strict";
import test from "node:test";
import {
  conceptCompatibleV1,
  membershipOutputSchemaV1,
  parseMembershipGroupV1,
  groupMembershipInputsV1,
  membershipSpansV1,
  buildMembershipRequestV1,
  conceptSetDigestV1,
  membershipLabelerIdentityV1,
  type ConceptForJudgeV1,
  type MembershipInputV1,
} from "./signal-concept-membership-v1";
import { partitionLiteralSpansV1 } from "./signal-literal-spans-v1";
const d = "sha256:" + "a".repeat(64);
const concept = (
  key = "example",
  scope: ConceptForJudgeV1["scope"] = "primary_brand",
): ConceptForJudgeV1 => ({
  concept_key: key,
  label: key,
  scope,
  definition: "A documented experience",
  inclusion: [],
  exclusion: [],
  positive_examples: [],
  negative_examples: [],
  definition_digest: d,
});
const root = (id = "root-a"): MembershipInputV1 => ({
  root_id: id,
  input_digest: d,
  root_fingerprint: d,
  entity_context_digest: d,
  effective_entities_digest: d,
  text: "A real documented experience.",
  title: null,
  platform: null,
  content_type: null,
  author: null,
  published_at: "2026-10-04",
  language: "en",
  entities: [
    { entity_id: "brand", kind: "primary_brand", salience: "main" },
    { entity_id: "rival", kind: "competitor", salience: "secondary" },
  ],
  voice: "individual",
  act: "experience",
  evaluated_concepts: [concept(), concept("rival", "competitor")],
});
const response = (roots: unknown[]) =>
  JSON.stringify({ contract_version: "concept-membership-judge-v1", roots });
test("secondary comparison entities are compatible for both scopes", () => {
  const r = root();
  assert.ok(conceptCompatibleV1(concept(), r.entities));
  assert.ok(conceptCompatibleV1(concept("rival", "competitor"), r.entities));
  assert.equal(
    conceptCompatibleV1(concept("category", "category"), r.entities),
    false,
  );
});
test("complete ordinal coverage emits explicit negative for only evaluated concepts", () => {
  const parsed = parseMembershipGroupV1(
    response([{ root_ordinal: 0, memberships: [] }]),
    [root()],
  );
  assert.equal(parsed.split, false);
  assert.equal(parsed.results.length, 2);
  assert.ok(parsed.results.every((r) => r.verdict === "not_belongs"));
});
test("an invalid item retries alone while valid roots keep their decisions; isolated error is durable", () => {
  const bad = {root_ordinal: 1, memberships: [{concept_key:"example",verdict:"insufficient",span_ids:[],rationale:"Missing evidence"}]};
  const good = {root_ordinal: 0, memberships: []};
  const grouped = parseMembershipGroupV1(response([good,bad]), [root("first"),root("second")]);
  assert.equal(grouped.split, false);
  assert.deepEqual(grouped.retry_ordinals, [1]);
  assert.ok(grouped.results.every((r) => r.root_id === "first" && r.verdict === "not_belongs"));
  const isolated = parseMembershipGroupV1(response([{...bad,root_ordinal:0}]), [root("second")]);
  assert.ok(isolated.results.every((r) => r.verdict === "error" && r.error_code === "membership_item_schema_invalid"));
  const malformedGroup = parseMembershipGroupV1("{", [root("second")]);
  assert.ok(malformedGroup.results.every((r) => r.error_code === "membership_json_invalid"));
});
test("missing/duplicate/out-of-range ordinals and max_tokens never create negatives", () => {
  for (const roots of [
    [],
    [{ root_ordinal: 1, memberships: [] }],
    [
      { root_ordinal: 0, memberships: [] },
      { root_ordinal: 0, memberships: [] },
    ],
  ]) {
    const p = parseMembershipGroupV1(response(roots), [root()]);
    assert.equal(p.split, true);
    assert.deepEqual(p.results, []);
  }
  assert.equal(
    parseMembershipGroupV1(
      response([{ root_ordinal: 0, memberships: [] }]),
      [root()],
      "max_tokens",
    ).split,
    true,
  );
});
test("citations are reconstructed from exact same-root spans", () => {
  const p = parseMembershipGroupV1(
    response([
      {
        root_ordinal: 0,
        memberships: [
          {
            concept_key: "example",
            verdict: "belongs",
            span_ids: ["r0c0s0"],
            rationale: "Documents the required experience.",
          },
        ],
      },
    ]),
    [root()],
  );
  assert.equal(p.results[0]?.citations[0]?.quote, root().text);
  assert.equal(p.results[1]?.verdict, "not_belongs");
});
test("foreign spans and unevaluated concepts invalidate entire group instead of inferring absence", () => {
  for (const [key, span] of [
    ["example", "r1c0s0"],
    ["unknown", "r0c0s0"],
  ]) {
    const p = parseMembershipGroupV1(
      response([
        {
          root_ordinal: 0,
          memberships: [
            {
              concept_key: key,
              verdict: "belongs",
              span_ids: [span],
              rationale: "Reason",
            },
          ],
        },
      ]),
      [root()],
    );
    assert.ok(p.results.every((r) => r.verdict === "error"));
  }
});
test("span extraction preserves surrogate pairs and all original text", () => {
  const text = "x".repeat(319) + "😀 end. " + "z".repeat(700);
  const spans = partitionLiteralSpansV1(text);
  assert.equal(spans.map((s) => s.text).join(""), text);
  assert.ok(spans.every((s) => s.text.length <= 320));
  assert.equal(membershipSpansV1([{ ...root(), text }])[0]?.quote_end, 319);
});
test("long roots travel alone and concept set identity is order independent", () => {
  const long = { ...root("long"), text: "x".repeat(12001) };
  assert.deepEqual(
    groupMembershipInputsV1([root(), long, root("last")]).map((g) => g.length),
    [1, 1, 1],
  );
  assert.equal(
    conceptSetDigestV1([concept(), concept("b")]),
    conceptSetDigestV1([concept("b"), concept()]),
  );
});
test("request contains full catalog, entity hints, adaptive reasoning and cache", () => {
  const r = root();
  const req = buildMembershipRequestV1(
    [r],
    { entities: [] },
    r.evaluated_concepts,
  );
  assert.equal(req.output_config.effort, "medium");
  assert.equal(req.system[0]?.cache_control.ttl, "1h");
  assert.ok(req.system[0]?.text.includes("positive_examples"));
  assert.ok(req.messages[0]?.content.includes("secondary"));
  assert.equal("temperature" in req, false);
});
test("judge evaluation accepts low and medium as distinct audited identities", () => {
  const low = membershipLabelerIdentityV1("low");
  const medium = membershipLabelerIdentityV1("medium");
  assert.notDeepEqual(low, medium);
  assert.equal(buildMembershipRequestV1([root()], {entities:[]}, [concept()], low).output_config.effort, "low");
  assert.equal(buildMembershipRequestV1([root()], {entities:[]}, [concept()], medium).output_config.effort, "medium");
  assert.throws(() => buildMembershipRequestV1([root()], {entities:[]}, [concept()], {...low, model:"other"}), /membership_identity_invalid/);
});

test("provider required ordinal keys normalize to the canonical response", () => {
  const r = root();
  const request = buildMembershipRequestV1(
    [r],
    { entities: [] },
    r.evaluated_concepts,
  );
  assert.deepEqual(
    request.output_config.format.schema.properties.roots.required,
    ["r0"],
  );
  const parsed = parseMembershipGroupV1(
    JSON.stringify({
      contract_version: "concept-membership-judge-v1",
      roots: { r0: { memberships: [] } },
    }),
    [r],
  );
  assert.equal(parsed.results.length, 2);
  assert.ok(parsed.results.every((result) => result.verdict === "not_belongs"));
});

test("provider grammar shares definitions while requiring every ordinal at 8 and 16 roots", () => {
  for (const count of [8, 16]) {
    const schema = membershipOutputSchemaV1(count);
    assert.equal(schema.properties.roots.required.length, count);
    assert.equal(Object.keys(schema.properties.roots.properties).length, count);
    for (let ordinal = 0; ordinal < count; ordinal++) {
      assert.ok(schema.properties.roots.required.includes(`r${ordinal}`));
      assert.deepEqual(schema.properties.roots.properties[`r${ordinal}`], {
        $ref: "#/definitions/root",
      });
    }
    assert.deepEqual(schema.definitions.root.properties.memberships.items, {
      $ref: "#/definitions/membership",
    });
    assert.deepEqual(schema.definitions.membership.properties.span_ids.items, {
      $ref: "#/definitions/citation",
    });
    assert.deepEqual(schema.definitions.membership.properties.verdict.enum, [
      "belongs",
      "insufficient",
    ]);
  }
});
