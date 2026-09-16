"use client";

import { useEffect, useRef, useState } from "react";
import stats from "@/data/training-stats.json";
import { countUpValue } from "@/lib/ease";

/**
 * What the ranking has been built from.
 *
 * Every figure is counted off the data on disk by
 * scripts/write-training-stats.mjs, never typed in. A number offered as
 * evidence of reliability has to be one we can point at — and the breakdown
 * is shown for the same reason, so "4.8 million" cannot be mistaken for
 * something it isn't.
 */

function useCountUp(target: number, durationMs = 1400) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const timeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const animate = () => {
      if (started.current) return;
      started.current = true;

      // Respect a reader who has asked for less motion.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setValue(target);
        return;
      }

      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        setValue(countUpValue(target, elapsed, durationMs));
        if (elapsed < durationMs) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      // requestAnimationFrame stops firing when the tab or pane is hidden, so
      // scrolling away mid-count leaves the number frozen somewhere arbitrary
      // and it never recovers. Timers still fire, so this guarantees it lands
      // on the real figure whatever happens to the animation.
      timeout.current = window.setTimeout(() => setValue(target), durationMs + 200);
    };

    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && animate()),
      { threshold: 0.3 },
    );
    io.observe(el);

    // The observer is an enhancement, not a dependency. If it never fires —
    // a hidden tab, an offscreen pane, a browser that throttles it — the
    // figure still has to appear. Showing "0 debate cards analysed" would be
    // worse than showing no animation at all.
    const fallback = window.setTimeout(animate, 2500);

    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
      if (timeout.current !== undefined) window.clearTimeout(timeout.current);
    };
  }, [target, durationMs]);

  return { value, ref };
}

export function TrainingCounter() {
  const { value, ref } = useCountUp(stats.totalCards);

  const rows: { label: string; value: string; note: string }[] = [
    {
      label: "Disclosed cards",
      value: stats.corpusCards.toLocaleString(),
      note: "The public openCaselist archive, read end to end.",
    },
    {
      label: "Cards from real files",
      value: stats.ownCards.toLocaleString(),
      note: `Parsed out of ${stats.ownFiles.toLocaleString()} debate files, tag and underlining intact.`,
    },
    {
      label: "Ranking examples",
      value: stats.rankerExamples.toLocaleString(),
      note: "Labelled pairs used to fit how sources get ordered.",
    },
  ];

  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-5xl px-6 py-14">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-faint">
              Built on real evidence
            </p>
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              <span ref={ref}>{value.toLocaleString()}</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              debate cards analysed — every one of them cut by a person first
            </p>
          </div>
          <p className="text-xs text-faint">Updated {stats.updated}</p>
        </div>

        <dl className="mt-8 grid gap-6 border-t border-border pt-6 sm:grid-cols-3">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-xs font-medium uppercase tracking-wider text-faint">
                {r.label}
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{r.value}</dd>
              <dd className="mt-1 text-xs leading-relaxed text-muted">{r.note}</dd>
            </div>
          ))}
        </dl>

        {/*
          Was "learns from these to judge which sources are worth your time"
          while the judging was done by a general-purpose model that had never
          seen a debate card — and which measured worse than counting keywords.
          It is true now, so it can say what it actually does instead.
        */}
        <p className="mt-6 max-w-2xl text-xs leading-relaxed text-faint">
          These cards trained the two models that do the work: one finds the
          paragraph, the other decides whether it proves your tag. On articles
          they had never seen, they pick a passage a real debater cut about two
          times in three — against roughly one in two for the keyword matching
          they replaced. They never reuse a card&rsquo;s text; every passage is
          cut fresh from the article it names.
        </p>
      </div>
    </section>
  );
}
