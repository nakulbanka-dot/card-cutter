# card-cutter

Cut debate cards from a five-to-ten word prompt.

You type `AI regulation kills innovation`. It searches, reads the full text of
what it finds, and hands back cards — tag, cite, verbatim body, underlines.

**Status: scaffolding.** The pipeline is not implemented. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the plan and the open questions.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the two keys
npm run dev
```

Keys needed: [Anthropic](https://console.anthropic.com/settings/keys) and
[Tavily](https://app.tavily.com/home). `.env.local` is gitignored.

## Layout

| Path | What's there |
| --- | --- |
| `src/app/page.tsx` | Homepage — still the Next.js default |
| `src/app/api/cut/route.ts` | `POST /api/cut`, stubbed at 501 |
| `src/lib/types.ts` | `Card`, `Cite`, `Source`, `Underline` — the domain vocabulary |
| `src/lib/env.ts` | Validated server env |
| `src/lib/models.ts` | Model + fan-out constants |
| `docs/ARCHITECTURE.md` | The pipeline plan |

## Scripts

```bash
npm run dev        # dev server (Turbopack)
npm run build      # production build
npm run typecheck  # tsc, no emit
npm run lint       # eslint
```

## The one rule

Card bodies are **verbatim**. A card whose body has been paraphrased, tightened,
or "cleaned up" is a fabricated card — in a round that's a career-ending
accusation, so the pipeline has to make it structurally impossible rather than
merely discouraged. That constraint drives most of the design in
`docs/ARCHITECTURE.md`.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 ·
`@anthropic-ai/sdk` · `@tavily/core` · zod
