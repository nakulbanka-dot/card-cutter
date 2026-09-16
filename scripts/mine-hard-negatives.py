"""
Negatives that are hard for the right reasons.

The first corpus build used one kind: another card from the same file. That is
a real hard negative — same topic, same season — but it is one axis, and a
model trained on one axis learns to beat that axis. Stage 2 regressed on its
second epoch (0.6794 -> 0.6539), which is what a model does when it has run
out of things to learn from the negatives it is being shown.

So this mines four kinds, each teaching a different confusion:

  near-tag      Another card whose TAG shares most of its words but makes a
                different claim. "Sanctions weaken Russia's economy" against
                "Russia can circumvent sanctions". The vocabulary is nearly
                identical and the argument is not. This is the hardest and the
                most valuable.

  opposite-side Cards from the opposing side of the same topic. Teaches
                direction — that "raises costs" is not "lowers costs" — which
                keyword scoring cannot represent at all.

  same-topic    Another card from the same file. Same topic, different claim.

  random        A minority. Easy, and teaches little, but keeps the model from
                assuming every candidate is topical.

Candidates come from an inverted index over tag terms, so finding the near-tag
negatives does not require comparing every card with every other card.
"""
import json, random, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path
import pyarrow.parquet as pq

SRC = Path("data/opencaselist/slim")
OUT = Path("data/training/corpus-pairs-hard.jsonl")
PER_FILE = int(sys.argv[1]) if len(sys.argv) > 1 else 2500
SEED = 17
random.seed(SEED)

STOP = set("a an the and or but if then than that this these those is are was were be been "
           "being am do does did have has had of to in on at by for with from as it its will "
           "would can could should may might must not no we i you they he she their our your "
           "about into over more most less least".split())


def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").strip()


def terms(s: str):
    return {w for w in re.findall(r"[a-z0-9']+", (s or "").lower())
            if len(w) > 2 and w not in STOP}


def paragraphs(text: str):
    for p in re.split(r"\n\s*\n|\n", text or ""):
        p = norm(p)
        if 40 <= len(p.split()) <= 400:
            yield p


def overlap(a: str, b: str) -> float:
    wa, wb = terms(a), terms(b)
    return len(wa & wb) / max(1, len(wa))


def main():
    # Text already used by held-out articles must never become a training
    # negative either — a memorised passage is memorised whichever label it
    # carries.
    held = set()
    SH = 12
    for name in ("val", "test"):
        p = Path(f"data/training/splits2/{name}.jsonl")
        if not p.exists():
            continue
        for line in p.open():
            if not line.strip():
                continue
            w = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ",
                       unicodedata.normalize("NFKC", json.loads(line)["text"]).lower())).strip().split()
            held.update(hash(" ".join(w[i:i + SH])) for i in range(max(0, len(w) - SH + 1)))
    print(f"held-out shingles: {len(held):,}", flush=True)

    def leaks(text: str) -> bool:
        w = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ",
                   unicodedata.normalize("NFKC", text).lower())).strip().split()
        return any(hash(" ".join(w[i:i + SH])) in held
                   for i in range(max(0, len(w) - SH + 1)))

    files = sorted(SRC.glob("*.parquet"))
    seen_buckets = set()
    counts = defaultdict(int)

    with OUT.open("w") as out:
        for fi, path in enumerate(files, 1):
            tbl = pq.read_table(path, columns=["tag", "fulltext", "summary",
                                               "bucketId", "side", "year"])
            cards = []
            for r in tbl.to_pylist():
                tag = norm(r["tag"])
                if not (4 <= len(tag.split()) <= 60):
                    continue
                if r["bucketId"] in seen_buckets:
                    continue
                paras = list(paragraphs(r["fulltext"]))
                if not paras:
                    continue
                seen_buckets.add(r["bucketId"])
                und = norm(r["summary"]) or ""
                best = max(paras, key=lambda p: overlap(und, p)) if und else paras[0]
                cards.append({"tag": tag, "pos": best, "paras": paras,
                              "side": r["side"], "bucket": r["bucketId"],
                              "tterms": terms(tag)})

            if len(cards) < 80:
                continue

            # inverted index: tag term -> card indices
            inv = defaultdict(list)
            for i, c in enumerate(cards):
                for t in c["tterms"]:
                    inv[t].append(i)

            random.shuffle(cards)
            chosen = list(range(len(cards)))[:PER_FILE]

            for ci in chosen:
                c = cards[ci]
                if leaks(c["pos"]):
                    continue
                out.write(json.dumps({"tag": c["tag"], "text": c["pos"],
                                      "label": 1, "kind": "positive"}) + "\n")
                counts["positive"] += 1

                # --- near-tag: tags that look alike, claims that are not ---
                cand = defaultdict(int)
                for t in c["tterms"]:
                    for j in inv[t][:400]:
                        if cards[j]["bucket"] != c["bucket"]:
                            cand[j] += 1
                ranked = sorted(cand.items(), key=lambda kv: -kv[1])
                near = []
                for j, shared in ranked[:60]:
                    o = shared / max(1, len(c["tterms"]))
                    # High overlap but not identical: the confusable band.
                    if 0.45 <= o < 0.95:
                        near.append(j)
                    if len(near) >= 2:
                        break
                for j in near:
                    txt = random.choice(cards[j]["paras"])
                    if leaks(txt):
                        continue
                    out.write(json.dumps({"tag": c["tag"], "text": txt,
                                          "label": 0, "kind": "near-tag"}) + "\n")
                    counts["near-tag"] += 1

                # --- opposite side, same topic ---
                opp = [j for j, _ in ranked[:120]
                       if cards[j]["side"] and c["side"] and cards[j]["side"] != c["side"]]
                if opp:
                    j = random.choice(opp[:10])
                    txt = random.choice(cards[j]["paras"])
                    if not leaks(txt):
                        out.write(json.dumps({"tag": c["tag"], "text": txt,
                                              "label": 0, "kind": "opposite-side"}) + "\n")
                        counts["opposite-side"] += 1

                # --- same topic (same file, any other card) ---
                for _ in range(1):
                    j = random.randrange(len(cards))
                    if cards[j]["bucket"] == c["bucket"]:
                        continue
                    txt = random.choice(cards[j]["paras"])
                    if not leaks(txt):
                        out.write(json.dumps({"tag": c["tag"], "text": txt,
                                              "label": 0, "kind": "same-topic"}) + "\n")
                        counts["same-topic"] += 1

            print(f"[{fi:3d}/{len(files)}] " +
                  "  ".join(f"{k} {v:,}" for k, v in sorted(counts.items())), flush=True)

    print("\nDONE " + "  ".join(f"{k} {v:,}" for k, v in sorted(counts.items())))
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
