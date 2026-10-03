import assert from "node:assert/strict";
import test from "node:test";

import { loadSignalTopicCandidatesForAccessV1 } from "./signal-topics-management";

test("a catalogue reader without adoption capability never loads or receives historical candidate excerpts", async () => {
  let readerCalls = 0;
  const unexpectedRead = async (): Promise<never> => {
    readerCalls++;
    throw new Error("Historical private excerpt must not be read");
  };
  const result = await loadSignalTopicCandidatesForAccessV1({ canAdopt: false,
    loadCurrent: unexpectedRead, loadLegacy: unexpectedRead });
  assert.equal(readerCalls, 0);
  assert.deepEqual(result, { current: null, legacy: { run_key: null, items: [] } });
});
