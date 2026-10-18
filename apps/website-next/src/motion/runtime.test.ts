import assert from "node:assert/strict";
import { test } from "node:test";
import { interpolate, spring } from "./runtime";

test("interpolate maps linearly inside the range", () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
  assert.equal(interpolate(15, [10, 20, 30], [0, 1, 0]), 0.5);
});

test("interpolate clamps when asked and extends by default", () => {
  assert.equal(interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "clamp" }), 0);
  assert.equal(interpolate(20, [0, 10], [0, 100], { extrapolateRight: "clamp" }), 100);
  assert.equal(interpolate(20, [0, 10], [0, 100]), 200);
});

test("spring starts at 0, settles near 1 and is deterministic", () => {
  assert.equal(spring({ frame: 0, fps: 30 }), 0);
  const settled = spring({ frame: 120, fps: 30, config: { damping: 18, mass: 0.7, stiffness: 120 } });
  assert.ok(Math.abs(settled - 1) < 0.01, `expected ~1, got ${settled}`);
  assert.equal(spring({ frame: 17, fps: 30 }), spring({ frame: 17, fps: 30 }));
});
