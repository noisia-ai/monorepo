import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnthropicWebSearchTool,
  hasAnthropicWebSearchLocationCountry
} from "./web-search";

test("does not localize web search unless user location is explicit", () => {
  const tool = buildAnthropicWebSearchTool({ maxUses: 2 });

  assert.equal(tool.type, "web_search_20250305");
  assert.equal(tool.name, "web_search");
  assert.equal(tool.max_uses, 2);
  assert.equal(tool.user_location, undefined);
});

test("omits unsupported explicit Anthropic web search user countries", () => {
  const tool = buildAnthropicWebSearchTool({
    maxUses: 2,
    userLocation: {
      type: "approximate",
      country: "BO",
      timezone: "America/La_Paz"
    }
  });

  assert.equal(tool.user_location, undefined);
  assert.equal(hasAnthropicWebSearchLocationCountry("BO"), false);
});

test("keeps supported explicit Anthropic web search user countries", () => {
  const tool = buildAnthropicWebSearchTool({
    maxUses: 2,
    userLocation: {
      type: "approximate",
      country: "mx",
      timezone: "America/Mexico_City"
    }
  });

  assert.deepEqual(tool.user_location, {
    type: "approximate",
    country: "MX",
    timezone: "America/Mexico_City"
  });
  assert.equal(hasAnthropicWebSearchLocationCountry("MX"), true);
});
