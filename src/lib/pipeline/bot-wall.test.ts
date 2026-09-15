import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeBotWall } from "./bot-wall.ts";

/**
 * These import the real check rather than a copy of its pattern.
 *
 * The previous version of this file redeclared the regex inline, so it tested
 * a duplicate and passed happily while a reCAPTCHA page went on reaching the
 * results — and, worse, the citation. A test that cannot fail when the code
 * is wrong is not a test.
 */

test("catches the wall titles that actually appeared", () => {
  for (const title of [
    "Checking your browser - reCAPTCHA",
    "Attention Required! | Cloudflare",
    "Access Denied",
    "Please verify you are human",
    "Just a moment... enable javascript to continue",
  ]) {
    assert.ok(looksLikeBotWall(title), `missed: ${title}`);
  }
});

test("does not catch real articles", () => {
  for (const title of [
    "Nuclear energy and climate change",
    "Nuclear Energy and Climate Change Mitigation | Congress.gov",
    "5 reasons nuclear energy is key to the climate transition",
  ]) {
    assert.equal(looksLikeBotWall(title), false, `false positive: ${title}`);
  }
});

test("a wall title is rejected even when the article itself was read", () => {
  // The case that shipped: the paid extractor got the article, but the
  // separate metadata request was blocked, so the wall's <title> became the
  // article title and flowed into the citation. Only the title is wrong
  // there, which is why the title is checked on its own.
  const fromMetadataFetch = "Checking your browser - reCAPTCHA";
  const fromExtractor = "Nuclear power and the decarbonisation of electricity";

  assert.ok(looksLikeBotWall(fromMetadataFetch));
  assert.equal(looksLikeBotWall(fromExtractor), false);
});
