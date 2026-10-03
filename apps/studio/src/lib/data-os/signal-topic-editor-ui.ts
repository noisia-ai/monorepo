import type { SignalTopicsManagementProductV1 } from "./signal-topics-management";

type Topic = SignalTopicsManagementProductV1["topics"][number];
export type SignalTopicEditorV1 = {
  label: string; definition: string; scope: Topic["scope"]; discovery_guidance: boolean;
  inclusion: string; exclusion: string; positive_examples: string; negative_examples: string;
};

// Exhaustive against the catalog contract; acquisition scopes are a separate contract.
const editorScopes: Record<Topic["scope"], true> = {
  primary_brand: true, competitor: true, category: true, all_conversations: true
};
export const SIGNAL_TOPIC_EDITOR_SCOPES_V1 = Object.keys(editorScopes) as Topic["scope"][];

export function emptyTopicEditorV1(): SignalTopicEditorV1 {
  return { label: "", definition: "", scope: "primary_brand", discovery_guidance: true,
    inclusion: "", exclusion: "", positive_examples: "", negative_examples: "" };
}

export function topicEditorFromDefinitionV1(topic: Topic): SignalTopicEditorV1 {
  return { label: topic.label, definition: topic.definition, scope: topic.scope,
    discovery_guidance: topic.discovery_guidance ?? topic.origin !== "workspace_discovery",
    inclusion: topic.inclusion.join("\n"), exclusion: topic.exclusion.join("\n"),
    positive_examples: topic.positive_examples.join("\n"), negative_examples: topic.negative_examples.join("\n") };
}

export function topicEditorPayloadV1(editor: SignalTopicEditorV1) {
  const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  return { label: editor.label.trim(), definition: editor.definition.trim(), scope: editor.scope,
    discovery_guidance: editor.discovery_guidance,
    inclusion: lines(editor.inclusion), exclusion: lines(editor.exclusion),
    positive_examples: lines(editor.positive_examples), negative_examples: lines(editor.negative_examples) };
}

export function topicDefinitionEditorPayloadV1(topic: Topic) {
  return { label: topic.label, definition: topic.definition, scope: topic.scope,
    discovery_guidance: topic.discovery_guidance ?? topic.origin !== "workspace_discovery",
    inclusion: topic.inclusion, exclusion: topic.exclusion,
    positive_examples: topic.positive_examples, negative_examples: topic.negative_examples };
}
