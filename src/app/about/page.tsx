import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Card Cutter exists, and the one rule it will not break: card bodies are never rewritten.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        Research is the part that doesn&rsquo;t make you better.
      </h1>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-muted">
        <p>
          Every debater knows the hours. You have a position you want to run.
          You know roughly what the card should say. And then you spend an
          evening opening tabs, skimming paywalls, and fighting cookie banners
          to find the one paragraph that says it well enough to read out loud.
        </p>

        <p>
          None of that makes you a better debater. Knowing which paragraph is
          the warrant does. Knowing whether an author has standing does. Knowing
          what to underline so it lands in eight seconds does. That is judgment,
          and it&rsquo;s built by cutting cards — not by hunting for them.
        </p>

        <p className="text-fg">
          Card Cutter does the hunting. You keep the judgment.
        </p>
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight text-fg">
        The one rule
      </h2>

      <div className="mt-5 space-y-6 text-[15px] leading-relaxed text-muted">
        <p>
          A card whose body has been reworded, tightened, or &ldquo;cleaned
          up&rdquo; is a fabricated card. Someone calls for it, pulls the
          original, and the words don&rsquo;t match. In a round that is not a
          mistake — it&rsquo;s the accusation you don&rsquo;t come back from.
        </p>

        <p>
          This is a real risk with AI tools, and it&rsquo;s a quiet one. Ask a
          language model for &ldquo;the relevant passage&rdquo; and it{" "}
          <em>writes</em> one. Usually it matches. Occasionally it smooths a
          clause or drops a hedge, and you&rsquo;d never notice, because the
          card reads better than the original.
        </p>

        <p className="text-fg">
          So Card Cutter never writes card text. It points at a passage, and the
          software copies the article&rsquo;s own characters. If the words
          can&rsquo;t be found in the source exactly, the passage is discarded
          rather than repaired. Not discouraged — impossible.
        </p>
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight text-fg">
        It learns your judgment
      </h2>

      <div className="mt-5 space-y-6 text-[15px] leading-relaxed text-muted">
        <p>
          Any AI can find articles. What makes this different is that it learns
          what <em>you</em> cut. Every passage you take and every one you pass
          on teaches it which sources hold up, which paragraphs carry a warrant,
          and how much of a card you actually underline.
        </p>

        <p>
          It can also read the cards you&rsquo;ve already cut. Your files are
          full of finished judgment calls — a tag stating what you wanted, a
          passage you chose over everything else on the page, underlining that
          marks what mattered. That&rsquo;s a training set you built years ago
          without meaning to.
        </p>
      </div>

      <div className="mt-14 rounded-lg border border-border bg-surface p-6">
        <p className="font-medium text-fg">Built by debaters, for debaters.</p>
        <p className="mt-1 text-sm text-muted">
          Every design decision here came from cutting cards under a deadline.
        </p>
        <Link
          href="/cut"
          className="mt-4 inline-block rounded-md bg-fg px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          Try it
        </Link>
      </div>
    </main>
  );
}
