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

- [ ] Raise the rate limits, or testers will hit a wall. Production is
      currently 25 per person per day, 60 a day total, **220 a month total**.
      Ten testers doing twenty searches each exhausts the month in under a
      week. See `src/lib/rate-limit.ts`.
- [ ] Confirm feedback storage is live: `curl .../api/feedback` should report
      `"storage":"redis"`, not `"none"`. A tester session with storage off
      produces nothing and cannot be replayed.
- [ ] Do one search yourself on the deployed site, not localhost.

## After

Around fifty labels is where the data starts being worth training on. Export
with `FEEDBACK_EXPORT_TOKEN` and retrain — the rejections go in as negatives
against the real live retrieval, which is the one thing the openCaselist
corpus cannot provide.
