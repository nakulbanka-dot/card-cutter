import { markUnderlines, highlighterLoadError } from "@/lib/ranking/highlighter";
import { checkPerHour, visitorFrom } from "@/lib/rate-limit";

/**
 * POST /api/underline — mark the sentences that do the argumentative work.
 *
 * Its own request, made when someone actually cuts a card, rather than part of
 * the search. A search returns thirty-two passages and a debater cuts one or
 * two of them, so underlining all of them up front would spend thirty seconds
 * of model time to throw most of it away.
 */
export const maxDuration = 60;

interface Body {
  claim?: string;
  passage?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  // 60 an hour per IP. A search returns 32 passages, so a debater cutting
  // everything they were shown twice over still never sees this.
  const gate = checkPerHour("underline", visitorFrom(request.headers), 60);
  if (!gate.allowed) {
    return Response.json(
      { error: "Too many cards at once — try again shortly." },
      { status: 429, headers: { "Retry-After": String(gate.resetInSeconds) } },
    );
  }

  const claim = body.claim?.trim();
  const passage = body.passage?.trim();
  if (!claim || !passage) {
    return Response.json({ error: "claim and passage are required" }, { status: 400 });
  }

  try {
    const marked = await markUnderlines(claim, passage.slice(0, 20_000));
    const err = highlighterLoadError();
    return Response.json({
      sentences: marked,
      // Said rather than implied. A card that comes back with nothing
      // underlined looks the same whether the model read it and declined to
      // mark anything or never ran at all.
      marked: marked.some((s) => s.mark),
      ...(err ? { modelError: err } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("underline failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
