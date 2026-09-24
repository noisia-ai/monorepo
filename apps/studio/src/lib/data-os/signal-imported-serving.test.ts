import assert from "node:assert/strict";
import test from "node:test";
import { allowImportedSignalFallbackV1 } from "./signal-imported-serving";
import type { SignalWorkspaceCorpus } from "./signal-workspace";

const corpus = (role: SignalWorkspaceCorpus["role"]): SignalWorkspaceCorpus => ({
  id: "corpus", role, name: "Existing corpus", status: "ready", validFrom: "2026-01-01",
  methodologySlug: null, outputId: null
});

test("first-import serving is enabled only when the resolved workspace has no operational or legacy source", () => {
  assert.equal(allowImportedSignalFallbackV1({ corpora: [] }), true);
  assert.equal(allowImportedSignalFallbackV1({ corpora: [corpus("strategic")] }), true);
  for (const corpora of [[corpus("operational")], [corpus("legacy")], [corpus("operational"), corpus("legacy")],
    [corpus("operational"), corpus("operational")], [{ ...corpus("operational"), status: "revoked" }]]) {
    assert.equal(allowImportedSignalFallbackV1({ corpora }), false);
  }
});
