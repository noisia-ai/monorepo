const COUNTRY_CODES = [
  "MX", "US", "GB", "CA", "CO", "AR", "BR", "CL", "PE", "ES", "UY", "EC", "CR", "GT", "PA", "DO", "SV", "HN", "NI", "PR",
  "BO", "PY", "VE", "BZ", "JM", "TT", "BS", "BB", "CU", "HT",
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BQ", "BT", "BV", "BW", "BY",
  "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CM", "CN", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DZ",
  "EE", "EG", "EH", "ER", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GU", "GW", "GY",
  "HK", "HM", "HR", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PS", "PT", "PW",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TV", "TW", "TZ",
  "UA", "UG", "UM", "UZ",
  "VA", "VC", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW"
] as const;

const countryNameOverrides: Partial<Record<(typeof COUNTRY_CODES)[number], string>> = {
  GB: "United Kingdom (UK/GB)",
  MX: "Mexico",
  US: "United States",
  PR: "Puerto Rico",
  PS: "Palestine",
  TW: "Taiwan"
};

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;

export const COUNTRY_CATALOG = COUNTRY_CODES.map((code) => ({
  code,
  name: countryNameOverrides[code] ?? regionNames?.of(code) ?? code
}));

export const COUNTRY_OPTIONS = COUNTRY_CATALOG.map((country) => ({
  value: country.code,
  label: `${country.name} (${country.code})`
}));

const COUNTRY_NAME_BY_CODE = new Map<string, string>(COUNTRY_CATALOG.map((country) => [country.code, country.name]));

export function describeCountryCodes(codes: readonly string[]) {
  return codes.map((code) => {
    const normalized = code.trim().toUpperCase();
    const name = COUNTRY_NAME_BY_CODE.get(normalized);
    return name ? `${name} (${normalized})` : normalized;
  });
}
