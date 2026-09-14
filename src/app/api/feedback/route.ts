import { logFeedback, readFeedback, computeStats, type FeedbackRow } from "@/lib/feedback";

/** POST — record one label. GET — training-set stats. */
export async function POST(request: Request) {
  try {
    const row = (await request.json()) as FeedbackRow;
    if (!row?.url || !row?.action) {
      return Response.json({ error: "url and action are required" }, { status: 400 });
    }
    const stored = await logFeedback({ ...row, ts: new Date().toISOString() });
    // `stored: false` means collection is off for this deployment, not that
    // anything went wrong. The button still works either way.
    return Response.json({ ok: true, stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json(computeStats(await readFeedback()));
}
