import test from "node:test";
import assert from "node:assert/strict";
import { easeOutCubic, countUpValue } from "./ease.ts";

test("runs from 0 to 1 across the duration", () => {
  assert.equal(easeOutCubic(0, 1000), 0);
  assert.equal(easeOutCubic(1000, 1000), 1);
  assert.ok(easeOutCubic(500, 1000) > 0.5, "eases out, so it is past halfway at half time");
});

test("NEGATIVE elapsed clamps to zero, never inverts", () => {
  // An rAF timestamp can predate the performance.now() taken just before it.
  // Unclamped, the cubic inverts and the counter renders a negative number.
  for (const elapsed of [-1, -50, -5000]) {
    assert.equal(easeOutCubic(elapsed, 1400), 0, `elapsed ${elapsed} must clamp`);
    assert.equal(countUpValue(4_853_260, elapsed, 1400), 0);
  }
});

test("overshooting the duration clamps to the target", () => {
  assert.equal(countUpValue(4_853_260, 99_999, 1400), 4_853_260);
});

test("never exceeds the target or goes below zero", () => {
  for (let e = -2000; e <= 3000; e += 50) {
    const v = countUpValue(4_853_260, e, 1400);
    assert.ok(v >= 0 && v <= 4_853_260, `out of range at elapsed=${e}: ${v}`);
  }
});

test("a zero or negative duration lands on the target rather than dividing by zero", () => {
  assert.equal(countUpValue(500, 10, 0), 500);
  assert.ok(Number.isFinite(countUpValue(500, 10, -1)));
});
