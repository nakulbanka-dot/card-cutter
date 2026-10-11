/**
 * The one Redis this app talks to, however it was provisioned.
 *
 * Two ways in, chosen by what the environment provides:
 *
 *   tcp    a redis:// connection string, which is what Vercel's Redis
 *          integration provisions.
 *   rest   a Redis HTTP API (Upstash's REST interface), if that is what was
 *          set up instead.
 *
 * Feedback storage and the shared search budget both go through here, so a
 * deployment that has Redis for one has it for the other.
 */

export interface RedisConfig {
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
export function redisConfig(): RedisConfig | null {
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

/** Vercel's Redis integration sets a connection string, not REST credentials. */
export function connectionUrl(): string | undefined {
  const url =
    process.env.REDIS_URL ??
    process.env.STORAGE_REDIS_URL ??
    process.env.KV_URL;
  return url && /^rediss?:\/\//.test(url) ? url : undefined;
}

/** One command over the REST interface. */
export async function redisCommand(
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

export interface TcpClient {
  rPush: (k: string, v: string) => Promise<number>;
  lRange: (k: string, a: number, b: number) => Promise<string[]>;
  sendCommand: (args: string[]) => Promise<unknown>;
}

/**
 * One client per process, reused across invocations.
 *
 * A serverless instance handles many requests, and reconnecting per request
 * would exhaust the connection limit quickly — the free plan allows 30.
 */
let client: Promise<TcpClient> | null = null;

export async function tcpClient(): Promise<TcpClient | null> {
  const url = connectionUrl();
  if (!url) return null;
  if (!client) {
    client = import("redis").then(async ({ createClient }) => {
      const c = createClient({ url });
      // Without a handler an emitted error is an unhandled rejection, which
      // takes the whole function down rather than losing one request.
      c.on("error", () => {});
      await c.connect();
      return c as unknown as TcpClient;
    });
  }
  try {
    return await client;
  } catch {
    client = null; // let the next request try again
    return null;
  }
}

/**
 * Run one raw command against whichever Redis is configured.
 *
 * Null when there is no Redis at all, so a caller can tell "not set up" from
 * "set up and failing" — the second throws.
 */
export function redisRunner(): ((command: string[]) => Promise<unknown>) | null {
  if (connectionUrl()) {
    return async (command) => {
      const c = await tcpClient();
      if (!c) throw new Error("redis: could not connect");
      return c.sendCommand(command);
    };
  }
  const cfg = redisConfig();
  if (cfg) return (command) => redisCommand(cfg, command);
  return null;
}
