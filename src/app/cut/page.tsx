"use client";

import { useState } from "react";
import { Results } from "@/components/results";
import { useSettings } from "@/lib/settings";
import { toMarkdown } from "@/lib/export-markdown";
import type { FindResponse } from "@/lib/pipeline/free";

const EXAMPLES = [
  "nuclear power solves climate change",
  "answers to AI regulation kills innovation",
  "sanctions on Russia have failed",
];

export default function CutPage() {
  const { settings } = useSettings();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FindResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const words = query.trim().split(/\s+/).filter(Boolean).length;

  async function run(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);

    try {
      const res = await fetch("/api/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit: settings.sourceLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setResult(data as FindResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function copyAll() {
    if (!result) return;
    await navigator.clipboard.writeText(toMarkdown(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const passageCount =
    result?.sources.reduce((n, s) => n + s.passages.length, 0) ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Cut cards</h1>
      <p className="mt-1 text-sm text-muted">
        Write what you want the card to prove, the way you&rsquo;d write a tag.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        className="mt-6"
      >
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nuclear power solves climate change"
            disabled={loading}
            className="flex-1 rounded-md border border-border bg-surface px-4 py-3 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-md bg-fg px-5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Searching…" : "Find evidence"}
          </button>
        </div>

        <div className="mt-2 flex min-h-5 items-center justify-between text-xs text-faint">
          <span>
            Start with &ldquo;answers to&rdquo; to find the other side.
          </span>
          <span>{words > 12 ? "Try trimming it down" : words > 0 ? `${words} words` : ""}</span>
        </div>
      </form>

      {!result && !loading && !error && (
        <div className="mt-8">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">
            Try one
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setQuery(ex);
                  run(ex);
                }}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-fg"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="mt-10 space-y-4">
          <p className="text-sm text-muted">
            Searching, then reading each article in full. Usually 10–20 seconds.
          </p>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-surface"
            />
          ))}
        </div>
      )}

      {error && (
        <p className="mt-10 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {result && (
        <section className="mt-10">
          {result.sources.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-6">
              <p className="font-medium">Nothing usable came back.</p>
              <p className="mt-1 text-sm text-muted">
                Try naming the specific policy, country, or year you have in
                mind — &ldquo;EU AI Act&rdquo; finds more than &ldquo;AI
                rules&rdquo;.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <p className="text-sm text-muted">
                  <span className="font-medium text-fg">{passageCount}</span>{" "}
                  passages from{" "}
                  <span className="font-medium text-fg">
                    {result.sources.length}
                  </span>{" "}
                  sources
                  {result.wantsRefutation && " · against the claim"}
                </p>
                <button
                  onClick={copyAll}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface"
                >
                  {copied ? "Copied" : "Copy all"}
                </button>
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
