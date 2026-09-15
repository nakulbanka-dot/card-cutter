"""
Split the real-article labels into train / val / test.

Grouped by URL, never by row. Paragraphs from one article share its topic,
its author and its vocabulary, so a random row split would put near-copies on
both sides and report a score the model has not earned. Every article lands
wholly in one split.
"""
import json, random, collections
from pathlib import Path

SEED = 17
random.seed(SEED)

rows = [json.loads(l) for l in open("data/training/labeled.jsonl")]
by_url = collections.defaultdict(list)
for r in rows:
    by_url[r["url"]].append(r)

urls = sorted(by_url)
random.shuffle(urls)
n = len(urls)
cuts = {"train": urls[: int(n * 0.70)],
        "val":   urls[int(n * 0.70): int(n * 0.85)],
        "test":  urls[int(n * 0.85):]}

Path("data/training/splits").mkdir(parents=True, exist_ok=True)
for name, group in cuts.items():
    out = Path(f"data/training/splits/{name}.jsonl")
    with out.open("w") as f:
        pos = tot = 0
        for u in group:
            for r in by_url[u]:
                f.write(json.dumps(r) + "\n")
                tot += 1
                pos += r["label"]
    print(f"{name:5s} {len(group):5,} articles  {tot:7,} rows  {pos/tot:.1%} positive")
