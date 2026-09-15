# Beta testers — what to send them

Paste the block below. It is written to get labels, not compliments.

The ask is deliberately blunt about rejections. Every copy already records a
positive automatically, so approval collects itself; a rejection only exists if
someone stops and clicks. Those are the examples that teach the ranking what
"close but wrong" looks like, and without them the training data is one-sided.

---

## Paste this

> **Card Cutter — try it and tell me what's wrong with it**
>
> https://card-cutter-gules.vercel.app/cut
>
> Type a tag the way you'd actually write one on a card — 5 to 10 words, take
> a position. "Nuclear power solves climate change", not "nuclear power".
>
> It searches, pulls the full text of each article, and shows you the
> paragraphs worth cutting, with the citation already built. Give it about 20
> seconds; it's reading real articles, not faking a loading bar.
>
> **The part I actually need:** hit **Cut this** when a passage is good, and
> **Not useful** when it isn't. The "Not useful" clicks are worth more to me
> than the good ones — they're what teaches it the difference between a
> paragraph that mentions your topic and one that argues your tag.
>
> Don't be polite about it. If everything on screen is bad, mark everything bad.
>
> Things worth telling me:
> - a tag where it found nothing usable
> - a passage that argues the opposite of what you asked
> - a citation that looks wrong
> - anything that felt slow, confusing, or broken
>
> No login, nothing to install. Works on your phone.

---

## Before you send it

- [x] **Rate limits reshaped** for a launch burst: 150 a day globally (was 60,
      which ten testers exhausted in an afternoon), 15 per person (was 25, one
      of which could spend a tenth of the month). The 220 monthly cap is
      unchanged — it is the free tier's real budget, and raising it means
      paying. See `src/lib/rate-limit.ts`.
- [x] Feedback storage confirmed live in production — `/api/feedback` reports
      `"storage":"redis"`. A tester session with storage off produces nothing
      and cannot be replayed.
- [ ] Deploy. The fixes above are committed but not pushed.
- [ ] Do one search yourself on the deployed site, not localhost.

## Owed after the trained model ships

- [ ] **Homepage copy.** It currently says Card Cutter "learns from these to
      judge which sources are worth your time." That is not true today — the
      corpus trained a junk filter and nothing more. It becomes true when the
      card-trained ranker replaces the borrowed NLI model, which is why it is
      being corrected then rather than twice.

## After

Around fifty labels is where the data starts being worth training on. Export
with `FEEDBACK_EXPORT_TOKEN` and retrain — the rejections go in as negatives
against the real live retrieval, which is the one thing the openCaselist
corpus cannot provide.
