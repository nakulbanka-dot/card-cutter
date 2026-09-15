import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FeedbackRow } from "./feedback";

/**
 * Where feedback rows go.
 *
 * Two backends, chosen by what the environment provides:
 *
 *   redis  a Redis HTTP API (Vercel KV, Upstash). Used in deployment, where
 *          the filesystem is wiped between requests.
 *   file   data/feedback.jsonl. Used locally, where a real disk exists.
 *
 * Neither available means collection is off, and the API says so rather than
 * accepting clicks it is silently discarding. A training set you believe you
 * are collecting and are not is worse than none.
 *
 * Talks to Redis over its REST interface rather than a client library: the
 * whole protocol here is "append to a list" and "read the list", and a
 * dependency for that would cost more than it saves.
 */

const LIST_KEY = "card-cutter:feedback";

interface RedisConfig {
  url: string;
  token: string;
}

/**
 * Find the Redis REST credentials, whatever they were named.
 *
 * Vercel's integration lets you choose a prefix when connecting a database,
 * so the variables can arrive as KV_REST_API_URL, UPSTASH_REDIS_REST_URL,
 * STORAGE_REST_URL, or anything else someone typed into that box. Hardcoding
 * one spelling means a correctly provisioned database silently does nothing.
 *
 * Known names are tried first, then any pair of variables that look like a
 * REST url and token from the same prefix.
 */
function redisConfig(): RedisConfig | null {
  const known: [string, string][] = [
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["REDIS_REST_URL", "REDIS_REST_TOKEN"],
    ["STORAGE_REST_URL", "STORAGE_REST_TOKEN"],
    ["STORAGE_KV_REST_API_URL", "STORAGE_KV_REST_API_TOKEN"],
  ];
  for (const [u, t] of known) {
    const url = process.env[u];
    const token = process.env[t];
    if (url && token) return { url: url.replace(/\/$/, ""), token };
  }

  // Fall back to matching on shape: <PREFIX>REST_URL with a sibling token.
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !/REST_URL$/.test(key)) continue;
    if (!/^https?:\/\//.test(value)) continue;

    const prefix = key.slice(0, -"REST_URL".length);
    const token =
      process.env[`${prefix}REST_TOKEN`] ?? process.env[`${prefix}REST_API_TOKEN`];
    if (token) return { url: value.replace(/\/$/, ""), token };
  }

  return null;
}

async function redisCommand(
  cfg: RedisConfig,
  command: (string | number)[],
): Promise<unknown> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(json.error);
  return json.result;
}

const DATA_DIR = path.join(process.cwd(), "data");
const LOG = path.join(DATA_DIR, "feedback.jsonl");

export type Backend = "redis" | "file" | "none";

export function activeBackend(): Backend {
  if (process.env.CARD_CUTTER_COLLECT === "0") return "none";
  if (redisConfig()) return "redis";

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
