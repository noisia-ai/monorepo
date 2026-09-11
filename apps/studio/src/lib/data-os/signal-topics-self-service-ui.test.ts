import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import { TopicsManager } from "../../components/brands/TopicsManager";
import { BrandMonitoringJourney } from "../../components/brands/BrandMonitoringJourney";
import type { SignalTopicsManagementProductV1 } from "./signal-topics-management";
import { emptyTopicEditorV1, topicEditorFromDefinitionV1, topicEditorPayloadV1,
  topicDefinitionEditorPayloadV1, SIGNAL_TOPIC_EDITOR_SCOPES_V1 } from "./signal-topic-editor-ui";

// Next compiles JSX automatically; the standalone tsx runner uses the classic runtime.
Object.assign(globalThis, { React });

const base = {
  workspace: { id: "workspace-test", slug: "new-brand", name: "New brand", timezone: "UTC", operational_corpus: null },
  profile: null, active_profile_id: null, topics: [], execution: null, search_execution_id: null, search_is_current: false,
  capabilities: { can_view: true, can_edit: true, can_execute: false, can_adopt: false,
    can_request_processing: true },
  readiness: { state: "awaiting_import", canonical_mentions: 0, operational_corpus_id: null,
    next_action: "import_mentions", reason_code: "topic_mentions_required" },
  embedding_preflight: { status: "blocked", requires_paid_call: false, missing_inputs: 0, estimated_micro_usd: 0,
    embedding_model: null, pricing_version: null, error_code: "topic_mentions_required" },
  discovered: { run_key: null, items: [], available: false }
} as unknown as SignalTopicsManagementProductV1;
const savedTopic = {
  taxonomy_term_id: "term-test", definition_digest: "sha256:test", created_at: "2026-09-07T00:00:00.000Z",
  term_key: "purchase-friction", label: "Purchase friction", definition: "Difficulty completing a purchase",
  scope: "category", discovery_guidance: true, inclusion: [], exclusion: [], positive_examples: [], negative_examples: [],
  lifecycle: "draft", origin: "manual", source: null, definition_revision: 1, updated_at: "2026-09-07T00:00:00.000Z",
  status: "draft", counts: { relevant: 0, doubt: 0, excluded: 0 }
} as SignalTopicsManagementProductV1["topics"][number];
const emergentTopic = { ...savedTopic, scope: "all_conversations", origin: "workspace_discovery", discovery_guidance: false,
  source: { run_key: "engine:local-fixture", candidate_key: "open:cluster-17", candidate_digest: null }
} as SignalTopicsManagementProductV1["topics"][number];

test("topic editing preserves mixed scope and output-only guidance through ordinary edits", () => {
  const editor = topicEditorFromDefinitionV1(emergentTopic);
  assert.deepEqual(topicEditorPayloadV1(editor), topicDefinitionEditorPayloadV1(emergentTopic));
  const renamed = topicEditorPayloadV1({ ...editor, label: " Revised title ", definition: "Revised definition" });
  assert.equal(renamed.scope, "all_conversations");
  assert.equal(renamed.discovery_guidance, false);
  assert.equal(renamed.label, "Revised title");
  assert.equal("origin" in renamed, false, "editing does not rewrite provenance");
  assert.equal("lifecycle" in renamed, false, "editing does not select, publish, or archive");
  assert.equal(topicEditorPayloadV1({ ...editor, discovery_guidance: true }).discovery_guidance, true);
  assert.equal(topicEditorPayloadV1({ ...editor, discovery_guidance: false }).discovery_guidance, false);
});

test("manual and previous interests default to guidance, while emergent defaults remain output-only", () => {
  assert.equal(emptyTopicEditorV1().discovery_guidance, true);
  const withoutGuidance = (topic: typeof savedTopic) => {
    const copy = { ...topic } as Partial<typeof savedTopic>; delete copy.discovery_guidance;
    return copy as typeof savedTopic;
  };
  assert.equal(topicEditorFromDefinitionV1(withoutGuidance(savedTopic)).discovery_guidance, true);
  assert.equal(topicEditorFromDefinitionV1(withoutGuidance(emergentTopic)).discovery_guidance, false);
  assert.equal(topicEditorFromDefinitionV1({ ...savedTopic, discovery_guidance: false }).discovery_guidance, false);
  assert.equal(topicEditorFromDefinitionV1({ ...emergentTopic, discovery_guidance: true }).discovery_guidance, true);
  assert.deepEqual(SIGNAL_TOPIC_EDITOR_SCOPES_V1, ["primary_brand", "competitor", "category", "all_conversations"]);
});

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (data = base) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>, createElement(TopicsManager, { brandId: "new-brand-id", workspaceId: "workspace-test", initial: data })));
  test(`${locale}: an empty authorized brand can define interests without implying mentions or execution`, () => {
    const html = render();
    assert.match(html, /href="\/studio\/brands\/new-brand-id\/data"/u);
    assert.match(html, new RegExp(messages.AdminWorkspace.topics.readiness.awaiting_import.title, "u"));
    assert.doesNotMatch(html, /<progress|topics-manager__results/u);
    const create = html.match(/<button[^>]*>[^]*?Create topic<\/button>/u);
    if (locale === "en-US" && create) assert.doesNotMatch(create[0].slice(create[0].lastIndexOf("<button")), /disabled/u);
  });
  test(`${locale}: saved category interests remain editable before import while search stays disabled`, () => {
    const html = render({ ...base, topics: [savedTopic] });
    assert.match(html, /<option value="category" selected=""/u);
    assert.doesNotMatch(html, /<fieldset[^>]*disabled/u);
    const searchLabel = messages.AdminWorkspace.topics.actions.search;
    const searchButton = html.match(new RegExp(`<button[^>]*disabled[^>]*>[^<]*(?:<svg[^]*?<\\/svg>)?${searchLabel}<\\/button>`, "u"));
    assert.ok(searchButton, "search must be disabled before data is available");
    assert.match(html, /Difficulty completing a purchase/u);
  });
  test(`${locale}: an emergent mixed-scope draft uses the same editor without adopting, guiding, or following automatically`, () => {
    const html = render({ ...base, topics: [emergentTopic] });
    assert.match(html, /<option value="all_conversations" selected=""/u);
    assert.ok(html.includes(messages.AdminWorkspace.topics.origin.workspace_discovery));
    assert.ok(html.includes(messages.AdminWorkspace.topics.editor.workspaceSource));
    assert.ok(html.includes(messages.AdminWorkspace.topics.fields.discoveryGuidance));
    const checkbox = html.match(/<input\b[^>]*type="checkbox"[^>]*>/u)?.[0];
    assert.ok(checkbox); assert.doesNotMatch(checkbox, /checked|\brequired\b/u);
    assert.doesNotMatch(html, /<fieldset[^>]*disabled/u);
    assert.doesNotMatch(html, /open:cluster-17/u, "internal cluster identity is not exposed as instructions");
    const buttons = html.match(/<button\b[^]*?<\/button>/gu) ?? [];
    assert.equal(buttons.some((button) => button.includes(messages.AdminWorkspace.topics.actions.follow)), false);
    assert.equal(buttons.some((button) => button.includes(messages.AdminWorkspace.topics.discovered.use)), false);
    assert.match(render({ ...base, topics: [{ ...emergentTopic, discovery_guidance: true }] }), /<input\b[^>]*type="checkbox"[^>]*checked/u);
  });
  test(`${locale}: read-only access disables editing, independently of the presence of data`, () => {
    const html = render({ ...base, topics: [savedTopic], capabilities: { ...base.capabilities, can_edit: false } });
    assert.match(html, /<fieldset[^>]*disabled/u);
    assert.match(html, new RegExp(messages.AdminWorkspace.topics.permissions.readOnly.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  });
  test(`${locale}: received data awaiting preparation links to its receipt while preserving interests and blocking search`, () => {
    const html = render({ ...base, topics: [savedTopic], capabilities: { ...base.capabilities, can_execute: true },
      readiness: { ...base.readiness, state: "needs_preparation", next_action: "prepare_mentions", reason_code: "topic_mentions_not_prepared" }
    });
    assert.match(html, /href="\/studio\/brands\/new-brand-id\/data#corpus-readiness"/u);
    assert.ok(html.includes(messages.AdminWorkspace.topics.actions.viewReceived));
    assert.doesNotMatch(html, /href="\/studio\/brands\/new-brand-id\/data"/u);
    assert.match(html, /Difficulty completing a purchase/u);
    assert.doesNotMatch(html, /<fieldset[^>]*disabled/u);
    const buttons = html.match(/<button\b[^]*?<\/button>/gu) ?? [];
    const search = buttons.find((button) => button.includes(messages.AdminWorkspace.topics.actions.search));
    assert.ok(search);
    assert.match(search, /^<button[^>]*disabled/u);
  });
  test(`${locale}: journey links preserve brand scope and distinguish current step from completion`, () => {
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
      createElement(BrandMonitoringJourney, { brandId: "other-brand", current: "topics" })));
    for (const path of ["brand-os", "topics", "data"]) assert.match(html, new RegExp(`href="/studio/brands/other-brand/${path}"`, "u"));
    assert.equal((html.match(/aria-current="step"/gu) ?? []).length, 1);
    assert.doesNotMatch(html, /complete|completed|completado/u);
  });
}
