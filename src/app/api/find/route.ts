import { findEvidence } from "@/lib/pipeline/free";
import { defaultSourceLimit } from "@/lib/env";
import { TavilyKeylessLimitError } from "@tavily/core";
import { checkAndCount, visitorFrom } from "@/lib/rate-limit";

/**
 * POST /api/find — search, extract, read and rank.
 *
 * Hosted stance scoring is ~4.4s a call against ~200ms locally, and the first
 * request after an idle period pays a ~23s model cold start on top. Measured
 * end to end at 28s. Vercel's default serverless ceiling would cut that off
 * mid-request, so the limit is raised explicitly.
 */
export const maxDuration = 60;
export async function POST(request: Request) {
  let body: { query?: string; limit?: number; exclude?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const query = body?.query?.trim();
  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  const limit = Math.min(Math.max(body.limit ?? defaultSourceLimit(), 1), 20);

  // Checked before any search runs, so a refused request spends no credits.
  const gate = checkAndCount(visitorFrom(request.headers));
  if (!gate.allowed) {
    const hours = Math.ceil(gate.resetInSeconds / 3600);
    return Response.json(
      {
        error:
          gate.reason === "month"
            ? "Card Cutter has used its search budget for this month. It resets on the 1st."
            : gate.reason === "global"
              ? `Card Cutter has hit its search budget for today. It resets in about ${hours} hour${hours === 1 ? "" : "s"}.`
              : `You've used your searches for today. They reset in about ${hours} hour${hours === 1 ? "" : "s"}.`,
      },
      { status: 429, headers: { "Retry-After": String(gate.resetInSeconds) } },
    );
  }

  try {
    const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, 200) : [];
    const result = await findEvidence(query, limit, exclude);
    return Response.json({ ...result, searchesLeftToday: gate.remaining });
  } catch (error) {
    if (error instanceof TavilyKeylessLimitError) {
      // User-facing: they cannot do anything about our search backend, only
      // about waiting. Operator detail goes to the server log instead.
      const wait = error.retryAfter
        ? `about ${Math.ceil(error.retryAfter / 60)} minutes`
        : "a little while";
      console.error(`search cap reached: ${error.capType}`, error);
      return Response.json(
        { error: `Search limit reached for now — try again in ${wait}.` },
        { status: 429 },
      );
    }

    const message = error instanceof Error ? error.message : "unknown error";
    console.error("find failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
