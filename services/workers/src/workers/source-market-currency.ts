export type MarketCurrencyResolution = {
  currencyCode: string | null;
  status: "resolved" | "missing_market" | "unsupported_market" | "ambiguous_market";
  marketCodes: string[];
  unmappedMarketCodes: string[];
};

const CURRENCY_BY_MARKET: Readonly<Record<string, string>> = {
  AR: "ARS",
  AT: "EUR",
  AU: "AUD",
  BE: "EUR",
  BO: "BOB",
  BR: "BRL",
  CA: "CAD",
  CH: "CHF",
  CL: "CLP",
  CN: "CNY",
  CO: "COP",
  CR: "CRC",
  CU: "CUP",
  CY: "EUR",
  CZ: "CZK",
  DE: "EUR",
  DK: "DKK",
  DO: "DOP",
  EC: "USD",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GB: "GBP",
  GR: "EUR",
  GT: "GTQ",
  HK: "HKD",
  HN: "HNL",
  HR: "EUR",
  HU: "HUF",
  ID: "IDR",
  IE: "EUR",
  IN: "INR",
  IT: "EUR",
  JM: "JMD",
  JP: "JPY",
  KR: "KRW",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MT: "EUR",
  MX: "MXN",
  NI: "NIO",
  NL: "EUR",
  NO: "NOK",
  NZ: "NZD",
  PE: "PEN",
  PL: "PLN",
  PR: "USD",
  PT: "EUR",
  PY: "PYG",
  SE: "SEK",
  SG: "SGD",
  SI: "EUR",
  SK: "EUR",
  SV: "USD",
  TH: "THB",
  TR: "TRY",
  TT: "TTD",
  TW: "TWD",
  US: "USD",
  UY: "UYU",
  VE: "VES",
  ZA: "ZAR"
};

export function resolveMarketCurrency(marketCodes: readonly string[] | null | undefined): MarketCurrencyResolution {
  const normalizedMarkets = Array.from(
    new Set((marketCodes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean))
  ).sort();

  if (normalizedMarkets.length === 0) {
    return {
      currencyCode: null,
      status: "missing_market",
      marketCodes: [],
      unmappedMarketCodes: []
    };
  }

  const unmappedMarketCodes = normalizedMarkets.filter((code) => !CURRENCY_BY_MARKET[code]);
  if (unmappedMarketCodes.length > 0) {
    return {
      currencyCode: null,
      status: "unsupported_market",
      marketCodes: normalizedMarkets,
      unmappedMarketCodes
    };
  }

  const currencies = Array.from(new Set(normalizedMarkets.map((code) => CURRENCY_BY_MARKET[code])));
  if (currencies.length !== 1) {
    return {
      currencyCode: null,
      status: "ambiguous_market",
      marketCodes: normalizedMarkets,
      unmappedMarketCodes: []
    };
  }

  return {
    currencyCode: currencies[0] ?? null,
    status: "resolved",
    marketCodes: normalizedMarkets,
    unmappedMarketCodes: []
  };
}
