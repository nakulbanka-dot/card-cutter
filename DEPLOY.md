# Putting this online

## GitHub Pages will not work, and it is worth knowing why

Pages serves static files. It has no server. This app needs one: `/api/find`
calls a search API, fetches and parses HTML from other sites, and scores
passages with a model. A static export of it would load, look correct, and do
nothing — every search would fail.

There is no GitHub product that runs a Node server for free on a `github.io`
domain. What GitHub does give you is the deploy trigger: every host below
builds straight from this repository on push.

## Recommended: Vercel

Built by the Next.js team, free tier, connects to the GitHub repo directly.
You get `card-cutter.vercel.app`, or a custom domain later.

### 1. Get the key, and set the model flag

| Variable | Where | Cost |
| --- | --- | --- |
| `TAVILY_API_KEY` | https://app.tavily.com/home | Free, 1,000 credits/month, no card |
| `USE_TRAINED_MODELS` | Set it to `1` | Free |

The Tavily key stops being optional the moment other people use the site.
Keyless mode has an hourly cap shared by every visitor, so it would be
exhausted by a handful of searches.

`USE_TRAINED_MODELS=1` turns on the three trained models in `ml/` — the
retriever and reranker that rank passages in `/api/find`, and the highlighter
that underlines a card in `/api/underline`. They run inside the function, so
there is no second service and no key. Without the flag the app still runs,
ranking on keywords alone and cutting cards without underlining — worse, but
it does not break. [docs/model-results.md](docs/model-results.md) has why the
flag exists and what the models score.

`HUGGINGFACE_API_KEY` is no longer needed. It was for the hosted copy of the
old stance model, which the trained models replaced.

### 2. Deploy

1. Go to https://vercel.com/new and sign in with GitHub.
2. Import `nakulbanka-dot/card-cutter`. The framework is detected; change nothing.
3. Under **Environment Variables**, add both variables from the table above.
4. Deploy. First build takes a few minutes.

Every push to `main` redeploys from then on.

### What deployment costs in speed

The models load from disk on the first request a function instance serves,
which makes that search slower than the ones after it. `maxDuration` on
`/api/find`, `/api/underline` and `/api/model-check` is raised to 60s so Vercel
does not cut a slow query off.

### 3. Check it

Open `/api/model-check` on the deployment. It loads the retriever and the
reranker on their own route and reports each one, so a model that cannot load
does not take search down to tell you:

```json
{ "flag": "on", "retriever": { "ok": true, … }, "reranker": { "ok": true, … } }
```

`"flag": "off"` means `USE_TRAINED_MODELS` is not set to `1`. An `"ok": false`
carries the reason the model did not load.

Then run one search. Results should come back with a **Match** percentage
that has an "Argues your side" row in its breakdown — that row is the
reranker's score, so it is missing whenever the reranker did not run.

## Collecting feedback from real users

Cut / Not useful decisions are the only source of one judgment the app cannot
learn anywhere else: whether a paragraph is worth reading aloud, as opposed to
merely on topic. Every search run without storage configured is a judgment
thrown away.

Serverless filesystems are wiped between requests, so deployment needs a
store. Roughly two minutes:

1. In your Vercel project, open **Storage** → **Create Database** → **Redis**
   → the free plan.
2. Connect it to the project. Vercel sets `REDIS_URL` for you. (If you set up
   Upstash's REST interface instead, `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` work too — both are supported.)
3. Add `FEEDBACK_EXPORT_TOKEN` yourself — any long random string. This is what
   lets you download the data later.
4. Redeploy.

The free plan is RAM-only with no persistence, so treat it as a collection
buffer rather than an archive and export regularly.

`GET /api/feedback` reports which store is live, so you can check rather than
assume:

```json
{ "total": 12, "cut": 7, "precision": 0.58, "storage": "redis" }
```

`"redis"` is a connection string, `"redis-rest"` is the HTTP interface, and
`"file"` is local disk — all three store rows.

`"storage": "none"` means clicks are being discarded. The app says so rather
than pretending, because a training set you believe you are collecting and are
not is worse than none.

### Getting the data out

```bash
curl -H "Authorization: Bearer $FEEDBACK_EXPORT_TOKEN" \
  "https://your-app.vercel.app/api/feedback?export=1" > data/feedback.jsonl
```

That is the same JSONL the training scripts read.

## Search limits, and why they are not optional

**1,000 Tavily credits a month, shared by everyone who visits.** One search
spends about four, so the whole site supports roughly **250 searches a
month**. Without a limit, one person with a script exhausts the month before
lunch and everyone else gets errors for three weeks.

Three ceilings ship on by default:

| Setting | Default | Stops |
| --- | --- | --- |
| `SEARCH_LIMIT_PER_VISITOR` | 15 / day | One visitor monopolising the day |
| `SEARCH_LIMIT_GLOBAL` | 150 / day | A crowd doing it collectively |
| `SEARCH_LIMIT_MONTHLY` | 220 / month | The site spending past the free tier |

The monthly cap is the real budget, set just under the free tier's 250. The
daily one is loose on purpose: a beta fails on the first afternoon, when
everyone opens the link at once, not at the end of the month. In development
all three are much higher, so building the app does not lock you out.

Both are env vars, so raise them in Vercel when you move off the free tier.
The remaining count shows above the results, and a refused search spends no
credits — being turned away does not also cost the visitor an allowance.

The counters live in memory. On serverless each instance counts separately
and a cold start forgets, so the real limit is looser than the number you
set. That is a deliberate trade: no database, no signup, no key, and it stops
the abuse that actually happens. Move to a shared store when traffic
justifies the dependency.

### What it costs to lift the cap

Tavily Pay As You Go is $0.008 a credit, so about **four cents a search**.
A squad of twelve doing ten searches a day each is roughly $150 a month. That
number is why the pricing model has a bring-your-own-source tier.

## Running it yourself

```bash
npm install
npm run dev
```

No keys needed locally — search falls back to keyless mode. Add
`USE_TRAINED_MODELS=1` to `.env.local` to rank with the trained models, which
are already in `ml/` and need no download.
