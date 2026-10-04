import test from "node:test";
import assert from "node:assert/strict";
import { secretMatches } from "./secret.ts";

test("matches the same secret", () => {
  assert.equal(secretMatches("s3cret-token", "s3cret-token"), true);
});

test("refuses a different secret, of any length", () => {
  assert.equal(secretMatches("s3cret-tokem", "s3cret-token"), false);
  assert.equal(secretMatches("s3cret", "s3cret-token"), false);
  assert.equal(secretMatches("s3cret-token-and-more", "s3cret-token"), false);
});

test("refuses a missing or empty secret", () => {
  assert.equal(secretMatches(null, "s3cret-token"), false);
  assert.equal(secretMatches(undefined, "s3cret-token"), false);
  assert.equal(secretMatches("", "s3cret-token"), false);
});
