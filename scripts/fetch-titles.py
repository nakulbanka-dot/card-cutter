"""
Fetch the headline for every article in the labelled set.

Production never shows the model a paragraph alone — it prepends the article's
title, because a paragraph can describe a position its article goes on to
reject. Measured once at 0.968 support without the headline and 0.010 with it.

So a comparison run without titles judges the current model on an input it
never actually sees, and a model trained without them learns a task the app
does not perform. Both problems go away once the titles are on disk.

Read-only GETs of pages already in the corpus, eight at a time.
"""
import json, re, ssl, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# This Python has no CA bundle of its own, so every https URL fails
# verification and the whole run comes back empty in seconds. Silent, and easy
# to misread as "the pages are gone".
import certifi
SSL = ssl.create_default_context(cafile=certifi.where())

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " \
     "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
OUT = Path("data/training/titles.json")

urls = sorted({json.loads(l)["url"] for l in open("data/training/labeled.jsonl")})
print(f"{len(urls):,} distinct articles", flush=True)

done = {}
errors = {}
todo = [u for u in urls if u not in done]
print(f"{len(todo):,} still to fetch", flush=True)


def title_of(html: str):
    for pat in (r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)',
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']',
                r"<title[^>]*>(.*?)</title>"):
        m = re.search(pat, html, re.I | re.S)
        if m:
            t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()
            if t:
                return t[:300]
    return None


def fetch(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=12, context=SSL) as r:
            raw = r.read(400_000)
        enc = "utf-8"
        return url, title_of(raw.decode(enc, "replace")), None
    except Exception as e:
        return url, None, type(e).__name__


with ThreadPoolExecutor(max_workers=8) as ex:
    for i, (url, t, err) in enumerate(ex.map(fetch, todo), 1):
        done[url] = t
        if err: errors[err] = errors.get(err, 0) + 1
        if i % 100 == 0:
            got = sum(1 for v in done.values() if v)
            print(f"  {i:,}/{len(todo):,}  {got:,} titles so far", flush=True)
            OUT.write_text(json.dumps(done))

OUT.write_text(json.dumps(done))
got = sum(1 for v in done.values() if v)
print(f"\nDONE  {got:,}/{len(done):,} articles have a title ({got/len(done):.0%})  -> {OUT}")
print("failures by kind:", sorted(errors.items(), key=lambda kv: -kv[1])[:8])
