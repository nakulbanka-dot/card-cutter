import { findEvidence } from "@/lib/pipeline/free";
import { defaultSourceLimit } from "@/lib/env";

/**
 * POST /api/find — free mode. Search, extract, rank passages.
 * No model calls, so this needs only TAVILY_API_KEY.
 */
export async function POST(request: Request) {
  let body: { query?: string; limit?: number };
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
    return Response.json(await findEvidence(query, limit));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("find failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
