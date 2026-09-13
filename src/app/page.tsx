"use client";

import { useState } from "react";
import { SourceBlock } from "@/components/passage-list";
import { toMarkdown } from "@/lib/export-markdown";
import type { FindResponse } from "@/lib/pipeline/free";

export default function Home() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FindResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const words = query.trim().split(/\s+/).filter(Boolean).length;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);

    try {
      const res = await fetch("/api/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "something went wrong");
      setResult(data as FindResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function copyForClaude() {
    if (!result) return;
    await navigator.clipboard.writeText(toMarkdown(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const passageCount =
    result?.sources.reduce((n, s) => n + s.passages.length, 0) ?? 0;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">card cutter</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        State a position in five to ten words. Get the paragraphs worth cutting.
      </p>

      <form onSubmit={onSubmit} className="mt-8">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="nuclear power solves climate change"
          disabled={loading}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-4 py-3 outline-none placeholder:text-neutral-400 focus:border-neutral-900 disabled:opacity-60 dark:border-neutral-700 dark:focus:border-neutral-300"
        />

        <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
          <span>
            {words > 0 && `${words} word${words === 1 ? "" : "s"}`}
            {words > 12 && " — try trimming it down"}
          </span>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {loading ? "Searching…" : "Find evidence"}
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-400">
          Tip: start with &ldquo;answers to&rdquo; to get the other side. Runs
          with no account; add a free Tavily key to raise the limits.
        </p>
      </form>

      {loading && (
        <p className="mt-10 text-sm text-neutral-500">
          Searching and pulling full text. Usually 10–20 seconds.
        </p>
      )}

      {error && (
        <p className="mt-10 rounded-md border border-red-300 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          {error}
        </p>
      )}

      {result && (
        <section className="mt-10">
          {result.sources.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Nothing usable came back. Try naming the specific policy, country,
              or year you have in mind.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between pb-4">
                <p className="text-xs text-neutral-500">
                  {passageCount} passage{passageCount === 1 ? "" : "s"} from{" "}
                  {result.sources.length} source
                  {result.sources.length === 1 ? "" : "s"}
                  {result.wantsRefutation && " · against the claim"}
                  {!result.usingKey && " · keyless"}
                </p>
                <button
                  onClick={copyForClaude}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  {copied ? "Copied" : "Copy for Claude"}
                </button>
              </div>

              <div className="space-y-8">
                {result.sources.map((source, i) => (
                  <SourceBlock
                    key={source.url}
                    source={source}
                    terms={result.terms}
                    index={i}
                  />
                ))}
              </div>
            </>
          )}

          {result.skipped.length > 0 && (
            <details className="mt-10 text-xs text-neutral-500">
              <summary className="cursor-pointer">
                {result.skipped.length} source
                {result.skipped.length === 1 ? "" : "s"} skipped
              </summary>
              <ul className="mt-2 space-y-1">
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    <span className="text-neutral-400">{s.reason}</span> — {s.url}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </main>
  );
}
