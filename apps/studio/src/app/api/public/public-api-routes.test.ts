import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (process.env.NOISIA_TEST_VERBOSE) originalConsoleError(...args);
};

const routeHandlers = await import("@/lib/reporting/public-route-handlers");
const publicApi = await import("@/lib/reporting/public-api");
const openApiRoute = await import("./openapi.yaml/route");
const readmePersonalizedDocsRoute = await import("../readme/personalized-docs/route");

const grant = { label: "unit", outputs: ["*"] };
const output = {
  outputId: "out_123",
  outputType: "narrative_dashboard",
  version: 4,
  title: "Signal",
  headline: "Headline",
  summary: "Summary",
  manifest: {},
  payload: { schema_version: 4, report: { headline: "Headline" } },
  publishedAt: new Date("2026-06-01T00:00:00.000Z"),
  generatedAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  brandName: "Noisia",
  brandFallbackName: "Noisia",
  themeName: null,
  methodologyName: "Triggers & Barriers",
  methodologySlug: "triggers-barriers"
};

function request(path = "https://studio.noisia.ai/api/public/v2/reports/out_123") {
  return new Request(path, { headers: { authorization: "Bearer test" } });
}

function params(path: string[] = []) {
  return { params: Promise.resolve({ outputId: "out_123", path }) };
}

function okAuth() {
  return { ok: true as const, grant };
}

function errorAuth(status = 401) {
  return {
    ok: false as const,
    response: Response.json({ error: "invalid_api_key", message: "Invalid reporting API key." }, { status })
  };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("public v1 reports list returns reports metadata", async () => {
  const response = await routeHandlers.handlePublicV1ReportsGET(request(), {
    authorize: async () => okAuth(),
    listReports: async () => [{ output_id: "out_123", title: "Signal" }]
  } as never);
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.meta, { dataset: "reports", row_count: 1 });
});

test("public v1 reports list returns auth errors before listing", async () => {
  const response = await routeHandlers.handlePublicV1ReportsGET(request(), {
    authorize: async () => errorAuth(),
    listReports: async () => {
      throw new Error("should not list");
    }
  } as never);
  const body = await json(response);

  assert.equal(response.status, 401);
  assert.equal(body.error, "invalid_api_key");
});

test("public v1 reports list returns server_error when listing fails", async () => {
  const response = await routeHandlers.handlePublicV1ReportsGET(request(), {
    authorize: async () => okAuth(),
    listReports: async () => {
      throw new Error("boom");
    }
  } as never);
  const body = await json(response);

  assert.equal(response.status, 500);
  assert.equal(body.error, "server_error");
});

test("public v1 report returns JSON dataset by path", async () => {
  const response = await routeHandlers.handlePublicV1ReportGET(request(), params(["findings"]), {
    authorize: async () => okAuth(),
    getOutput: async () => output,
    buildDataset: () => [{ output_id: "out_123", finding_id: "F1" }]
  } as never);
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal((body.meta as Record<string, unknown>).dataset, "findings");
  assert.equal((body.data as unknown[]).length, 1);
});

test("public v1 report returns CSV datasets", async () => {
  const response = await routeHandlers.handlePublicV1ReportGET(
    request("https://studio.noisia.ai/api/public/v1/reports/out_123/datasets/findings.csv"),
    params(["datasets", "findings.csv"]),
    {
      authorize: async () => okAuth(),
      getOutput: async () => output,
      buildDataset: () => [{ output_id: "out_123", finding_id: "F1" }]
    } as never
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(text, /output_id,finding_id/);
});

test("public v1 report maps nested aliases and handles not found", async () => {
  const response = await routeHandlers.handlePublicV1ReportGET(request(), params(["time-series", "monthly"]), {
    authorize: async () => okAuth(),
    getOutput: async () => null,
    buildDataset: () => []
  } as never);
  const body = await json(response);

  assert.equal(response.status, 404);
  assert.equal(body.error, "report_not_found");
});

test("public v1 report rejects unknown datasets", async () => {
  const response = await routeHandlers.handlePublicV1ReportGET(request(), params(["not-a-dataset"]), {
    authorize: async () => okAuth(),
    getOutput: async () => output,
    buildDataset: () => []
  } as never);
  const body = await json(response);

  assert.equal(response.status, 404);
  assert.equal(body.error, "unknown_dataset");
});

test("public v1 report returns server_error when dataset build fails", async () => {
  const response = await routeHandlers.handlePublicV1ReportGET(request(), params(["summary"]), {
    authorize: async () => okAuth(),
    getOutput: async () => output,
    buildDataset: () => {
      throw new Error("boom");
    }
  } as never);
  const body = await json(response);

  assert.equal(response.status, 500);
  assert.equal(body.error, "server_error");
});

test("public v2 reports list returns structured metadata", async () => {
  const response = await routeHandlers.handlePublicV2ReportsGET(request(), {
    authorize: async () => okAuth(),
    listReports: async () => [{ api_version: 2, output_id: "out_123", sections: ["overview"] }]
  } as never);
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.meta, { api_version: 2, dataset: "reports", row_count: 1 });
});

test("public v2 reports list returns auth and server errors", async () => {
  const authResponse = await routeHandlers.handlePublicV2ReportsGET(request(), {
    authorize: async () => errorAuth(403),
    listReports: async () => []
  } as never);
  const serverResponse = await routeHandlers.handlePublicV2ReportsGET(request(), {
    authorize: async () => okAuth(),
    listReports: async () => {
      throw new Error("boom");
    }
  } as never);

  assert.equal(authResponse.status, 403);
  assert.equal(serverResponse.status, 500);
});

test("public v2 report returns full document by default", async () => {
  const response = await routeHandlers.handlePublicV2ReportGET(request(), params(), {
    authorize: async () => okAuth(),
    getOutput: async () => output,
    buildSection: () => ({ metadata: { output_id: "out_123" }, sections: {} })
  } as never);
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal((body.meta as Record<string, unknown>).section, "full");
  assert.deepEqual(body.data, { metadata: { output_id: "out_123" }, sections: {} });
});

test("public v2 report returns section aliases", async () => {
  const response = await routeHandlers.handlePublicV2ReportGET(request(), params(["sections", "actions"]), {
    authorize: async () => okAuth(),
    getOutput: async () => output,
    buildSection: (_output: unknown, section: string) => ({ section })
  } as never);
  const engineResponse = await routeHandlers.handlePublicV2ReportGET(request(), params(["sections", "lens-view"]), {
    authorize: async () => okAuth(),
    getOutput: async () => output,
    buildSection: (_output: unknown, section: string) => ({ section })
  } as never);
  const body = await json(response);
  const engineBody = await json(engineResponse);

  assert.equal(response.status, 200);
  assert.equal((body.meta as Record<string, unknown>).section, "action-cards");
  assert.deepEqual(body.data, { section: "action-cards" });
  assert.equal(engineResponse.status, 200);
  assert.equal((engineBody.meta as Record<string, unknown>).section, "methodology-view");
  assert.deepEqual(engineBody.data, { section: "methodology-view" });
});

test("public v2 report handles unknown section, not found and build errors", async () => {
  const unknownResponse = await routeHandlers.handlePublicV2ReportGET(request(), params(["sections", "nope"]), {
    authorize: async () => okAuth(),
    getOutput: async () => output,
    buildSection: () => ({})
  } as never);
  const notFoundResponse = await routeHandlers.handlePublicV2ReportGET(request(), params(["overview"]), {
    authorize: async () => okAuth(),
    getOutput: async () => null,
    buildSection: () => ({})
  } as never);
  const serverResponse = await routeHandlers.handlePublicV2ReportGET(request(), params(["overview"]), {
    authorize: async () => okAuth(),
    getOutput: async () => output,
    buildSection: () => {
      throw new Error("boom");
    }
  } as never);

  assert.equal(unknownResponse.status, 404);
  assert.equal((await json(unknownResponse)).error, "unknown_section");
  assert.equal(notFoundResponse.status, 404);
  assert.equal((await json(notFoundResponse)).error, "report_not_found");
  assert.equal(serverResponse.status, 500);
  assert.equal((await json(serverResponse)).error, "server_error");
});

test("public reporting uses theme name for brandless industry reports", () => {
  const themeOutput = {
    ...output,
    brandName: null,
    brandFallbackName: null,
    themeName: "Telefonía Móvil México",
    payload: {
      schema_version: 4,
      report: {
        headline: "Telefonía móvil en México",
        methodology_name: "Triggers & Barriers",
        methodology_slug: "triggers-barriers"
      },
      metrics: {},
      aggregates: { corpus: { window: {} } }
    }
  };

  const summary = publicApi.buildReportingDataset(themeOutput as never, "summary")[0] as Record<string, unknown>;
  const document = publicApi.buildReportingV2Document(themeOutput as never) as Record<string, unknown>;
  const metadata = document.metadata as Record<string, unknown>;
  const sections = document.sections as Record<string, Record<string, unknown>>;
  const overview = sections.overview as Record<string, unknown>;
  const report = overview.report as Record<string, unknown>;

  assert.equal(summary.brand_name, "Telefonía Móvil México");
  assert.equal(metadata.brand_name, "Telefonía Móvil México");
  assert.equal(report.brand_name, "Telefonía Móvil México");
});

test("public v2 document exposes engine methodology sections", () => {
  const engineOutput = {
    ...output,
    manifest: { engine_methodology: true },
    methodologySlug: "narrative-ownership",
    payload: {
      schema_version: 4,
      report: {
        headline: "Narrativas de telefonía",
        methodology_name: "Narrative Ownership",
        methodology_slug: "narrative-ownership"
      },
      metrics: {},
      aggregates: { corpus: { window: {} } },
      engine_block: {
        kind: "narrative-ownership",
        title: "Narrative Ownership",
        methodology_slug: "narrative-ownership",
        summary: "Narrativas listas",
        methodology_view: {
          kind: "narrative-ownership",
          title: "Narrative ownership board",
          primary_question: "Quien posee cada narrativa?",
          readiness: { status: "directional", reason: "QA pendiente", missing: ["diversidad"] },
          cards: [],
          rows: [{ finding_id: "narrative-1", label: "cobertura", axis: "positiva", evidence_count: 2, confidence: "media", dimensions: {} }],
          conclusions: []
        },
        charts: [],
        findings: [],
        evidence_index: [],
        limitations: []
      }
    }
  };

  const document = publicApi.buildReportingV2Document(engineOutput as never) as Record<string, unknown>;
  const sections = document.sections as Record<string, unknown>;
  const methodologyView = publicApi.buildReportingV2Section(engineOutput as never, "methodology-view") as Record<string, unknown>;

  assert.equal((sections.engine_methodology as Record<string, unknown>).methodology_slug, "narrative-ownership");
  assert.equal(methodologyView.title, "Narrative ownership board");
});

test("public v2 section inventory only advertises engine sections when engine block exists", () => {
  const normalSections = publicApi.getEnabledV2Sections({}, { schema_version: 4, report: {} });
  const engineSections = publicApi.getEnabledV2Sections(
    { engine_methodology: true },
    { schema_version: 4, engine_block: { kind: "narrative-ownership" } }
  );

  assert.equal(normalSections.includes("engine-methodology"), false);
  assert.equal(engineSections.includes("engine-methodology"), true);
  assert.equal(engineSections.includes("methodology-view"), true);
});

test("public v2 section inventory honors method-specific engine module keys", () => {
  for (const moduleKey of [
    "competitive_wave",
    "narrative_ownership",
    "value_perception",
    "brand_positioning",
    "category_opportunity",
    "white_space",
    "journey_friction",
    "decision_velocity",
    "cultural_codes",
    "advocacy_proxy",
    "audience_segment",
    "influence_architecture",
    "trust_risk",
    "evidence_confidence"
  ]) {
    const sections = publicApi.getEnabledV2Sections(
      { [moduleKey]: true },
      { schema_version: 4, engine_block: { methodology_slug: "narrative-ownership" } }
    );

    assert.equal(sections.includes("engine-methodology"), true, moduleKey);
    assert.equal(sections.includes("methodology-view"), true, moduleKey);
  }
});

test("public v2 Signal Pulse document hides paid data and internal support by default", () => {
  const signalPulseOutput = {
    ...output,
    outputType: "signal_pulse_dashboard",
    kind: "signal_pulse",
    methodologyName: "Signal Pulse",
    methodologySlug: "signal-pulse",
    visibilityConfig: {},
    payload: {
      kind: "signal_pulse",
      report: { title: "Pulse", business_question: "Que movemos?" },
      executive_read: { headline: "Mover el claim principal", body: "Hay traccion.", action: "Probar contenido." },
      periods: [{ id: "p1", period_start: "2026-05-01", period_end: "2026-05-31" }],
      signals: [{ id: "s1", title: "Confianza en entrega" }],
      marketing_moves: [{ id: "m1", action_text: "Probar claim de entrega" }],
      evidence: [{ evidence_id: "e1", quote: "Llego rapido" }],
      performance: { campaigns: [{ external_id: "ad-1", spend: 1000 }] },
      sources: [{ id: "src-1", name: "Meta export" }],
      quality_gates: [{ id: "performance_structured", passed: true }],
      cost: { estimated_cost_usd: 1.2 }
    }
  };

  const document = publicApi.buildReportingV2Document(signalPulseOutput as never) as Record<string, unknown>;
  const sections = document.sections as Record<string, unknown>;
  const paid = publicApi.buildReportingV2Section(signalPulseOutput as never, "paid-organic") as Record<string, unknown>;
  const sources = publicApi.buildReportingV2Section(signalPulseOutput as never, "sources") as Record<string, unknown>;
  const enabled = publicApi.getEnabledV2Sections(signalPulseOutput.manifest, signalPulseOutput.payload, signalPulseOutput.visibilityConfig);

  assert.equal(enabled.includes("paid-organic"), false);
  assert.equal(enabled.includes("sources"), false);
  assert.equal((sections.paid_organic as Record<string, unknown>).locked, true);
  assert.equal((sections.sources as Record<string, unknown>).locked, true);
  assert.equal(paid.reason, "not_authorized_for_client_export");
  assert.equal(sources.reason, "not_authorized_for_client_export");
});

test("public v2 Signal Pulse document exposes paid data only with explicit visibility", () => {
  const signalPulseOutput = {
    ...output,
    outputType: "signal_pulse_dashboard",
    kind: "signal_pulse",
    methodologyName: "Signal Pulse",
    methodologySlug: "signal-pulse",
    visibilityConfig: { paid_data: true },
    payload: {
      kind: "signal_pulse",
      report: { title: "Pulse" },
      periods: [],
      signals: [],
      marketing_moves: [],
      evidence: [],
      performance: { campaigns: [{ external_id: "ad-1", spend: 1000 }] }
    }
  };

  const paid = publicApi.buildReportingV2Section(signalPulseOutput as never, "paid-organic") as Record<string, unknown>;
  const enabled = publicApi.getEnabledV2Sections(signalPulseOutput.manifest, signalPulseOutput.payload, signalPulseOutput.visibilityConfig);

  assert.equal(enabled.includes("paid-organic"), true);
  assert.deepEqual(paid, { campaigns: [{ external_id: "ad-1", spend: 1000 }] });
});

test("public OpenAPI route serves the YAML specification", async () => {
  const response = await openApiRoute.GET();
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/yaml; charset=utf-8");
  assert.match(text, /^openapi: 3\.1\.0/m);
  assert.match(text, /\/api\/public\/v2\/reports/);
});

test("ReadMe personalized docs webhook returns security variables", async () => {
  process.env.README_WEBHOOK_SECRET = "unit-secret";
  process.env.NOISIA_README_API_KEYS_BY_EMAIL = JSON.stringify({
    "client@example.com": "sk_unit_client"
  });

  const body = { email: "client@example.com" };
  const response = await readmePersonalizedDocsRoute.POST(
    new Request("https://studio.noisia.ai/api/readme/personalized-docs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "readme-signature": signatureFor(body, "unit-secret")
      },
      body: JSON.stringify(body)
    })
  );
  const data = await json(response);

  assert.equal(response.status, 200);
  assert.equal(data.bearerAuth, "sk_unit_client");
  assert.equal(data.noisiaApiKey, "sk_unit_client");
  assert.equal(data["x-noisia-api-key"], "sk_unit_client");
});

test("ReadMe personalized docs webhook rejects invalid signatures", async () => {
  process.env.README_WEBHOOK_SECRET = "unit-secret";
  process.env.NOISIA_README_DEFAULT_API_KEY = "sk_unit_default";

  const response = await readmePersonalizedDocsRoute.POST(
    new Request("https://studio.noisia.ai/api/readme/personalized-docs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "readme-signature": "t=1,v0=invalid"
      },
      body: JSON.stringify({ email: "client@example.com" })
    })
  );
  const data = await json(response);

  assert.equal(response.status, 401);
  assert.equal(data.error, "invalid_readme_signature");
});

test("ReadMe personalized docs webhook returns 404 when no key is mapped", async () => {
  process.env.README_WEBHOOK_SECRET = "unit-secret";
  delete process.env.NOISIA_README_DEFAULT_API_KEY;
  delete process.env.NOISIA_README_API_KEYS_BY_EMAIL;

  const body = { email: "unknown@example.com" };
  const response = await readmePersonalizedDocsRoute.POST(
    new Request("https://studio.noisia.ai/api/readme/personalized-docs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "readme-signature": signatureFor(body, "unit-secret")
      },
      body: JSON.stringify(body)
    })
  );
  const data = await json(response);

  assert.equal(response.status, 404);
  assert.equal(data.error, "api_key_not_found");
});

function signatureFor(body: Record<string, unknown>, secret: string) {
  const timestamp = Date.now();
  const unsigned = `${timestamp}.${JSON.stringify(body)}`;
  const digest = crypto.createHmac("sha256", secret).update(unsigned).digest("hex");
  return `t=${timestamp},v0=${digest}`;
}
