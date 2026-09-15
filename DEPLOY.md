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

### 1. Get the two keys

| Key | Where | Cost |
| --- | --- | --- |
| `TAVILY_API_KEY` | https://app.tavily.com/home | Free, 1,000 credits/month, no card |
| `HUGGINGFACE_API_KEY` | https://huggingface.co/settings/tokens | Free, read token is enough |

The Tavily key stops being optional the moment other people use the site.
Keyless mode has an hourly cap shared by every visitor, so it would be
exhausted by a handful of searches.

The Hugging Face key is what makes stance ranking work in deployment. The
local model is ~600MB installed, which is past every serverless limit, so the
deployed copy calls the hosted copy of the same model instead. Without the
key the app still runs, ranking on keywords alone — worse, but it does not
break.

### 2. Deploy

1. Go to https://vercel.com/new and sign in with GitHub.
2. Import `nakulbanka-dot/card-cutter`. The framework is detected; change nothing.
3. Under **Environment Variables**, add both keys from the table above.
4. Deploy. First build takes a few minutes.

Every push to `main` redeploys from then on.

### What deployment costs in speed

Hosted stance scoring is much slower than local, and it is worth knowing
before you see it:

| | Local | Hosted |
| --- | --- | --- |
| One passage read | ~200ms | ~4.4s |
| First read after idle | — | ~23s cold start |
| Whole query | ~11s | ~28s |

The shortlist shrinks from five candidates a source to two when running
hosted, which keeps it inside the function timeout while still letting the
model choose rather than rubber-stamp the keyword favourite. `maxDuration` on
the route is raised to 60s so Vercel does not cut a slow query off.

If that is too slow, a container host runs the local model at full speed —
see the last section.

### 3. Check it

Open the deployment and run one search. If results come back with a **Match**
percentage that has an "Argues your side" row in its breakdown, both keys are
working. If that row is missing, the Hugging Face key is not set.

## Collecting feedback from real users

Cut / Not useful decisions are the only source of one judgment the app cannot
learn anywhere else: whether a paragraph is worth reading aloud, as opposed to
merely on topic. Every search run without storage configured is a judgment
thrown away.

Serverless filesystems are wiped between requests, so deployment needs a
store. Roughly two minutes:

1. In your Vercel project, open **Storage** → **Create Database** → **Upstash
   for Redis** → the free plan.
2. Connect it to the project. Vercel sets `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` for you.
3. Add `FEEDBACK_EXPORT_TOKEN` yourself — any long random string. This is what
   lets you download the data later.
4. Redeploy.

`GET /api/feedback` reports which store is live, so you can check rather than
assume:

```json
{ "total": 12, "cut": 7, "precision": 0.58, "storage": "redis" }
```

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
month** — eight a day. Without a limit, one person with a script exhausts the
month before lunch and everyone else gets errors for three weeks.

Two ceilings ship on by default:

| Setting | Default | Stops |
| --- | --- | --- |
| `SEARCH_LIMIT_PER_VISITOR` | 5 / day | One visitor monopolising the day |
| `SEARCH_LIMIT_GLOBAL` | 8 / day | A crowd doing it collectively |

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

## If you want the local model in production

Serverless will not hold it. A container host will: Render, Railway and
Fly.io all run this unchanged with `npm run build && npm start`. Give the
instance at least 2GB of memory, leave `HUGGINGFACE_API_KEY` unset, and the
app uses the local model with no per-request network hop.

Render's free tier sleeps after inactivity, so the first request after a
quiet spell takes about a minute.

## Running it yourself

```bash
npm install
npm run dev
```

No keys needed locally — search falls back to keyless mode and the stance
model downloads on first use.
