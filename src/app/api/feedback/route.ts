import {
  logFeedback, readFeedback, computeStats, activeBackend, type FeedbackRow,
} from "@/lib/feedback";

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

/**
 * GET — stats by default.
 *
 * `?export=1` returns every row as JSONL for training, and requires
 * FEEDBACK_EXPORT_TOKEN. The rows carry what people searched for and what
 * they kept, which is not public data, so the export is behind a secret while
 * the stats stay open.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("export") === "1") {
    const expected = process.env.FEEDBACK_EXPORT_TOKEN;
    const supplied =
      request.headers.get("authorization")?.replace(/^Bearer /i, "") ??
      url.searchParams.get("token");

    if (!expected) {
      return Response.json(
        { error: "Export is not configured. Set FEEDBACK_EXPORT_TOKEN." },
        { status: 501 },
      );
    }
    if (supplied !== expected) {
      return Response.json({ error: "Not authorised." }, { status: 401 });
    }

    const rows = await readFeedback();
    return new Response(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": 'attachment; filename="feedback.jsonl"',
      },
    });
  }

  const rows = await readFeedback();
  return Response.json({
    ...computeStats(rows),
    // So it is visible at a glance whether anything is actually being kept.
    storage: activeBackend(),
  });
}
