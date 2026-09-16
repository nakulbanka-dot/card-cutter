# Beta testers — what to send them

Paste the block below. It is written to get labels, not compliments.

The ask is deliberately blunt about rejections. Every copy already records a
positive automatically, so approval collects itself; a rejection only exists if
someone stops and clicks. Those are the examples that teach the ranking what
"close but wrong" looks like, and without them the training data is one-sided.

---

## Paste this

> **Card Cutter — try it and tell me what's broken**
>
> https://card-cutter-gules.vercel.app/cut
>
> Type a tag the way you'd actually write one on a card. 5-10 words, take a
> position. "Nuclear power solves climate change" — not "nuclear power."
>
> It searches, pulls the full text of each article, and shows you the
> paragraphs worth cutting with the citation already built. Give it about
> thirty seconds. It is running a model trained on 4.8 million real debate
> cards, actually reading every paragraph, not faking a loading bar.
>
> **The part I actually need from you:** hit **Cut this** when a passage is
> good, **Not useful** when it isn't.
>
> The "Not useful" clicks are worth more to me than the good ones. Those are
> what teach it the difference between a paragraph that is about your topic and
> one that proves your tag. Don't be polite — if everything on screen is bad,
> mark everything bad.
>
> Worth telling me about:
> - a tag where it found nothing usable
> - a passage that argues the opposite of what you asked (known weak spot,
>   examples wanted)
> - a citation that looks wrong
> - anything slow, confusing, or broken
>
> No login, nothing to install. Works on your phone. About fifteen searches per
> person per day.

## Before you send it

- [x] **Rate limits reshaped** for a launch burst: 150 a day globally (was 60,
      which ten testers exhausted in an afternoon), 15 per person (was 25, one
      of which could spend a tenth of the month). The 220 monthly cap is
      unchanged — it is the free tier's real budget, and raising it means
      paying. See `src/lib/rate-limit.ts`.
- [x] Feedback storage confirmed live in production — `/api/feedback` reports
      `"storage":"redis"`. A tester session with storage off produces nothing
      and cannot be replayed.
- [x] **The trained models are live in production.** Verified end to end:
      8 sources, 32 passages, 32 of 32 judged by the model, no fallback.
      Memory peaked at 252MB of the 1024MB this plan allows, so nothing needs
      paying for.
- [ ] Do one search yourself on the deployed site, not localhost.
- [ ] Send it to about ten people, not fifty. The monthly cap is 220 searches
      in total: ten testers doing fifteen each is comfortable, fifty will hit
      a wall and spend the first impression on it.

## Done since

- [x] **Homepage copy.** It claimed the corpus taught the app to judge sources
      while the judging was done by a general-purpose model that had never seen
      a card. That is true now, so the page says what the models actually do
      and quotes the measured figure rather than implying one.

## After

Around fifty labels is where the data starts being worth training on. Export
with `FEEDBACK_EXPORT_TOKEN` and retrain — the rejections go in as negatives
against the real live retrieval, which is the one thing the openCaselist
corpus cannot provide.
