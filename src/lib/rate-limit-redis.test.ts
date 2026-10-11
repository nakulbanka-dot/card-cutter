import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "redis";
import { budgetKeys, checkSearchBudget, resetLimits } from "./rate-limit.ts";
import { redisCommand } from "./redis.ts";

const LIMITS = { perVisitorPerDay: 3, globalPerDay: 5, globalPerMonth: 8 };
const T = new Date("2026-09-14T12:00:00Z");

// ---------- without a real Redis: the wiring and the fallbacks ----------

test("with no Redis configured, counts in memory as before", async () => {
  resetLimits();
  for (let i = 0; i < 3; i++) {
    assert.equal((await checkSearchBudget("a", T, LIMITS, null)).allowed, true);
  }
  const blocked = await checkSearchBudget("a", T, LIMITS, null);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "visitor");
});

test("sends one script with the three keys and the limits", async () => {
  let sent: string[] = [];
  await checkSearchBudget("1.2.3.4", T, LIMITS, async (cmd) => {
    sent = cmd;
    return [1, 1, 0];
  });
  assert.equal(sent[0], "EVAL");
  assert.equal(sent[2], "3");
  assert.deepEqual(sent.slice(3, 6), budgetKeys("1.2.3.4", T));
  assert.deepEqual(sent.slice(6, 9), ["3", "5", "8"]);
});

test("all three keys share a hash slot, as a clustered Redis requires", () => {
  for (const key of budgetKeys("1.2.3.4", T)) assert.match(key, /\{limits\}/);
});

test("reads an allowed reply", async () => {
  const r = await checkSearchBudget("a", T, LIMITS, async () => [1, 2, 0]);
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 1);
  assert.equal(r.reason, undefined);
});

test("reads each kind of refusal", async () => {
  const visitor = await checkSearchBudget("a", T, LIMITS, async () => [0, 3, 1]);
  assert.deepEqual([visitor.allowed, visitor.reason, visitor.remaining], [false, "visitor", 0]);
  const day = await checkSearchBudget("a", T, LIMITS, async () => [0, 1, 2]);
  assert.deepEqual([day.allowed, day.reason, day.remaining], [false, "global", 2]);
  const month = await checkSearchBudget("a", T, LIMITS, async () => [0, 1, 3]);
  assert.deepEqual([month.allowed, month.reason], [false, "month"]);
});

test("a Redis error falls back to memory instead of failing the search", async (t) => {
  t.mock.method(console, "error", () => {});
  resetLimits();
  const r = await checkSearchBudget("a", T, LIMITS, async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 2, "the memory counter took this search");
});

test("a reply that is not the script's falls back to memory", async (t) => {
  t.mock.method(console, "error", () => {});
  resetLimits();
  const r = await checkSearchBudget("a", T, LIMITS, async () => "OK");
  assert.equal(r.allowed, true);
});

test("a Redis that never answers falls back to memory", async (t) => {
  t.mock.method(console, "error", () => {});
  resetLimits();
  const started = Date.now();
  const r = await checkSearchBudget("a", T, LIMITS, () => new Promise(() => {}));
  assert.equal(r.allowed, true);
  assert.ok(Date.now() - started < 5_000);
});

// ---------- against a real Redis ----------
//
// The script is the part that matters and the part a fake cannot check, so
// these run it for real. CI starts a Redis service and sets REDIS_TEST_URL;
// locally, point it at a scratch Redis to run them. Every test counts on its
// own made-up date, so no two share a key and nothing existing is touched.

const REDIS = process.env.REDIS_TEST_URL;
const needsRedis = { skip: REDIS ? false : "set REDIS_TEST_URL to run against Redis" };

let dates = 0;
/** A date no other test uses, so its day and month keys are its own. */
function freshDate(): Date {
  dates++;
  return new Date(Date.UTC(2100 + dates, 0, 15, 12));
}

async function withRedis(fn: (run: (cmd: string[]) => Promise<unknown>, used: Date[]) => Promise<void>) {
  const client = createClient({ url: REDIS });
  await client.connect();
  const used: Date[] = [];
  try {
    await fn((cmd) => client.sendCommand(cmd), used);
  } finally {
    for (const d of used) {
      const [, dayKey, monthKey] = budgetKeys("x", d);
      const date = d.toISOString().slice(0, 10);
      const visitors = await client.keys(`card-cutter:{limits}:visitor:${date}:*`);
      await client.del([dayKey, monthKey, ...visitors]);
    }
    await client.quit();
  }
}

test("Redis: allows up to the visitor's limit, then refuses", needsRedis, async () => {
  await withRedis(async (run, used) => {
    const T = freshDate(); used.push(T);
    for (let i = 0; i < 3; i++) {
      const r = await checkSearchBudget("a", T, LIMITS, run);
      assert.equal(r.allowed, true, `search ${i + 1}`);
      assert.equal(r.remaining, 2 - i);
    }
    const blocked = await checkSearchBudget("a", T, LIMITS, run);
    assert.deepEqual([blocked.allowed, blocked.reason, blocked.remaining], [false, "visitor", 0]);
  });
});

test("Redis: one visitor's limit does not touch another's", needsRedis, async () => {
  await withRedis(async (run, used) => {
    const T = freshDate(); used.push(T);
    for (let i = 0; i < 3; i++) await checkSearchBudget("a", T, LIMITS, run);
    assert.equal((await checkSearchBudget("b", T, LIMITS, run)).allowed, true);
  });
});

test("Redis: the daily cap holds across visitors", needsRedis, async () => {
  await withRedis(async (run, used) => {
    const T = freshDate(); used.push(T);
    for (const v of ["a", "a", "b", "b", "c"]) {
      assert.equal((await checkSearchBudget(v, T, LIMITS, run)).allowed, true);
    }
    const r = await checkSearchBudget("d", T, LIMITS, run);
    assert.deepEqual([r.allowed, r.reason], [false, "global"]);
  });
});

test("Redis: the monthly cap holds across days", needsRedis, async () => {
  await withRedis(async (run, used) => {
    const day1 = freshDate(); used.push(day1);
    const day2 = new Date(day1.getTime() + 24 * 3600 * 1000); used.push(day2);
    for (const v of ["a", "b", "c", "d", "e"]) await checkSearchBudget(v, day1, LIMITS, run);
    for (const v of ["a", "b", "c"]) {
      assert.equal((await checkSearchBudget(v, day2, LIMITS, run)).allowed, true);
    }
    const r = await checkSearchBudget("f", day2, LIMITS, run);
    assert.deepEqual([r.allowed, r.reason], [false, "month"]);
  });
});

test("Redis: a refused search counts against nothing", needsRedis, async () => {
  await withRedis(async (run, used) => {
    const T = freshDate(); used.push(T);
    for (let i = 0; i < 3; i++) await checkSearchBudget("a", T, LIMITS, run);
    for (let i = 0; i < 10; i++) await checkSearchBudget("a", T, LIMITS, run);
    // Had the ten refusals counted, the global cap of five would be gone.
    assert.equal((await checkSearchBudget("b", T, LIMITS, run)).allowed, true);
    assert.equal((await checkSearchBudget("c", T, LIMITS, run)).allowed, true);
  });
});

test("Redis: searches at the same moment cannot overspend the cap", needsRedis, async () => {
  // The bug this exists to fix: separate counters, each happy to say yes.
  // Fifty searches at once against a cap of five must let exactly five in.
  await withRedis(async (run, used) => {
    const T = freshDate(); used.push(T);
    const many = { perVisitorPerDay: 100, globalPerDay: 5, globalPerMonth: 100 };
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => checkSearchBudget(`v${i}`, T, many, run)),
    );
    assert.equal(results.filter((r) => r.allowed).length, 5);
  });
});

test("Redis: the counters expire instead of piling up", needsRedis, async () => {
  const client = createClient({ url: REDIS });
  await client.connect();
  try {
    await withRedis(async (run, used) => {
      const T = freshDate(); used.push(T);
      await checkSearchBudget("a", T, LIMITS, run);
      const [visitor, day, month] = budgetKeys("a", T);
      for (const key of [visitor, day]) {
        const ttl = await client.ttl(key);
        assert.ok(ttl > 24 * 3600 && ttl <= 2 * 24 * 3600, `${key} ttl ${ttl}`);
      }
      assert.ok((await client.ttl(month)) > 31 * 24 * 3600);
    });
  } finally {
    await client.quit();
  }
});

test("Redis REST: the same script works over the HTTP interface", needsRedis, async () => {
  // Upstash's REST API takes the command as a JSON array and answers
  // { result }. This stands one up in front of the real Redis, so what is
  // checked is the request redisCommand actually sends.
  const client = createClient({ url: REDIS });
  await client.connect();
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const cmd = (JSON.parse(body) as unknown[]).map(String);
      const result = await client.sendCommand(cmd);
      res.end(JSON.stringify({ result }));
    } catch (err) {
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const cfg = { url: `http://127.0.0.1:${port}`, token: "t" };
  const T = freshDate();
  try {
    const run = (cmd: string[]) => redisCommand(cfg, cmd);
    for (let i = 0; i < 3; i++) {
      assert.equal((await checkSearchBudget("a", T, LIMITS, run)).allowed, true);
    }
    const r = await checkSearchBudget("a", T, LIMITS, run);
    assert.deepEqual([r.allowed, r.reason], [false, "visitor"]);
  } finally {
    server.close();
    await client.del(budgetKeys("a", T));
    await client.quit();
  }
});
