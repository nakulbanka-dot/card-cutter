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
 * State is in memory. On a serverless host each instance counts separately and
 * a cold start forgets, so the real limit is looser than the configured one.
 * That is a deliberate trade at this traffic: it needs no database, no signup
 * and no key, and it stops the abuse that actually happens. Move to a shared
 * store when the traffic justifies the dependency — the interface here does
 * not change.
 */

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
