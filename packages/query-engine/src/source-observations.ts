import { createHash } from "node:crypto";

import {
  dataOsMetricVariantDefinition,
  dataOsMetricValueRangeIssue,
  dataOsMetricUnit,
  type DataOsMetricUnit
} from "./data-os-metric-catalog";

export type SourceObservationFieldProfile = {
  name: string;
  semantic_type?: string;
  metric_role?: string;
  dimension_role?: string;
  field_type?: string;
};

export type SourceObservationDatasetInput = {
  datasetKey: string;
  datasetName: string;
  datasetRole?: string | null;
  fields?: SourceObservationFieldProfile[];
  records: Record<string, unknown>[];
};

export type SourceObservationPeriodSemantics = "measurement" | "event" | "snapshot" | "static" | "unknown";
export type SourceObservationQualityStatus = "accepted" | "needs_mapping_review" | "rejected";

export type SourceRecord = {
  datasetKey: string;
  datasetName: string;
  datasetRole: string | null;
  rowIndex: number;
  recordHash: string;
  periodStart: string | null;
  periodEnd: string | null;
  periodGrain: "day" | "week" | "month" | "year" | "unknown";
  periodSemantics: SourceObservationPeriodSemantics;
  entityType: string | null;
  entityKey: string | null;
  entityLabel: string | null;
  dimensions: Record<string, unknown>;
  rawRecord: Record<string, unknown>;
  lineage: Record<string, unknown>;
  qualityStatus: SourceObservationQualityStatus;
  qualityIssues: string[];
};

export type SourceObservation = {
  datasetKey: string;
  datasetName: string;
  datasetRole: string | null;
  rowIndex: number;
  recordHash: string;
  periodStart: string | null;
  periodEnd: string | null;
  periodGrain: "day" | "week" | "month" | "year" | "unknown";
  periodSemantics: SourceObservationPeriodSemantics;
  entityType: string | null;
  entityKey: string | null;
  entityLabel: string | null;
  metricKey: string;
  metricFamily: string;
  metricVariant: string;
  metricValue: string;
  metricUnit: DataOsMetricUnit;
  metricCurrencyCode: string | null;
  dimensions: Record<string, unknown>;
  rawRecord: Record<string, unknown>;
  lineage: Record<string, unknown>;
  qualityStatus: SourceObservationQualityStatus;
  qualityIssues: string[];
};

export type MaterializeSourceObservationsArgs = {
  sourceName: string;
  datasets: SourceObservationDatasetInput[];
  maxRowsPerDataset?: number;
  defaultCurrencyCode?: string | null;
};

export type MaterializeSourceRecordsArgs = MaterializeSourceObservationsArgs;

const SNAPSHOT_FAMILIES = new Set([
  "price",
  "competitor_price",
  "cost",
  "margin",
  "discount",
  "stock",
  "inventory",
  "followers"
]);

const PRODUCT_ID_FIELDS = [
  "sku",
  "sku_prov",
  "sku_proveedor",
  "sku_hills",
  "ean",
  "ean_pieza",
  "ean_piece",
  "ean_caja",
  "ean_case",
  "upc",
  "gtin",
  "product_id",
  "producto_id",
  "variant_id",
  "inventory_item_id",
  "codigobind",
  "codigo_bind",
  "codigo_producto",
  "codigo_de_producto"
];

const TRANSACTION_ID_FIELDS = [
  "order_id",
  "order_number",
  "orden_id",
  "pedido_id",
  "transaction_id",
  "payment_id",
  "invoice_id"
];
const CANONICAL_DATASET_ROLES = [
  "social_listening",
  "ecommerce_sales",
  "product_catalog",
  "web_analytics",
  "search_demand",
  "customer_service",
  "organic_social",
  "paid_media",
  "crm_marketing",
  "reviews_ratings",
  "pricing_inventory",
  "competitive_intelligence",
  "uploaded_context"
] as const;

const TEMPORAL_DATASET_ROLES = new Set([
  "social_listening",
  "ecommerce_sales",
  "web_analytics",
  "search_demand",
  "customer_service",
  "organic_social",
  "paid_media",
  "crm_marketing",
  "reviews_ratings",
  "pricing_inventory",
  "competitive_intelligence"
]);

export function buildSourceRecords(args: MaterializeSourceRecordsArgs): SourceRecord[] {
  const maxRowsPerDataset = args.maxRowsPerDataset ?? Number.POSITIVE_INFINITY;
  const records: SourceRecord[] = [];

  for (const dataset of args.datasets) {
    const fields = dataset.fields ?? inferFieldsFromRecords(dataset.records);
    const datasetRole = normalizeDatasetRole(dataset.datasetRole) ?? inferSourceDatasetRole({
      datasetName: dataset.datasetName,
      fieldNames: fields.map((field) => field.name),
      metricFamilies: fields.map((field) => inferSourceMetricFamily(field.metric_role ?? field.name))
    });
    const hasPeriodField = fields.some(isPeriodField);

    const effectiveRows = inheritMergedPeriodCells(dataset.records.slice(0, maxRowsPerDataset), fields);
    for (const [rowIndex, { rawRow, effectiveRow, inheritedFields }] of effectiveRows.entries()) {
      const period = inferPeriod(effectiveRow, fields);
      const entity = inferEntity(rawRow, fields);
      const periodSemantics = inferRecordPeriodSemantics(datasetRole, period.grain);
      const qualityIssues = evaluateRecordQuality({
        row: rawRow,
        datasetRole,
        hasPeriodField,
        periodGrain: period.grain,
        entityType: entity.type,
        entityKey: entity.key
      });

      records.push({
        datasetKey: dataset.datasetKey,
        datasetName: dataset.datasetName,
        datasetRole,
        rowIndex,
        recordHash: hashSourceRecord(dataset.datasetKey, rowIndex, rawRow),
        periodStart: period.start,
        periodEnd: period.end,
        periodGrain: period.grain,
        periodSemantics,
        entityType: entity.type,
        entityKey: entity.key,
        entityLabel: entity.label,
        dimensions: buildDimensions(rawRow, fields, datasetRole),
        rawRecord: rawRow,
        lineage: {
          source_name: args.sourceName,
          dataset_key: dataset.datasetKey,
          dataset_name: dataset.datasetName,
          dataset_role: datasetRole,
          row_index: rowIndex,
          inferred_period_grain: period.grain,
          period_inference: inheritedFields.length > 0 ? "dataset_forward_fill" : "row_value",
          inherited_period_fields: inheritedFields,
          period_semantics: periodSemantics,
          entity_source_field: entity.sourceField,
          canonical_target: "data_asset_records"
        },
        qualityStatus: qualityStatusForRecordIssues(qualityIssues),
        qualityIssues
      });
    }
  }

  return records;
}

export function buildSourceObservations(args: MaterializeSourceObservationsArgs): SourceObservation[] {
  const maxRowsPerDataset = args.maxRowsPerDataset ?? 5000;
  const observations: SourceObservation[] = [];

  for (const dataset of args.datasets) {
    const fields = dataset.fields ?? inferFieldsFromRecords(dataset.records);
    const datasetRole = normalizeDatasetRole(dataset.datasetRole) ?? inferSourceDatasetRole({
      datasetName: dataset.datasetName,
      fieldNames: fields.map((field) => field.name),
      metricFamilies: fields.map((field) => inferSourceMetricFamily(field.metric_role ?? field.name))
    });
    const metricFieldCandidates = fields
      .map((field) => ({ field, family: inferSourceMetricFamily(field.metric_role ?? field.name, datasetRole) }))
      .filter((item): item is { field: SourceObservationFieldProfile; family: string } => Boolean(item.family));
    const metricFamilyCounts = new Map<string, number>();
    for (const { family } of metricFieldCandidates) {
      metricFamilyCounts.set(family, (metricFamilyCounts.get(family) ?? 0) + 1);
    }
    const metricFields = metricFieldCandidates.map(({ field, family }) => {
      const governedVariant = dataOsMetricVariantDefinition(field.name, family, datasetRole);
      const requiresSourceFieldVariant = !governedVariant && (metricFamilyCounts.get(family) ?? 0) > 1;
      return {
        field,
        family,
        variant: governedVariant?.key ?? (requiresSourceFieldVariant ? `${family}_${normalizeKey(field.name)}` : family),
        variantInference: governedVariant
          ? "metric_variant_catalog"
          : requiresSourceFieldVariant
            ? "source_field_fallback"
            : "canonical_family",
        variantIssues: requiresSourceFieldVariant ? ["metric_variant_requires_catalog_review"] : []
      };
    });
    if (metricFields.length === 0) continue;

    const effectiveRows = inheritMergedPeriodCells(dataset.records.slice(0, maxRowsPerDataset), fields);
    const defaultCurrencyCode = normalizeCurrencyCode(args.defaultCurrencyCode);
    for (const [rowIndex, { rawRow, effectiveRow, inheritedFields }] of effectiveRows.entries()) {
      const period = inferPeriod(effectiveRow, fields);
      const entity = inferEntity(rawRow, fields);
      const dimensions = buildDimensions(rawRow, fields, datasetRole);

      for (const { field: metricField, family, variant, variantInference, variantIssues } of metricFields) {
        const rawValue = valueForField(rawRow, metricField.name);
        const parsed = parseMetricValue(rawValue, family, metricField.name);
        if (parsed.value === null) continue;

        const periodSemantics = inferPeriodSemantics(
          family,
          period.grain,
          datasetRole
        );
        const metricKey = canonicalSourceMetricKey(variant, period.grain, periodSemantics);
        const metricUnit = metricUnitForFamily(family);
        const detectedCurrencyCode = metricUnit === "currency"
          ? inferCurrencyCode(rawRow, fields, `${args.sourceName} ${dataset.datasetName} ${metricField.name}`)
          : null;
        const metricCurrencyCode = detectedCurrencyCode ?? (metricUnit === "currency" ? defaultCurrencyCode : null);
        const qualityIssues = evaluateObservationQuality({
          family,
          metricUnit,
          metricCurrencyCode,
          metricValue: parsed.value,
          periodStart: period.start,
          periodSemantics,
          parsedIssues: [...parsed.issues, ...variantIssues]
        });
        const qualityStatus = qualityStatusForIssues(qualityIssues);

        observations.push({
          datasetKey: dataset.datasetKey,
          datasetName: dataset.datasetName,
          datasetRole,
          rowIndex,
          recordHash: hashRecord(dataset.datasetKey, rowIndex, metricKey, rawRow),
          periodStart: period.start,
          periodEnd: period.end,
          periodGrain: period.grain,
          periodSemantics,
          entityType: entity.type,
          entityKey: entity.key,
          entityLabel: entity.label,
          metricKey,
          metricFamily: family,
          metricVariant: variant,
          metricValue: String(parsed.value),
          metricUnit,
          metricCurrencyCode,
          dimensions,
          rawRecord: rawRow,
          lineage: {
            source_name: args.sourceName,
            dataset_key: dataset.datasetKey,
            dataset_name: dataset.datasetName,
            dataset_role: datasetRole,
            row_index: rowIndex,
            source_field: metricField.name,
            inferred_metric_family: family,
            metric_variant: variant,
            metric_variant_inference: variantInference,
            entity_source_field: entity.sourceField,
            inferred_period_grain: period.grain,
            period_inference: inheritedFields.length > 0 ? "dataset_forward_fill" : "row_value",
            inherited_period_fields: inheritedFields,
            period_semantics: periodSemantics,
            value_normalization: parsed.normalization,
            currency_inference: metricUnit !== "currency"
              ? "not_applicable"
              : detectedCurrencyCode
                ? "source_value_or_label"
                : metricCurrencyCode
                  ? "market_default"
                  : "unresolved"
          },
          qualityStatus,
          qualityIssues
        });
      }
    }
  }

  return observations;
}

export function inferSourceMetricFamily(value: string | null | undefined, datasetRole?: string | null) {
  const normalized = normalizeToken(value ?? "");
  const role = normalizeDatasetRole(datasetRole);
  if (!normalized) return null;

  // Identifiers belong in entity/dimension columns. Treating order_id or ticket_id as
  // numeric measures silently inflates every downstream total.
  if (isIdentifierField(normalized)) return null;

  // Compound business terms must win before generic words such as ticket, order or volume.
  if (matchesAlias(normalized, ["aov", "ticket_promedio", "ticket_medio", "average_ticket", "average_order_value", "avg_order_value"])) return "average_order_value";
  if (matchesAlias(normalized, ["search_volume", "volumen_busqueda", "volumen_de_busqueda", "query_count", "keyword_volume"])) return "search_volume";
  if (matchesAlias(normalized, ["share_of_voice", "sov", "participacion_conversacion"])) return "share_of_voice";
  if (matchesAlias(normalized, ["share_of_search", "sos", "participacion_busqueda"])) return "share_of_search";
  if (matchesAlias(normalized, ["conversion_rate", "cvr", "tasa_conversion", "tasa_de_conversion", "conversionrate"])) return "conversion_rate";
  if (matchesAlias(normalized, ["click_through_rate", "clickthrough_rate", "ctr", "tasa_click", "tasa_de_clicks"])) return "ctr";
  if (matchesAlias(normalized, ["cost_per_click", "cpc", "costo_por_click", "costo_por_clic"])) return "cpc";
  if (matchesAlias(normalized, ["cost_per_mille", "cost_per_thousand", "cpm", "costo_por_mil"])) return "cpm";
  if (matchesAlias(normalized, ["return_on_ad_spend", "roas", "retorno_inversion_publicitaria"])) return "roas";
  if (matchesAlias(normalized, ["product_view", "product_views", "view_item", "vistas_producto", "views_producto"])) return "product_views";
  if (matchesAlias(normalized, ["page_view", "page_views", "screen_view", "screen_views", "vistas_pagina", "vistas_de_pagina"])) return "page_views";
  if (matchesAlias(normalized, ["add_to_cart", "addtocart", "agregar_carrito", "agregados_carrito"])) return "add_to_cart";
  if (matchesAlias(normalized, ["begin_checkout", "inicio_checkout", "checkouts", "checkout"])) return "checkout";
  if (matchesAlias(normalized, ["support_ticket", "support_tickets", "tickets", "casos_soporte", "customer_service_cases"])) return "support_tickets";
  if (matchesAlias(normalized, ["resolution_time", "resolution_minutes", "resolution_hours", "average_resolution_time", "first_resolution_time", "tiempo_resolucion", "tiempo_de_resolucion", "duracion_resolucion"])) return "resolution_time";
  if (matchesAlias(normalized, ["customer_satisfaction", "customer_satisfaction_score", "csat", "nps", "satisfaccion_cliente", "satisfaccion_del_cliente"])) return "customer_satisfaction";

  // In product masters, "precio venta" is the selling price, not a completed sale.
  if (matchesAlias(normalized, ["precio_venta", "precio_de_venta", "selling_price", "sale_price", "retail_price", "pvp"])) {
    return role === "competitive_intelligence" ? "competitor_price" : "price";
  }
  if (matchesAlias(normalized, ["venta_a_costo", "sales_cost", "cost_of_sales", "cost_of_goods_sold", "cogs", "costo_venta", "costo_de_venta", "cost", "costs", "costo", "costos"])) return "cost";
  if (matchesAlias(normalized, ["gross_profit", "net_profit", "operating_profit", "profit", "profits", "utilidad", "utilidades", "ganancia", "ganancias"])) return "profit";
  if (matchesAlias(normalized, ["revenue", "ingreso", "ingresos"])) return "revenue";
  if (matchesAlias(normalized, ["venta", "ventas", "sales", "gmv", "sellout", "sell_out", "venta_real"])) return "sales";
  if (matchesAlias(normalized, ["unit", "units", "unidades", "qty", "quantity", "cantidad_vendida", "items_sold", "piezas_vendidas"])) return "units";
  if (matchesAlias(normalized, ["order", "orders", "orden", "ordenes", "pedido", "pedidos", "purchase", "purchases", "compras"])) return "orders";
  if (matchesAlias(normalized, ["discount_rate", "discount_pct", "discount_percentage", "tasa_descuento", "porcentaje_descuento"])) return "discount_rate";
  if (matchesAlias(normalized, ["refund_rate", "tasa_reembolso", "porcentaje_reembolso"])) return "refund_rate";
  if (matchesAlias(normalized, ["return_rate", "returns_rate", "tasa_devolucion", "porcentaje_devolucion"])) return "return_rate";
  if (matchesAlias(normalized, ["refund_amount", "refund_value", "reembolso_importe", "monto_reembolso", "importe_reembolso"])) return "refund_amount";
  if (matchesAlias(normalized, ["discount", "discounts", "descuento", "descuentos", "promo", "promocion"])) return "discount";
  if (matchesAlias(normalized, ["return", "returns", "refund", "refunds", "devolucion", "devoluciones", "reembolso", "reembolsos"])) return "returns";
  if (matchesAlias(normalized, ["margen", "margin", "gross_margin", "margen_porcentaje", "margin_rate"])) return "margin";
  if (matchesAlias(normalized, ["position", "posicion", "ranking", "rank", "average_position"])) return "search_position";
  if (matchesAlias(normalized, ["mention", "mentions", "mencion", "menciones", "mention_count", "social_volume"])) return "mentions";
  if (matchesAlias(normalized, ["sentiment", "sentimiento", "sentiment_score", "polaridad"])) return "sentiment";
  if (matchesAlias(normalized, ["session", "sessions", "sesion", "sesiones", "visits", "visitas"])) return "sessions";
  if (matchesAlias(normalized, ["user", "users", "usuario", "usuarios", "active_users", "unique_users"])) return "users";
  if (matchesAlias(normalized, ["spend", "inversion", "inversiones", "gasto", "ad_spend", "media_spend"])) return "spend";
  if (matchesAlias(normalized, ["reach", "alcance", "accounts_reached", "cuentas_alcanzadas"])) return "reach";
  if (matchesAlias(normalized, ["impression", "impressions", "impresiones"])) return role === "search_demand" ? "search_impressions" : "impressions";
  if (matchesAlias(normalized, ["click", "clicks", "clic", "clics"])) {
    if (role === "search_demand") return "search_clicks";
    if (role === "crm_marketing") return "email_clicks";
    return "clicks";
  }
  if (matchesAlias(normalized, ["like", "likes", "reaction", "reactions", "reaccion", "reacciones"])) return "likes";
  if (matchesAlias(normalized, ["comment", "comments", "comentario", "comentarios"])) return "comments";
  if (matchesAlias(normalized, ["share", "shares", "compartido", "compartidos"])) return "shares";
  if (matchesAlias(normalized, ["save", "saves", "guardado", "guardados"])) return "saves";
  if (matchesAlias(normalized, ["engagement", "interactions", "interacciones", "interaction", "interaccion"])) return "engagement";
  if (matchesAlias(normalized, ["conversion", "conversions", "conversiones"])) return "conversions";
  if (matchesAlias(normalized, ["post", "posts", "publicacion", "publicaciones", "published_posts"])) return "posts";
  if (matchesAlias(normalized, ["follower", "followers", "seguidores", "audience_size"])) return "followers";
  if (matchesAlias(normalized, ["customer", "customers", "cliente", "clientes", "customer_count"])) return "customers";
  if (matchesAlias(normalized, ["repeat_customer", "repeat_customers", "clientes_recurrentes", "clientes_recompra", "recompradores"])) return "repeat_customers";
  if (matchesAlias(normalized, ["retention_rate", "tasa_retencion", "retained_rate"])) return "retention_rate";
  if (matchesAlias(normalized, ["churn_rate", "tasa_churn", "tasa_abandono", "attrition_rate"])) return "churn_rate";
  if (matchesAlias(normalized, ["email_click", "email_clicks", "clicks_email", "clics_email"])) return "email_clicks";
  if (matchesAlias(normalized, ["open", "opens", "apertura", "aperturas", "email_opens"])) return "email_opens";
  if (matchesAlias(normalized, ["unsubscribe", "unsubscribes", "baja", "bajas"])) return "unsubscribes";
  if (matchesAlias(normalized, ["review", "reviews", "resena", "resenas"])) return "reviews";
  if (matchesAlias(normalized, ["rating", "calificacion", "estrellas", "stars"])) return "rating";
  if (matchesAlias(normalized, ["score", "puntaje", "indice", "index"])) return "score";
  if (matchesAlias(normalized, ["competitor_price", "competitive_price", "precio_competidor", "precio_de_competencia"])) return "competitor_price";
  if (matchesAlias(normalized, ["price", "precio", "pricing", "precio_lista", "list_price", "unit_price"])) return role === "competitive_intelligence" ? "competitor_price" : "price";
  if (matchesAlias(normalized, ["stockout", "stockouts", "out_of_stock", "sin_stock", "agotado", "agotados", "quiebre_stock"])) return "stockout";
  if (matchesAlias(normalized, ["inventory", "inventario"])) return "inventory";
  if (matchesAlias(normalized, ["stock", "available", "disponible", "availability", "on_hand"])) return "stock";
  return null;
}

export function inferSourceDatasetRole(args: {
  datasetName: string;
  fieldNames: string[];
  metricFamilies?: Array<string | null | undefined>;
}) {
  const text = normalizeToken(`${args.datasetName} ${args.fieldNames.join(" ")}`);
  const fieldNames = args.fieldNames.map(normalizeToken);
  const metrics = new Set((args.metricFamilies ?? args.fieldNames.map((field) => inferSourceMetricFamily(field))).filter(Boolean));
  const hasProductIdentity = fieldNames.some((field) => PRODUCT_ID_FIELDS.includes(field));
  const hasTransactionIdentity = fieldNames.some((field) => TRANSACTION_ID_FIELDS.includes(field));
  const hasPeriod = fieldNames.some((field) => isPeriodFieldName(field));
  const hasProductAttributes = fieldNames.some((field) => matchesAlias(field, [
    "descripcion",
    "description",
    "product_name",
    "producto",
    "marca",
    "brand",
    "categoria",
    "category",
    "supercategoria",
    "subcategoria",
    "proveedor"
  ]));
  const hasTransactionalActivity = [
    "sales",
    "revenue",
    "orders",
    "units",
    "returns",
    "refund_amount",
    "return_rate",
    "refund_rate"
  ].some((metric) => metrics.has(metric));

  // Provider and dataset anchors disambiguate fields such as clicks, impressions and
  // revenue before generic metric families are considered.
  if (matchesAlias(text, ["social_listening", "sentione", "brandwatch", "talkwalker", "meltwater", "sprinklr_listening", "mentions_export"])) return "social_listening";
  if (matchesAlias(text, ["google_search_console", "search_console", "gsc", "keyword_planner", "google_trends", "searchbuzz", "semrush", "ahrefs", "keyword_research", "share_of_search"])) return "search_demand";
  if (matchesAlias(text, ["ga4", "google_analytics", "web_analytics", "website_funnel", "site_performance", "web_performance"])) return "web_analytics";
  if (matchesAlias(text, ["zendesk", "gorgias", "freshdesk", "intercom", "customer_service", "customer_support", "call_center", "whatsapp_support"])) return "customer_service";
  if (matchesAlias(text, ["meta_ads", "facebook_ads", "google_ads", "tiktok_ads", "paid_media", "media_spend", "campaign_performance"])) return "paid_media";
  if (matchesAlias(text, ["meta_organic", "instagram_organic", "facebook_organic", "tiktok_organic", "organic_social", "owned_social", "social_performance"])) return "organic_social";
  if (matchesAlias(text, ["klaviyo", "braze", "mailchimp", "customer_io", "crm_marketing", "email_marketing", "sms_marketing", "lifecycle_marketing"])) return "crm_marketing";
  if (matchesAlias(text, ["reviews", "ratings", "trustpilot", "yotpo", "bazaarvoice", "app_store_reviews", "google_business_reviews"])) return "reviews_ratings";
  if (matchesAlias(text, ["product_catalog", "catalogo_producto", "catalogo_de_producto", "catalog", "catalogo", "master_products", "maestro_productos"])) return "product_catalog";
  if (matchesAlias(text, ["shopify", "vtex", "woocommerce", "magento", "adobe_commerce", "ecommerce_sales", "sales_performance", "order_export", "ventas_ecommerce"])) return "ecommerce_sales";
  if (matchesAlias(text, ["competitive_intelligence", "competitor_pricing", "benchmark_competitivo", "claims_competencia"])) return "competitive_intelligence";
  if (matchesAlias(text, ["pricing_inventory", "inventory_snapshot", "stock_snapshot", "price_snapshot", "promo_calendar"])) return "pricing_inventory";

  // Product masters often include cost, margin and selling price. Those columns describe
  // the product at capture time; without order/period activity they are not transactions.
  if (
    hasProductIdentity
    && hasProductAttributes
    && !hasTransactionIdentity
    && !hasPeriod
    && !hasTransactionalActivity
  ) return "product_catalog";

  // A transactional table can contain SKU/EAN fields and is still sales, not a product catalog.
  if (
    hasTransactionIdentity
    || hasTransactionalActivity
    || (["cost", "profit", "average_order_value"].some((metric) => metrics.has(metric)) && hasPeriod)
  ) return "ecommerce_sales";
  if (["sessions", "users", "page_views", "product_views", "add_to_cart", "checkout", "conversion_rate"].some((metric) => metrics.has(metric))) return "web_analytics";
  if (metrics.has("mentions") || metrics.has("sentiment")) return "social_listening";
  if (["search_volume", "search_position", "share_of_search", "search_clicks", "search_impressions"].some((metric) => metrics.has(metric))) return "search_demand";
  if (["support_tickets", "resolution_time", "customer_satisfaction"].some((metric) => metrics.has(metric))) return "customer_service";
  if (["spend", "ctr", "cpc", "cpm", "roas"].some((metric) => metrics.has(metric))) return "paid_media";
  if (["posts", "likes", "comments", "shares", "saves", "engagement", "reach", "followers"].some((metric) => metrics.has(metric))) return "organic_social";
  if (["customers", "repeat_customers", "retention_rate", "churn_rate", "email_clicks", "email_opens", "unsubscribes"].some((metric) => metrics.has(metric))) return "crm_marketing";
  if (["reviews", "rating"].some((metric) => metrics.has(metric))) return "reviews_ratings";
  if (matchesAlias(text, ["crm", "email", "sms", "klaviyo", "hubspot", "braze", "mailchimp", "cohort", "segment"])) return "crm_marketing";
  if (["share_of_voice", "competitor_price"].some((metric) => metrics.has(metric)) || matchesAlias(text, ["competitor", "competidor", "benchmark", "claims", "share_of_voice"])) return "competitive_intelligence";
  if (hasProductIdentity || matchesAlias(text, ["sku", "product_id", "producto_id", "catalog", "catalogo", "ean", "upc", "variant", "inventory_item"])) return "product_catalog";
  if (["price", "stock", "inventory", "stockout", "discount"].some((metric) => metrics.has(metric))) return "pricing_inventory";
  return "uploaded_context";
}

function normalizeDatasetRole(value: string | null | undefined): string | null {
  const normalized = normalizeToken(value ?? "");
  if (!normalized) return null;
  if ((CANONICAL_DATASET_ROLES as readonly string[]).includes(normalized)) return normalized;

  const aliases: Record<string, string> = {
    listening: "social_listening",
    listening_data: "social_listening",
    mentions: "social_listening",
    sales: "ecommerce_sales",
    sales_performance: "ecommerce_sales",
    ecommerce: "ecommerce_sales",
    orders: "ecommerce_sales",
    catalog: "product_catalog",
    catalogo: "product_catalog",
    product_master: "product_catalog",
    ga4: "web_analytics",
    website: "web_analytics",
    funnel: "web_analytics",
    search: "search_demand",
    keywords: "search_demand",
    search_console: "search_demand",
    support: "customer_service",
    tickets: "customer_service",
    social_organic: "organic_social",
    meta_organic: "organic_social",
    ads: "paid_media",
    media: "paid_media",
    crm: "crm_marketing",
    email: "crm_marketing",
    reviews: "reviews_ratings",
    ratings: "reviews_ratings",
    inventory: "pricing_inventory",
    pricing: "pricing_inventory",
    competition: "competitive_intelligence",
    competitors: "competitive_intelligence"
  };
  return aliases[normalized] ?? normalized;
}

function inferFieldsFromRecords(records: Record<string, unknown>[]): SourceObservationFieldProfile[] {
  return Array.from(new Set(records.flatMap((record) => Object.keys(record)))).map((name) => ({ name }));
}

export function canonicalSourceMetricKey(
  metricVariant: string,
  grain: SourceObservation["periodGrain"],
  semantics: SourceObservationPeriodSemantics
) {
  if (semantics === "snapshot") return `${metricVariant}_snapshot`;
  if (semantics === "static") return `${metricVariant}_static`;
  const suffix = metricGrainSuffix(grain);
  return `${metricVariant}_${suffix}`;
}

function metricGrainSuffix(grain: SourceObservation["periodGrain"]) {
  if (grain === "day") return "daily";
  if (grain === "week") return "weekly";
  if (grain === "month") return "monthly";
  if (grain === "year") return "yearly";
  return "observed";
}

function metricUnitForFamily(family: string): SourceObservation["metricUnit"] {
  return dataOsMetricUnit(family) ?? "count";
}

function inferPeriodSemantics(
  family: string,
  grain: SourceObservation["periodGrain"],
  datasetRole: string | null
): SourceObservationPeriodSemantics {
  if (grain === "unknown" && datasetRole === "product_catalog") {
    return SNAPSHOT_FAMILIES.has(family) ? "unknown" : "static";
  }
  if (grain === "unknown") return "unknown";
  if (
    SNAPSHOT_FAMILIES.has(family)
    && ["product_catalog", "pricing_inventory", "competitive_intelligence"].includes(datasetRole ?? "")
  ) return "snapshot";
  if (["price", "competitor_price", "stock", "inventory", "followers"].includes(family)) return "snapshot";
  return grain === "day" ? "event" : "measurement";
}

function inferRecordPeriodSemantics(
  datasetRole: string | null,
  grain: SourceRecord["periodGrain"]
): SourceObservationPeriodSemantics {
  if (grain === "unknown" && datasetRole === "product_catalog") return "static";
  if (grain === "unknown") return "unknown";
  if (datasetRole === "pricing_inventory" || datasetRole === "product_catalog") return "snapshot";
  return grain === "day" ? "event" : "measurement";
}

function evaluateRecordQuality(args: {
  row: Record<string, unknown>;
  datasetRole: string | null;
  hasPeriodField: boolean;
  periodGrain: SourceRecord["periodGrain"];
  entityType: string | null;
  entityKey: string | null;
}) {
  const issues: string[] = [];
  const hasValue = Object.values(args.row).some((value) => cleanString(value) !== "");
  if (!hasValue) issues.push("empty_record");
  if (args.datasetRole === "product_catalog" && (!args.entityKey || args.entityType !== "product")) {
    issues.push("catalog_identity_missing");
  }
  if (args.hasPeriodField && args.periodGrain === "unknown") issues.push("period_unparseable");
  if (
    args.datasetRole
    && TEMPORAL_DATASET_ROLES.has(args.datasetRole)
    && !args.hasPeriodField
  ) issues.push("period_field_missing");
  return Array.from(new Set(issues));
}

function qualityStatusForRecordIssues(issues: string[]): SourceObservationQualityStatus {
  if (issues.includes("empty_record")) return "rejected";
  if (issues.length > 0) return "needs_mapping_review";
  return "accepted";
}

function parseMetricValue(value: unknown, family: string, fieldName: string) {
  const original = cleanString(value);
  const hasPercentSign = original.includes("%");
  const unit = dataOsMetricUnit(family);

  if (unit === "duration_seconds") {
    return parseDurationSeconds(value, fieldName);
  }

  const numeric = parseNumericValue(value);
  if (numeric === null) return { value: null, normalization: "unparseable", issues: [] as string[] };

  if (unit !== "ratio") {
    return { value: numeric, normalization: "numeric", issues: [] as string[] };
  }

  if (hasPercentSign) {
    return { value: numeric / 100, normalization: "percent_to_ratio", issues: [] as string[] };
  }
  if (Math.abs(numeric) > 1 && Math.abs(numeric) <= 100) {
    return {
      value: numeric / 100,
      normalization: "inferred_percent_to_ratio",
      issues: ["ratio_scale_inferred_from_0_100"]
    };
  }
  return { value: numeric, normalization: "ratio", issues: [] as string[] };
}

function parseDurationSeconds(value: unknown, fieldName: string) {
  const original = cleanString(value).toLowerCase();
  if (!original) return { value: null, normalization: "unparseable", issues: [] as string[] };

  const clock = original.match(/^(-?\d{1,3}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?$/);
  if (clock) {
    const hours = clock[3] ? Number(clock[1]) : 0;
    const minutes = clock[3] ? Number(clock[2]) : Number(clock[1]);
    const seconds = Number((clock[3] ?? clock[2] ?? "0").replace(",", "."));
    const sign = hours < 0 || minutes < 0 ? -1 : 1;
    return {
      value: sign * (Math.abs(hours) * 3600 + Math.abs(minutes) * 60 + Math.abs(seconds)),
      normalization: clock[3] ? "hh_mm_ss_to_seconds" : "mm_ss_to_seconds",
      issues: [] as string[]
    };
  }

  const explicitParts = Array.from(original.matchAll(/(-?\d+(?:[.,]\d+)?)\s*(milliseconds?|millisecond|ms|seconds?|secs?|segundos?|segs?|s|minutos?|minutes?|mins?|min|m|hours?|hrs?|horas?|h|days?|dias?|días?|d)\b/g));
  if (explicitParts.length > 0) {
    const seconds = explicitParts.reduce((total, part) => {
      const numeric = Number((part[1] ?? "0").replace(",", "."));
      const suffix = part[2] ?? "";
      if (/^(?:milliseconds?|millisecond|ms)$/.test(suffix)) return total + numeric / 1000;
      if (/^(?:seconds?|secs?|segundos?|segs?|s)$/.test(suffix)) return total + numeric;
      if (/^(?:minutos?|minutes?|mins?|min|m)$/.test(suffix)) return total + numeric * 60;
      if (/^(?:hours?|hrs?|horas?|h)$/.test(suffix)) return total + numeric * 3600;
      return total + numeric * 86400;
    }, 0);
    return { value: seconds, normalization: "explicit_duration_to_seconds", issues: [] as string[] };
  }

  const numeric = parseNumericValue(value);
  if (numeric === null) return { value: null, normalization: "unparseable", issues: [] as string[] };
  const normalizedField = normalizeToken(fieldName);
  if (matchesAlias(normalizedField, ["milliseconds", "millisecond", "duration_ms", "resolution_ms"])) {
    return { value: numeric / 1000, normalization: "milliseconds_to_seconds", issues: [] as string[] };
  }
  if (matchesAlias(normalizedField, ["seconds", "second", "duration_seconds", "resolution_seconds", "resolution_secs"])) {
    return { value: numeric, normalization: "seconds", issues: [] as string[] };
  }
  if (matchesAlias(normalizedField, ["minutes", "minute", "duration_minutes", "resolution_minutes", "resolution_mins"])) {
    return { value: numeric * 60, normalization: "minutes_to_seconds", issues: [] as string[] };
  }
  if (matchesAlias(normalizedField, ["hours", "hour", "duration_hours", "resolution_hours", "resolution_hrs"])) {
    return { value: numeric * 3600, normalization: "hours_to_seconds", issues: [] as string[] };
  }
  if (matchesAlias(normalizedField, ["days", "day", "duration_days", "resolution_days"])) {
    return { value: numeric * 86400, normalization: "days_to_seconds", issues: [] as string[] };
  }
  return {
    value: numeric,
    normalization: "duration_unit_unresolved",
    issues: ["duration_unit_missing"]
  };
}

function evaluateObservationQuality(args: {
  family: string;
  metricUnit: SourceObservation["metricUnit"];
  metricCurrencyCode: string | null;
  metricValue: number;
  periodStart: string | null;
  periodSemantics: SourceObservationPeriodSemantics;
  parsedIssues: string[];
}) {
  const issues = [...args.parsedIssues];
  if (args.metricUnit === "currency" && !args.metricCurrencyCode) issues.push("currency_code_missing");
  if (args.periodSemantics === "unknown") issues.push("measurement_period_missing");
  const rangeIssue = dataOsMetricValueRangeIssue(args.family, args.metricValue);
  if (rangeIssue) issues.push(rangeIssue);
  if (args.metricUnit === "count" && args.metricValue < 0 && args.family !== "returns") issues.push("negative_count");
  if (args.metricUnit === "duration_seconds" && args.metricValue < 0) issues.push("negative_duration");
  if (!Number.isFinite(args.metricValue)) issues.push("non_finite_metric_value");
  if (
    !args.periodStart
    && SNAPSHOT_FAMILIES.has(args.family)
    && args.periodSemantics !== "static"
  ) issues.push("snapshot_date_missing");
  return Array.from(new Set(issues));
}

function qualityStatusForIssues(issues: string[]): SourceObservationQualityStatus {
  if (issues.some((issue) => ["metric_value_below_minimum", "metric_value_above_maximum", "negative_count", "negative_duration", "non_finite_metric_value"].includes(issue))) return "rejected";
  if (issues.length > 0) return "needs_mapping_review";
  return "accepted";
}

function inferCurrencyCode(row: Record<string, unknown>, fields: SourceObservationFieldProfile[], sourceText: string) {
  const currencyField = findField(fields, ["currency", "currency_code", "moneda", "codigo_moneda", "código_moneda"]);
  const candidates = [currencyField ? valueForField(row, currencyField.name) : null, sourceText]
    .map((value) => cleanString(value).toUpperCase());
  for (const candidate of candidates) {
    const match = candidate.match(/(?:^|[^A-Z])(MXN|USD|EUR|COP|BRL|ARS|CLP|PEN|BOB|GTQ|CRC|UYU)(?:$|[^A-Z])/);
    if (match?.[1]) return match[1];
    if (/\bPESOS?\s+MEXICANOS?\b/.test(candidate)) return "MXN";
    if (/\bD[OÓ]LARES?\b/.test(candidate)) return "USD";
  }
  return null;
}

function normalizeCurrencyCode(value: string | null | undefined) {
  const normalized = cleanString(value).toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function matchesAlias(value: string, aliases: string[]) {
  const normalized = normalizeToken(value);
  const padded = `_${normalized}_`;
  return aliases.some((alias) => {
    const candidate = normalizeToken(alias);
    return normalized === candidate || padded.includes(`_${candidate}_`);
  });
}

function isIdentifierField(value: string) {
  if (["id", "uuid", "guid"].includes(value)) return true;
  if (/(?:^|_)(?:id|uuid|guid|key|code|codigo|numero|number|ref|reference)$/.test(value)) return true;
  return PRODUCT_ID_FIELDS.includes(value)
    || TRANSACTION_ID_FIELDS.includes(value)
    || matchesAlias(value, [
    "order_id",
    "order_number",
    "ticket_id",
    "ticket_number",
    "product_id",
    "customer_id",
    "user_id",
    "transaction_id",
    "payment_id",
    "invoice_id",
    "case_id",
    "sku",
    "ean",
    "upc"
  ]);
}

function inheritMergedPeriodCells(
  rows: Record<string, unknown>[],
  fields: SourceObservationFieldProfile[]
) {
  const yearField = findField(fields, ["ano", "anio", "año", "year"]);
  const monthField = findField(fields, ["mes", "month"]);
  let carriedYear: unknown = null;
  let carriedMonth: unknown = null;

  return rows.map((rawRow) => {
    const effectiveRow = { ...rawRow };
    const inheritedFields: string[] = [];

    if (yearField) {
      const currentYear = valueForField(rawRow, yearField.name);
      if (parseYear(currentYear)) {
        const previousYear = parseYear(carriedYear);
        carriedYear = currentYear;
        if (previousYear && previousYear !== parseYear(currentYear) && monthField) {
          const currentMonth = valueForField(rawRow, monthField.name);
          if (!parseMonth(currentMonth)) carriedMonth = null;
        }
      } else if (parseYear(carriedYear)) {
        effectiveRow[yearField.name] = carriedYear;
        inheritedFields.push(normalizeKey(yearField.name));
      }
    }

    if (monthField) {
      const currentMonth = valueForField(rawRow, monthField.name);
      if (parseMonth(currentMonth)) {
        carriedMonth = currentMonth;
      } else if (parseMonth(carriedMonth)) {
        effectiveRow[monthField.name] = carriedMonth;
        inheritedFields.push(normalizeKey(monthField.name));
      }
    }

    return { rawRow, effectiveRow, inheritedFields };
  });
}

function inferPeriod(row: Record<string, unknown>, fields: SourceObservationFieldProfile[]) {
  const yearField = findField(fields, ["ano", "anio", "año", "year"]);
  const monthField = findField(fields, ["mes", "month"]);
  const year = parseYear(yearField ? valueForField(row, yearField.name) : null);
  const month = parseMonth(monthField ? valueForField(row, monthField.name) : null);
  if (year && month) return monthPeriod(year, month);

  const dateField = fields.find((field) => matchesAlias(field.name, ["fecha", "date", "day", "dia", "event_date", "created_date"]));
  const dateValue = dateField ? parseDateLike(valueForField(row, dateField.name)) : null;
  if (dateValue) return { start: dateValue, end: dateValue, grain: "day" as const };

  const periodField = fields.find((field) => matchesAlias(field.name, ["period", "periodo", "month", "mes", "year_month"]));
  const periodValue = periodField ? parseYearMonth(valueForField(row, periodField.name)) : null;
  if (periodValue) return monthPeriod(periodValue.year, periodValue.month);

  return { start: null, end: null, grain: "unknown" as const };
}

function inferEntity(row: Record<string, unknown>, fields: SourceObservationFieldProfile[]) {
  const candidates = [
    { keys: PRODUCT_ID_FIELDS, type: "product" },
    { keys: ["url", "landing_page", "page", "pagina", "página", "screen"], type: "page" },
    { keys: ["query", "keyword", "termino", "término", "search_term", "consulta"], type: "search_query" },
    { keys: ["campaign", "campana", "campaña", "adset", "ad"], type: "campaign" },
    { keys: ["customer", "cliente", "user_id", "usuario"], type: "customer" },
    { keys: ["ticket_id", "case_id", "conversation_id", "chat_id"], type: "support_case" },
    { keys: ["brand", "marca"], type: "brand" },
    { keys: ["market", "mercado", "country", "pais", "país"], type: "market" },
    { keys: ["categoria", "categoría", "category", "supercategoria", "supercategoría"], type: "category" }
  ];
  for (const candidate of candidates) {
    for (const field of findFields(fields, candidate.keys)) {
      const value = cleanString(valueForField(row, field.name));
      if (isUsableIdentityValue(value)) {
        return { type: candidate.type, key: value, label: value, sourceField: field.name };
      }
    }
  }
  return { type: null, key: null, label: null, sourceField: null };
}

function buildDimensions(row: Record<string, unknown>, fields: SourceObservationFieldProfile[], datasetRole: string | null) {
  const dimensions: Record<string, unknown> = {};
  for (const field of fields) {
    if (inferSourceMetricFamily(field.metric_role ?? field.name, datasetRole)) continue;
    if (isPeriodField(field)) continue;
    const value = valueForField(row, field.name);
    if (value === null || value === undefined || value === "") continue;
    dimensions[normalizeKey(field.name)] = value;
  }
  return dimensions;
}

function isPeriodField(field: SourceObservationFieldProfile) {
  return isPeriodFieldName(field.name);
}

function isPeriodFieldName(value: string) {
  return matchesAlias(value, ["ano", "anio", "año", "year", "mes", "month", "fecha", "date", "day", "dia", "día", "period", "periodo", "week", "semana"]);
}

function findField(fields: SourceObservationFieldProfile[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeToken);
  return fields.find((field) => normalizedCandidates.includes(normalizeToken(field.name)));
}

function findFields(fields: SourceObservationFieldProfile[], candidates: string[]) {
  const fieldsByName = new Map(fields.map((field) => [normalizeToken(field.name), field]));
  return candidates
    .map((candidate) => fieldsByName.get(normalizeToken(candidate)))
    .filter((field): field is SourceObservationFieldProfile => Boolean(field));
}

function isUsableIdentityValue(value: string) {
  if (!value) return false;
  const normalized = normalizeToken(value);
  if (!normalized) return false;
  return ![
    "na",
    "n_a",
    "no_aplica",
    "not_applicable",
    "sin_dato",
    "sin_informacion",
    "null",
    "none",
    "undefined",
    "-"
  ].includes(normalized);
}

function valueForField(row: Record<string, unknown>, fieldName: string) {
  if (Object.prototype.hasOwnProperty.call(row, fieldName)) return row[fieldName];
  const normalized = normalizeToken(fieldName);
  const key = Object.keys(row).find((item) => normalizeToken(item) === normalized);
  return key ? row[key] : null;
}

function parseNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = cleanString(value)
    .replace(/[%$€£\s]/g, "")
    .replace(/\(([^)]+)\)/, "-$1")
    .replace(/,(?=\d{3}(?:\D|$))/g, "")
    .replace(/,(?=\d{1,2}$)/, ".");
  if (!clean || /^[-.]$/.test(clean)) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseYear(value: unknown) {
  const parsed = Number(cleanString(value).match(/\b(20\d{2}|19\d{2})\b/)?.[1] ?? "");
  return parsed >= 1900 && parsed <= 2100 ? parsed : null;
}

function parseMonth(value: unknown) {
  if (typeof value === "number" && value >= 1 && value <= 12) return Math.trunc(value);
  const clean = normalizeToken(cleanString(value));
  const numeric = Number(clean);
  if (numeric >= 1 && numeric <= 12) return Math.trunc(numeric);
  const months = [
    ["enero", "ene", "january", "jan"], ["febrero", "feb", "february"], ["marzo", "mar", "march"],
    ["abril", "abr", "april", "apr"], ["mayo", "may"], ["junio", "jun", "june"],
    ["julio", "jul", "july"], ["agosto", "ago", "august", "aug"],
    ["septiembre", "sep", "setiembre", "september"], ["octubre", "oct", "october"],
    ["noviembre", "nov", "november"], ["diciembre", "dic", "december", "dec"]
  ];
  const index = months.findIndex((aliases) => aliases.includes(clean));
  return index >= 0 ? index + 1 : null;
}

function parseYearMonth(value: unknown) {
  const clean = cleanString(value);
  const match = clean.match(/\b(20\d{2}|19\d{2})[-/](0?[1-9]|1[0-2])\b/);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

function parseDateLike(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const clean = cleanString(value);
  const iso = clean.match(/\b(20\d{2}|19\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  return iso ? `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}` : null;
}

function monthPeriod(year: number, month: number) {
  const start = `${year}-${pad2(month)}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end, grain: "month" as const };
}

function hashRecord(datasetKey: string, rowIndex: number, metricKey: string, row: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({ datasetKey, rowIndex, metricKey, row })).digest("hex");
}

function hashSourceRecord(datasetKey: string, rowIndex: number, row: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({ datasetKey, rowIndex, row })).digest("hex");
}

function cleanString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeToken(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeKey(value: string) {
  return normalizeToken(value).slice(0, 80) || "field";
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
