import test from "node:test";
import assert from "node:assert/strict";
import { train, score, auc, explain } from "./logistic.ts";
import { FEATURE_NAMES } from "./features.ts";

/** Synthetic rows where feature 0 alone decides the label. */
function separable(n: number) {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const positive = i % 2 === 0;
    const v = new Array(FEATURE_NAMES.length).fill(0).map(() => Math.random() * 0.1);
    v[0] = positive ? 1 + Math.random() : -1 - Math.random();
    X.push(v);
    y.push(positive ? 1 : 0);
  }
  return { X, y };
}

test("learns a separable signal", () => {
  const { X, y } = separable(400);
  const m = train(X, y, { epochs: 300 });
  assert.ok(m.metrics.testAccuracy > 0.9, `accuracy was ${m.metrics.testAccuracy}`);
  assert.ok(m.metrics.testAuc > 0.95, `auc was ${m.metrics.testAuc}`);
});

test("the deciding feature gets the largest weight", () => {
  const { X, y } = separable(400);
  const top = explain(train(X, y, { epochs: 300 }))[0];
  assert.equal(top.feature, FEATURE_NAMES[0]);
});

test("cannot beat chance on pure noise", () => {
  const X = Array.from({ length: 300 }, () =>
    new Array(FEATURE_NAMES.length).fill(0).map(() => Math.random()),
  );
  const y = X.map(() => (Math.random() > 0.5 ? 1 : 0));
  const m = train(X, y, { epochs: 200 });
  // A model that "learns" noise is a model with a bug.
  assert.ok(m.metrics.testAuc < 0.75, `auc on noise was ${m.metrics.testAuc}`);
});

test("training is deterministic for a given seed", () => {
  const { X, y } = separable(200);
  const a = train(X, y, { seed: 7, epochs: 100 });
  const b = train(X, y, { seed: 7, epochs: 100 });
  assert.deepEqual(a.weights, b.weights);
});

test("scores are probabilities", () => {
  const { X, y } = separable(200);
  const m = train(X, y, { epochs: 200 });
  for (const row of X.slice(0, 30)) {
    const p = score(m, row);
    assert.ok(p >= 0 && p <= 1, `score out of range: ${p}`);
  }
});

test("scoring rejects a vector of the wrong width", () => {
  const { X, y } = separable(100);
  const m = train(X, y, { epochs: 50 });
  assert.throws(() => score(m, [1, 2, 3]), /expects \d+ features/);
});

test("refuses to train on too little data", () => {
  assert.throws(() => train([[1], [0]], [1, 0]), /at least 20 rows/);
});

test("auc is 1 for a perfect ranking and 0.5 for a coin flip", () => {
  assert.equal(auc([{ p: 0.9, y: 1 }, { p: 0.8, y: 1 }, { p: 0.2, y: 0 }]), 1);
  const tied = Array.from({ length: 100 }, (_, i) => ({ p: 0.5, y: i % 2 }));
  assert.ok(Math.abs(auc(tied) - 0.5) < 0.06);
});
