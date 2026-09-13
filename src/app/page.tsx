"use client";

import { useState } from "react";
import { CardView } from "@/components/card-view";
import type { CutResponse } from "@/lib/types";

export default function Home() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const words = query.trim().split(/\s+/).filter(Boolean).length;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "something went wrong");
      setResult(data as CutResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">card cutter</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        State a position in five to ten words. Get cards.
      </p>

      <form onSubmit={onSubmit} className="mt-8">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="AI regulation kills innovation"
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
            {loading ? "Cutting…" : "Cut cards"}
          </button>
        </div>
      </form>

      {loading && (
        <p className="mt-10 text-sm text-neutral-500">
          Searching, reading the full text, and cutting. This takes a minute.
        </p>
      )}

      {error && (
        <p className="mt-10 rounded-md border border-red-300 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          {error}
        </p>
      )}

      {result && (
        <section className="mt-10">
          {result.cards.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Nothing worth cutting came back. Try naming the specific policy,
              country, or year you have in mind.
            </p>
          ) : (
            <div className="space-y-8">
              {result.cards.map((card, i) => (
                <CardView key={i} card={card} />
              ))}
            </div>
          )}

          {result.rejected.length > 0 && (
            <details className="mt-10 text-xs text-neutral-500">
              <summary className="cursor-pointer">
                {result.rejected.length} source
                {result.rejected.length === 1 ? "" : "s"} skipped
              </summary>
              <ul className="mt-2 space-y-1">
                {result.rejected.map((r, i) => (
                  <li key={i}>
                    <span className="text-neutral-400">{r.reason}</span> — {r.url}
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
