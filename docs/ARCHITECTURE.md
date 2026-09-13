# How this works

All five stages are built, in `src/lib/pipeline/`. This is how they fit
together and what's still open. Not yet run against the live APIs.

## The input

One text box. Five to ten words. `"AI regulation kills innovation"`.
No filters, no date pickers, no source whitelist in v1.

## The pipeline

```
query ──▶ 1. EXPAND ──▶ 2. SEARCH ──▶ 3. EXTRACT ──▶ 4. CUT ──▶ 5. UNDERLINE ──▶ cards
```

1. **Expand** (`expand.ts`) — Claude turns the shorthand into real search
   queries. "AI regulation kills innovation" is not a search query; "EU AI Act
   compliance cost startups 2026" is. Also decides aff vs neg ground: say
   "answers to" or "AT" and it looks for refutation instead.

2. **Search** (`search.ts`) — Tavily, one call per expanded query, merged.
   Deduped by URL, capped at 2 per domain: eight cards off the same outlet is
   one card as far as a judge is concerned. Best-scoring hits survive the cap.

3. **Extract** (`extract.ts`) — Tavily full-text on the survivors. Snippets are
   useless for cutting; the quotable paragraph is almost never the one the
   search engine previewed. Under 600 characters recovered is treated as a
   paywall and skipped.

4. **Cut** (`cut.ts`) — Claude reads one article and proposes up to 3 cards,
   usually 0 or 1. It's told explicitly that returning nothing is the correct
   and common answer, because most articles contain nothing worth reading aloud.

   **The verbatim guard.** The model's quote is a *pointer*, not content.
   `verbatim.ts` finds it in the real article and puts the article's own
   characters on the card. A quote that can't be found word-for-word means the
   model rewrote it, so the card is discarded rather than repaired. Matching
   tolerates extraction drift (curly quotes, line wrapping, em-dashes, casing)
   and nothing else. This is the constraint the whole design serves.

5. **Underline** (`underline.ts`) — a second pass marking what gets read aloud.
   Separate from step 4 on purpose: "find the evidence" and "compress it to
   eight seconds" are different judgments, and the model does both worse when
   asked at once. Same guard applies — the model returns phrases, we locate
   them ourselves, and a reworded phrase simply fails to place.

Articles are cut 3 at a time (`CUT_CONCURRENCY`); each is a full-length Opus
call, so this is the main cost and latency knob.

## Open questions

- **Author qualification.** What makes a card good is the author's credential,
  and it's usually not in the article body. The cutter is told to use null
  rather than guess, so right now many cards will have a bare name. A separate
  lookup pass is the obvious fix.
- **Output format.** Debaters live in Verbatim / Word with specific styles.
  Do we export .docx, or is copy-paste from the browser enough for v1?
- **Paywalls.** Detected and skipped. Worth surfacing the cite anyway so you
  can go find the text yourself?
- **Cost.** Opus reading 8 full articles per query is not free. A cheap
  relevance pre-filter (Haiku) before the Opus cut would cut most of that.
- **Latency.** Expand → search → extract → cut → underline is serial by stage.
  A minute-plus per query is likely. Streaming cards to the UI as they finish
  would make it feel much better, and nothing in the design prevents it.
