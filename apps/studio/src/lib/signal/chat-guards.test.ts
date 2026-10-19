import assert from "node:assert/strict";
import test from "node:test";

import {
  isSignalChatLlmEnabled,
  isSignalChatModelAllowed,
  SIGNAL_CHAT_ALLOW_OPUS_FLAG,
  SIGNAL_CHAT_LLM_FLAG
} from "./chat-guards";

test("Signal chat LLM and Opus guards are closed by default", () => {
  assert.equal(isSignalChatLlmEnabled({}), false);
  assert.equal(isSignalChatModelAllowed("claude-sonnet-4-6", {}), true);
  assert.equal(isSignalChatModelAllowed("claude-opus-4-1", {}), false);
  assert.equal(isSignalChatLlmEnabled({ [SIGNAL_CHAT_LLM_FLAG]: "true" }), true);
  assert.equal(
    isSignalChatModelAllowed("claude-opus-4-1", { [SIGNAL_CHAT_ALLOW_OPUS_FLAG]: "true" }),
    true
  );
});
