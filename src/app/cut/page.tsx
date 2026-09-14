"use client";

import { useCallback, useRef, useState } from "react";
import { Results } from "@/components/results";
import { toMarkdown } from "@/lib/export-markdown";
import { useSettings } from "@/lib/settings";
import type { FindResponse } from "@/lib/pipeline/free";

const EXAMPLES = [
  "nuclear power solves climate change",
  "answers to AI regulation kills innovation",
  "sanctions on Russia have failed",
];

/** Shown in sequence so a long wait reads as progress, not a hang. */
const STAGES = [
  "Searching for sources",
  "Reading each article in full",
  "Finding the passages worth cutting",
];

export default function CutPage() {
  const { settings } = useSettings();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FindResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [copied, setCopied] = useState(false);
  /** Everything shown so far this session, so refresh finds new material. */
  const seen = useRef<string[]>([]);

  const run = useCallback(
    async (q: string, mode: "new" | "refresh" = "new") => {
      if (!q.trim() || loading) return;

      setLoading(true);
      setError(null);
      setCopied(false);
      setStage(0);
      if (mode === "new") {
        setResult(null);
        seen.current = [];
      }

      const ticker = setInterval(
        () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
        6000,
      );

      try {
        const res = await fetch("/api/find", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            limit: settings.sourceLimit,
            exclude: mode === "refresh" ? seen.current : [],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Something went wrong.");

        const next = data as FindResponse;
        if (mode === "refresh" && next.sources.length === 0) {
          setError("No other sources left for this one. Try rewording the tag.");
        } else {
          seen.current = [...seen.current, ...next.sources.map((s) => s.url)];
          setResult(next);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        clearInterval(ticker);
        setLoading(false);
      }
    },
    [loading, settings.sourceLimit],
  );

  async function copyAll() {
    if (!result) return;
    await navigator.clipboard.writeText(toMarkdown(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const words = query.trim().split(/\s+/).filter(Boolean).length;
  const passages = result?.sources.reduce((n, s) => n + s.passages.length, 0) ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* ---- search ---- */}
      <div className="sticky top-14 z-10 -mx-6 bg-bg/90 px-6 pb-4 pt-2 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(query);
          }}
        >
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Write what you want the card to prove…"
              disabled={loading}
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded-lg bg-fg px-5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loading ? "Working…" : "Find evidence"}
            </button>
          </div>

          <div className="mt-2 flex min-h-4 items-center justify-between text-xs text-faint">
            <span>Start with &ldquo;answers to&rdquo; to find the other side.</span>
            <span>{words > 12 ? "Try trimming it down" : words > 0 ? `${words} words` : ""}</span>
          </div>
        </form>
      </div>

      {/* ---- examples ---- */}
      {!result && !loading && !error && (
        <div className="mt-10">
          <p className="text-[10px] font-medium uppercase tracking-wider text-faint">
            Try one
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setQuery(ex);
                  run(ex);
                }}
                className="rounded-full border border-border px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-fg"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- loading ---- */}
      {loading && (
        <div className="mt-10">
          <div className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            <p className="text-sm text-muted">{STAGES[stage]}…</p>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[260px_1fr]">
            <div className="space-y-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-surface" />
              ))}
            </div>
            <div className="space-y-4">
              <div className="h-14 animate-pulse rounded-lg bg-surface" />
              <div className="h-28 animate-pulse rounded-lg bg-surface" />
              <div className="h-28 animate-pulse rounded-lg bg-surface" />
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-10 rounded-lg border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {/* ---- results ---- */}
      {result && !loading && (
        <section className="mt-6">
          {result.sources.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-6">
              <p className="font-medium">Nothing usable came back.</p>
              <p className="mt-1 text-sm text-muted">
                Try naming the specific policy, country, or year —
                &ldquo;EU AI Act&rdquo; finds more than &ldquo;AI rules&rdquo;.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <p className="text-sm text-muted">
                  <span className="font-medium text-fg">{passages}</span> passages from{" "}
                  <span className="font-medium text-fg">{result.sources.length}</span> sources
                  {result.wantsRefutation && " · against the claim"}
                </p>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => run(result.query, "refresh")}
                    disabled={loading}
                    title="Find eight different sources for the same tag"
                    className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                      <path
                        d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13 2v3h-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Different sources
                  </button>
                  <button
                    onClick={copyAll}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
                  >
                    {copied ? "Copied" : "Copy all"}
                  </button>
                </div>
              </div>

              <div className="pt-6">
                <Results result={result} />
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
