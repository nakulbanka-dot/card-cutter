import { cutCards } from "@/lib/pipeline";
import { hasAnthropicKey, requestedSourceLimit } from "@/lib/env";
import { checkSearchBudget, visitorFrom } from "@/lib/rate-limit";
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

  const limit = requestedSourceLimit(body.limit);

  // Before the gate, so a deployment without paid cutting does not spend
  // anyone's search allowance on a request that cannot run.
  if (!hasAnthropicKey()) {
    return Response.json(
      { error: "Paid cutting is not set up here. Free mode (/api/find) works without it." },
      { status: 501 },
    );
  }

  // The same budget as /api/find. This path runs the same searches out of the
  // same monthly credits, and every source it reads is a Claude call on top,
  // so it was the one endpoint that cost the most and had no ceiling at all.
  const gate = await checkSearchBudget(visitorFrom(request.headers));
  if (!gate.allowed) {
    return Response.json(
      { error: "Search limit reached for now. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.resetInSeconds) } },
    );
  }

  try {
    return Response.json(await cutCards(query, limit));
  } catch (error) {
    // Missing keys surface here as a zod parse error from getEnv().
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("cut failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
