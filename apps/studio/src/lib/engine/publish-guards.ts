type EnginePublishReadiness =
  | {
      ok: true;
      checks: Array<{ id: string; passed: boolean; detail: string }>;
    }
  | {
      ok: false;
      error:
        | "engine_block_not_ready"
        | "engine_block_directional"
        | "engine_coding_missing"
        | "fixture_coding_used"
        | "quality_gates_missing"
        | "quality_gates_failed";
      message: string;
      failedChecks: Array<{ id: string; detail: string }>;
    };

export function validateEnginePublishReadiness(metaJson: unknown): EnginePublishReadiness {
  const meta = asRecord(metaJson);
  const synthesis = asRecord(meta.synthesis);
  if (synthesis.engine_block_ready !== true) {
    return {
      ok: false,
      error: "engine_block_not_ready",
      message: "El engine block todavia no esta listo para publicarse.",
      failedChecks: []
    };
  }

  const engineBlock = asRecord(meta.engine_block);
  const methodologyView = asRecord(engineBlock.methodology_view);
  const readiness = asRecord(methodologyView.readiness);
  const readinessStatus = typeof readiness.status === "string" ? readiness.status : "";
  if (readinessStatus && readinessStatus !== "beta_ready") {
    return {
      ok: false,
      error: "engine_block_directional",
      message: "El engine block es direccional o insuficiente; requiere mas evidencia o review antes de publicarse.",
      failedChecks: [{
        id: "engine_block_readiness",
        detail: typeof readiness.reason === "string"
          ? readiness.reason
          : `readiness.status=${readinessStatus}`
      }]
    };
  }

  const engineCoding = asRecord(meta.engine_coding);
  if (engineCoding.fixture === true || engineCoding.provider === "fixture") {
    return {
      ok: false,
      error: "fixture_coding_used",
      message: "Este output viene de fixture/no-cost QA y no puede publicarse como client-ready. Recorre el lente con Claude real.",
      failedChecks: [{ id: "fixture_coding", detail: "engine_coding.fixture=true" }]
    };
  }

  if (engineCoding.provider !== "anthropic") {
    return {
      ok: false,
      error: "engine_coding_missing",
      message: "Este output engine no tiene codificación Claude real registrada. Vuelve a correr el lente antes de publicarlo.",
      failedChecks: [{ id: "engine_coding_provider", detail: `provider=${String(engineCoding.provider ?? "missing")}` }]
    };
  }

  const checks = Array.isArray(meta.quality_gates)
    ? meta.quality_gates.map(normalizeCheck).filter((check): check is { id: string; passed: boolean; detail: string } => Boolean(check))
    : [];
  if (checks.length === 0) {
    return {
      ok: false,
      error: "quality_gates_missing",
      message: "Faltan quality gates del engine; guarda draft o vuelve a correr quality_gates antes de publicar.",
      failedChecks: []
    };
  }

  const failedChecks = checks
    .filter((check) => !check.passed)
    .map((check) => ({ id: check.id, detail: check.detail }));
  if (failedChecks.length > 0) {
    return {
      ok: false,
      error: "quality_gates_failed",
      message: "El output engine no puede publicarse con quality gates fallidas.",
      failedChecks
    };
  }

  return { ok: true, checks };
}

function normalizeCheck(value: unknown) {
  const check = asRecord(value);
  const id = typeof check.id === "string" ? check.id : null;
  if (!id) return null;
  return {
    id,
    passed: check.passed === true,
    detail: typeof check.detail === "string" ? check.detail : ""
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
