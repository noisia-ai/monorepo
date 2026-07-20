export type AnthropicWebSearchTool = {
  type: "web_search_20250305";
  name: "web_search";
  max_uses: number;
  user_location?: AnthropicApproximateUserLocation;
};

export type AnthropicApproximateUserLocation = {
  type: "approximate";
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
};

// This is provider localization for the searching user/operator, not the studied
// brand market. Brand markets must stay in the prompt/Data OS payload.
const SUPPORTED_WEB_SEARCH_LOCATION_COUNTRIES = new Set([
  "AU",
  "BR",
  "CA",
  "DE",
  "ES",
  "FR",
  "GB",
  "IN",
  "IT",
  "JP",
  "KR",
  "MX",
  "NL",
  "US"
]);

export function buildAnthropicWebSearchTool({
  maxUses,
  userLocation
}: {
  maxUses: number;
  userLocation?: AnthropicApproximateUserLocation | null;
}): AnthropicWebSearchTool {
  const tool: AnthropicWebSearchTool = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: Number.isFinite(maxUses) ? maxUses : 1
  };
  const normalizedUserLocation = normalizeUserLocation(userLocation);
  if (normalizedUserLocation) tool.user_location = normalizedUserLocation;
  return tool;
}

export function hasAnthropicWebSearchLocationCountry(countryCode?: string | null) {
  const normalizedCountry = countryCode?.trim().toUpperCase();
  return Boolean(normalizedCountry && SUPPORTED_WEB_SEARCH_LOCATION_COUNTRIES.has(normalizedCountry));
}

function normalizeUserLocation(
  userLocation?: AnthropicApproximateUserLocation | null
): AnthropicApproximateUserLocation | null {
  if (!userLocation) return null;
  const country = userLocation.country?.trim().toUpperCase();
  if (country && !SUPPORTED_WEB_SEARCH_LOCATION_COUNTRIES.has(country)) return null;
  const normalized: AnthropicApproximateUserLocation = {
    type: "approximate"
  };
  if (userLocation.city?.trim()) normalized.city = userLocation.city.trim();
  if (userLocation.region?.trim()) normalized.region = userLocation.region.trim();
  if (country) normalized.country = country;
  if (userLocation.timezone?.trim()) normalized.timezone = userLocation.timezone.trim();
  return normalized.city || normalized.region || normalized.country || normalized.timezone
    ? normalized
    : null;
}
