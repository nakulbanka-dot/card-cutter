/**
 * Search limits.
 *
 * Search is the only thing here with a hard external budget: the free Tavily
 * tier is 1,000 credits a month and one search spends about four, so the whole
 * site gets roughly 250 searches a month — eight a day. Without a limit, one
 * person with a script exhausts the month before lunch and everyone else gets
 * errors for three weeks.
 *
 * Two ceilings, because they fail differently. The per-visitor limit stops one
 * user monopolising the day. The global limit stops a crowd of well-behaved
 * users doing the same thing collectively.
 *
 * Counted in Redis when the deployment has one (checkSearchBudget), so every
 * instance draws on the same budget. Without Redis, or when it cannot be
 * reached, each instance counts in its own memory (checkAndCount): a cold
 * start forgets and every instance has its own allowance, so the real limit
 * is looser than the configured one — but it is never worse than that.
 */
import { redisRunner } from "./redis.ts";

export interface LimitConfig {
  perVisitorPerDay: number;
  globalPerDay: number;
  /**
   * The ceiling that actually matters. Search credits renew monthly, not
   * daily, so a generous daily allowance can still exhaust the month in a
   * week. This is the one that protects the budget; the daily numbers only
   * stop a single person or a single afternoon running away with it.
   */
  globalPerMonth: number;
}

/**
 * Sized for beta testing on the free search tier.
 *
 * The free tier is 1,000 credits a month and a search spends about four, so
 * roughly 250 searches exist per month in total. The monthly cap sits just
 * under that and is the real budget — raising it means paying.
 *
 * The daily figures are shaped around how a beta actually fails. It is not
 * the month that runs out; it is the first afternoon, when everyone opens the
 * link at once. Ten testers doing six searches each used to exhaust a
 * sixty-a-day cap by dinner, which is the worst possible moment to show
 * someone a wall. So the day is loose enough to absorb that burst.
 *
 * Per-visitor moves the other way. At twenty-five a day one enthusiastic
 * tester could spend eleven percent of the month in an afternoon and leave
 * nothing for the people who opened the link on Tuesday. Fifteen is still
 * more than a real session needs — each search returns up to thirty-two
 * passages, and every one of them is a label.
 */
export const DEFAULT_LIMITS: LimitConfig = {
  perVisitorPerDay: 15,
  globalPerDay: 150,
  globalPerMonth: 220,
};

/**
 * Generous in development. The public defaults are sized for a shared search
 * budget; applied to the machine you are building on they just stop you
 * working after five queries, which is what happened.
 */
export const DEV_LIMITS: LimitConfig = {
  perVisitorPerDay: 200,
  globalPerDay: 200,
  globalPerMonth: 5000,
};

/**
 * `isProduction` is a parameter rather than a read of NODE_ENV inside, so a
 * test can exercise both branches without mutating the environment.
 */
export function configuredLimits(
  isProduction: boolean = process.env.NODE_ENV === "production",
): LimitConfig {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const base = isProduction ? DEFAULT_LIMITS : DEV_LIMITS;
  return {
    perVisitorPerDay: num(process.env.SEARCH_LIMIT_PER_VISITOR, base.perVisitorPerDay),
    globalPerDay: num(process.env.SEARCH_LIMIT_GLOBAL, base.globalPerDay),
    globalPerMonth: num(process.env.SEARCH_LIMIT_MONTHLY, base.globalPerMonth),
  };
}

interface Bucket {
  day: string;
  count: number;
}

const visitors = new Map<string, Bucket>();
let global: Bucket = { day: "", count: 0 };
let monthly: Bucket = { day: "", count: 0 };

/** UTC day key, so the reset is predictable rather than per-visitor. */
function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface LimitResult {
  allowed: boolean;
  /** Searches this visitor has left today. */
  remaining: number;
  /** Which ceiling was hit, when one was. */
  reason?: "visitor" | "global" | "month";
  /** Seconds until the counters reset. */
  resetInSeconds: number;
}

function secondsUntilMidnight(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0,
  );
  return Math.max(1, Math.round((next - now.getTime()) / 1000));
}

/**
 * Record one search and say whether it is allowed.
 *
 * Counts only on success — a refused search spends no credits, so refusing it
 * must not also spend the visitor's allowance.
 */
export function checkAndCount(
  visitorId: string,
  now: Date = new Date(),
  limits: LimitConfig = configuredLimits(),
): LimitResult {
  const day = today(now);
  const resetInSeconds = secondsUntilMidnight(now);

  if (global.day !== day) global = { day, count: 0 };
  const month = day.slice(0, 7);
  if (monthly.day !== month) monthly = { day: month, count: 0 };

  let bucket = visitors.get(visitorId);
  if (!bucket || bucket.day !== day) {
    bucket = { day, count: 0 };
    visitors.set(visitorId, bucket);
  }

  if (bucket.count >= limits.perVisitorPerDay) {
    return { allowed: false, remaining: 0, reason: "visitor", resetInSeconds };
  }
  if (monthly.count >= limits.globalPerMonth) {
    return {
      allowed: false,
      remaining: Math.max(0, limits.perVisitorPerDay - bucket.count),
      reason: "month",
      resetInSeconds,
    };
  }
  if (global.count >= limits.globalPerDay) {
    return {
      allowed: false,
      remaining: Math.max(0, limits.perVisitorPerDay - bucket.count),
      reason: "global",
      resetInSeconds,
    };
  }

  bucket.count++;
  global.count++;
  monthly.count++;

  // Yesterday's visitors are dead weight; clear them when the map grows.
  if (visitors.size > 5000) {
    for (const [k, v] of visitors) if (v.day !== day) visitors.delete(k);
  }

  return {
    allowed: true,
    remaining: Math.max(0, limits.perVisitorPerDay - bucket.count),
    resetInSeconds,
  };
}

/**
 * The search limits, shared by every instance.
 *
 * In memory, each serverless instance kept its own count and a cold start
 * reset it, so the monthly cap — the one meant to keep the site inside the
 * free search tier — was really that cap times however many instances
 * Vercel happened to run. Over the free tier, search stops for everyone
 * until the month turns over.
 *
 * One script, so the check and the count happen as one step in Redis: two
 * instances cannot both read 219 and both let a search through. It applies
 * the same rules in the same order as checkAndCount, and like it, counts
 * nothing for a refused search.
 *
 * The {limits} hash tag keeps all three keys in one slot, which a clustered
 * Redis requires of a script that touches several keys.
 */
const BUDGET_SCRIPT = `
local visitor = tonumber(redis.call('GET', KEYS[1]) or '0')
local day = tonumber(redis.call('GET', KEYS[2]) or '0')
local month = tonumber(redis.call('GET', KEYS[3]) or '0')
if visitor >= tonumber(ARGV[1]) then return {0, visitor, 1} end
if month >= tonumber(ARGV[3]) then return {0, visitor, 3} end
if day >= tonumber(ARGV[2]) then return {0, visitor, 2} end
visitor = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[4])
redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], ARGV[5])
return {1, visitor, 0}
`;

/** Day keys outlive their day so a request at 23:59:59 still finds its count. */
const DAY_TTL_SECONDS = 2 * 24 * 3600;
const MONTH_TTL_SECONDS = 40 * 24 * 3600;

/** A slow Redis must not hold a search hostage; memory takes over after this. */
const BUDGET_TIMEOUT_MS = 2_000;

const REASONS = { 1: "visitor", 2: "global", 3: "month" } as const;

/** Key names, exported for tests that inspect what was counted. */
export function budgetKeys(visitorId: string, now: Date): [string, string, string] {
  const day = today(now);
  return [
    `card-cutter:{limits}:visitor:${day}:${visitorId}`,
    `card-cutter:{limits}:day:${day}`,
    `card-cutter:{limits}:month:${day.slice(0, 7)}`,
  ];
}

/**
 * Record one search against the shared budget and say whether it is allowed.
 *
 * Falls back to this instance's memory when no Redis is configured, or when
 * Redis errors or is slow — a search must not fail because the counter did.
 *
 * `run` is the test seam: a function that executes one raw Redis command.
 */
export async function checkSearchBudget(
  visitorId: string,
  now: Date = new Date(),
  limits: LimitConfig = configuredLimits(),
  run: ((command: string[]) => Promise<unknown>) | null = redisRunner(),
): Promise<LimitResult> {
  if (!run) return checkAndCount(visitorId, now, limits);

  const keys = budgetKeys(visitorId, now);
  const command = [
    "EVAL", BUDGET_SCRIPT, "3", ...keys,
    String(limits.perVisitorPerDay),
    String(limits.globalPerDay),
    String(limits.globalPerMonth),
    String(DAY_TTL_SECONDS),
    String(MONTH_TTL_SECONDS),
  ];

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      run(command),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), BUDGET_TIMEOUT_MS);
      }),
    ]);
    const [allowed, count, reason] = (reply as unknown[]).map(Number);
    if (![allowed, count, reason].every(Number.isFinite)) {
      throw new Error(`unexpected reply ${JSON.stringify(reply)}`);
    }
    return {
      allowed: allowed === 1,
      remaining: Math.max(0, limits.perVisitorPerDay - count),
      ...(allowed === 1 ? {} : { reason: REASONS[reason as 1 | 2 | 3] }),
      resetInSeconds: secondsUntilMidnight(now),
    };
  } catch (err) {
    // Said in the log, because a budget that has quietly gone back to
    // per-instance counting looks exactly like one that works.
    console.error("search budget: Redis unavailable, counting in memory:", err);
    return checkAndCount(visitorId, now, limits);
  } finally {
    clearTimeout(timer);
  }
}

/** Identify a visitor from proxy headers. Falls back to one shared bucket. */
export function visitorFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? headers.get("cf-connecting-ip") ?? "unknown";
}

/** Test seam. */
export function resetLimits(): void {
  visitors.clear();
  global = { day: "", count: 0 };
  monthly = { day: "", count: 0 };
}

/**
 * A simple per-IP cap for the endpoints that are not searches.
 *
 * Searching is metered against a real bill — every query spends Tavily credits
 * out of a fixed monthly budget, which is why it has a global cap as well as a
 * per-visitor one. Underlining and feedback cost no credits, so a shared
 * monthly budget would be the wrong shape: one visitor could exhaust the
 * month for everyone over something that costs nothing.
 *
 * They are not free either. Underlining runs a model per request and feedback
 * writes a row, so left ungated they are a way to spend the function's time
 * and fill the database. This bounds each IP per hour and nothing else.
 */
const buckets = new Map<string, { hour: string; count: number }>();

export interface SimpleLimit {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

export function checkPerHour(
  key: string,
  visitorId: string,
  perHour: number,
  now: Date = new Date(),
): SimpleLimit {
  const hour = now.toISOString().slice(0, 13);
  const id = `${key}:${visitorId}`;

  let bucket = buckets.get(id);
  if (!bucket || bucket.hour !== hour) {
    bucket = { hour, count: 0 };
    buckets.set(id, bucket);
  }

  // Unbounded growth would be its own denial of service; an IP that has not
  // been seen this hour has no reason to stay in the map.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.hour !== hour) buckets.delete(k);
  }

  const resetInSeconds = 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds());
  if (bucket.count >= perHour) {
    return { allowed: false, remaining: 0, resetInSeconds };
  }
  bucket.count += 1;
  return { allowed: true, remaining: perHour - bucket.count, resetInSeconds };
}
