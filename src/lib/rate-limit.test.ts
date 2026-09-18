import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAndCount, resetLimits, visitorFrom, configuredLimits,
  DEFAULT_LIMITS, DEV_LIMITS, checkPerHour,
} from "./rate-limit.ts";

const LIMITS = { perVisitorPerDay: 3, globalPerDay: 5, globalPerMonth: 100 };
const T = new Date("2026-09-14T12:00:00Z");

test("allows up to the visitor's limit, then refuses", () => {
  resetLimits();
  for (let i = 0; i < 3; i++) {
    assert.equal(checkAndCount("a", T, LIMITS).allowed, true, `search ${i + 1}`);
  }
  const blocked = checkAndCount("a", T, LIMITS);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "visitor");
});

test("a refused search does not consume the global budget", () => {
  resetLimits();
  for (let i = 0; i < 3; i++) checkAndCount("a", T, LIMITS);
  checkAndCount("a", T, LIMITS); // refused
  checkAndCount("a", T, LIMITS); // refused
  // Global should have counted 3, not 5, so another visitor still gets through.
  assert.equal(checkAndCount("b", T, LIMITS).allowed, true);
});

test("the global ceiling stops a crowd of well-behaved visitors", () => {
  resetLimits();
  assert.equal(checkAndCount("a", T, LIMITS).allowed, true);
  assert.equal(checkAndCount("b", T, LIMITS).allowed, true);
  assert.equal(checkAndCount("c", T, LIMITS).allowed, true);
  assert.equal(checkAndCount("d", T, LIMITS).allowed, true);
  assert.equal(checkAndCount("e", T, LIMITS).allowed, true);
  const sixth = checkAndCount("f", T, LIMITS);
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.reason, "global", "a fresh visitor is refused by the site budget");
});

test("counters reset on the next UTC day", () => {
  resetLimits();
  for (let i = 0; i < 3; i++) checkAndCount("a", T, LIMITS);
  assert.equal(checkAndCount("a", T, LIMITS).allowed, false);

  const tomorrow = new Date("2026-09-15T00:30:00Z");
  assert.equal(checkAndCount("a", tomorrow, LIMITS).allowed, true);
});

test("visitors are counted separately", () => {
  resetLimits();
  for (let i = 0; i < 3; i++) checkAndCount("a", T, LIMITS);
  assert.equal(checkAndCount("a", T, LIMITS).allowed, false);
  assert.equal(checkAndCount("b", T, LIMITS).allowed, true, "one heavy user must not block others");
});

test("remaining counts down and never goes negative", () => {
  resetLimits();
  assert.equal(checkAndCount("a", T, LIMITS).remaining, 2);
  assert.equal(checkAndCount("a", T, LIMITS).remaining, 1);
  assert.equal(checkAndCount("a", T, LIMITS).remaining, 0);
  assert.equal(checkAndCount("a", T, LIMITS).remaining, 0);
});

test("reset time is seconds until UTC midnight", () => {
  resetLimits();
  const r = checkAndCount("a", new Date("2026-09-14T23:00:00Z"), LIMITS);
  assert.ok(r.resetInSeconds > 3500 && r.resetInSeconds <= 3600, `got ${r.resetInSeconds}`);
});

test("visitor id comes from the first forwarded address", () => {
  assert.equal(
    visitorFrom(new Headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" })),
    "203.0.113.5",
  );
  assert.equal(visitorFrom(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(visitorFrom(new Headers()), "unknown");
});

test("development gets generous defaults, production tight ones", () => {
  // The public defaults are sized for a shared search budget. Applying them
  // to a dev machine just stops you working after five queries.
  assert.equal(configuredLimits(true).perVisitorPerDay, DEFAULT_LIMITS.perVisitorPerDay);
  assert.equal(configuredLimits(false).perVisitorPerDay, DEV_LIMITS.perVisitorPerDay);
  assert.ok(DEV_LIMITS.perVisitorPerDay > DEFAULT_LIMITS.perVisitorPerDay);
});

test("the monthly cap holds even when daily limits are generous", () => {
  resetLimits();
  // Search credits renew monthly, so a loose daily allowance can still
  // exhaust the month. This is the ceiling that protects the budget.
  const loose = { perVisitorPerDay: 100, globalPerDay: 100, globalPerMonth: 4 };
  for (let i = 0; i < 4; i++) {
    assert.equal(checkAndCount(`v${i}`, T, loose).allowed, true, `search ${i + 1}`);
  }
  const over = checkAndCount("someone-new", T, loose);
  assert.equal(over.allowed, false);
  assert.equal(over.reason, "month");
});

test("a new day does not reset the monthly cap", () => {
  resetLimits();
  const loose = { perVisitorPerDay: 100, globalPerDay: 100, globalPerMonth: 2 };
  checkAndCount("a", T, loose);
  checkAndCount("a", T, loose);
  const nextDay = new Date("2026-09-20T09:00:00Z");
  assert.equal(checkAndCount("a", nextDay, loose).allowed, false, "still inside the same month");

  const nextMonth = new Date("2026-10-01T09:00:00Z");
  assert.equal(checkAndCount("a", nextMonth, loose).allowed, true, "new month, new budget");
});

test("per-hour cap lets a real session through and stops a script", () => {
  const at = new Date("2026-09-18T10:00:00Z");
  // A debater cutting every passage of two full searches: 64 calls.
  let allowed = 0;
  for (let i = 0; i < 64; i++) {
    if (checkPerHour("underline", "1.2.3.4", 60, at).allowed) allowed++;
  }
  assert.equal(allowed, 60, "the cap should bite at exactly 60");
});

test("one IP hitting the cap does not affect another", () => {
  const at = new Date("2026-09-18T11:00:00Z");
  for (let i = 0; i < 60; i++) checkPerHour("underline", "9.9.9.9", 60, at);
  assert.equal(checkPerHour("underline", "9.9.9.9", 60, at).allowed, false);
  assert.equal(checkPerHour("underline", "8.8.8.8", 60, at).allowed, true,
    "a different visitor was punished for someone else's traffic");
});

test("the counter resets on the hour", () => {
  const ten = new Date("2026-09-18T12:30:00Z");
  for (let i = 0; i < 60; i++) checkPerHour("underline", "7.7.7.7", 60, ten);
  assert.equal(checkPerHour("underline", "7.7.7.7", 60, ten).allowed, false);
  const eleven = new Date("2026-09-18T13:00:00Z");
  assert.equal(checkPerHour("underline", "7.7.7.7", 60, eleven).allowed, true);
});

test("separate endpoints have separate budgets", () => {
  const at = new Date("2026-09-18T14:00:00Z");
  for (let i = 0; i < 60; i++) checkPerHour("underline", "5.5.5.5", 60, at);
  assert.equal(checkPerHour("underline", "5.5.5.5", 60, at).allowed, false);
  assert.equal(checkPerHour("feedback", "5.5.5.5", 200, at).allowed, true,
    "cutting cards should not use up the labels budget");
});
