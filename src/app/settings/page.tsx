"use client";

import { useSettings } from "@/lib/settings";
import { formatCite } from "@/lib/cite-format";
import type { ArticleMetadata } from "@/lib/citation";

/** A realistic source so the preview shows what a real cite will look like. */
const SAMPLE: ArticleMetadata = {
  authors: ["Jane Nakano", "Yu-Hsuan Yeh"],
  title: "China's Nuclear Energy Priorities Under Its 15th Five-Year Plan",
  container: "Center for Strategic and International Studies",
  published: "2025-09-02T00:00:00Z",
  url: "https://www.csis.org/analysis/chinas-nuclear-energy-priorities",
  missing: [],
};

function Field({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <div className="flex items-baseline justify-between gap-4">
        <label className="text-sm font-medium">{label}</label>
        <div className="shrink-0">{children}</div>
      </div>
      {hint && <p className="mt-1 max-w-lg text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Toggle({
  on, onChange,
}: {
  on: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-border"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform ${
          on ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const preview = formatCite(SAMPLE, settings, new Date("2026-09-14T00:00:00Z"));

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        How your citations get built. Saved in this browser only.
      </p>

      {/* Live preview */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-faint">
          Preview
        </p>
        <p className="prose-source mt-2 break-words text-[13px]">{preview}</p>
      </div>

      <section className="mt-8 divide-y divide-border">
        <Field
          label="Citation style"
          hint="Debate style leads with the author and year so it can be read aloud. MLA is the works-cited format."
        >
          <select
            value={settings.style}
            onChange={(e) => update({ style: e.target.value as "debate" | "mla" })}
            className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="debate">Debate</option>
            <option value="mla">MLA</option>
          </select>
        </Field>

        <Field
          label="Your tag"
          hint="Added to the end of every citation, so anyone reading the card knows who cut it. Initials, school, whatever your squad uses."
        >
          <input
            value={settings.suffix}
            onChange={(e) => update({ suffix: e.target.value })}
            placeholder="N.B@UCB"
            spellCheck={false}
            className="w-40 rounded-md border border-border bg-bg px-3 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent"
          />
        </Field>

        <Field
          label="Tag separator"
          hint="Goes right before your tag. Most templates use two slashes."
        >
          <input
            value={settings.suffixSeparator}
            onChange={(e) => update({ suffixSeparator: e.target.value })}
            spellCheck={false}
            className="w-20 rounded-md border border-border bg-bg px-3 py-1.5 text-center text-sm outline-none focus:border-accent"
          />
        </Field>

        <Field
          label="Brackets around the details"
          hint="Wraps the author quals, outlet, date and link in square brackets. On by default."
        >
          <Toggle on={settings.brackets} onChange={(v) => update({ brackets: v })} />
        </Field>

        <Field
          label="Author qualifications"
          hint="Puts what an author is after their name — read off the page when the publisher provides it. When it does not, [AUTHOR QUALS] goes in so you know to look it up rather than finding out in a round."
        >
          <Toggle
            on={settings.authorQuals}
            onChange={(v) => update({ authorQuals: v })}
          />
        </Field>

        <Field
          label="Include date of access"
          hint="Adds DOA with the date you pulled the source — some circuits expect it."
        >
          <Toggle
            on={settings.includeAccessDate}
            onChange={(v) => update({ includeAccessDate: v })}
          />
        </Field>

        <Field
          label="Sources per search"
          hint="More sources means more to read through, and a slower search."
        >
          <input
            type="number"
            min={3}
            max={20}
            value={settings.sourceLimit}
            onChange={(e) =>
              update({ sourceLimit: Math.min(20, Math.max(3, Number(e.target.value) || 8)) })
            }
            className="w-20 rounded-md border border-border bg-bg px-3 py-1.5 text-center text-sm outline-none focus:border-accent"
          />
        </Field>

        <Field
          label="Passages per source"
          hint="How many candidate paragraphs to show from each article."
        >
          <input
            type="number"
            min={1}
            max={8}
            value={settings.passagesPerSource}
            onChange={(e) =>
              update({ passagesPerSource: Math.min(8, Math.max(1, Number(e.target.value) || 4)) })
            }
            className="w-20 rounded-md border border-border bg-bg px-3 py-1.5 text-center text-sm outline-none focus:border-accent"
          />
        </Field>
      </section>

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={reset}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface"
        >
          Reset to defaults
        </button>
        <span className="text-xs text-muted">
          Changes save as you type.
        </span>
      </div>
    </main>
  );
}
