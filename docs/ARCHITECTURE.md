# How this is supposed to work

Nothing here is built yet. This is the plan we're arguing about before writing code.

## The input

One text box. Five to ten words. `"AI regulation kills innovation"`.
That's the whole interface — no filters, no date pickers, no source whitelist in v1.

## The pipeline

```
query ──▶ 1. EXPAND ──▶ 2. SEARCH ──▶ 3. EXTRACT ──▶ 4. CUT ──▶ 5. UNDERLINE ──▶ cards
```

1. **Expand** — Claude turns the 5–10 words into several real search queries.
   "AI regulation kills innovation" is not a search query; "EU AI Act compliance
   cost startups 2026" is. This is also where we decide whether the user wants
   aff or neg ground.

2. **Search** — Tavily, one call per expanded query. Returns URLs + snippets.
   Dedupe by domain so we don't cut eight cards off the same outlet.

3. **Extract** — Tavily full-text extraction on the surviving URLs. Snippets are
   useless for cutting; we need the whole article to find the good paragraph.

4. **Cut** — Claude reads each article and returns: the tag, the verbatim
   passage, and the cite. **The body must be verbatim.** A card with a
   paraphrased body is a fabricated card, and that is the one failure mode that
   actually matters in this project. Plan: have the model return character
   offsets into the extracted text rather than re-typing the passage, then slice
   it ourselves so paraphrase is structurally impossible.

5. **Underline** — a second pass marking which spans get read aloud.
   Separate from step 4 on purpose: "find the evidence" and "compress it to
   eight seconds" are different judgments and the model does both worse when
   asked at once.

## Open questions

- **Author qualification.** The thing that makes a card good is the author's
  credential, and it's usually not in the article body. Separate lookup pass?
- **Verbatim enforcement.** Offsets (above) are the plan, but extraction
  normalizes whitespace, so offsets may drift. Needs a reconciliation step.
- **Output format.** Debaters live in Verbatim / Word with specific styles.
  Do we export .docx, or is copy-paste from the browser enough for v1?
- **Paywalls.** A meaningful share of good evidence is behind one. Do we detect
  and skip, or surface the cite anyway and let the user find the text?
- **Cost.** Opus reading 8 full articles per query is not free. Cheaper model
  for a relevance pre-filter, Opus only on survivors?
