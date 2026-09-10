import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVISOR_CREDENTIAL_ENVIRONMENT_NAME,
  NoisiaCodexAdvisorCredentialError,
  createNoisiaCodexAdvisorTransportV1,
  resolveNoisiaCodexAdvisorCredentialV1
} from "./credential-lane.mjs";

const PRODUCT_RUNTIME_CREDENTIAL_ENVIRONMENT_NAME = "ANTHROPIC_API_KEY";

test("dedicated Advisor variable resolves and builds a fake transport", async () => {
  const syntheticAdvisorCredential = "synthetic-advisor-only-value";
  const received = [];
  const transport = createNoisiaCodexAdvisorTransportV1({
    environment: {
      [ADVISOR_CREDENTIAL_ENVIRONMENT_NAME]: syntheticAdvisorCredential
    },
    createTransport(configuration) {
      received.push(configuration);
      return { lane: configuration.lane, send: async () => ({ ok: true }) };
    }
  });

  assert.equal(transport.lane, "development_advisor");
  assert.deepEqual(await transport.send(), { ok: true });
  assert.deepEqual(received, [{
    apiKey: syntheticAdvisorCredential,
    credentialEnvironmentName: ADVISOR_CREDENTIAL_ENVIRONMENT_NAME,
    lane: "development_advisor"
  }]);
});

test("absent Advisor variable fails closed before transport creation", () => {
  let factoryCalls = 0;
  assert.throws(
    () => createNoisiaCodexAdvisorTransportV1({
      environment: {},
      createTransport() {
        factoryCalls += 1;
        return {};
      }
    }),
    (error) => error instanceof NoisiaCodexAdvisorCredentialError
      && error.code === "advisor_credential_unavailable"
  );
  assert.equal(factoryCalls, 0);
});

test("product credential alone never becomes Advisor authority", () => {
  const syntheticProductCredential = "synthetic-product-only-value";
  assert.throws(
    () => resolveNoisiaCodexAdvisorCredentialV1({
      [PRODUCT_RUNTIME_CREDENTIAL_ENVIRONMENT_NAME]: syntheticProductCredential
    }),
    (error) => error instanceof NoisiaCodexAdvisorCredentialError
      && error.code === "advisor_credential_unavailable"
      && !error.message.includes(syntheticProductCredential)
  );
});

test("equal Advisor and product values fail closed without exposing either value", () => {
  const syntheticSharedCredential = "synthetic-value-that-must-not-appear";
  let factoryCalls = 0;
  assert.throws(
    () => createNoisiaCodexAdvisorTransportV1({
      environment: {
        [ADVISOR_CREDENTIAL_ENVIRONMENT_NAME]: syntheticSharedCredential,
        [PRODUCT_RUNTIME_CREDENTIAL_ENVIRONMENT_NAME]: syntheticSharedCredential
      },
      createTransport() {
        factoryCalls += 1;
        return {};
      }
    }),
    (error) => error instanceof NoisiaCodexAdvisorCredentialError
      && error.code === "advisor_product_credential_collision"
      && !error.message.includes(syntheticSharedCredential)
  );
  assert.equal(factoryCalls, 0);
});

test("distinct values forward only the dedicated Advisor credential", () => {
  const syntheticAdvisorCredential = "synthetic-distinct-advisor-value";
  const syntheticProductCredential = "synthetic-distinct-product-value";
  let received;

  createNoisiaCodexAdvisorTransportV1({
    environment: {
      [ADVISOR_CREDENTIAL_ENVIRONMENT_NAME]: syntheticAdvisorCredential,
      [PRODUCT_RUNTIME_CREDENTIAL_ENVIRONMENT_NAME]: syntheticProductCredential
    },
    createTransport(configuration) {
      received = configuration;
      return {};
    }
  });

  assert.equal(received.apiKey, syntheticAdvisorCredential);
  assert.notEqual(received.apiKey, syntheticProductCredential);
  assert.doesNotMatch(JSON.stringify(received), /synthetic-distinct-product-value/u);
});

test("Advisor preflight control cannot grant a missing credential", () => {
  assert.throws(
    () => resolveNoisiaCodexAdvisorCredentialV1({ ADVISOR_PREFLIGHT_ONLY: "1" }),
    (error) => error instanceof NoisiaCodexAdvisorCredentialError
      && error.code === "advisor_credential_unavailable"
  );
});

test("resolution is deterministic and does not mutate the supplied environment", () => {
  const environment = Object.freeze({
    [ADVISOR_CREDENTIAL_ENVIRONMENT_NAME]: "  synthetic-advisor-value  "
  });
  const first = resolveNoisiaCodexAdvisorCredentialV1(environment);
  const second = resolveNoisiaCodexAdvisorCredentialV1(environment);

  assert.deepEqual(first, second);
  assert.equal(first.apiKey, "synthetic-advisor-value");
  assert.equal(
    environment[ADVISOR_CREDENTIAL_ENVIRONMENT_NAME],
    "  synthetic-advisor-value  "
  );
});
