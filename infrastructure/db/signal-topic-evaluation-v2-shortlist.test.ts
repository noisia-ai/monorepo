import assert from "node:assert/strict";
import test from "node:test";

import { signalTopicEvaluationV2TestOnly } from "./signal-topic-evaluation-v2";

const profile = (terms: string[], phrases: string[] = []) => ({
  label: "Historical BERTopic proposal",
  terms,
  phrases,
  limitations: [],
  distributions: { language: {}, market: {}, scope: { primary_brand: 1 }, month: {} },
  centrality_available: true
});

const context = [
  { element_key: "alias.alexa", element_kind: "alias", display_text: "Alexa", scope: "workspace",
    locale: null, source_refs_digest: `sha256:${"1".repeat(64)}`, evidence_count: 1 },
  { element_key: "alias.alexa-plus", element_kind: "alias", display_text: "Alexa Plus", scope: "workspace",
    locale: null, source_refs_digest: `sha256:${"2".repeat(64)}`, evidence_count: 1 },
  { element_key: "product.echo", element_kind: "product", display_text: "Amazon Echo", scope: "workspace",
    locale: null, source_refs_digest: `sha256:${"3".repeat(64)}`, evidence_count: 1 },
  { element_key: "competitor.apple-homepod", element_kind: "competitor", display_text: "Apple HomePod",
    scope: "workspace", locale: null, source_refs_digest: `sha256:${"4".repeat(64)}`, evidence_count: 1 }
];

test("evaluation brief puts exact Brand OS anchors before high-volume unaligned proposals", () => {
  const shortlist = signalTopicEvaluationV2TestOnly.rankEvaluationBriefShortlist([
    { cluster_key: "cluster.unaligned", proposal_key: "proposal-001", member_count: 10_000,
      profile: profile(["amazon", "stocks", "quarterly"]) },
    { cluster_key: "cluster.echo", proposal_key: "proposal-002", member_count: 20,
      profile: profile(["echo", "device"]) },
    { cluster_key: "cluster.alexa-plus", proposal_key: "proposal-003", member_count: 4,
      profile: profile(["alexa", "plus"], ["alexa plus"]) },
    { cluster_key: "cluster.homepod", proposal_key: "proposal-004", member_count: 80,
      profile: profile(["speaker"], ["apple homepod"]) }
  ], context);

  assert.deepEqual(shortlist.map((row) => row.cluster_key), [
    "cluster.alexa-plus", "cluster.homepod", "cluster.echo", "cluster.unaligned"
  ]);
  assert.deepEqual(shortlist[0]!.brand_os_matches, ["alias.alexa", "alias.alexa-plus"]);
  assert.equal(shortlist[0]!.brand_os_match_count, 2);
  assert.deepEqual(shortlist[1]!.brand_os_matches, ["competitor.apple-homepod"]);
  assert.deepEqual(shortlist[2]!.brand_os_matches, ["product.echo"]);
  assert.deepEqual(shortlist[3]!.brand_os_matches, []);
});

test("brief preserves a bounded match-hint payload while retaining the exact match count", () => {
  const aliases = Array.from({ length: 13 }, (_, index) => ({
    element_key: `alias.seed-${index}`, element_kind: "alias", display_text: "Seed", scope: "workspace",
    locale: null, source_refs_digest: `sha256:${String(index).padStart(1, "0").repeat(64).slice(0, 64)}`,
    evidence_count: 1
  }));
  const [row] = signalTopicEvaluationV2TestOnly.rankEvaluationBriefShortlist([
    { cluster_key: "cluster.seed", proposal_key: "proposal-seed", member_count: 1,
      profile: profile(["seed"]) }
  ], aliases);
  assert.ok(row);
  assert.equal(row!.brand_os_match_count, 13);
  assert.equal(row!.brand_os_matches.length, 12);
  assert.deepEqual(row!.brand_os_matches, aliases.map((item) => item.element_key).sort().slice(0, 12));
});

test("brief does not reserve a zero-match slot when all 24 highest rows are Brand OS anchored", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    cluster_key: `cluster.aligned-${String(index).padStart(2, "0")}`,
    proposal_key: `proposal-${String(index).padStart(2, "0")}`,
    member_count: index + 1,
    profile: profile(["alexa"])
  }));
  rows.push({ cluster_key: "cluster.unaligned", proposal_key: "proposal-unaligned", member_count: 99_999,
    profile: profile(["stocks"]) });
  const shortlist = signalTopicEvaluationV2TestOnly.rankEvaluationBriefShortlist(rows, [context[0]!]).slice(0, 24);
  assert.equal(shortlist.length, 24);
  assert.equal(shortlist.every((row) => row.brand_os_match_count === 1), true);
  assert.equal(shortlist.some((row) => row.cluster_key === "cluster.unaligned"), false);
});
