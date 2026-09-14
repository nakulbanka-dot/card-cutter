import {
  FEATURE_NAMES, type FeatureVector, type Scaler, applyScaler, fitScaler,
} from "./features.ts";

/**
 * Logistic regression, trained by gradient descent.
 *
 * Hand-rolled rather than pulled from a library for three reasons: it runs in
 * the same process that serves requests, so there is no Python step and no
 * model server; the whole model is a JSON file of a dozen numbers; and the
 * weights are readable — you can look at them and see that, say, author
 * credentials matter more than keyword density, which is a fact about your own
 * judgment worth knowing.
 *
 * If linear stops being enough, gradient boosting is the upgrade. It is not
 * the place to start.
 */

export interface Model {
  weights: number[];
  bias: number;
  scaler: Scaler;
  /** Guards against loading weights trained on a different feature layout. */
  featureNames: readonly string[];
  trainedAt: string;
  metrics: TrainMetrics;
}

export interface TrainMetrics {
  trainRows: number;
  testRows: number;
  trainAccuracy: number;
  testAccuracy: number;
  testAuc: number;
  /** Share of positives in the test split — the accuracy floor to beat. */
  baseRate: number;
  epochs: number;
  finalLoss: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

function dot(w: number[], x: number[], bias: number): number {
  let s = bias;
  for (let i = 0; i < w.length; i++) s += w[i] * x[i];
  return s;
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  /** L2 penalty. Small but non-zero — features here are correlated. */
  l2?: number;
  /** Fraction held out for reporting. */
  testSplit?: number;
  seed?: number;
  /**
   * Group id per row. Rows sharing a group are kept on the same side of the
   * split. Paragraphs mined from one article are near-duplicates of each
   * other — same outlet, same subject, same prose style — so splitting them
   * across train and test would let the model recognise the article rather
   * than learn the task, and report an accuracy it has not earned.
   */
  groups?: string[];
}

/** Deterministic PRNG so a rerun on the same data gives the same model. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function train(
  rawX: FeatureVector[],
  y: number[],
  opts: TrainOptions = {},
): Model {
  const {
    epochs = 200, learningRate = 0.1, l2 = 1e-4, testSplit = 0.2, seed = 42,
  } = opts;

  if (rawX.length !== y.length) throw new Error("features and labels differ in length");
  if (rawX.length < 20) throw new Error(`need at least 20 rows, got ${rawX.length}`);

  // Shuffle before splitting; the corpus arrives grouped by year and event, so
  // an unshuffled tail split would test on a different distribution entirely.
  const rand = rng(seed);
  const { groups } = opts;

  let trainIdx: number[];
  let testIdx: number[];

  if (groups) {
    // Shuffle whole groups, then assign groups to sides until the test share
    // is met. Keeps every row of an article together.
    const byGroup = new Map<string, number[]>();
    groups.forEach((g, i) => {
      const list = byGroup.get(g) ?? [];
      list.push(i);
      byGroup.set(g, list);
    });

    const keys = [...byGroup.keys()];
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }

    const target = Math.floor(rawX.length * testSplit);
    testIdx = [];
    trainIdx = [];
    for (const k of keys) {
      const rows = byGroup.get(k)!;
      if (testIdx.length < target) testIdx.push(...rows);
      else trainIdx.push(...rows);
    }
  } else {
    const order = rawX.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const cut = Math.floor(order.length * (1 - testSplit));
    trainIdx = order.slice(0, cut);
    testIdx = order.slice(cut);
  }

  // Fit the scaler on training rows only — fitting on everything leaks the
  // test distribution into the model.
  const scaler = fitScaler(trainIdx.map((i) => rawX[i]));
  const X = rawX.map((v) => applyScaler(v, scaler));

  const d = FEATURE_NAMES.length;
  const weights = new Array(d).fill(0);
  let bias = 0;
  let finalLoss = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    let loss = 0;

    for (const i of trainIdx) {
      const p = sigmoid(dot(weights, X[i], bias));
      const err = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
      loss -= y[i] * Math.log(p + 1e-12) + (1 - y[i]) * Math.log(1 - p + 1e-12);
    }

    const n = trainIdx.length;
    for (let j = 0; j < d; j++) {
      weights[j] -= learningRate * (gw[j] / n + l2 * weights[j]);
    }
    bias -= learningRate * (gb / n);
    finalLoss = loss / n;
  }

  const accuracy = (idx: number[]) => {
    if (idx.length === 0) return 0;
    let right = 0;
    for (const i of idx) {
      const p = sigmoid(dot(weights, X[i], bias));
      if ((p >= 0.5 ? 1 : 0) === y[i]) right++;
    }
    return right / idx.length;
  };

  const scores = testIdx.map((i) => ({ p: sigmoid(dot(weights, X[i], bias)), y: y[i] }));

  return {
    weights,
    bias,
    scaler,
    featureNames: FEATURE_NAMES,
    trainedAt: new Date().toISOString(),
    metrics: {
      trainRows: trainIdx.length,
      testRows: testIdx.length,
      trainAccuracy: accuracy(trainIdx),
      testAccuracy: accuracy(testIdx),
      testAuc: auc(scores),
      baseRate: scores.length ? scores.filter((s) => s.y === 1).length / scores.length : 0,
      epochs,
      finalLoss,
    },
  };
}

/**
 * Area under the ROC curve — the probability that a random positive outranks a
 * random negative. Reported because accuracy is misleading when the classes
 * are unbalanced, and ranking is what this model is actually for.
 */
export function auc(scores: { p: number; y: number }[]): number {
  const pos = scores.filter((s) => s.y === 1);
  const neg = scores.filter((s) => s.y === 0);
  if (pos.length === 0 || neg.length === 0) return 0.5;

  const sorted = [...scores].sort((a, b) => a.p - b.p);
  let rankSum = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].y === 1) rankSum += i + 1;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

/** Probability that this passage is what the query wanted. */
export function score(model: Model, raw: FeatureVector): number {
  if (model.featureNames.length !== raw.length) {
    throw new Error(
      `model expects ${model.featureNames.length} features, got ${raw.length} — retrain after changing the feature set`,
    );
  }
  return sigmoid(dot(model.weights, applyScaler(raw, model.scaler), model.bias));
}

/** Weights in readable order. What the model decided matters. */
export function explain(model: Model): { feature: string; weight: number }[] {
  return model.featureNames
    .map((feature, i) => ({ feature, weight: model.weights[i] }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}
