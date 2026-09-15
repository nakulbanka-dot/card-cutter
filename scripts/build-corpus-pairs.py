"""
Turn openCaselist cards into (tag, paragraph, label) training pairs.

The signal we want is the one a debater creates every time they cut: the tag
states a claim, and the underlined body is the text that makes it. So the
positive is the paragraph of the card that overlaps the underlining most --
the part they actually marked as answering the tag.

Negatives are the point of the whole exercise. A negative drawn at random
teaches topic matching, which is what keyword scoring already does. So
negatives are mined from OTHER cards in the same file: same topic, same
season, same vocabulary, different claim. Getting those right is the only
way the model learns to read the tag rather than count its words.
"""
import json, random, re, sys, unicodedata
from pathlib import Path
import pyarrow.parquet as pq

SRC = Path("data/opencaselist/slim")
OUT = Path("data/training/corpus-pairs.jsonl")
POS_PER_FILE = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
SEED = 17

random.seed(SEED)

def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").strip()

def paragraphs(text: str):
    for p in re.split(r"\n\s*\n|\n", text or ""):
        p = norm(p)
        if 40 <= len(p.split()) <= 400:
            yield p

def overlap(a: str, b: str) -> float:
    """Word overlap of the underlined text against a paragraph."""
    wa = set(re.findall(r"[a-z0-9]+", a.lower()))
    wb = set(re.findall(r"[a-z0-9]+", b.lower()))
    return len(wa & wb) / max(1, len(wa))

files = sorted(SRC.glob("*.parquet"))
written = pos_n = neg_n = 0
seen_buckets = set()

with OUT.open("w") as out:
    for fi, path in enumerate(files, 1):
        cards = []
        tbl = pq.read_table(path, columns=["tag", "fulltext", "summary",
                                           "bucketId", "side", "year"])
        for r in tbl.to_pylist():
            tag = norm(r["tag"])
            # A tag has to actually be a claim. One-word tags and headers are
            # not the relationship we are trying to learn.
            if not (4 <= len(tag.split()) <= 60):
                continue
            bucket = r["bucketId"]
            if bucket in seen_buckets:   # cards repeat heavily across files
                continue
            paras = list(paragraphs(r["fulltext"]))
            if not paras:
                continue
            seen_buckets.add(bucket)
            underlined = norm(r["summary"]) or ""
            best = max(paras, key=lambda p: overlap(underlined, p)) if underlined else paras[0]
            cards.append({"tag": tag, "pos": best, "paras": paras,
                          "side": r["side"], "bucket": bucket})

        if len(cards) < 50:
            continue
        random.shuffle(cards)
        chosen = cards[:POS_PER_FILE]

        for c in chosen:
            out.write(json.dumps({"tag": c["tag"], "text": c["pos"], "label": 1}) + "\n")
            pos_n += 1
            # Two hard negatives per positive, both from this file: same
            # topic and season, a different card's evidence.
            for _ in range(2):
                for _try in range(6):
                    other = random.choice(cards)
                    if other["bucket"] != c["bucket"]:
                        out.write(json.dumps({"tag": c["tag"],
                                              "text": random.choice(other["paras"]),
                                              "label": 0}) + "\n")
                        neg_n += 1
                        break
        written += len(chosen)
        print(f"[{fi:3d}/{len(files)}] {written:,} positives  {neg_n:,} negatives", flush=True)

print(f"\nDONE  {pos_n:,} positive  {neg_n:,} negative  -> {OUT}")
