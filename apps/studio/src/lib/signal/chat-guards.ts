export const SIGNAL_CHAT_LLM_FLAG = "NOISIA_SIGNAL_CHAT_LLM_ENABLED";
export const SIGNAL_CHAT_ALLOW_OPUS_FLAG = "NOISIA_SIGNAL_CHAT_ALLOW_OPUS";

type Env = Record<string, string | undefined>;

export function isSignalChatLlmEnabled(env: Env = process.env) {
  return env[SIGNAL_CHAT_LLM_FLAG] === "true";
}

export function isSignalChatModelAllowed(model: string, env: Env = process.env) {
  if (!model.toLowerCase().includes("opus")) return true;
  return env[SIGNAL_CHAT_ALLOW_OPUS_FLAG] === "true";
}
