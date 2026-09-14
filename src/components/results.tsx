"use client";

import { useState } from "react";
import { highlight } from "@/lib/passages";
import { classifySource, archiveUrl } from "@/lib/source-tier";
import { asPercent } from "@/lib/match-score";
import { formatCite, citeGaps } from "@/lib/cite-format";
import { useSettings } from "@/lib/settings";
import type { FindResponse, FoundSource } from "@/lib/pipeline/free";
import type { Action, PassageFeatures } from "@/lib/feedback";

/**
 * Results as two panes: every source on the left so you can see the whole
 * field at once, the selected one open on the right.
 *
 * The chips are all measured, not scored by a model. "Match" is this source's
 * rank relative to the best one in this set — which is what a ranking means —
 * and tier, access and byline are read off the source itself. Nothing here
 * claims a confidence the software does not actually have.
 */

function TierDot({ tier }: { tier: number }) {
  const color =
    tier === 1 ? "bg-good" : tier === 2 ? "bg-accent" : tier === 3 ? "bg-warn" : "bg-faint";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

export function Results({ result }: { result: FindResponse }) {
  const [selected, setSelected] = useState(0);
  const [acted, setActed] = useState<Record<string, Action>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const { settings } = useSettings();

  const source = result.sources[selected];
  if (!source) return null;

  const tier = classifySource(source.url);
  const gaps = citeGaps(source.metadata);
  const cite = formatCite(source.metadata, settings);
  const match = asPercent(source.match.score);

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  }

  function featuresFor(src: FoundSource, i: number, srcIndex: number): PassageFeatures {
    const p = src.passages[i];
    return {
      termCoverage: result.terms.length ? p.matched.length / result.terms.length : 0,
      termHits: p.matched.length,
      shownRank: i,
      sourceRank: srcIndex,
      charCount: p.text.length,
      hasQuantity: /\d/.test(p.text),
      hasQuote: /["“”]/.test(p.text),
      heuristicScore: p.score,
      domain: new URL(src.url).hostname.replace(/^www\./, ""),
      hasAuthor: src.metadata.authors.length > 0,
    };
  }

  async function record(i: number, action: Action) {
    const key = `${selected}:${i}`;
    setActed((a) => ({ ...a, [key]: action }));
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: result.query,
          terms: result.terms,
          wantsRefutation: result.wantsRefutation,
          url: source.url,
          passageText: source.passages[i].text,
          action,
          features: featuresFor(source, i, selected),
        }),
      });
    } catch {
      /* a lost label must not interrupt cutting */
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      {/* ---- source rail ---- */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-faint">
          {result.sources.length} sources
        </p>

        <ol className="space-y-1">
          {result.sources.map((s, i) => {
            const t = classifySource(s.url);
            const pct = asPercent(s.match.score);
            const active = i === selected;
            return (
              <li key={s.url}>
                <button
                  onClick={() => setSelected(i)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent-soft"
                      : "border-transparent hover:border-border hover:bg-surface"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-[11px] text-muted">
                      <TierDot tier={t.tier} />
                      {new URL(s.url).hostname.replace(/^www\./, "")}
                    </span>
                    <span className="shrink-0 text-[11px] font-medium tabular-nums text-faint">
                      {pct}%
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug">{s.title}</p>
                </button>
              </li>
            );
          })}
        </ol>

        {result.skipped.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer px-1 text-[10px] font-medium uppercase tracking-wider text-faint">
              {result.skipped.length} unavailable
            </summary>
            <ul className="mt-2 space-y-2 px-1">
              {result.skipped.map((s, i) => (
                <li key={i} className="text-[11px] leading-snug text-faint">
                  <span className="block truncate">
                    {new URL(s.url).hostname.replace(/^www\./, "")}
                  </span>
                  <span className="block truncate text-[10px]">{s.reason}</span>
                  {/* Paywalls are common and often have an archived copy. */}
                  <a
                    href={archiveUrl(s.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    Try archive →
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </aside>

      {/* ---- selected source ---- */}
      <section className="min-w-0">
        <div className="flex flex-wrap items-start gap-2">
          <details className="group rounded-lg border border-border bg-surface">
            <summary className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
              <span className="text-lg font-semibold tabular-nums">{match}%</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
                Match
                <span className="ml-1 text-faint group-open:hidden">▾</span>
              </span>
            </summary>
            {/* The number is only useful if you can see what produced it. */}
            <div className="space-y-1.5 border-t border-border px-4 py-3">
              {[
                // Direction leads when it is available: it carries the most
                // weight and it is the component people actually question.
                ...(source.match.support !== undefined
                  ? [["Argues your side", source.match.support] as const]
                  : []),
                ["Terms in title", source.match.title],
                ["Terms in the passage", source.match.passage],
                ["Terms in the article", source.match.article],
                ["How often they appear", source.match.density],
              ].map(([label, value]) => (
                <div key={label as string} className="flex items-center gap-2">
                  <span className="w-40 text-[11px] text-muted">{label}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${asPercent(value as number)}%` }}
                    />
                  </div>
                  <span className="w-9 text-right text-[11px] tabular-nums text-faint">
                    {asPercent(value as number)}%
                  </span>
                </div>
              ))}
              <p className="pt-1 text-[10px] leading-snug text-faint">
                {source.match.support === undefined
                  ? "Measures topic only — not yet which side the source argues."
                  : "Topic and direction, combined into one score."}
              </p>
            </div>
          </details>

          <div className="flex items-center gap-3 rounded-lg border border-good/30 bg-good/10 px-4 py-2.5">
            <span className="text-lg font-semibold">Open</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
              Access
            </span>
          </div>
        </div>

        <h2 className="mt-5 text-lg font-semibold leading-snug">
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {source.title}
          </a>
        </h2>
        <p className="mt-1 flex items-center gap-2 text-xs text-faint">
          <TierDot tier={tier.tier} />
          {tier.category}
          <span>·</span>
          {new URL(source.url).hostname.replace(/^www\./, "")}
          {source.publishedAt && (
            <>
              <span>·</span>
              {source.publishedAt.slice(0, 10)}
            </>
          )}
        </p>

        <div className="mt-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="prose-source min-w-0 break-words text-[13px]">{cite}</p>
            <button
              onClick={() => copy(cite, "cite")}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
            >
              {copied === "cite" ? "Copied" : "Copy cite"}
            </button>
          </div>
          {gaps.length > 0 && (
            <p className="mt-2 rounded bg-warn-soft px-2 py-1 text-xs text-warn">
              No {gaps.join(" or ")} on the page — check the article before you read this.
            </p>
          )}
        </div>

        <div className="mt-5 space-y-5">
          {source.passages.map((p, i) => {
            const key = `${selected}:${i}`;
            return (
              <div key={i} className="rounded-lg border border-border bg-surface p-4">
                <blockquote className="prose-source">
                  {highlight(p.text, result.terms).map((part, j) =>
                    part.hit ? (
                      <mark key={j} className="bg-mark text-mark-fg">{part.text}</mark>
                    ) : (
                      <span key={j}>{part.text}</span>
                    ),
                  )}
                </blockquote>

                <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                  {acted[key] === "cut" ? (
                    <span className="text-xs font-medium text-good">Copied with citation</span>
                  ) : acted[key] === "reject" ? (
                    <span className="text-xs text-faint">Marked not useful</span>
                  ) : (
                    <>
                      <button
                        onClick={async () => {
                          await copy(`${cite}\n\n${p.text}`, key);
                          await record(i, "cut");
                        }}
                        className="rounded-md bg-fg px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90"
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
                  <span className="ml-auto text-[10px] text-faint">
                    {p.paragraphCount} paragraphs
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-muted hover:text-fg">
            Show full article
          </summary>
          <pre className="prose-source mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-4 text-[13px]">
            {source.body}
          </pre>
        </details>
      </section>
    </div>
  );
}
