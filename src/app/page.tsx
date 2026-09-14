import Link from "next/link";

const STEPS = [
  {
    n: "01",
    title: "Say what you want it to prove",
    body: "One line, the way you'd write a tag. “Nuclear power solves warming.” Start with “answers to” and it looks for the other side instead.",
  },
  {
    n: "02",
    title: "It reads the whole article",
    body: "Not search snippets — the full text, with the navigation, ads, and cookie banners stripped out. The quotable paragraph is almost never the one a search engine previews.",
  },
  {
    n: "03",
    title: "You get the passages, ranked",
    body: "Best sources first, your terms highlighted, and the MLA citation already assembled from the page's own metadata. You make the call on what's actually cuttable.",
  },
];

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Evidence for debate,
            <br />
            <span className="text-accent">in one line.</span>
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-muted">
            Write what you want the card to say. Card Cutter finds the sources,
            pulls the full text, and hands back the paragraphs worth cutting —
            citation included.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/cut"
              className="rounded-md bg-fg px-5 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
            >
              Start cutting
            </Link>
            <Link
              href="/pricing"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface"
            >
              See plans
            </Link>
            <span className="text-sm text-faint">Free to use. No account.</span>
          </div>
        </div>
      </section>

      {/* What it looks like */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">
            What comes back
          </p>

          <div className="mt-5 rounded-lg border border-border bg-bg p-5">
            <p className="text-sm font-medium">
              France generates 70% of its power from nuclear
            </p>
            <p className="prose-source mt-1 text-muted">
              Chen, Wei. &ldquo;Nuclear and the Grid.&rdquo; Brookings
              Institution, 12 Mar. 2026.
            </p>
            <blockquote className="prose-source mt-3 border-l-2 border-border pl-4">
              Setting aside the politics,{" "}
              <mark className="bg-mark text-mark-fg">
                France generates roughly 70 percent of its electricity from
                nuclear reactors
              </mark>
              , and its grid carbon intensity sits at about one fifth the
              European average.
            </blockquote>
          </div>

          <p className="mt-4 text-sm text-muted">
            Ranked by how likely they are to be cuttable. Your terms marked.
            Citation ready to paste.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>

        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="font-mono text-xs text-accent">{step.n}</span>
              <h3 className="mt-2 font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The rule */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight">
              Card bodies are never rewritten.
            </h2>
            <p className="mt-4 leading-relaxed text-muted">
              A card whose body has been tightened, smoothed, or &ldquo;cleaned
              up&rdquo; is a fabricated card — and that is the one accusation you
              don&rsquo;t come back from in a round.
            </p>
            <p className="mt-4 leading-relaxed text-muted">
              So Card Cutter never writes card text. It locates the passage in
              the real article and gives you{" "}
              <span className="text-fg">the article&rsquo;s own characters</span>
              . If the words can&rsquo;t be found in the source exactly, the
              passage is thrown out rather than repaired.
            </p>

            <Link
              href="/about"
              className="mt-6 inline-block text-sm font-medium text-accent hover:underline"
            >
              Why this matters →
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-4 px-6 py-14 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Try it on your next case.
            </h2>
            <p className="mt-1 text-sm text-muted">
              No sign-up, no card. Type a tag and see what comes back.
            </p>
          </div>
          <Link
            href="/cut"
            className="rounded-md bg-fg px-5 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
          >
            Start cutting
          </Link>
        </div>
      </section>
    </main>
  );
}
