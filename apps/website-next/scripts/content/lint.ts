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

/** Checks every string inside `value`. `emDash` is the copy rule of the pieces and study pages. */
export function lintTexts(label: string, value: unknown, { emDash = true }: { emDash?: boolean } = {}): string[] {
  const issues: string[] = [];
  for (const { path, text } of texts(value, "", [])) {
    const where = path ? `${label} ${path}` : label;
    if (URL_PATTERN.test(text)) issues.push(`${where}: link (${text.match(URL_PATTERN)?.[0]})`);
    const handles = (text.match(HANDLE) ?? []).filter((handle) => !BRAND_HANDLES.has(handle.toLowerCase()));
    if (handles.length) issues.push(`${where}: @user (${handles.join(", ")})`);
    if (PROVIDERS.test(text)) issues.push(`${where}: provider or internal tool name (${text.match(PROVIDERS)?.[0]})`);
    if (emDash && text.includes("—")) issues.push(`${where}: em dash`);
  }
  return issues;
}

export function lintStory(story: Story): string[] {
  // `report` is the internal link to the study page; every other string is shown to readers.
  return lintTexts(story.id, { ...story, report: undefined });
}

// Hosts of social networks: a link to one of them in a deck points to a post and its author.
const SOCIAL_HOSTS = /^(?:[\w-]+\.)*(?:twitter\.com|x\.com|facebook\.com|fb\.com|instagram\.com|tiktok\.com|reddit\.com|youtube\.com|youtu\.be|threads\.net|linkedin\.com|pinterest\.com|t\.me)$/i;

/**
 * Privacy checks on a builder deck (its index.html). The deck is public once a study opens: it
 * may not link to posts, show @users or name the data provider or internal tools. Scripts and
 * styles are skipped for the text checks; links and image sources are checked wherever they are.
 */
export function lintDeckHtml(html: string): { issues: string[]; external: string[] } {
  const issues: string[] = [];
  const external = new Set<string>();
  for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const value = match[1];
    if (!/^(?:https?:)?\/\//i.test(value)) continue;
    let host = "";
    try {
      host = new URL(value, "https://deck.local").hostname;
    } catch {
      continue;
    }
    if (SOCIAL_HOSTS.test(host)) issues.push(`deck: link to a social post (${value})`);
    else external.add(host);
  }
  if (PROVIDERS.test(html)) issues.push(`deck: provider or internal tool name (${html.match(PROVIDERS)?.[0]})`);
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
  const handles = (visible.match(HANDLE) ?? []).filter((handle) => !BRAND_HANDLES.has(handle.toLowerCase()));
  if (handles.length) issues.push(`deck: @user in the text (${[...new Set(handles)].slice(0, 8).join(", ")})`);
  const urls = visible.match(new RegExp(URL_PATTERN.source, "gi")) ?? [];
  for (const url of urls) {
    let host = "";
    try {
      host = new URL(url.startsWith("www.") ? `https://${url}` : url).hostname;
    } catch {
      continue;
    }
    if (SOCIAL_HOSTS.test(host)) issues.push(`deck: link to a social post in the text (${url})`);
  }
  return { issues, external: [...external] };
}
