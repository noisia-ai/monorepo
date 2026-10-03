export const DATA_OS_METRIC_UNITS = [
  "count",
  "currency",
  "ratio",
  "score",
  "duration_seconds"
] as const;

export type DataOsMetricUnit = (typeof DATA_OS_METRIC_UNITS)[number];

export type DataOsMetricDefinition = {
  family: string;
  name: string;
  unit: DataOsMetricUnit;
  domains: string[];
  description: string;
  defaultGrain: "event" | "day" | "week" | "month" | "snapshot" | "static";
  dimensions: string[];
  validRange?: {
    min?: number;
    max?: number;
  };
};

export type DataOsMetricVariantDefinition = {
  key: string;
  family: string;
  name: string;
  aliases: string[];
  datasetRoles?: string[];
};

const COUNT = "count" satisfies DataOsMetricUnit;
const CURRENCY = "currency" satisfies DataOsMetricUnit;
const RATIO = "ratio" satisfies DataOsMetricUnit;
const SCORE = "score" satisfies DataOsMetricUnit;
const DURATION = "duration_seconds" satisfies DataOsMetricUnit;
const UNIT_INTERVAL = { min: 0, max: 1 } as const;

export const DATA_OS_METRIC_DEFINITIONS: DataOsMetricDefinition[] = [
  metric("mentions", "Mentions", COUNT, ["social_listening"], "Canonical included listening records.", "month", ["platform", "country", "language", "content_type"]),
  metric("engagement", "Engagement", COUNT, ["social_listening", "organic_social"], "Provider engagement interactions.", "month", ["platform", "content_id"]),
  metric("sentiment", "Sentiment score", SCORE, ["social_listening"], "Numeric sentiment score on the source scale.", "month", ["platform"]),
  metric("likes", "Likes", COUNT, ["social_listening", "organic_social"], "Like or reaction interactions.", "event", ["platform", "content_id"]),
  metric("comments", "Comments", COUNT, ["social_listening", "organic_social"], "Comment interactions.", "event", ["platform", "content_id"]),
  metric("shares", "Shares", COUNT, ["social_listening", "organic_social"], "Share or repost interactions.", "event", ["platform", "content_id"]),
  metric("saves", "Saves", COUNT, ["social_listening", "organic_social"], "Save interactions.", "event", ["platform", "content_id"]),

  metric("sales", "Sales", CURRENCY, ["ecommerce_sales"], "Gross or net sales as declared by the source.", "month", ["product", "category", "channel", "market"]),
  metric("revenue", "Revenue", CURRENCY, ["ecommerce_sales"], "Revenue as declared by the source.", "month", ["product", "category", "channel", "market"]),
  metric("cost", "Cost of sales", CURRENCY, ["ecommerce_sales"], "Cost attributable to sold goods or services.", "month", ["product", "category", "channel"]),
  metric("profit", "Profit", CURRENCY, ["ecommerce_sales"], "Gross, operating, or net profit as declared by the source.", "month", ["product", "category", "channel"]),
  metric("average_order_value", "Average order value", CURRENCY, ["ecommerce_sales"], "Average monetary value per order.", "month", ["channel", "market"]),
  metric("discount", "Discount amount", CURRENCY, ["ecommerce_sales", "pricing_inventory"], "Monetary discount amount.", "event", ["product", "promotion", "channel"]),
  metric("refund_amount", "Refund amount", CURRENCY, ["ecommerce_sales"], "Monetary value refunded.", "event", ["product", "reason", "channel"]),
  metric("orders", "Orders", COUNT, ["ecommerce_sales"], "Completed or declared orders.", "month", ["product", "category", "channel"]),
  metric("units", "Units sold", COUNT, ["ecommerce_sales"], "Physical or logical units sold.", "month", ["product", "category", "channel"]),
  metric("returns", "Returns", COUNT, ["ecommerce_sales"], "Returned orders or units as declared by the source.", "month", ["product", "reason", "channel"]),
  metric("margin", "Margin rate", RATIO, ["ecommerce_sales"], "Normalized margin rate. Negative values represent loss-making products or periods; values above 1 are invalid.", "month", ["product", "category", "channel"], { max: 1 }),
  metric("discount_rate", "Discount rate", RATIO, ["ecommerce_sales", "pricing_inventory"], "Normalized discount rate in the 0..1 range.", "event", ["product", "promotion", "channel"], UNIT_INTERVAL),
  metric("return_rate", "Return rate", RATIO, ["ecommerce_sales"], "Normalized returned-order or returned-unit rate.", "month", ["product", "category", "channel"], UNIT_INTERVAL),
  metric("refund_rate", "Refund rate", RATIO, ["ecommerce_sales"], "Normalized refunded-order rate.", "month", ["product", "category", "channel"], UNIT_INTERVAL),

  metric("sessions", "Sessions", COUNT, ["web_analytics"], "Analytics sessions.", "day", ["source", "medium", "campaign", "landing_page"]),
  metric("users", "Users", COUNT, ["web_analytics"], "Unique or active users as declared by the source.", "day", ["source", "medium", "campaign"]),
  metric("page_views", "Page views", COUNT, ["web_analytics"], "Page or screen views.", "day", ["page", "source", "medium"]),
  metric("product_views", "Product views", COUNT, ["web_analytics"], "Product detail views.", "day", ["product", "category", "source"]),
  metric("add_to_cart", "Add to cart", COUNT, ["web_analytics"], "Add-to-cart events.", "day", ["product", "category", "source"]),
  metric("checkout", "Checkout starts", COUNT, ["web_analytics"], "Checkout-start events.", "day", ["product", "category", "source"]),
  metric("conversions", "Conversions", COUNT, ["web_analytics", "paid_media"], "Conversion events as declared by the source.", "day", ["campaign", "channel", "conversion_type"]),
  metric("conversion_rate", "Conversion rate", RATIO, ["web_analytics", "paid_media"], "Normalized conversion rate in the 0..1 range.", "day", ["campaign", "channel", "conversion_type"], UNIT_INTERVAL),

  metric("search_volume", "Search volume", COUNT, ["search_demand"], "Estimated or observed query volume.", "month", ["query", "market", "device"]),
  metric("search_clicks", "Search clicks", COUNT, ["search_demand"], "Organic search-result clicks.", "day", ["query", "page", "device", "market"]),
  metric("search_impressions", "Search impressions", COUNT, ["search_demand"], "Organic search-result impressions.", "day", ["query", "page", "device", "market"]),
  metric("search_position", "Search position", SCORE, ["search_demand"], "Average search-result position on the provider scale.", "day", ["query", "page", "device", "market"]),
  metric("share_of_search", "Share of search", RATIO, ["search_demand", "competitive_intelligence"], "Normalized share of category search demand.", "month", ["brand", "market"], UNIT_INTERVAL),

  metric("support_tickets", "Support tickets", COUNT, ["customer_service"], "Customer-service cases or conversations.", "day", ["channel", "reason", "status"]),
  metric("resolution_time", "Resolution time", DURATION, ["customer_service"], "Case resolution duration normalized to seconds.", "day", ["channel", "reason", "priority"]),
  metric("customer_satisfaction", "Customer satisfaction", SCORE, ["customer_service"], "CSAT or NPS score on the declared source scale.", "day", ["channel", "reason"]),

  metric("posts", "Published posts", COUNT, ["organic_social"], "Owned social posts published.", "day", ["platform", "content_type", "campaign"]),
  metric("reach", "Organic reach", COUNT, ["organic_social"], "Unique accounts reached by owned content.", "day", ["platform", "content_id"]),
  metric("impressions", "Impressions", COUNT, ["organic_social", "paid_media"], "Content or ad impressions.", "day", ["platform", "campaign", "content_id"]),
  metric("clicks", "Clicks", COUNT, ["organic_social", "paid_media"], "Content or ad clicks.", "day", ["platform", "campaign", "content_id"]),
  metric("followers", "Followers", COUNT, ["organic_social"], "Follower snapshot.", "snapshot", ["platform", "account"]),

  metric("spend", "Media spend", CURRENCY, ["paid_media"], "Paid media investment.", "day", ["platform", "campaign", "ad_set", "ad"]),
  metric("ctr", "Click-through rate", RATIO, ["paid_media"], "Normalized click-through rate.", "day", ["platform", "campaign", "ad_set", "ad"], UNIT_INTERVAL),
  metric("cpc", "Cost per click", CURRENCY, ["paid_media"], "Paid cost per click.", "day", ["platform", "campaign", "ad_set", "ad"]),
  metric("cpm", "Cost per thousand impressions", CURRENCY, ["paid_media"], "Paid cost per one thousand impressions.", "day", ["platform", "campaign", "ad_set", "ad"]),
  metric("roas", "Return on ad spend", SCORE, ["paid_media"], "Revenue-to-spend multiple on the source scale.", "day", ["platform", "campaign", "ad_set", "ad"]),

  metric("customers", "Customers", COUNT, ["crm_marketing"], "Distinct customer profiles in the declared segment.", "month", ["segment", "market"]),
  metric("repeat_customers", "Repeat customers", COUNT, ["crm_marketing"], "Customers with a repeat purchase or declared repeat event.", "month", ["segment", "market"]),
  metric("retention_rate", "Retention rate", RATIO, ["crm_marketing"], "Normalized retained-customer rate.", "month", ["segment", "cohort"], UNIT_INTERVAL),
  metric("churn_rate", "Churn rate", RATIO, ["crm_marketing"], "Normalized churned-customer rate.", "month", ["segment", "cohort"], UNIT_INTERVAL),
  metric("email_clicks", "Email clicks", COUNT, ["crm_marketing"], "Email or lifecycle-message clicks.", "day", ["campaign", "segment", "channel"]),
  metric("email_opens", "Email opens", COUNT, ["crm_marketing"], "Email or lifecycle-message opens.", "day", ["campaign", "segment", "channel"]),
  metric("unsubscribes", "Unsubscribes", COUNT, ["crm_marketing"], "Email or lifecycle-message opt-outs.", "day", ["campaign", "segment", "channel"]),

  metric("reviews", "Reviews", COUNT, ["reviews_ratings"], "Post-purchase reviews or ratings submitted.", "day", ["platform", "product", "rating"]),
  metric("rating", "Rating", SCORE, ["reviews_ratings"], "Review rating on the declared source scale.", "day", ["platform", "product"]),
  metric("score", "Score", SCORE, ["reviews_ratings", "customer_service"], "Generic governed score on the declared source scale.", "day", ["score_type"]),

  metric("price", "Price", CURRENCY, ["pricing_inventory", "product_catalog"], "Product price at the effective snapshot or static catalog state.", "snapshot", ["product", "market", "channel"]),
  metric("stock", "Stock", COUNT, ["pricing_inventory"], "Available stock at a point in time.", "snapshot", ["product", "location", "channel"]),
  metric("inventory", "Inventory", COUNT, ["pricing_inventory"], "Inventory quantity at a point in time.", "snapshot", ["product", "location", "channel"]),
  metric("stockout", "Stockouts", COUNT, ["pricing_inventory"], "Stockout events or products without stock.", "day", ["product", "location", "channel"]),

  metric("share_of_voice", "Share of voice", RATIO, ["competitive_intelligence"], "Normalized share of category conversation.", "month", ["brand", "market", "channel"], UNIT_INTERVAL),
  metric("competitor_price", "Competitor price", CURRENCY, ["competitive_intelligence"], "Observed competitor price at a point in time.", "snapshot", ["brand", "product", "market", "channel"])
];

/**
 * Governed variants keep distinct commercial measures from collapsing into one
 * observation key. They intentionally describe business meaning, not source-system
 * column names, so Signal can compare the same measure across future connectors.
 */
export const DATA_OS_METRIC_VARIANTS: DataOsMetricVariantDefinition[] = [
  variant(
    "resolution_duration",
    "resolution_time",
    "Resolution duration",
    [
      "resolution_seconds",
      "resolution_minutes",
      "resolution_hours",
      "resolution_days",
      "resolution_duration_seconds",
      "resolution_duration_minutes",
      "resolution_duration_hours",
      "resolution_duration_days"
    ],
    ["customer_service"]
  ),
  variant(
    "supplier_suggested_retail_price",
    "price",
    "Supplier suggested retail price",
    ["precio_publico_sugerido_prov", "precio_publico_sugerido_proveedor", "supplier_suggested_retail_price", "supplier_suggested_price", "msrp"],
    ["product_catalog"]
  ),
  variant(
    "selling_price",
    "price",
    "Selling price",
    ["precio_venta", "precio_de_venta", "selling_price", "sale_price", "retail_price", "pvp"],
    ["product_catalog", "pricing_inventory"]
  ),
  variant(
    "supplier_cost_ex_tax",
    "cost",
    "Supplier cost excluding tax",
    ["costo_sin_iva_proveedor", "costo_sin_iva_prov", "supplier_cost_ex_tax", "supplier_cost_before_tax"],
    ["product_catalog"]
  ),
  variant(
    "unit_cost",
    "cost",
    "Unit cost",
    ["costo_unit", "costo_unitario", "unit_cost", "cost_per_unit"],
    ["product_catalog", "pricing_inventory", "ecommerce_sales"]
  ),
  variant(
    "net_cost_after_rebates",
    "cost",
    "Net cost after rebates",
    ["costo_con_backs", "costo_con_back", "net_cost_after_rebates", "net_cost_after_backend_rebates"],
    ["product_catalog"]
  ),
  variant(
    "front_margin",
    "margin",
    "Front margin",
    ["margen_front", "front_margin", "front_end_margin"],
    ["product_catalog"]
  ),
  variant(
    "final_margin",
    "margin",
    "Final margin",
    ["margen_final", "final_margin", "net_margin_after_rebates"],
    ["product_catalog"]
  )
];

const BY_FAMILY = new Map(DATA_OS_METRIC_DEFINITIONS.map((definition) => [definition.family, definition]));
const VARIANT_BY_KEY = new Map(DATA_OS_METRIC_VARIANTS.map((definition) => [definition.key, definition]));

export const DATA_OS_CANONICAL_METRIC_FAMILIES = DATA_OS_METRIC_DEFINITIONS.map((definition) => definition.family);

export function dataOsMetricDefinition(family: string | null | undefined) {
  return family ? BY_FAMILY.get(family) ?? null : null;
}

export function dataOsMetricUnit(family: string | null | undefined): DataOsMetricUnit | null {
  return dataOsMetricDefinition(family)?.unit ?? null;
}

export function dataOsMetricVariantDefinition(
  fieldName: string | null | undefined,
  family: string | null | undefined,
  datasetRole?: string | null
) {
  if (!fieldName || !family) return null;
  const normalizedField = normalizeMetricCatalogToken(fieldName);
  return DATA_OS_METRIC_VARIANTS.find((definition) => (
    definition.family === family
    && (!definition.datasetRoles || definition.datasetRoles.includes(datasetRole ?? ""))
    && definition.aliases.some((alias) => normalizeMetricCatalogToken(alias) === normalizedField)
  )) ?? null;
}

export function dataOsMetricVariantDefinitionByKey(key: string | null | undefined) {
  return key ? VARIANT_BY_KEY.get(key) ?? null : null;
}

export function isCanonicalDataOsMetricFamily(family: string | null | undefined): family is string {
  return Boolean(dataOsMetricDefinition(family));
}

export function dataOsMetricValueRangeIssue(
  family: string | null | undefined,
  value: number
): "metric_value_below_minimum" | "metric_value_above_maximum" | null {
  const range = dataOsMetricDefinition(family)?.validRange;
  if (!range) return null;
  if (range.min !== undefined && value < range.min) return "metric_value_below_minimum";
  if (range.max !== undefined && value > range.max) return "metric_value_above_maximum";
  return null;
}

function metric(
  family: string,
  name: string,
  unit: DataOsMetricUnit,
  domains: string[],
  description: string,
  defaultGrain: DataOsMetricDefinition["defaultGrain"],
  dimensions: string[],
  validRange?: DataOsMetricDefinition["validRange"]
): DataOsMetricDefinition {
  return validRange
    ? { family, name, unit, domains, description, defaultGrain, dimensions, validRange }
    : { family, name, unit, domains, description, defaultGrain, dimensions };
}

function variant(
  key: string,
  family: string,
  name: string,
  aliases: string[],
  datasetRoles?: string[]
): DataOsMetricVariantDefinition {
  return datasetRoles
    ? { key, family, name, aliases, datasetRoles }
    : { key, family, name, aliases };
}

function normalizeMetricCatalogToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
