import type { Story } from "../../src/content/stories/schema";

/**
 * Privacy and copy checks that run before a piece reaches the database. A piece is public:
 * nothing in it may point to the person who wrote a quote, and it never names the data
 * provider or internal tools.
 */

const PROVIDERS = /\b(sentione|talkwalker|brandwatch|meltwater|sprinklr|youscan|foresight engine|signal pulse)\b/i;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
// @handle not preceded by a word character (so emails don't match).
const HANDLE = /(?<![\w.])@[A-Za-z0-9_.]{2,}/g;
// Company accounts a person tagged in their post (a complaint to an airline, say). They point to a
// brand, not to whoever wrote the quote. Add only verified company accounts, never a person's.
const BRAND_HANDLES = new Set(["@viajavolaris", "@didi_mexico"]);

function texts(value: unknown, path: string, out: { path: string; text: string }[]) {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((item, i) => texts(item, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) texts(item, path ? `${path}.${key}` : key, out);
  return out;
}

export function lintStory(story: Story): string[] {
  const issues: string[] = [];
  // `report` is the internal link to the study page; every other string is shown to readers.
  for (const { path, text } of texts({ ...story, report: undefined }, "", [])) {
    if (URL_PATTERN.test(text)) issues.push(`${story.id} ${path}: link (${text.match(URL_PATTERN)?.[0]})`);
    const handles = (text.match(HANDLE) ?? []).filter((handle) => !BRAND_HANDLES.has(handle.toLowerCase()));
    if (handles.length) issues.push(`${story.id} ${path}: @user (${handles.join(", ")})`);
    if (PROVIDERS.test(text)) issues.push(`${story.id} ${path}: provider or internal tool name (${text.match(PROVIDERS)?.[0]})`);
    if (text.includes("—")) issues.push(`${story.id} ${path}: em dash`);
  }
  return issues;
}
