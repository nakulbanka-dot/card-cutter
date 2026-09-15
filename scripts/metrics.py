"""
Scoring for any model that ranks paragraphs against a tag.

Same numbers for every candidate, so comparisons mean something. Reads a JSON
list of groups, each group a list of {label, score} for one (article, tag).
"""
import json, sys


def auc(pairs):
    """Rank-based AUC. Ties get the average rank, which matters for a model
    that outputs the same score for many paragraphs."""
    ranked = sorted(pairs, key=lambda p: p[1])
    ranks, i = {}, 0
    while i < len(ranked):
        j = i
        while j + 1 < len(ranked) and ranked[j + 1][1] == ranked[i][1]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[k] = avg
        i = j + 1
    pos = [ranks[k] for k, p in enumerate(ranked) if p[0] == 1]
    npos, nneg = len(pos), len(ranked) - len(pos)
    if npos == 0 or nneg == 0:
        return float("nan")
    return (sum(pos) - npos * (npos + 1) / 2) / (npos * nneg)


def report(path, name):
    groups = json.load(open(path))
    flat = [(r["label"], r["score"]) for g in groups for r in g]

    # Pooled AUC mixes scores from different articles, so a model that ranks
    # perfectly inside each article still scores badly if its scale shifts
    # between them. Per-group AUC is the honest measure for ranking within an
    # article, which is the only ranking the product does.
    per = [auc([(r["label"], r["score"]) for r in g]) for g in groups]
    per = [a for a in per if a == a]

    # What a coin flip gets, so no number below is read as skill.
    floor1 = sum(sum(r["label"] for r in g) / len(g) for g in groups) / len(groups)

    hit1 = hit4 = mrr = 0.0
    for g in groups:
        order = sorted(g, key=lambda r: -r["score"])
        hit1 += order[0]["label"] == 1
        hit4 += any(r["label"] == 1 for r in order[:4])
        for i, r in enumerate(order, 1):
            if r["label"] == 1:
                mrr += 1 / i
                break

    n = len(groups)
    print(f"{name:<28} groups {n:>5}  rows {len(flat):>6}")
    print(f"  AUC (per article) {sum(per) / len(per):.4f}   <- the one that matters")
    print(f"  AUC (pooled)      {auc(flat):.4f}")
    print(f"  Precision@1       {hit1 / n:.4f}   vs {floor1:.4f} by chance")
    print(f"  Recall@4          {hit4 / n:.4f}   (a cut paragraph in the 4 we show)")
    print(f"  MRR               {mrr / n:.4f}")
    return {"auc_group": sum(per) / len(per), "auc": auc(flat),
            "p1": hit1 / n, "p1_floor": floor1, "r4": hit4 / n,
            "mrr": mrr / n, "groups": n}


if __name__ == "__main__":
    for path in sys.argv[1:]:
        report(path, path.split("/")[-1].replace(".json", ""))
        print()
