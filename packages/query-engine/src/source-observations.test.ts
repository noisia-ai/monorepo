import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceRecords,
  buildSourceObservations,
  inferSourceDatasetRole,
  inferSourceMetricFamily
} from "./source-observations";

test("preserves every static catalog row even when the source has no numeric metrics", () => {
  const records = buildSourceRecords({
    sourceName: "Master product catalog",
    datasets: [
      {
        datasetKey: "catalog",
        datasetName: "Catalog",
        datasetRole: "product_catalog",
        records: [
          { sku: "FOOD-001", product_name: "Croquetas adulto", category: "Alimento" },
          { sku: "TOY-002", product_name: "Pelota", category: "Accesorios" }
        ]
      }
    ]
  });

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.entityKey), ["FOOD-001", "TOY-002"]);
  assert.ok(records.every((record) => record.periodStart === null));
  assert.ok(records.every((record) => record.periodSemantics === "static"));
  assert.ok(records.every((record) => record.qualityStatus === "accepted"));
  assert.equal(records[0]?.rawRecord.product_name, "Croquetas adulto");
});

test("marks product catalog rows without a durable product identity for mapping review", () => {
  const [record] = buildSourceRecords({
    sourceName: "Unmapped catalog",
    datasets: [
      {
        datasetKey: "catalog",
        datasetName: "Catalog",
        datasetRole: "product_catalog",
        records: [{ product_name: "Croquetas adulto", category: "Alimento" }]
      }
    ]
  });

  assert.ok(record);
  assert.equal(record.qualityStatus, "needs_mapping_review");
  assert.ok(record.qualityIssues.includes("catalog_identity_missing"));
});

test("preserves period and row lineage independently from numeric observations", () => {
  const [record] = buildSourceRecords({
    sourceName: "Search demand",
    datasets: [
      {
        datasetKey: "search",
        datasetName: "Google Search Console",
        datasetRole: "search_demand",
        records: [{ month: "2025-11", query: "croquetas premium", clicks: 120 }]
      }
    ]
  });

  assert.ok(record);
  assert.equal(record.periodStart, "2025-11-01");
  assert.equal(record.periodEnd, "2025-11-30");
  assert.equal(record.periodSemantics, "measurement");
  assert.equal(record.entityType, "search_query");
  assert.equal(record.entityKey, "croquetas premium");
  assert.equal(record.lineage.canonical_target, "data_asset_records");
});

test("materializes monthly sales observations from spreadsheet rows", () => {
  const observations = buildSourceObservations({
    sourceName: "Reporte Maestro",
    datasets: [
      {
        datasetKey: "ventas",
        datasetName: "Ventas",
        datasetRole: "sales_performance",
        fields: [
          { name: "AÑO", semantic_type: "time", field_type: "number" },
          { name: "MES", semantic_type: "time", field_type: "number" },
          { name: "SUPERCATEGORIA", semantic_type: "dimension", dimension_role: "category", field_type: "text" },
          { name: "VENTA REAL", semantic_type: "metric", metric_role: "sales", field_type: "number" },
          { name: "MARGEN", semantic_type: "metric", metric_role: "margin", field_type: "number" }
        ],
        records: [
          {
            AÑO: 2025,
            MES: "noviembre",
            SUPERCATEGORIA: "Alimento",
            "VENTA REAL": 1245000,
            MARGEN: 0.31
          }
        ]
      }
    ]
  });

  assert.equal(observations.length, 2);
  const sales = observations.find((observation) => observation.metricKey === "sales_monthly");
  assert.ok(sales);
  assert.equal(sales.periodStart, "2025-11-01");
  assert.equal(sales.periodEnd, "2025-11-30");
  assert.equal(sales.metricValue, "1245000");
  assert.equal(sales.dimensions.supercategoria, "Alimento");

  const margin = observations.find((observation) => observation.metricKey === "margin_monthly");
  assert.ok(margin);
  assert.equal(margin.metricUnit, "ratio");
  assert.equal(margin.metricValue, "0.31");
  assert.equal(margin.periodSemantics, "measurement");
});

test("keeps negative margins as governed loss signals and rejects impossible bounded rates", () => {
  const observations = buildSourceObservations({
    sourceName: "Commercial performance MXN",
    defaultCurrencyCode: "MXN",
    datasets: [
      {
        datasetKey: "performance",
        datasetName: "Performance",
        datasetRole: "ecommerce_sales",
        records: [
          {
            year: 2025,
            month: 11,
            margin: -0.25,
            conversion_rate: -0.1
          }
        ]
      }
    ]
  });

  const margin = observations.find((observation) => observation.metricFamily === "margin");
  assert.ok(margin);
  assert.equal(margin.metricValue, "-0.25");
  assert.equal(margin.qualityStatus, "accepted");

  const conversion = observations.find((observation) => observation.metricFamily === "conversion_rate");
  assert.ok(conversion);
  assert.equal(conversion.qualityStatus, "rejected");
  assert.ok(conversion.qualityIssues.includes("metric_value_below_minimum"));
});

test("materializes monthly mention observations with the same period grain as sales", () => {
  const observations = buildSourceObservations({
    sourceName: "Social Listening Export",
    datasets: [
      {
        datasetKey: "mentions",
        datasetName: "Mentions Monthly",
        datasetRole: "social_listening",
        records: [
          {
            month: "2025-11",
            brand: "Laika",
            mentions: "3842",
            sentiment_score: "0.41"
          }
        ]
      }
    ]
  });

  const mentions = observations.find((observation) => observation.metricKey === "mentions_monthly");
  assert.ok(mentions);
  assert.equal(mentions.periodStart, "2025-11-01");
  assert.equal(mentions.periodEnd, "2025-11-30");
  assert.equal(mentions.metricFamily, "mentions");
  assert.equal(mentions.metricValue, "3842");
  assert.equal(mentions.entityType, "brand");
  assert.equal(mentions.entityKey, "Laika");
  assert.equal(mentions.qualityStatus, "accepted");
});

test("materializes ecommerce catalog, funnel, search, support, and inventory metrics", () => {
  const observations = buildSourceObservations({
    sourceName: "Data OS priority sources",
    datasets: [
      {
        datasetKey: "shopify_orders",
        datasetName: "Shopify Orders",
        datasetRole: "ecommerce_sales",
        records: [
          {
            date: "2025-11-15",
            sku: "FOOD-001",
            revenue: "$1,250.50",
            orders: 12,
            units: 36,
            discount: 150,
            returns: 1
          }
        ]
      },
      {
        datasetKey: "ga4_funnel",
        datasetName: "GA4 Funnel",
        datasetRole: "web_analytics",
        records: [
          {
            month: "2025-11",
            landing_page: "/croquetas-premium",
            sessions: 4200,
            product_views: 900,
            add_to_cart: 140,
            conversion_rate: "3.2%"
          }
        ]
      },
      {
        datasetKey: "search_console",
        datasetName: "Google Search Console",
        datasetRole: "search_demand",
        records: [
          {
            month: "2025-11",
            query: "croquetas premium perro",
            search_volume: 33100,
            clicks: 820,
            position: 4.2
          }
        ]
      },
      {
        datasetKey: "support",
        datasetName: "Zendesk Tickets",
        datasetRole: "customer_service",
        records: [
          {
            month: "2025-11",
            ticket_id: "ZD-10",
            tickets: 18,
            csat: 0.71
          }
        ]
      },
      {
        datasetKey: "inventory",
        datasetName: "Stock",
        datasetRole: "pricing_inventory",
        records: [
          {
            month: "2025-11",
            sku: "FOOD-001",
            price: 499,
            stock: 0
          }
        ]
      }
    ]
  });

  const keys = new Set(observations.map((observation) => observation.metricKey));
  assert.ok(keys.has("revenue_daily"));
  assert.ok(keys.has("orders_daily"));
  assert.ok(keys.has("units_daily"));
  assert.ok(keys.has("sessions_monthly"));
  assert.ok(keys.has("add_to_cart_monthly"));
  assert.ok(keys.has("conversion_rate_monthly"));
  assert.ok(keys.has("search_volume_monthly"));
  assert.ok(keys.has("search_clicks_monthly"));
  assert.ok(keys.has("customer_satisfaction_monthly"));
  assert.ok(keys.has("support_tickets_monthly"));
  assert.ok(keys.has("price_snapshot"));
  assert.ok(keys.has("stock_snapshot"));

  const query = observations.find((observation) => observation.metricKey === "search_volume_monthly");
  assert.ok(query);
  assert.equal(query.entityType, "search_query");
  assert.equal(query.entityKey, "croquetas premium perro");

  const support = observations.find((observation) => observation.metricKey === "support_tickets_monthly");
  assert.ok(support);
  assert.equal(support.entityType, "support_case");
  assert.equal(support.entityKey, "ZD-10");

  const conversionRate = observations.find((observation) => observation.metricKey === "conversion_rate_monthly");
  assert.ok(conversionRate);
  assert.equal(conversionRate.metricValue, "0.032");
});

test("separates average order value, support tickets, units, and currency semantics", () => {
  assert.equal(inferSourceMetricFamily("TICKET PROMEDIO"), "average_order_value");
  assert.equal(inferSourceMetricFamily("tickets"), "support_tickets");
  assert.equal(inferSourceMetricFamily("UNIDADES"), "units");

  const observations = buildSourceObservations({
    sourceName: "REPORTE MAESTRO MXN",
    datasets: [
      {
        datasetKey: "performance",
        datasetName: "Performance MXN",
        datasetRole: "ecommerce_sales",
        records: [
          {
            year: 2025,
            month: 11,
            currency: "MXN",
            "ticket promedio": 1175,
            units: 42,
            margin: "45%"
          }
        ]
      }
    ]
  });

  const ticket = observations.find((row) => row.metricFamily === "average_order_value");
  assert.ok(ticket);
  assert.equal(ticket.metricUnit, "currency");
  assert.equal(ticket.metricCurrencyCode, "MXN");
  assert.equal(ticket.qualityStatus, "accepted");

  const units = observations.find((row) => row.metricFamily === "units");
  assert.ok(units);
  assert.equal(units.metricUnit, "count");

  const margin = observations.find((row) => row.metricFamily === "margin");
  assert.ok(margin);
  assert.equal(margin.metricValue, "0.45");
  assert.equal(margin.metricUnit, "ratio");
});

test("keeps identifiers out of metrics and separates cost, profit, margin, and return semantics", () => {
  assert.equal(inferSourceMetricFamily("order_id"), null);
  assert.equal(inferSourceMetricFamily("ticket_id"), null);
  assert.equal(inferSourceMetricFamily("SKU"), null);
  assert.equal(inferSourceMetricFamily("VENTA A COSTO"), "cost");
  assert.equal(inferSourceMetricFamily("UTILIDAD"), "profit");
  assert.equal(inferSourceMetricFamily("MARGEN"), "margin");
  assert.equal(inferSourceMetricFamily("return_rate"), "return_rate");
  assert.equal(inferSourceMetricFamily("refund_amount"), "refund_amount");

  const observations = buildSourceObservations({
    sourceName: "Orders MXN",
    datasets: [
      {
        datasetKey: "orders",
        datasetName: "Orders",
        records: [
          {
            month: "2025-11",
            order_id: 1234,
            ticket_id: 9876,
            currency: "MXN",
            "VENTA A COSTO": 800,
            UTILIDAD: 200,
            MARGEN: "20%",
            returns: 2,
            return_rate: "4%",
            refund_amount: 350
          }
        ]
      }
    ]
  });

  assert.deepEqual(
    new Set(observations.map((row) => row.metricFamily)),
    new Set(["cost", "profit", "margin", "returns", "return_rate", "refund_amount"])
  );
  assert.equal(observations.find((row) => row.metricFamily === "returns")?.metricUnit, "count");
  assert.equal(observations.find((row) => row.metricFamily === "return_rate")?.metricValue, "0.04");
  assert.equal(observations.find((row) => row.metricFamily === "refund_amount")?.metricCurrencyCode, "MXN");
});

test("does not accept a catalog price until a governed snapshot date is attached", () => {
  const [price] = buildSourceObservations({
    sourceName: "Product catalog MXN",
    datasets: [
      {
        datasetKey: "catalog",
        datasetName: "Catalog",
        datasetRole: "product_catalog",
        records: [{ sku: "FOOD-001", price: 499 }]
      }
    ]
  });

  assert.ok(price);
  assert.equal(price.periodStart, null);
  assert.equal(price.periodSemantics, "unknown");
  assert.equal(price.qualityStatus, "needs_mapping_review");
  assert.ok(price.qualityIssues.includes("measurement_period_missing"));
  assert.ok(price.qualityIssues.includes("snapshot_date_missing"));
});

test("classifies a product master with commercial attributes as catalog, not sales", () => {
  assert.equal(
    inferSourceDatasetRole({
      datasetName: "ANIMALL",
      fieldNames: [
        "SKU PROV",
        "CODIGOBIND",
        "EAN PIEZA",
        "DESCRIPCIÓN",
        "MARCA",
        "SUPERCATEGORIA",
        "UNIDAD",
        "COSTO",
        "PRECIO VENTA",
        "MARGEN"
      ]
    }),
    "product_catalog"
  );
  assert.equal(inferSourceMetricFamily("PRECIO VENTA", "product_catalog"), "price");
  assert.equal(inferSourceMetricFamily("UNIDAD", "product_catalog"), null);
});

test("uses durable product identity and preserves non-metric catalog dimensions", () => {
  const [record] = buildSourceRecords({
    sourceName: "REPORTE MAESTRO V1.xlsx",
    datasets: [
      {
        datasetKey: "ANIMALL",
        datasetName: "ANIMALL",
        records: [
          {
            "SKU PROV": "RC-001",
            CODIGOBIND: "750000001",
            DESCRIPCIÓN: "Royal Canin Adulto",
            MARCA: "Royal Canin",
            UNIDAD: "PIEZA",
            COSTO: 100,
            "PRECIO VENTA": 145,
            MARGEN: "31%"
          }
        ]
      }
    ]
  });

  assert.ok(record);
  assert.equal(record.datasetRole, "product_catalog");
  assert.equal(record.entityType, "product");
  assert.equal(record.entityKey, "RC-001");
  assert.equal(record.dimensions.unidad, "PIEZA");
  assert.equal(record.periodSemantics, "static");
  assert.equal(record.qualityStatus, "accepted");
});

test("falls back to the next durable product identifier when the preferred field is NA", () => {
  const [record] = buildSourceRecords({
    sourceName: "REPORTE MAESTRO V1.xlsx",
    datasets: [
      {
        datasetKey: "ANIMALL",
        datasetName: "ANIMALL",
        datasetRole: "product_catalog",
        records: [
          {
            "SKU PROV": "NA",
            CODIGOBIND: "MLM1389972099",
            "EAN PIEZA": "-",
            DESCRIPCION: "Producto marketplace",
            "PRECIO VENTA": 1800
          }
        ]
      }
    ]
  });

  assert.ok(record);
  assert.equal(record.entityType, "product");
  assert.equal(record.entityKey, "MLM1389972099");
  assert.equal(record.lineage.entity_source_field, "CODIGOBIND");
  assert.equal(record.qualityStatus, "accepted");
});

test("keeps governed commercial variants as distinct product observations", () => {
  const observations = buildSourceObservations({
    sourceName: "REPORTE MAESTRO V1.xlsx",
    defaultCurrencyCode: "MXN",
    datasets: [
      {
        datasetKey: "ANIMALL",
        datasetName: "ANIMALL",
        datasetRole: "product_catalog",
        records: [
          {
            "SKU PROV": "NA",
            CODIGOBIND: "MLM1389972099",
            "PRECIO PUBLICO SUGERIDO PROV": 1800,
            "COSTO SIN IVA PROVEEDOR": 1056.23,
            "PRECIO VENTA": 1750,
            "COSTO UNIT": 1040,
            "MARGEN FRONT": 0.3193,
            "COSTO CON BACKS": 934.76,
            "MARGEN FINAL": 0.3976
          }
        ]
      }
    ]
  });

  assert.deepEqual(
    new Set(observations.map((observation) => observation.metricVariant)),
    new Set([
      "supplier_suggested_retail_price",
      "supplier_cost_ex_tax",
      "selling_price",
      "unit_cost",
      "front_margin",
      "net_cost_after_rebates",
      "final_margin"
    ])
  );
  assert.equal(new Set(observations.map((observation) => observation.metricKey)).size, 7);
  assert.ok(observations.every((observation) => observation.entityKey === "MLM1389972099"));
  assert.ok(observations.every((observation) => observation.metricKey.endsWith("_observed")));
  assert.ok(observations.every((observation) => observation.qualityIssues.includes("snapshot_date_missing")));
});

test("forward-fills merged year and month cells only inside the dataset", () => {
  const observations = buildSourceObservations({
    sourceName: "Reporte Maestro MXN",
    datasets: [
      {
        datasetKey: "R1",
        datasetName: "R1",
        datasetRole: "ecommerce_sales",
        records: [
          { AÑO: 2025, MES: "noviembre", SUPERCATEGORIA: "Alimento", "VENTA REAL": 100 },
          { AÑO: null, MES: null, SUPERCATEGORIA: "Accesorios", "VENTA REAL": 50 }
        ]
      }
    ]
  });

  assert.equal(observations.length, 2);
  assert.equal(observations[1]?.periodStart, "2025-11-01");
  assert.equal(observations[1]?.lineage.period_inference, "dataset_forward_fill");
  assert.deepEqual(observations[1]?.lineage.inherited_period_fields, ["ano", "mes"]);
  assert.equal(observations[1]?.rawRecord.AÑO, null);
  assert.equal(observations[1]?.qualityStatus, "accepted");
});

test("uses a governed market currency fallback and records its provenance", () => {
  const [observation] = buildSourceObservations({
    sourceName: "Reporte Maestro",
    defaultCurrencyCode: "MXN",
    datasets: [
      {
        datasetKey: "R1",
        datasetName: "R1",
        datasetRole: "ecommerce_sales",
        records: [{ year: 2025, month: 11, sales: 1000 }]
      }
    ]
  });

  assert.ok(observation);
  assert.equal(observation.metricCurrencyCode, "MXN");
  assert.equal(observation.lineage.currency_inference, "market_default");
  assert.equal(observation.qualityStatus, "accepted");
});

test("classifies transactional SKU sheets as ecommerce sales before product catalog", () => {
  assert.equal(
    inferSourceDatasetRole({
      datasetName: "Ventas",
      fieldNames: ["AÑO", "MES", "SKU", "VENTA REAL", "UNIDADES"],
      metricFamilies: ["sales", "units"]
    }),
    "ecommerce_sales"
  );
});

test("normalizes customer-service durations to seconds and reviews ambiguous units", () => {
  const observations = buildSourceObservations({
    sourceName: "Zendesk",
    datasets: [
      {
        datasetKey: "support",
        datasetName: "Zendesk tickets",
        datasetRole: "customer_service",
        records: [
          {
            month: "2025-11",
            resolution_minutes: 45,
            resolution_time: 2
          }
        ]
      }
    ]
  });

  const normalized = observations.find((row) => row.lineage.source_field === "resolution_minutes");
  assert.ok(normalized);
  assert.equal(normalized.metricUnit, "duration_seconds");
  assert.equal(normalized.metricValue, "2700");
  assert.equal(normalized.qualityStatus, "accepted");

  const ambiguous = observations.find((row) => row.lineage.source_field === "resolution_time");
  assert.ok(ambiguous);
  assert.equal(ambiguous.metricValue, "2");
  assert.equal(ambiguous.qualityStatus, "needs_mapping_review");
  assert.ok(ambiguous.qualityIssues.includes("duration_unit_missing"));
});

test("uses source context to disambiguate all governed Data OS domains", () => {
  const roles = [
    ["SentiOne mentions export", ["published_at", "mentions"], "social_listening"],
    ["Shopify orders", ["date", "revenue", "orders"], "ecommerce_sales"],
    ["Master product catalog", ["sku", "product_name", "price"], "product_catalog"],
    ["GA4 web funnel", ["date", "sessions", "clicks"], "web_analytics"],
    ["Google Search Console", ["date", "query", "clicks", "impressions"], "search_demand"],
    ["Zendesk tickets", ["ticket_id", "resolution_time", "csat"], "customer_service"],
    ["Meta organic", ["date", "posts", "reach", "engagement"], "organic_social"],
    ["Meta Ads", ["date", "spend", "clicks", "impressions"], "paid_media"],
    ["Klaviyo lifecycle", ["date", "customers", "email_clicks"], "crm_marketing"],
    ["Yotpo reviews", ["date", "reviews", "rating"], "reviews_ratings"],
    ["Inventory snapshot", ["date", "sku", "stock", "price"], "pricing_inventory"],
    ["Competitive intelligence", ["date", "brand", "share_of_voice"], "competitive_intelligence"]
  ] as const;

  for (const [datasetName, fieldNames, expected] of roles) {
    assert.equal(inferSourceDatasetRole({ datasetName, fieldNames: [...fieldNames] }), expected);
  }

  assert.equal(inferSourceMetricFamily("clicks", "search_demand"), "search_clicks");
  assert.equal(inferSourceMetricFamily("clicks", "paid_media"), "clicks");
  assert.equal(inferSourceMetricFamily("clicks", "crm_marketing"), "email_clicks");
});
