import { cutCards } from "@/lib/pipeline";
import { defaultSourceLimit } from "@/lib/env";
import type { CutRequest } from "@/lib/types";

/**
 * POST /api/cut — takes a 5-10 word prompt, returns cut cards.
 *
 * Route handlers are not cached by default in Next 16, which is what we want:
 * every query is fresh.
 */
export async function POST(request: Request) {
  let body: CutRequest;
  try {
    body = (await request.json()) as CutRequest;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const query = body?.query?.trim();
  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  const limit = Math.min(Math.max(body.limit ?? defaultSourceLimit(), 1), 20);

  try {
    return Response.json(await cutCards(query, limit));
  } catch (error) {
    // Missing keys surface here as a zod parse error from getEnv().
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("cut failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
