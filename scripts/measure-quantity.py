"""
Do paragraphs with hard numbers actually get cut more often?

The claim is that debaters want quantified evidence — "emissions fell 43%", not
"emissions fell". It is worth testing before building anything on it, because
the data to test it already exists: 63,727 paragraphs from real articles,
each labelled with whether a debater cut it.

Measured two ways, because the naive one lies:

  overall     P(cut | has a number) against P(cut | none). Confounded — an
              article dense with statistics has more numbers AND more cards in
              it, so this flatters the hypothesis whether or not it is true.

  within article  The same comparison inside each article, then averaged. This
              is the question the ranker actually faces: given these paragraphs
              from this page, does the one with a figure get cut?

Also split by kind of number, since "1990" and "43 percent" are not the same
claim about evidence.
"""
import json, re
from collections import defaultdict

PATTERNS = {
    "percentage": re.compile(r"\b\d{1,3}(?:\.\d+)?\s?(?:%|percent|per cent)\b", re.I),
    "magnitude": re.compile(r"\b\d[\d,.]*\s?(?:billion|million|trillion|thousand)\b", re.I),
    "money": re.compile(r"[$£€]\s?\d", re.I),
    "year": re.compile(r"\b(?:19|20)\d{2}\b"),
    "any digit": re.compile(r"\d"),
}


def load(path):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    return rows


def rate(rows, pred):
    hit = [r for r in rows if pred(r)]
    if not hit:
        return None, 0
    return sum(r["label"] for r in hit) / len(hit), len(hit)


def main():
    rows = []
    for name in ("train", "val", "test"):
        rows += load(f"data/training/splits2/{name}.jsonl")
    print(f"{len(rows):,} labelled paragraphs, {sum(r['label'] for r in rows):,} cut\n")

    base = sum(r["label"] for r in rows) / len(rows)
    print(f"a paragraph is cut {base:.1%} of the time overall\n")

    print("OVERALL — confounded, but the number people quote")
    print(f"  {'pattern':<14}{'has it':>9}{'cut rate':>11}{'vs base':>10}")
    for name, pat in PATTERNS.items():
        r, n = rate(rows, lambda x, p=pat: bool(p.search(x["text"])))
        if r is None:
            continue
        print(f"  {name:<14}{n:>9,}{r:>10.1%}{r / base:>9.2f}x")

    # ---------- within article ----------
    print("\nWITHIN ARTICLE — the question the ranker actually faces")
    groups = defaultdict(list)
    for r in rows:
        groups[(r["url"], r["tag"])].append(r)

    print(f"  {'pattern':<14}{'groups':>8}{'with':>9}{'without':>10}{'lift':>9}")
    for name, pat in PATTERNS.items():
        with_r, without_r, used = [], [], 0
        for g in groups.values():
            has = [r for r in g if pat.search(r["text"])]
            hasnt = [r for r in g if not pat.search(r["text"])]
            # Only groups that contain both, or the comparison is meaningless.
            if not has or not hasnt:
                continue
            used += 1
            with_r.append(sum(r["label"] for r in has) / len(has))
            without_r.append(sum(r["label"] for r in hasnt) / len(hasnt))
        if used < 30:
            continue
        a = sum(with_r) / len(with_r)
        b = sum(without_r) / len(without_r)
        print(f"  {name:<14}{used:>8,}{a:>9.1%}{b:>10.1%}{a / max(b, 1e-9):>8.2f}x")


if __name__ == "__main__":
    main()
