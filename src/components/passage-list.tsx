"use client";

import { useState } from "react";
import { highlight } from "@/lib/passages";
import type { FoundSource, FindResponse } from "@/lib/pipeline/free";
import type { Action, PassageFeatures } from "@/lib/feedback";

/**
 * One source: its citation, then the paragraphs most likely to be cuttable.
 *
 * The Cut / Not useful buttons also teach the ranking. Acting on a passage
 * records what you chose, so results get better the more you use it.
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
    <article className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-faint">{index + 1}</span>
        <h3 className="font-medium leading-snug">
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {source.title}
          </a>
        </h3>
      </div>

      <div className="mt-1">
        <p className="prose-source text-xs text-muted">
          {source.mla}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(source.mla);
              setCopiedCite(true);
              setTimeout(() => setCopiedCite(false), 1500);
            }}
            className="text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-fg"
          >
            {copiedCite ? "Copied" : "Copy citation"}
          </button>
          {source.missingCiteFields.length > 0 && (
            <span className="rounded bg-warn-soft px-1.5 py-0.5 text-xs text-warn">
              check the {source.missingCiteFields.join(" and ")} on the page
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-5">
        {source.passages.map((passage, i) => (
          <div key={i}>
            <blockquote className="prose-source border-l-2 border-border pl-4">
              {highlight(passage.text, result.terms).map((part, j) =>
                part.hit ? (
                  <mark key={j} className="bg-mark text-mark-fg">
                    {part.text}
                  </mark>
                ) : (
                  <span key={j}>{part.text}</span>
                ),
              )}
            </blockquote>

            <div className="mt-2 flex items-center gap-3 pl-4">
              {acted[i] === "cut" ? (
                <span className="text-xs font-medium text-good">
                  Copied with citation
                </span>
              ) : acted[i] === "reject" ? (
                <span className="text-xs text-faint">Marked not useful</span>
              ) : (
                <>
                  <button
                    onClick={() => cut(i)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
                  >
                    Cut this
                  </button>
                  <button
                    onClick={() => record(i, "reject")}
                    className="text-xs text-faint transition-colors hover:text-fg"
                  >
                    Not useful
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-fg"
        >
          {showAll ? "Hide full article" : "Show full article"}
        </button>

        {showAll && (
          <pre className="prose-source mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-4 text-[13px]">
            {source.body}
          </pre>
        )}
      </div>
    </article>
  );
}
