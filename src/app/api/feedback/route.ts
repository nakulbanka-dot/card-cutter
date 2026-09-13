import { logFeedback, readFeedback, computeStats, type FeedbackRow } from "@/lib/feedback";

/** POST — record one label. GET — training-set stats. */
export async function POST(request: Request) {
  try {
    const row = (await request.json()) as FeedbackRow;
    if (!row?.url || !row?.action) {
      return Response.json({ error: "url and action are required" }, { status: 400 });
    }
    await logFeedback({ ...row, ts: new Date().toISOString() });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json(computeStats(await readFeedback()));
}
