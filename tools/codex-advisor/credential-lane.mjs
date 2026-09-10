/**
 * Development-only credential boundary for sanitized Codex/Backend Advisor reviews.
 *
 * This module deliberately has no provider SDK, network transport, environment-file
 * loader, filesystem access, or product-package export. Callers must pass the explicit
 * process environment and inject their own development-only transport factory.
 */

export const ADVISOR_CREDENTIAL_ENVIRONMENT_NAME =
  "NOISIA_CODEX_ADVISOR_ANTHROPIC_API_KEY";

export class NoisiaCodexAdvisorCredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NoisiaCodexAdvisorCredentialError";
    this.code = code;
  }
}

function readExplicitEnvironmentValue(environment, name) {
  if (!environment || typeof environment !== "object") return "";
  const value = Object.prototype.hasOwnProperty.call(environment, name)
    ? environment[name]
    : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function hasAnthropicCredentialCollision(environment, advisorCredential) {
  return Object.entries(environment).some(([name, value]) =>
    name !== ADVISOR_CREDENTIAL_ENVIRONMENT_NAME
    && /^ANTHROPIC(?:_[A-Z0-9]+)*_KEY$/u.test(name)
    && typeof value === "string"
    && value.trim() === advisorCredential);
}

/**
 * Resolves only the dedicated Advisor credential from an explicitly supplied
 * environment. The product-runtime lane is observed solely for the equality guard;
 * it is never returned and can never act as fallback authority.
 */
export function resolveNoisiaCodexAdvisorCredentialV1(environment) {
  const advisorCredential = readExplicitEnvironmentValue(
    environment,
    ADVISOR_CREDENTIAL_ENVIRONMENT_NAME
  );

  if (!advisorCredential) {
    throw new NoisiaCodexAdvisorCredentialError(
      "advisor_credential_unavailable",
      `${ADVISOR_CREDENTIAL_ENVIRONMENT_NAME} is required for a development Advisor review.`
    );
  }

  if (hasAnthropicCredentialCollision(environment, advisorCredential)) {
    throw new NoisiaCodexAdvisorCredentialError(
      "advisor_product_credential_collision",
      `${ADVISOR_CREDENTIAL_ENVIRONMENT_NAME} must be distinct from the product runtime credential.`
    );
  }

  return Object.freeze({
    apiKey: advisorCredential,
    credentialEnvironmentName: ADVISOR_CREDENTIAL_ENVIRONMENT_NAME,
    lane: "development_advisor"
  });
}

/**
 * Creates a development Advisor transport through an injected factory. The factory
 * receives only the dedicated Advisor credential and non-secret lane metadata.
 */
export function createNoisiaCodexAdvisorTransportV1({
  environment,
  createTransport
}) {
  if (typeof createTransport !== "function") {
    throw new NoisiaCodexAdvisorCredentialError(
      "advisor_transport_factory_required",
      "A development-only Advisor transport factory is required."
    );
  }

  const credential = resolveNoisiaCodexAdvisorCredentialV1(environment);
  return createTransport(Object.freeze({ ...credential }));
}
