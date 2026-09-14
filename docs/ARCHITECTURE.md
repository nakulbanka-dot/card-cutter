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

---

# Training on your own cards

A cut card is a finished labeling task. Nobody has to sit down and label
anything — the labels were produced as a side effect of cutting.

| Part of the card | What it teaches |
| --- | --- |
| Tag | the query — measured median is 8 words, which *is* the prompt format |
| Body | this paragraph beat everything else in the article |
| Underlining | which words carried the argument, at token level |
| Cite | which sources you trust, and the URL for negative mining |

`npm run import-cards -- data/past-cards` reads `.docx` and `.html`, writes
`data/cards.jsonl`, and reports what signal it found. Everything stays local.

## The positives-only problem

Past cards are all positives. A classifier that only ever sees good passages
learns to call everything good — this is the single thing that decides whether
any of this trains.

The fix comes from the same data. Each card's cite carries the source URL.
Re-extract that article and **every other paragraph in it is a negative you can
trust**: the debater read that page and chose this paragraph over those. Those
are hard negatives, worth far more than random paragraphs from unrelated
articles, and they cost one extraction per card.

## Position bias

The other way this fails quietly. If you mostly cut from rank 0, a model
trained on click data learns "rank 0 is good," which is circular. Three
mitigations, all cheap:

- log every passage *shown*, not only the ones acted on (done — `action: "shown"`)
- shuffle the order ~10% of the time so lower ranks get a fair look
- keep `shownRank` as a feature so the model can subtract position out

Skip these and the metrics look great while the model learns nothing.

## Metrics

Baseline first, then measure every change against it. `GET /api/feedback`
returns the first three today.

- **Precision@k** — of the top k shown, the fraction cut. The headline number.
- **Cut rate by rank** — if rank 0 and rank 3 cut equally, ranking does nothing.
- **Source yield** — fraction of sources producing at least one cut.
- **Citation completeness** — share of cites with both author and date.
- **Time to first cut** — the honest usability number.

Roughly 200 labeled passages before a learned ranker beats the heuristics;
~500 for stable weights. Imported cards count toward that from day one.

---

# What the corpus training actually showed

Pulled all 4,830,561 openCaselist cards (MIT, 9.9 GB slim). Exported the
subset re-cut 3+ times: 2,890,696 cards. Trained on 250,000 of them.

## Result

    base rate   50.2%   <- accuracy to beat
    test acc    77.2%
    test AUC    0.842   <- 0.5 is chance

    termCoverage    +1.18  ██████████████
    termDensity     +0.96  ████████████
    logChars        -0.32  ████
    ... everything else below 0.2

## The result is worse than it looks

AUC 0.842 sounds like it works. The weights say otherwise: the model put
essentially all of its mass on `termCoverage` and `termDensity` — it learned
keyword matching, which the heuristic already did. Credentials, quantities and
hedging carry no weight at all.

The second run tested whether better negatives would fix it. 185,383 of the
500,000 examples were **opposite-side** negatives: same topic, same season, a
card cut by the other team arguing the other way. Keyword overlap cannot
separate those pairs, so the model had every reason to learn direction.

It did not. AUC 0.842 versus 0.846 — statistically the same model.

## Why

The features are the limit, not the negatives. All twelve are bag-of-words
statistics, and no combination of them can distinguish "nuclear solves
climate" from "nuclear does not solve climate". The words are identical. A
12-dimensional word-count vector has no way to represent negation or stance,
so no amount of training data will teach it one.

## What would actually work

1. **Embeddings.** Encode the tag and the passage, feed cosine similarity plus
   the existing features into the same classifier. Captures meaning rather
   than word overlap, so negation changes the vector. Runs locally.
2. **Negation features.** Detect negation near query terms. Crude, cheap, and
   probably worth a day to see how far it gets.
3. **A cheap model call.** Haiku scoring "does this support the claim" on the
   top few sources. Works today, at roughly a tenth of a cent per query.
4. **A cross-encoder.** The real answer and the heaviest lift.

The trained model is kept at `data/training/ranker.json` for comparison, but
it is deliberately **not wired into production** — it does not beat the
heuristic it would replace, and shipping it would add a model dependency for
no gain.

## Corpus limitations worth knowing

- **PF is 0.7% of the corpus.** 19,818 PF cards against 1.9M policy and
  725K LD. A ranker trained on this learns policy debate's conventions.
- **The data stops in 2022.** Nothing on recent topics, so source reputation
  learned from it will be stale on anything current.

Both point the same way: the corpus is good for learning what a cuttable
passage looks like in general, and poor for learning this event or this
season. Your own files and your own Cut/Not-useful clicks stay the better
signal for those.


---

# What reads the articles, and what does not

Worth stating precisely, because it is easy to assume more is happening than is.

## Keyword scoring — no model

- splitting the tag into terms
- the search queries sent out
- **shortlisting** candidate paragraphs from each article
- the topic components of the match score (title, passage, article, density)

## The model — reads the text

- **choosing** which shortlisted paragraphs you actually see
- ordering them
- deciding whether each argues your claim
- the direction component of the match score, weighted highest at 0.35

Keyword scoring narrows each article to eight plausible paragraphs, because it
is cheap and reading every paragraph of every article would be far too slow.
The model then reads all eight and picks the four worth showing. Measured on
one query, it chose a different top passage from the keyword favourite in
**5 sources out of 5**, and its pick scored higher on argument every time —
95 against 76, 97 against 75, 98 against 92.

That shortlist is still a real limit. A paragraph that argues the claim
perfectly while using none of your words never reaches the model, because
keywords never surface it. Fixing that needs semantic retrieval over the whole
article rather than term matching, which is the next honest step.

Cost of reading: roughly 200ms per paragraph, so about 13 seconds on a
64-paragraph query. That is the bulk of the wait.
