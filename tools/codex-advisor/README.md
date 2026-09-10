# Codex Advisor credential boundary

This directory is development-only tooling. It is deliberately outside the pnpm
workspace and has no product provider client, filesystem environment loader, or import
from Studio/Workers.

Future Prompt Looping or Backend Advisor runners must import
`./credential-lane.mjs`, pass the runner's explicit `process.env`, and inject their own
development-only transport factory:

```js
createNoisiaCodexAdvisorTransportV1({
  environment: process.env,
  createTransport: ({ apiKey }) => fakeOrDevelopmentOnlyTransport({ apiKey })
});
```

The only supported credential name for this boundary is:

```text
NOISIA_CODEX_ADVISOR_ANTHROPIC_API_KEY=<advisor-only-development-key>
```

There is no product-key fallback. Missing authority or an equal Advisor/product value
fails before transport creation. `ADVISOR_PREFLIGHT_ONLY` controls preflight behavior;
it never supplies credentials. Do not load `.env` files in an Advisor runner and never
import this directory from a product package.

Run the contract and repository enforcement tests with:

```bash
node --test tools/codex-advisor/*.test.mjs
```
