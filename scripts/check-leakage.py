"""
Did the training data contain the text we tested on?

The splits were grouped by article URL, which stops a paragraph appearing on
both sides of the same split. It does not stop two other things:

  1. Stage 1 trained on openCaselist card bodies. A card body IS source-article
     text. If a team once cut an article that is also in our test set, stage 1
     read that passage — and openCaselist has no URL field, so grouping by URL
     could never have caught it.

  2. The same article can live at two URLs (syndication, reprints, a PDF and an
     HTML copy). Grouped by URL those are different articles; to a model they
     are the same text.

Either one inflates the test score, and the inflation is invisible: the metric
just looks good.

Method: index the small side (test paragraphs) and stream the large side. Two
signals — exact match after normalisation, and a shared 12-word shingle, which
catches reformatting, partial overlap and different truncation. Twelve words is
long enough that ordinary prose does not collide by chance.
"""
import json, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path

SHINGLE = 12


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def shingles(words, n=SHINGLE):
    for i in range(0, max(0, len(words) - n + 1)):
        yield hash(" ".join(words[i:i + n]))


def load_test(path):
    """Index every test paragraph by exact text and by each of its shingles."""
    rows, exact, by_shingle = [], {}, defaultdict(set)
    for line in open(path):
        if not line.strip():
            continue
        r = json.loads(line)
        i = len(rows)
        rows.append(r)
        t = norm(r["text"])
        exact.setdefault(t, i)
        w = t.split()
        for h in shingles(w):
            by_shingle[h].add(i)
    return rows, exact, by_shingle


def scan(path, field, rows, exact, by_shingle, label):
    """Stream a training file, flagging any test paragraph it reproduces."""
    hit_exact, hit_near = set(), set()
    n = 0
    for line in open(path):
        if not line.strip():
            continue
        r = json.loads(line)
        text = r.get(field) or ""
        if not text:
            continue
        n += 1
        t = norm(text)
        if t in exact:
            hit_exact.add(exact[t])
        w = t.split()
        # One shared 12-word run is enough to call it the same passage.
        for h in shingles(w):
            if h in by_shingle:
                hit_near |= by_shingle[h]
                break
        if n % 200_000 == 0:
            print(f"    ...{n:,} rows scanned", flush=True)

    total = len(rows)
    print(f"\n  {label}")
    print(f"    training rows scanned      {n:,}")
    print(f"    test paragraphs reproduced exactly   {len(hit_exact):,} / {total:,}"
          f"  ({len(hit_exact)/total:.2%})")
    print(f"    test paragraphs overlapping (12-word) {len(hit_near):,} / {total:,}"
          f"  ({len(hit_near)/total:.2%})")
    return hit_near


if __name__ == "__main__":
    test_path = "data/training/splits/test.jsonl"
    print(f"indexing {test_path} ...", flush=True)
    rows, exact, by_shingle = load_test(test_path)
    print(f"  {len(rows):,} test paragraphs, {len(by_shingle):,} distinct shingles")

    leaked = set()
    leaked |= scan("data/training/corpus-pairs.jsonl", "text",
                   rows, exact, by_shingle,
                   "STAGE 1 — openCaselist card bodies vs test set")
    leaked |= scan("data/training/splits/train.jsonl", "text",
                   rows, exact, by_shingle,
                   "STAGE 2 — training articles vs test set")

    # What the score looks like with contaminated paragraphs removed.
    clean = [i for i in range(len(rows)) if i not in leaked]
    print(f"\n  clean test paragraphs: {len(clean):,} / {len(rows):,}")
    Path("data/training/leaked-test-idx.json").write_text(
        json.dumps(sorted(leaked)))
    print("  wrote data/training/leaked-test-idx.json")
