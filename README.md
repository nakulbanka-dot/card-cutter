# card-cutter

Find debate evidence from a five-to-ten word prompt.

You type `nuclear power solves climate change`. It searches, pulls the full
text of what it finds, and shows you the paragraphs most likely to hold the
card — your terms highlighted, nav junk stripped.

**Free mode is the default and needs no account at all.** Tavily's keyless
tier covers the search and extract calls it makes, so there is nothing to sign
up for and nothing to pay.

## Setup

```bash
npm install
npm run dev
```

That's it. No `.env.local` needed to start.

Hitting the keyless caps? A [free Tavily key](https://app.tavily.com/home)
(no credit card) raises it to 1,000 credits a month — roughly 100+ queries.
That free tier is a **hard stop**: it refuses requests rather than billing you.
You are only charged if you deliberately upgrade to Pay As You Go. See
`.env.example`.

## The two modes

| | Cost | What it does |
| --- | --- | --- |
| **Free** (`POST /api/find`) | $0, no account | Searches, extracts, ranks passages. You cut. |
| **Paid** (`POST /api/cut`) | ~$0.50–1.00/query | Claude cuts the cards for you. |

Free mode drops the expensive stage — deciding which paragraph is the warrant —
which is the stage you're already good at. What it keeps is the grind: finding
sourceable articles and getting clean text out of pages buried in nav bars.

**Free, with Opus judgment.** Hit **Copy for Claude** and paste into the Claude
you already pay for. Same quality cutting, zero API cost, one extra paste.

## The one rule

Card bodies are **verbatim**. A card whose body has been paraphrased or
"cleaned up" is a fabricated card.

In paid mode this is enforced in code: the model never writes a card body, it
points at a passage, and `src/lib/verbatim.ts` puts *the article's own
characters* on the card. If the quote isn't in the article word-for-word, the
card is discarded. Formatting drift (curly quotes, line wrapping, casing) is
tolerated; a changed word is not.

In free mode the markdown export carries the same rule as an instruction — and
you're reading the output, which is the trade you accept for it costing nothing.

## Layout

| Path | What's there |
| --- | --- |
| `src/app/page.tsx` | Search box and results |
| `src/app/api/find/route.ts` | Free mode |
| `src/app/api/cut/route.ts` | Paid mode |
| `src/lib/terms.ts` | Query parsing, no LLM |
| `src/lib/passages.ts` | Paragraph ranking and highlighting |
| `src/lib/verbatim.ts` | The fabrication guard |
| `src/lib/export-markdown.ts` | The "Copy for Claude" payload |
| `src/lib/pipeline/free.ts` | Free pipeline |
| `src/lib/pipeline/` | Paid stages: expand, search, extract, cut, underline |
| `docs/ARCHITECTURE.md` | How it fits together, and what's open |

## Scripts

```bash
npm run dev        # dev server (Turbopack)
npm run build      # production build
npm run typecheck  # tsc, no emit
npm run lint       # eslint
npm test           # node:test — 25 tests, no API keys needed
```

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 ·
`@tavily/core` · `@anthropic-ai/sdk` (paid mode only) · zod
