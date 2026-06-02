import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (process.env.NOISIA_TEST_VERBOSE) originalConsoleError(...args);
};

const routeHandlers = await import("@/lib/reporting/public-route-handlers");
const openApiRoute = await import("./openapi.yaml/route");

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
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal((body.meta as Record<string, unknown>).section, "action-cards");
  assert.deepEqual(body.data, { section: "action-cards" });
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

test("public OpenAPI route serves the YAML specification", async () => {
  const response = await openApiRoute.GET();
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/yaml; charset=utf-8");
  assert.match(text, /^openapi: 3\.1\.0/m);
  assert.match(text, /\/api\/public\/v2\/reports/);
});
