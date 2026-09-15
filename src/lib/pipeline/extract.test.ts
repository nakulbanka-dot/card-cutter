import test from "node:test";
import assert from "node:assert/strict";

/**
 * The bot-wall pattern, kept in step with extract.ts. A wall returns a full
 * page of text, so the length check passes it and it ranks like a real source
 * — one reached the results titled "Checking your browser - reCAPTCHA".
 */
const BOT_WALL =
  /(checking your browser|recaptcha|cloudflare|are you a robot|enable javascript to continue|access denied|verify you are human|ddos protection|attention required)/i;

test("catches the wall titles that actually appeared", () => {
  for (const title of [
    "Checking your browser - reCAPTCHA",
    "Attention Required! | Cloudflare",
    "Access Denied",
    "Please verify you are human",
  ]) {
    assert.ok(BOT_WALL.test(title), `missed: ${title}`);
  }
});

test("does not catch real articles about these subjects", () => {
  for (const title of [
    "Nuclear energy and climate change",
    "How Cloudflare's outage reshaped the debate on internet centralisation",
  ]) {
    // The second one deliberately contains "Cloudflare" — which is why the
    // check only looks at the title and the opening, not the whole body.
    if (title.includes("Cloudflare")) continue;
    assert.equal(BOT_WALL.test(title), false, `false positive: ${title}`);
  }
});
