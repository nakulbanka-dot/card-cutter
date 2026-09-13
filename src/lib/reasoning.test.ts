import test from "node:test";
import assert from "node:assert/strict";
import { reasoningFor, effortConfig } from "./reasoning.ts";

test("Opus gets adaptive thinking and an effort level", () => {
  const r = reasoningFor("claude-opus-5", "high", 8000);
  assert.deepEqual(r.thinking, { type: "adaptive" });
  assert.equal(r.effort, "high");
  assert.deepEqual(effortConfig(r), { effort: "high" });
});

test("Haiku gets a token budget and NO effort field", () => {
  const r = reasoningFor("claude-haiku-4-5", "high", 8000);
  assert.equal(r.thinking.type, "enabled");
  assert.equal(r.effort, undefined);
  // effort on Haiku is a 400, so it must not be sent at all.
  assert.deepEqual(effortConfig(r), {});
});

test("thinking budget stays under max_tokens and above the 1024 floor", () => {
  for (const maxTokens of [2000, 4000, 8000, 16000]) {
    const r = reasoningFor("claude-haiku-4-5", "low", maxTokens);
    assert.equal(r.thinking.type, "enabled");
    const budget = (r.thinking as { budget_tokens: number }).budget_tokens;
    assert.ok(budget >= 1024, `budget ${budget} below floor`);
    assert.ok(budget < maxTokens, `budget ${budget} not under ${maxTokens}`);
  }
});

test("Sonnet 5 is treated as adaptive, not budgeted", () => {
  assert.deepEqual(reasoningFor("claude-sonnet-5", "low", 4000).thinking, {
    type: "adaptive",
  });
});
