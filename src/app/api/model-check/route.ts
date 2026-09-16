import { rankByMeaning, retrieverLoadError } from "@/lib/ranking/retriever";
import { scoreCuttable, rerankerLoadError } from "@/lib/ranking/reranker";

/**
 * GET /api/model-check — can the trained models load and run here?
 *
 * Its own route on purpose. Turning the models on inside /api/find to find out
 * took the whole search down: the function did not throw, it died, so the
 * route's error handling never ran and every user got an HTML error page.
 * Finding that out should not cost anyone a working search.
 *
 * Reports timings because the failure mode was memory, and the point at which
 * it gives up says which stage was too expensive.
 */
export const maxDuration = 60;

export async function GET() {
  const started = Date.now();
  const at = () => Date.now() - started;
  const steps: Record<string, unknown> = {};

  steps.flag = process.env.USE_TRAINED_MODELS === "1" ? "on" : "off";
  steps.memoryMB = Math.round(process.memoryUsage().rss / 1e6);

  try {
    const r = await rankByMeaning("nuclear power solves climate change", [
      "France generates roughly 70 percent of its electricity from nuclear reactors, and its grid carbon intensity sits far below the European average.",
      "The weather was pleasant that spring in Paris and the cafes were full.",
    ]);
    steps.retriever = r ? { ok: true, scores: r.map((n) => +n.toFixed(3)), ms: at() } : { ok: false, error: retrieverLoadError() };
  } catch (e) {
    steps.retriever = { ok: false, threw: e instanceof Error ? e.message : String(e) };
  }
  steps.memoryAfterRetrieverMB = Math.round(process.memoryUsage().rss / 1e6);

  try {
    const s = await scoreCuttable("nuclear power solves climate change", [
      { title: "Nuclear and the grid", text: "France generates roughly 70 percent of its electricity from nuclear reactors, and no country has decarbonised its supply at comparable speed without them." },
      { title: "Nuclear and the grid", text: "The weather was pleasant that spring in Paris and the cafes were full." },
    ]);
    steps.reranker = s[0] !== null ? { ok: true, scores: s.map((n) => (n === null ? null : +n.toFixed(3))), ms: at() } : { ok: false, error: rerankerLoadError() };
  } catch (e) {
    steps.reranker = { ok: false, threw: e instanceof Error ? e.message : String(e) };
  }
  steps.memoryAfterBothMB = Math.round(process.memoryUsage().rss / 1e6);
  steps.totalMs = at();

  return Response.json(steps);
}
