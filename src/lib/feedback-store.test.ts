import test from "node:test";
import assert from "node:assert/strict";
import { activeBackend } from "./feedback-store.ts";

/** Save and restore the env keys the backend choice depends on. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const keys = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN", "VERCEL", "CARD_CUTTER_COLLECT",
    "REDIS_URL", "STORAGE_REDIS_URL", "KV_URL"];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("uses a redis:// connection string when one is present", () => {
  // This is what Vercel's Redis integration actually provisions — a
  // connection string, not REST credentials.
  withEnv({ REDIS_URL: "rediss://default:pw@host.upstash.io:6379" }, () => {
    assert.equal(activeBackend(), "redis");
  });
  withEnv({ STORAGE_REDIS_URL: "redis://host:6379" }, () => {
    assert.equal(activeBackend(), "redis");
  });
});

test("uses the REST api when that is what was set up instead", () => {
  withEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }, () => {
    assert.equal(activeBackend(), "redis-rest");
  });
});

test("a connection string that is not redis:// is ignored", () => {
  withEnv({ REDIS_URL: "https://not-a-redis-url" }, () => {
    assert.notEqual(activeBackend(), "redis");
  });
});

test("accepts the Upstash names as well as the Vercel KV ones", () => {
  withEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }, () => {
    assert.equal(activeBackend(), "redis-rest");
  });
});

test("a half-configured redis is never treated as redis", () => {
  // Locally this falls through to a file, which is fine. What must not happen
  // is writing to a Redis we have no token for and reporting success.
  withEnv({ KV_REST_API_URL: "https://x.upstash.io" }, () => {
    assert.notEqual(activeBackend(), "redis");
  });
  withEnv({ VERCEL: "1", KV_REST_API_URL: "https://x.upstash.io" }, () => {
    assert.equal(activeBackend(), "none", "and on serverless there is nowhere left to go");
  });
});

test("falls back to a file locally", () => {
  withEnv({}, () => assert.equal(activeBackend(), "file"));
});

test("refuses to write files on serverless, where the disk is wiped", () => {
  // Writing there would look like success and lose every row.
  withEnv({ VERCEL: "1" }, () => assert.equal(activeBackend(), "none"));
});

test("a store is used on serverless, where a file would not survive", () => {
  withEnv({ VERCEL: "1", REDIS_URL: "rediss://host:6379" }, () => {
    assert.equal(activeBackend(), "redis");
  });
});

test("collection can be switched off explicitly", () => {
  withEnv({ CARD_CUTTER_COLLECT: "0", REDIS_URL: "rediss://host:6379" }, () => {
    assert.equal(activeBackend(), "none");
  });
});

test("finds the credentials under any prefix Vercel was told to use", () => {
  // The integration lets you type a prefix, so these can arrive named almost
  // anything. A correctly provisioned database must not silently do nothing.
  const cases: Record<string, string>[] = [
    { STORAGE_REST_URL: "https://x.upstash.io", STORAGE_REST_TOKEN: "t" },
    { MY_CACHE_REST_URL: "https://x.upstash.io", MY_CACHE_REST_TOKEN: "t" },
    { FEEDBACK_REST_URL: "https://x.upstash.io", FEEDBACK_REST_API_TOKEN: "t" },
  ];
  for (const vars of cases) {
    const keys = Object.keys(vars);
    const saved: Record<string, string | undefined> = {};
    for (const k of keys) saved[k] = process.env[k];
    try {
      for (const [k, v] of Object.entries(vars)) process.env[k] = v;
      assert.equal(activeBackend(), "redis-rest", `missed: ${keys.join(", ")}`);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }
});

test("a REST_URL that is not a url is ignored", () => {
  const saved = process.env.WEIRD_REST_URL;
  try {
    process.env.WEIRD_REST_URL = "not-a-url";
    process.env.WEIRD_REST_TOKEN = "t";
    assert.notEqual(activeBackend(), "redis-rest");
  } finally {
    if (saved === undefined) delete process.env.WEIRD_REST_URL;
    delete process.env.WEIRD_REST_TOKEN;
  }
});
