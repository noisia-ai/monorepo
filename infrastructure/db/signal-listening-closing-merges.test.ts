import test from "node:test";
import assert from "node:assert/strict";
import { signalListeningCarriedClosingMergesV1 } from "./signal-listening-cycle";

const catalog = [{ topic_key: "bitter" }, { topic_key: "bitterness" }, { topic_key: "price" }];

test("a merge the last pass asked for travels with the map while both of its topics are still in it", () => {
  const review = { settling: true, closing_merges: [{ stays: "bitter", folded: "bitterness" }, { stays: "price", folded: "auction" }] };
  assert.deepEqual(signalListeningCarriedClosingMergesV1(review, catalog), [{ stays: "bitter", folded: "bitterness" }]);
  // Once a round folds the two itself, or drops one of them, there is nothing left to carry.
  assert.deepEqual(signalListeningCarriedClosingMergesV1(review, [{ topic_key: "bitter" }, { topic_key: "price" }]), []);
});

test("a review without merges, or with something else in their place, carries nothing", () => {
  for (const review of [null, undefined, {}, { closing_merges: "bitter" }, { closing_merges: [null, 3, { stays: "bitter" }, { stays: "bitter", folded: "bitter" }] }]) {
    assert.deepEqual(signalListeningCarriedClosingMergesV1(review, catalog), []);
  }
});
