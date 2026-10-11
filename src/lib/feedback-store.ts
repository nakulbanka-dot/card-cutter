import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FeedbackRow } from "./feedback";
import { connectionUrl, redisCommand, redisConfig, tcpClient } from "./redis.ts";

/**
 * Where feedback rows go.
 *
 * Three backends, chosen by what the environment provides:
 *
 *   tcp    a redis:// connection string, which is what Vercel's Redis
 *          integration provisions. Used in deployment.
 *   rest   a Redis HTTP API (Upstash's REST interface), if that is what was
 *          set up instead.
 *   file   data/feedback.jsonl. Used locally, where a real disk exists.
 *
 * Neither available means collection is off, and the API says so rather than
 * accepting clicks it is silently discarding. A training set you believe you
 * are collecting and are not is worse than none.
 *
 * The connection itself lives in redis.ts, shared with the search budget.
 */

const LIST_KEY = "card-cutter:feedback";

const DATA_DIR = path.join(process.cwd(), "data");
const LOG = path.join(DATA_DIR, "feedback.jsonl");

export type Backend = "redis" | "redis-rest" | "file" | "none";

export function activeBackend(): Backend {
  if (process.env.CARD_CUTTER_COLLECT === "0") return "none";
  if (connectionUrl()) return "redis";
  if (redisConfig()) return "redis-rest";

  // Serverless filesystems are wiped between invocations, so a file write
  // there would look like success and lose everything.
  const serverless = Boolean(
    process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME,
  );
  return serverless ? "none" : "file";
}

/** Append one row. Returns false when nothing was stored. */
export async function appendFeedback(row: FeedbackRow): Promise<boolean> {
  const backend = activeBackend();

  if (backend === "redis") {
    try {
      const c = await tcpClient();
      if (!c) return false;
      await c.rPush(LIST_KEY, JSON.stringify(row));
      return true;
    } catch {
      return false;
    }
  }

  if (backend === "redis-rest") {
    const cfg = redisConfig()!;
    try {
      await redisCommand(cfg, ["RPUSH", LIST_KEY, JSON.stringify(row)]);
      return true;
    } catch {
      // A lost label must never turn a click into an error for the user.
      return false;
    }
  }

  if (backend === "file") {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await appendFile(LOG, JSON.stringify(row) + "\n", "utf8");
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/** Read every row back, for stats and for export. */
export async function readAllFeedback(): Promise<FeedbackRow[]> {
  const backend = activeBackend();

  if (backend === "redis") {
    try {
      const c = await tcpClient();
      if (!c) return [];
      const raw = await c.lRange(LIST_KEY, 0, -1);
      return raw.flatMap((line) => {
        try {
          return [JSON.parse(line) as FeedbackRow];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  if (backend === "redis-rest") {
    const cfg = redisConfig()!;
    try {
      const raw = (await redisCommand(cfg, ["LRANGE", LIST_KEY, 0, -1])) as string[];
      return raw.flatMap((line) => {
        try {
          return [JSON.parse(line) as FeedbackRow];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  if (backend === "file") {
    try {
      const raw = await readFile(LOG, "utf8");
      return raw
        .split("\n")
        .filter((l) => l.trim())
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as FeedbackRow];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  return [];
}
