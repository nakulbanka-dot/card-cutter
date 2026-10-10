# What the models do, and how well

Every number here is measured on 362 held-out article/tag pairs from articles
no model saw in training, with the leakage check in `scripts/check-leakage.py`
reporting 0% contamination. Chance is 0.3663.

## The three models

| | Job | Ships as | Size (int8) | Runs in |
|---|---|---|---|---|
| `models/retriever` | Which paragraphs does the reranker get to see | `ml/retriever` | 22.9 MB | `/api/find` |
| `models/cutter2` | Does this paragraph prove the tag | `ml/reranker` | 23.0 MB | `/api/find` |
| `models/highlighter` | Which sentences would a debater underline | `ml/highlighter` | 23.0 MB | `/api/underline` |

All three fit inside a serverless function, which is the point. They replaced
the NLI stance model, whose ~600MB runtime did not fit, so production had to
call a hosted copy over the network — and that call is why production showed
testers 8 passages where a local run showed 24.

## Retrieval — finding the passage

Each tag searched against all 9,299 test paragraphs.

| | R@1 | R@5 | R@20 | R@100 | MRR |
|---|---|---|---|---|---|
| keyword overlap | 0.1740 | 0.3508 | 0.5580 | 0.7403 | 0.2636 |
| trained retriever | **0.3232** | **0.6133** | **0.7707** | **0.8895** | **0.4527** |

Twice as likely to put the cut paragraph first. Said plainly, because
"doubles retrieval" flatters it: R@1 0.32 means it is wrong about the single
best passage two times in three. What it does reliably is get the right
passage into the candidate set — R@20 0.77 against 0.56 — which is the job of
a shortlist. Retrieval is for recall; the reranker is for precision.

Inside one article the gap nearly vanishes (P@1 0.5912 vs 0.5884, inside the
noise floor). That is expected: on the right page the author uses the topic's
vocabulary throughout, so counting words does fine. The value is in finding
the page.

## Reranking — judging the passage

| | AUC/article | P@1 | R@4 | MRR |
|---|---|---|---|---|
| NLI stance (deployed before this) | 0.5792 | 0.4922 | 0.8264 | 0.6443 |
| keyword (the app's own ranking) | 0.6459 | 0.5718 | 0.8591 | 0.7069 |
| trained reranker, fp32 | 0.7223 | 0.6657 | 0.8950 | 0.7711 |
| trained reranker, int8 (deployed) | **0.7247** | **0.6740** | **0.8978** | **0.7773** |

In product terms, of the top passage shown:

| | wrong top pick | usable card in the four shown |
|---|---|---|
| NLI stance | 55.3% | 82.6% |
| keyword | 42.8% | 85.9% |
| trained | **32.6%** | **89.8%** |

The NLI stance rows were measured by `scripts/eval-stance.mjs` against
`src/lib/ranking/stance.ts`. Both were removed once the reranker replaced that
model; to rerun the baseline, check out commit `1f8f8a4`, the last one that
has them.

## Underlining

    val AUC 0.7479   accuracy 0.7022   (always-"no" scores 0.6266)

The weakest of the three, on the smallest data — 7,864 usable cards. Good
enough to pre-mark a passage a debater then edits. Not good enough to underline
silently and be trusted.

## Precision of these numbers

Keyword scoring measured 0.1740 and 0.1602 on R@1 across two runs of identical
code. Python randomises string hashing per process, so set iteration order —
and therefore tie-breaking — changes between runs. That is a noise floor of
roughly **±0.014**.

Differences smaller than that are not real. It is why the debate-jargon filter
(+0.0027) is described as noise, and why the cross-article result (+0.15) is
described as solid.

## What was wrong before, and how it was found

**Leakage.** Splits grouped by article URL still leaked: 26% of test groups had
their answer memorised, through openCaselist card bodies (which are source text
and carry no URL) and through the same article served at two URLs. Splits are
now grouped by content cluster and the corpus is filtered against held-out
text. Measured before and after: 29% of groups contaminated, then 0.00%.

The leak inflated but did not invent. Every model scored higher on leaked
groups including keyword counting and the untrained NLI model, neither of which
can memorise anything — those groups are simply easier. Retraining on clean
data landed at P@1 0.6657, against 0.6655 for the leaky model scored on clean
groups.

**A strawman baseline.** The keyword bar was a Python reimplementation, not the
app's ranking. The real one scores better, so the bar being cleared was one
set too low.

**Underlining URLs.** The highlight extractor split citation blocks into
"sentences" and labelled them underlined, because debaters underline into the
cite and the splitter breaks on the dots in a URL.

**One negative axis.** Stage 2 regressed on its second epoch (0.6794 → 0.6539)
when negatives came only from the same file. With four kinds — near-tag,
opposite-side, same-topic, random — epoch 2 holds flat at 0.6621 instead of
collapsing.

## Running them in production

All three are behind `USE_TRAINED_MODELS=1`. Without it the app runs the
keyword path, which is worse and works, and cards cut in free mode come back
without underlining.

The gate exists because the first deploy with both models loaded did not throw
— the function died, so the route's error handling never ran and every search
returned an HTML error page. A search that fails is worse than a weaker one.

`/api/model-check` loads each model in turn on its own route and reports RSS
between stages, so the question can be asked without taking search down to ask
it. The plan here is Hobby, which caps a function at 1024MB; the baseline with
nothing loaded is 84MB.

## Not done

- The highlighter is not measured on the 362 held-out pairs like the other
  two. Its numbers come from its own validation split, and the int8 file that
  ships has no score written down here — `scripts/eval-highlighter.py --onnx`
  measures it.
- The tag-jargon filter helps search queries in principle and that is
  unmeasured; it needs a live comparison once testers are running.
- Retrieval is still limited by which URLs the search engine returns. The
  models rank what they are given; they do not choose the candidate pool.
