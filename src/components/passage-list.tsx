"use client";

import { useState } from "react";
import { highlight } from "@/lib/passages";
import type { FoundSource } from "@/lib/pipeline/free";

/** One source: its cite line, then its best paragraphs with terms marked. */
export function SourceBlock({
  source,
  terms,
  index,
}: {
  source: FoundSource;
  terms: string[];
  index: number;
}) {
  const [showAll, setShowAll] = useState(false);

  return (
    <article className="border-t border-neutral-300 pt-5 dark:border-neutral-700">
      <div className="flex items-baseline gap-2">
        <span className="text-xs tabular-nums text-neutral-400">{index + 1}</span>
        <h3 className="font-medium leading-snug">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {source.title}
          </a>
        </h3>
      </div>

      <p className="mt-0.5 pl-6 text-xs text-neutral-500">
        {new URL(source.url).hostname.replace(/^www\./, "")}
        {source.publishedAt && <> · {source.publishedAt.slice(0, 10)}</>}
      </p>

      <div className="mt-3 space-y-3 pl-6">
        {source.passages.map((passage, i) => (
          <blockquote
            key={i}
            className="border-l-2 border-neutral-300 pl-3 font-serif text-[15px] leading-relaxed dark:border-neutral-700"
          >
            {highlight(passage.text, terms).map((part, j) =>
              part.hit ? (
                <mark
                  key={j}
                  className="bg-yellow-200/70 text-inherit dark:bg-yellow-500/30"
                >
                  {part.text}
                </mark>
              ) : (
                <span key={j}>{part.text}</span>
              ),
            )}
          </blockquote>
        ))}
      </div>

      <div className="mt-2 pl-6">
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-200"
        >
          {showAll ? "Hide full article" : "Show full article"}
        </button>

        {showAll && (
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-100 p-3 font-serif text-[13px] leading-relaxed dark:bg-neutral-900">
            {source.body}
          </pre>
        )}
      </div>
    </article>
  );
}
