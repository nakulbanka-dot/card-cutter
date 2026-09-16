"""
Which words in a tag are debate, and which are the subject?

A tag is written in debate dialect. "Controls backfire", "solves warming",
"turns the case", "no uniqueness" — an author writing about export policy uses
none of those words. We send the tag to a general web search almost verbatim,
so every one of those words is a term the search engine tries to match against
prose that will never contain it.

This measures the gap directly. For every card we have the tag the debater
wrote AND the passage they cut, so we can ask of each tag word: when this word
appears in a tag, how often does it appear in the evidence underneath?

A word that shows up in tags and almost never in the passage is a word worth
dropping from the query, or translating. A word that appears in both is the
subject, and must be kept.

No model needed — the corpus answers it by counting.
"""
import json, re, sys
from collections import Counter, defaultdict

STOP = set("a an the and or but if then than that this these those is are was were be been "
           "being am do does did have has had of to in on at by for with from as it its will "
           "would can could should may might must not no we i you they he she their our your "
           "about into over more most less least".split())

MIN_TAG_COUNT = 300


def words(s):
    return [w for w in re.findall(r"[a-z]+", (s or "").lower())
            if len(w) > 2 and w not in STOP]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "data/training/corpus-pairs-hard.jsonl"
    in_tag = Counter()
    also_in_passage = Counter()
    n = 0

    for line in open(path):
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("label") != 1:
            continue
        n += 1
        body = set(words(r["text"]))
        for w in set(words(r["tag"])):
            in_tag[w] += 1
            if w in body:
                also_in_passage[w] += 1

    rows = []
    for w, c in in_tag.items():
        if c >= MIN_TAG_COUNT:
            rows.append((also_in_passage[w] / c, c, w))
    rows.sort()

    print(f"{n:,} cards\n")
    print("DEBATE DIALECT — common in tags, rarely in the evidence itself")
    print("(these are the words we currently send to a web search for nothing)\n")
    print(f"  {'word':<18}{'in tags':>9}{'appears in passage':>20}")
    for rate, c, w in rows[:28]:
        print(f"  {w:<18}{c:>9,}{rate:>19.1%}")

    print("\n\nSUBJECT LANGUAGE — when it is in the tag it is in the evidence")
    print("(these carry the query and must be kept)\n")
    print(f"  {'word':<18}{'in tags':>9}{'appears in passage':>20}")
    for rate, c, w in rows[-14:][::-1]:
        print(f"  {w:<18}{c:>9,}{rate:>19.1%}")

    out = "data/training/tag-language.json"
    json.dump({"jargon": [w for rate, c, w in rows if rate < 0.20],
               "subject": [w for rate, c, w in rows if rate >= 0.55]},
              open(out, "w"), indent=1)
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
