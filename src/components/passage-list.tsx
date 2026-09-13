"use client";

import { useState } from "react";
import { highlight } from "@/lib/passages";
import type { FoundSource, FindResponse } from "@/lib/pipeline/free";
import type { Action, PassageFeatures } from "@/lib/feedback";

/**
 * One source: MLA cite, then its best paragraphs.
 *
 * Every button here is also a training label. "Cut this" copies the passage
 * with its citation and records a positive; "Not useful" records a negative.
 * The ranker learns from ordinary use rather than a separate labeling session.
 */
export function SourceBlock({
  source,
  result,
  index,
}: {
  source: FoundSource;
  result: FindResponse;
  index: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const [acted, setActed] = useState<Record<number, Action>>({});
  const [copiedCite, setCopiedCite] = useState(false);

  const domain = new URL(source.url).hostname.replace(/^www\./, "");

  function featuresFor(passageIndex: number): PassageFeatures {
    const p = source.passages[passageIndex];
    return {
      termCoverage: result.terms.length ? p.matched.length / result.terms.length : 0,
      termHits: p.matched.length,
      shownRank: passageIndex,
      sourceRank: index,
      charCount: p.text.length,
      hasQuantity: /\d/.test(p.text),
      hasQuote: /["""]/.test(p.text),
      heuristicScore: p.score,
      domain,
      hasAuthor: source.metadata.authors.length > 0,
    };
  }

  async function record(passageIndex: number, action: Action) {
    setActed((a) => ({ ...a, [passageIndex]: action }));
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: result.query,
          terms: result.terms,
          wantsRefutation: result.wantsRefutation,
          url: source.url,
          passageText: source.passages[passageIndex].text,
          action,
          features: featuresFor(passageIndex),
        }),
      });
    } catch {
      // A failed label shouldn't interrupt cutting.
    }
  }

  async function cut(passageIndex: number) {
    const passage = source.passages[passageIndex];
    await navigator.clipboard.writeText(`${source.mla}\n\n${passage.text}`);
    await record(passageIndex, "cut");
  }

  return (
    <article className="border-t border-neutral-300 pt-5 dark:border-neutral-700">
      <div className="flex items-baseline gap-2">
        <span className="text-xs tabular-nums text-neutral-400">{index + 1}</span>
        <h3 className="font-medium leading-snug">
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {source.title}
          </a>
        </h3>
      </div>

      <div className="mt-1 pl-6">
        <p className="font-serif text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
          {source.mla}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(source.mla);
              setCopiedCite(true);
              setTimeout(() => setCopiedCite(false), 1500);
            }}
            className="text-xs text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-200"
          >
            {copiedCite ? "Copied" : "Copy citation"}
          </button>
          {source.missingCiteFields.length > 0 && (
            <span className="text-xs text-amber-700 dark:text-amber-500">
              missing {source.missingCiteFields.join(", ")} — check the page
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-4 pl-6">
        {source.passages.map((passage, i) => (
          <div key={i}>
            <blockquote className="border-l-2 border-neutral-300 pl-3 font-serif text-[15px] leading-relaxed dark:border-neutral-700">
              {highlight(passage.text, result.terms).map((part, j) =>
                part.hit ? (
                  <mark key={j} className="bg-yellow-200/70 text-inherit dark:bg-yellow-500/30">
                    {part.text}
                  </mark>
                ) : (
                  <span key={j}>{part.text}</span>
                ),
              )}
            </blockquote>

            <div className="mt-1.5 flex items-center gap-3 pl-3">
              {acted[i] === "cut" ? (
                <span className="text-xs font-medium text-green-700 dark:text-green-500">
                  Copied with citation
                </span>
              ) : acted[i] === "reject" ? (
                <span className="text-xs text-neutral-400">Marked not useful</span>
              ) : (
                <>
                  <button
                    onClick={() => cut(i)}
                    className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Cut this
                  </button>
                  <button
                    onClick={() => record(i, "reject")}
                    className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
                  >
                    Not useful
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 pl-6">
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
