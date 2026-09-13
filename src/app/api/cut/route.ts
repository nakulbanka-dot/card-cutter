import type { CutRequest } from "@/lib/types";

/**
 * POST /api/cut — takes a 5–10 word prompt, returns cut cards.
 *
 * Stub. The pipeline (search → extract → cut → underline) is not built yet;
 * see docs/ARCHITECTURE.md. This exists so the route shape is settled and the
 * frontend has something to call.
 *
 * Route handlers are not cached by default in Next 16, which is what we want —
 * every query is fresh.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as CutRequest;

  if (!body?.query?.trim()) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  return Response.json(
    { error: "Not implemented yet", query: body.query },
    { status: 501 },
  );
}
