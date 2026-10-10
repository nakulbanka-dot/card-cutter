"""
A test for direction, held out from training entirely.

The reranker separates on-topic from off-topic well and has almost no sense of
which way a passage argues. Probed on one claim:

    OPPOSES  0.901   "Nuclear power cannot solve climate change..."
    SUPPORTS 0.699   "France generates 70 percent of its electricity..."
    unrelated 0.075

The opposing passage scored highest, because it uses the tag's own words.

Nothing measured that, so nothing could have caught it. This builds a test
that does: for one tag, the evidence a debater cut FOR it, against the
evidence someone cut for the opposing side of the same topic. A model with no
sense of direction scores them the same.

Held out by FILE. The last ten parquet files never enter training, so the
retrain cannot see this test even indirectly through a shared card.
"""
import json, random, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path
import pyarrow.parquet as pq

SRC = Path("data/opencaselist/slim")
OUT = Path("data/training/direction-test.jsonl")
# Files 98-108 carry no side label at all — the first attempt held those out
# and produced zero pairs. These are the last ten that have one.
HELD_OUT = slice(88, 98)
SEED = 23
random.seed(SEED)

STOP = set("a an the and or but if then than that this these those is are was were be been "
           "being am do does did have has had of to in on at by for with from as it its will "
           "would can could should may might must not no we i you they he she their our your "
           "about into over more most less least".split())


def norm(s):
    return unicodedata.normalize("NFKC", s or "").strip()


def terms(s):
    return {w for w in re.findall(r"[a-z0-9']+", (s or "").lower())
            if len(w) > 2 and w not in STOP}


def paragraphs(text):
    for p in re.split(r"\n\s*\n|\n", text or ""):
        p = norm(p)
        if 40 <= len(p.split()) <= 400:
            yield p


def overlap(a, b):
    wa, wb = terms(a), terms(b)
    return len(wa & wb) / max(1, len(wa))


def main():
    files = sorted(SRC.glob("*.parquet"))[HELD_OUT]
    print(f"held-out files: {[f.name for f in files]}", flush=True)

    made = 0
    with OUT.open("w") as out:
        for path in files:
            tbl = pq.read_table(path, columns=["tag", "fulltext", "summary",
                                               "bucketId", "side"])
            cards = []
            seen = set()
            for r in tbl.to_pylist():
                tag = norm(r["tag"])
                if not (4 <= len(tag.split()) <= 60) or not r["side"]:
                    continue
                if r["bucketId"] in seen:
                    continue
                paras = list(paragraphs(r["fulltext"]))
                if not paras:
                    continue
                seen.add(r["bucketId"])
                und = norm(r["summary"]) or ""
                best = max(paras, key=lambda p: overlap(und, p)) if und else paras[0]
                cards.append({"tag": tag, "pos": best, "side": r["side"],
                              "tterms": terms(tag), "bucket": r["bucketId"]})

            if len(cards) < 100:
                continue

            # Index by tag term so the opposing card is about the same thing.
            inv = defaultdict(list)
            for i, c in enumerate(cards):
                for t in c["tterms"]:
                    inv[t].append(i)

            random.shuffle(cards)
            for c in cards[:400]:
                shared = defaultdict(int)
                for t in c["tterms"]:
                    for j in inv[t][:300]:
                        if cards[j]["bucket"] != c["bucket"] and cards[j]["side"] != c["side"]:
                            shared[j] += 1
                if not shared:
                    continue
                j, n = max(shared.items(), key=lambda kv: kv[1])
                # Same subject, other side. Below this it is a different
                # argument and the comparison says nothing about direction.
                if n / max(1, len(c["tterms"])) < 0.5:
                    continue

                out.write(json.dumps({
                    "tag": c["tag"],
                    "supports": c["pos"],
                    "opposes": cards[j]["pos"],
                    "opposing_tag": cards[j]["tag"],
                    "side": c["side"],
                    "opposing_side": cards[j]["side"],
                }) + "\n")
                made += 1

    print(f"\n{made:,} direction pairs -> {OUT}")


if __name__ == "__main__":
    main()
