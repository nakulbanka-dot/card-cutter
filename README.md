# card-cutter

Cut debate cards from a five-to-ten word prompt.

You type `AI regulation kills innovation`. It searches, reads the full text of
what it finds, and hands back cards — tag, cite, verbatim body, underlines.

**Status: pipeline built, never run end-to-end.** All five stages are wired up,
and typecheck/lint/build/tests pass — but it has not been run against the live
APIs, because that needs your keys. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the two keys
npm run dev
```

Keys needed: [Anthropic](https://console.anthropic.com/settings/keys) and
[Tavily](https://app.tavily.com/home). `.env.local` is gitignored.

## The one rule

Card bodies are **verbatim**. A card whose body has been paraphrased, tightened,
or "cleaned up" is a fabricated card — so the pipeline makes that structurally
impossible rather than merely discouraged.

The model never writes a card body. It points at a passage; `src/lib/verbatim.ts`
finds that passage in the real article and puts **the article's own characters**
on the card, discarding whatever the model typed. If the quote it returned isn't
in the article word-for-word, the card is thrown away.

Formatting drift from extraction — curly quotes, line wrapping, em-dash style,
casing — is tolerated. A changed, dropped, or reordered word is not.

`npm test` covers that guard, including the cases that must fail: a reworded
quote and a dropped hedge.

## Layout

| Path | What's there |
| --- | --- |
| `src/app/page.tsx` | Search box and results |
| `src/app/api/cut/route.ts` | `POST /api/cut` |
| `src/components/card-view.tsx` | Renders a card with its underlines |
| `src/lib/verbatim.ts` | The fabrication guard |
| `src/lib/pipeline/` | The five stages |
| `src/lib/types.ts` | `Card`, `Cite`, `Source`, `Underline` |
| `src/lib/env.ts` | Validated server env |
| `docs/ARCHITECTURE.md` | How the stages fit together, and what's open |

## Scripts

```bash
npm run dev        # dev server (Turbopack)
npm run build      # production build
npm run typecheck  # tsc, no emit
npm run lint       # eslint
npm test           # node:test — the verbatim matcher
```

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 ·
`@anthropic-ai/sdk` · `@tavily/core` · zod
