import { findEvidence } from "@/lib/pipeline/free";
import { defaultSourceLimit } from "@/lib/env";
import { TavilyKeylessLimitError } from "@tavily/core";

/**
 * POST /api/find — free mode. Search, extract, rank passages.
 * No model calls, so this needs only TAVILY_API_KEY.
 */
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

  try {
    const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, 200) : [];
    return Response.json(await findEvidence(query, limit, exclude));
  } catch (error) {
    if (error instanceof TavilyKeylessLimitError) {
      const wait = error.retryAfter
        ? ` Try again in about ${Math.ceil(error.retryAfter / 60)} minutes,`
        : "";
      return Response.json(
        {
          error:
            `Hit the keyless ${error.capType} limit.${wait} or add a free ` +
            "TAVILY_API_KEY to .env.local for 1,000 credits a month. " +
            "No card required.",
        },
        { status: 429 },
      );
    }

    const message = error instanceof Error ? error.message : "unknown error";
    console.error("find failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
