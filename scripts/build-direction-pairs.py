"""
Tags that contradict each other, and the evidence cut for each.

The reranker has almost no sense of direction. Probed on one claim, the
strongest OPPOSING passage scored 0.901 against 0.699 for the supporting one,
because the opposing passage used the tag's own words.

The first attempt at fixing this used the corpus `side` field, and that was a
misreading. `side` is which team cut the card in a round, affirmative or
negative — not whether it contradicts a given claim. Two cards on opposite
sides of the same file are usually different arguments entirely:

    "Success in the Manoomin case leads to future tribal lawsuits"  [N]
    against
    "China prioritizes economic growth"                             [A]

Which is exactly why negatives mined that way were topically unrelated, and
why they taught nothing: the model already knows an unrelated paragraph is
unrelated.

What does carry direction is negation between otherwise-matching tags. A
debater who writes "Climate change causes extinction" is answered by another
who writes "No climate change extinction---new studies", and both cut evidence
for their version. That pair is the confusion the model has to resolve.

    --held-out   build from files 88-97, which training never sees
    default      build from files 0-87 as training negatives

Files 98-108 are excluded either way; they carry no side or clean tags.
"""
import argparse, json, random, re, unicodedata
from collections import defaultdict
from pathlib import Path
import pyarrow.parquet as pq

SRC = Path("data/opencaselist/slim")
SEED = 23

STOP = set("a an the and or but if then than that this these those is are was were be been "
           "being am do does did have has had of to in on at by for with from as it its will "
           "would can could should may might must we i you they he she their our your "
           "about into over more most less least".split())

# Words that make a claim negative without a negation word in it.
#
# "Air pollution impact is overhyped" was paired against "No impact to air
# pollution" as if they contradicted. They agree. The rule assumed a tag with
# no negation word states the positive claim, and debate tags routinely carry
# the negative in their vocabulary instead.
NEGATIVE_SENSE = re.compile(
    r"\b(overhyped|overblown|overstated|exaggerat\w*|hype\w*|minimal|negligible"
    r"|inevitab\w*|alt cause\w*|non-?unique|nonunique|empirically denied|squo solves"
    r"|too late|impossible|unsolvable|myth\w*|debunk\w*)\b", re.I)

NEG = re.compile(
    r"\b(no|not|never|fails?|failed|doesn't|don't|won't|can't|cannot|isn't|aren't"
    r"|unlikely|false|wrong|refutes?|disproves?|denies|nonexistent|zero)\b", re.I)


def norm(s):
    # Fold curly quotes to straight ones. NFKC does not, so "doesn't" written
    # with a typographic apostrophe never matched the negation pattern and the
    # tag was read as a positive claim — which paired "Warming doesn't cause
    # extinction" against itself as though the two contradicted.
    s = unicodedata.normalize("NFKC", s or "")
    return s.replace("\u2019", "'").replace("\u2018", "'").strip()


def terms(s):
    return {w for w in re.findall(r"[a-z0-9']+", norm(s).lower())
            if len(w) > 2 and w not in STOP and not NEG.fullmatch(w)}


def paragraphs(text):
    for p in re.split(r"\n\s*\n|\n", text or ""):
        p = norm(p)
        if 40 <= len(p.split()) <= 400:
            yield p


def overlap(a, b):
    wa, wb = terms(a), terms(b)
    return len(wa & wb) / max(1, len(wa))


def cards_in(path):
    tbl = pq.read_table(path, columns=["tag", "fulltext", "summary", "bucketId"])
    out, seen = [], set()
    for r in tbl.to_pylist():
        tag = norm(r["tag"])
        # A plan text or a heading is not a claim anyone argues against.
        if not (4 <= len(tag.split()) <= 40):
            continue
        if r["bucketId"] in seen:
            continue
        paras = list(paragraphs(r["fulltext"]))
        if not paras:
            continue
        seen.add(r["bucketId"])
        und = norm(r["summary"]) or ""
        best = max(paras, key=lambda p: overlap(und, p)) if und else paras[0]
        tt = terms(tag)
        if len(tt) < 3:
            continue
        out.append({"tag": tag, "pos": best, "tterms": tt, "neg": bool(NEG.search(tag))})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--held-out", action="store_true")
    ap.add_argument("--out", default=None)
    ap.add_argument("--min-overlap", type=float, default=0.7)
    ap.add_argument("--per-file", type=int, default=600)
    args = ap.parse_args()

    random.seed(SEED)
    files = sorted(SRC.glob("*.parquet"))
    files = files[88:98] if args.held_out else files[0:88]
    out_path = Path(args.out or (
        "data/training/direction-test.jsonl" if args.held_out
        else "data/training/direction-train.jsonl"))

    made = 0
    with out_path.open("w") as out:
        for fi, path in enumerate(files, 1):
            cards = cards_in(path)
            if len(cards) < 100:
                continue
            inv = defaultdict(list)
            for i, c in enumerate(cards):
                for w in c["tterms"]:
                    inv[w].append(i)

            # The positive side of the pair has to actually assert something.
            plain = [i for i, c in enumerate(cards)
                     if not c["neg"] and not NEGATIVE_SENSE.search(c["tag"])]
            random.shuffle(plain)
            per = 0
            for i in plain:
                if per >= args.per_file:
                    break
                c = cards[i]
                cand = defaultdict(int)
                for w in c["tterms"]:
                    for j in inv[w][:400]:
                        if j != i and cards[j]["neg"]:
                            cand[j] += 1
                if not cand:
                    continue
                j, n = max(cand.items(), key=lambda kv: kv[1])
                if n / len(c["tterms"]) < args.min_overlap:
                    continue
                # The negation has to attack the claim, not sit somewhere
                # inside it. "No climate change extinction" contradicts;
                # "'In the area' means all of the activities in each area"
                # merely contains a negation further along and actually AGREES
                # with the tag it was paired to.
                head = " ".join(cards[j]["tag"].split()[:6])
                if not NEG.search(head):
                    continue
                # A clean contradiction is short and says the same thing back.
                # The long opposing tags that survived every other filter were
                # separate arguments that happened to share vocabulary:
                # "AI outweighs nuclear war" paired against "Space domination
                # is zero sum and winner-take-all---solves heg, climate...".
                if len(cards[j]["tag"].split()) > 14:
                    continue
                out.write(json.dumps({
                    "tag": c["tag"],
                    "supports": c["pos"],
                    "opposes": cards[j]["pos"],
                    "opposing_tag": cards[j]["tag"],
                    "overlap": round(n / len(c["tterms"]), 2),
                }) + "\n")
                made += 1
                per += 1
            print(f"[{fi:3d}/{len(files)}] {made:,} pairs", flush=True)

    print(f"\n{made:,} directional pairs -> {out_path}")


if __name__ == "__main__":
    main()
