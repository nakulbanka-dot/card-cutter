"""
Splits that survive the leakage check.

The previous splits grouped by article URL. That was correct as far as it went
and still leaked 6.9% of test paragraphs, by two routes URL-grouping cannot
see:

  1. The same article at two URLs — syndication, a reprint, a PDF beside the
     HTML. Different URLs, identical text.
  2. openCaselist card bodies, which ARE source-article text. The corpus has no
     URL field at all, so stage 1 could read a passage that later turned up in
     the test set. 26% of test groups had their answer memorised this way.

So articles are clustered by content before splitting, and the corpus is
filtered against the held-out clusters afterwards.

Near-duplicate detection is MinHash over 12-word shingles: keep the k smallest
shingle hashes per article as its sketch, and union articles that share any
sketch value. Exact hashing alone misses reformatted copies; comparing every
pair is quadratic and unnecessary.
"""
import json, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path

SHINGLE = 12
SKETCH = 24          # minhashes kept per article; higher = better recall
SEED = 17


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def shingle_hashes(text: str):
    w = norm(text).split()
    return {hash(" ".join(w[i:i + SHINGLE])) for i in range(max(0, len(w) - SHINGLE + 1))}


def sketch(hashes):
    """The k smallest hashes — a MinHash sketch. Two texts that overlap
    substantially share small hashes with high probability."""
    return sorted(hashes)[:SKETCH]


class Union:
    def __init__(self): self.p = {}
    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x
    def join(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb: self.p[rb] = ra


def main():
    rows = [json.loads(l) for l in open("data/training/labeled.jsonl")]
    by_url = defaultdict(list)
    for r in rows:
        by_url[r["url"]].append(r)
    urls = sorted(by_url)
    print(f"{len(rows):,} paragraphs across {len(urls):,} articles", flush=True)

    # --- cluster articles by content ---
    u = Union()
    seen = {}
    art_hashes = {}
    for url in urls:
        h = set()
        for r in by_url[url]:
            h |= shingle_hashes(r["text"])
        art_hashes[url] = h
        for s in sketch(h):
            if s in seen:
                u.join(seen[s], url)
            else:
                seen[s] = url

    clusters = defaultdict(list)
    for url in urls:
        clusters[u.find(url)].append(url)
    merged = sum(1 for c in clusters.values() if len(c) > 1)
    print(f"{len(clusters):,} content clusters "
          f"({merged:,} contain more than one URL — those were leaking)", flush=True)

    # --- split by cluster ---
    import random
    random.seed(SEED)
    keys = sorted(clusters)
    random.shuffle(keys)
    n = len(keys)
    parts = {"train": keys[: int(n * .70)],
             "val":   keys[int(n * .70): int(n * .85)],
             "test":  keys[int(n * .85):]}

    Path("data/training/splits2").mkdir(parents=True, exist_ok=True)
    held_hashes = set()
    for name, ks in parts.items():
        out = Path(f"data/training/splits2/{name}.jsonl")
        tot = pos = 0
        with out.open("w") as f:
            for k in ks:
                for url in clusters[k]:
                    if name in ("val", "test"):
                        held_hashes |= art_hashes[url]
                    for r in by_url[url]:
                        f.write(json.dumps(r) + "\n")
                        tot += 1
                        pos += r["label"]
        print(f"  {name:5s} {len(ks):5,} clusters  {tot:7,} rows  {pos/tot:.1%} positive")

    # --- filter the corpus against held-out content ---
    src = Path("data/training/corpus-pairs.jsonl")
    dst = Path("data/training/corpus-pairs-clean.jsonl")
    kept = dropped = 0
    with src.open() as fin, dst.open("w") as fout:
        for line in fin:
            if not line.strip():
                continue
            r = json.loads(line)
            w = norm(r["text"]).split()
            hit = any(hash(" ".join(w[i:i + SHINGLE])) in held_hashes
                      for i in range(max(0, len(w) - SHINGLE + 1)))
            if hit:
                dropped += 1
            else:
                fout.write(line)
                kept += 1
    print(f"\ncorpus pairs: kept {kept:,}, dropped {dropped:,} "
          f"({dropped/(kept+dropped):.2%}) that reproduce held-out articles")
    print(f"-> {dst}")


if __name__ == "__main__":
    main()
