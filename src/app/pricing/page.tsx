import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free to find evidence. Paid to have it cut for you. Team plans for programs.",
};

interface Tier {
  name: string;
  price: string;
  cadence?: string;
  pitch: string;
  cta: string;
  href: string;
  featured?: boolean;
  features: string[];
  limits?: string;
}

const TIERS: Tier[] = [
  {
    name: "Scout",
    price: "Free",
    pitch: "Find the evidence. Cut it yourself.",
    cta: "Start now",
    href: "/cut",
    features: [
      "Unlimited searches",
      "Full article text, cleaned up",
      "Top passages ranked and highlighted",
      "MLA citation built automatically",
      "Export for use with any AI assistant",
    ],
    limits: "No account. No card.",
  },
  {
    name: "Cutter",
    price: "$15",
    cadence: "/month",
    pitch: "It cuts the card. You check it.",
    cta: "Join the waitlist",
    href: "/cut",
    featured: true,
    features: [
      "Everything in Scout",
      "Cards cut for you — tag, cite, body",
      "Underlining suggested for reading aloud",
      "Verbatim guarantee: bodies are never rewritten",
      "Learns which sources and passages you keep",
      "Import your old files to train it on day one",
    ],
    limits: "Roughly 200 cut cards a month.",
  },
  {
    name: "Program",
    price: "$99",
    cadence: "/month",
    pitch: "For teams and the people coaching them.",
    cta: "Get in touch",
    href: "/about",
    features: [
      "Everything in Cutter, for up to 12 debaters",
      "Shared team card library",
      "Trained on your program's whole archive",
      "Coach view: what everyone is researching",
      "Priority support through the season",
    ],
    limits: "Per-squad pricing for larger programs.",
  },
];

function Check() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="mt-[3px] h-3.5 w-3.5 shrink-0 text-accent"
    >
      <path
        d="M3 8.5l3.5 3.5L13 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">
          Finding evidence is free.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          The searching and reading costs us almost nothing, so it costs you
          nothing. You only pay when you want the card cut for you — that&rsquo;s
          the part that runs on a model and actually has a bill attached.
        </p>
      </div>

      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={`flex flex-col rounded-xl border p-6 ${
              tier.featured
                ? "border-accent bg-surface shadow-sm"
                : "border-border bg-surface"
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{tier.name}</h2>
              {tier.featured && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                  Most popular
                </span>
              )}
            </div>

            <p className="mt-1 text-sm text-muted">{tier.pitch}</p>

            <p className="mt-5">
              <span className="text-3xl font-semibold tracking-tight">
                {tier.price}
              </span>
              {tier.cadence && (
                <span className="text-sm text-faint">{tier.cadence}</span>
              )}
            </p>

            <Link
              href={tier.href}
              className={`mt-5 rounded-md px-4 py-2 text-center text-sm font-medium transition-opacity hover:opacity-90 ${
                tier.featured
                  ? "bg-accent text-white"
                  : "border border-border text-fg hover:bg-bg"
              }`}
            >
              {tier.cta}
            </Link>

            <ul className="mt-6 space-y-2.5 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex gap-2 text-muted">
                  <Check />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {tier.limits && (
              <p className="mt-5 border-t border-border pt-4 text-xs text-faint">
                {tier.limits}
              </p>
            )}
          </div>
        ))}
      </div>

      <section className="mt-16 max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight">
          Questions worth answering up front
        </h2>

        <dl className="mt-6 space-y-6 text-[15px]">
          <div>
            <dt className="font-medium">Why is the free plan this good?</dt>
            <dd className="mt-1 leading-relaxed text-muted">
              Because searching and reading articles is cheap, and because a
              debater who can&rsquo;t afford a subscription still deserves to
              stop wasting evenings on tab-hunting. The free tier isn&rsquo;t a
              trial — it&rsquo;s the product, minus the cutting.
            </dd>
          </div>

          <div>
            <dt className="font-medium">
              Can I use my own AI instead of paying?
            </dt>
            <dd className="mt-1 leading-relaxed text-muted">
              Yes, and we make it easy. Hit <em>Copy all</em> on any result and
              paste it into whatever assistant you already pay for. It comes
              with the cutting instructions and the citations attached.
            </dd>
          </div>

          <div>
            <dt className="font-medium">What does &ldquo;learns your judgment&rdquo; mean?</dt>
            <dd className="mt-1 leading-relaxed text-muted">
              Which sources you keep, which paragraphs you take, how much you
              underline. Paid plans can also read the cards you&rsquo;ve already
              cut, so it starts out matching your taste instead of guessing at
              it. Your files stay yours.
            </dd>
          </div>

          <div>
            <dt className="font-medium">Is evidence ever reworded?</dt>
            <dd className="mt-1 leading-relaxed text-muted">
              No — on every plan. Card bodies come from the article&rsquo;s own
              text, and a passage that can&rsquo;t be matched to the source
              exactly is thrown out rather than fixed.{" "}
              <Link href="/about" className="text-accent hover:underline">
                How that works
              </Link>
              .
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
