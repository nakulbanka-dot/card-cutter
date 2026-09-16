"""
Two tests for the retrieval layer, because they measure different failures.

WITHIN-ARTICLE — given one article's paragraphs and a tag, rank them. This is
comparable to every other number we have, and it is the easier job: the right
answer is guaranteed to be in the candidate set.

CROSS-ARTICLE — given a tag and EVERY paragraph in the test split, find the
one a debater cut. This is the job the live shortlist actually does, and it is
where keyword matching is expected to fail: the correct passage may share very
few words with the tag, and thousands of wrong passages share many. If the
bi-encoder cannot beat keywords here it has no reason to exist, because the
cross-encoder already handles the within-article case.
"""
import argparse, json, re, unicodedata
from collections import defaultdict

import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

STOP = set("a an the and or but if then than that this these those is are was were be been "
           "being am do does did have has had of to in on at by for with from as it its will "
           "would can could should may might must not no we i you they he she their our your "
           "about into over more most less least".split())


def terms(s):
    return {w for w in re.findall(r"[a-z0-9']+", (s or "").lower())
            if len(w) > 2 and w not in STOP}


def embed(model, tok, texts, device, max_len, batch=64):
    out = []
    model.eval()
    with torch.no_grad():
        for i in range(0, len(texts), batch):
            enc = tok(texts[i:i + batch], padding=True, truncation=True,
                      max_length=max_len, return_tensors="pt").to(device)
            h = model(**enc).last_hidden_state
            m = enc["attention_mask"].unsqueeze(-1).float()
            v = (h * m).sum(1) / m.sum(1).clamp(min=1e-9)
            out.append(F.normalize(v, dim=-1).cpu())
    return torch.cat(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/retriever")
    ap.add_argument("--split", default="test")
    ap.add_argument("--dir", default="data/training/splits2")
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(f"{args.dir}/{args.split}.jsonl") if l.strip()]
    groups = defaultdict(list)
    for i, r in enumerate(rows):
        groups[(r["url"], r["tag"])].append(i)
    usable = [(k, v) for k, v in groups.items()
              if any(rows[i]["label"] == 1 for i in v)
              and any(rows[i]["label"] == 0 for i in v)]
    print(f"{len(rows):,} paragraphs, {len(usable):,} rankable groups")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModel.from_pretrained(args.model).to(device)

    print("embedding paragraphs ...", flush=True)
    P = embed(model, tok, [r["text"] for r in rows], device, 160)
    print("embedding tags ...", flush=True)
    Q = embed(model, tok, [k[1] for k, _ in usable], device, 48)

    # ---------- within-article ----------
    def report_within(score_of, name):
        p1 = r4 = 0
        for gi, (k, idxs) in enumerate(usable):
            sc = score_of(gi, idxs)
            order = sorted(range(len(idxs)), key=lambda j: -sc[j])
            p1 += rows[idxs[order[0]]]["label"] == 1
            r4 += any(rows[idxs[j]]["label"] == 1 for j in order[:4])
        n = len(usable)
        print(f"  {name:<22} P@1 {p1/n:.4f}   R@4 {r4/n:.4f}")

    print("\nWITHIN-ARTICLE")
    report_within(lambda gi, idxs: (P[idxs] @ Q[gi]).tolist(), "bi-encoder")
    tg = [terms(k[1]) for k, _ in usable]
    ptv = [terms(r["text"]) for r in rows]
    report_within(
        lambda gi, idxs: [len(tg[gi] & ptv[i]) / max(1, len(tg[gi])) for i in idxs],
        "keyword")

    # ---------- cross-article ----------
    print(f"\nCROSS-ARTICLE  (each tag searched against all {len(rows):,} paragraphs)")
    gold = [{i for i in idxs if rows[i]["label"] == 1} for _, idxs in usable]

    def report_cross(rank_fn, name):
        hits = {1: 0, 5: 0, 20: 0, 100: 0}
        mrr = 0.0
        for gi in range(len(usable)):
            order = rank_fn(gi)
            g = gold[gi]
            for k in hits:
                if any(i in g for i in order[:k]):
                    hits[k] += 1
            for pos, i in enumerate(order[:1000], 1):
                if i in g:
                    mrr += 1 / pos
                    break
        n = len(usable)
        print(f"  {name:<22} " + "  ".join(f"R@{k} {v/n:.4f}" for k, v in hits.items())
              + f"   MRR {mrr/n:.4f}")

    sims = P @ Q.T                     # paragraphs x tags
    report_cross(lambda gi: torch.argsort(sims[:, gi], descending=True).tolist(),
                 "bi-encoder")

    # Keyword over the same pool, scored the same way the shortlist would.
    import heapq
    inv = defaultdict(list)
    for i, tset in enumerate(ptv):
        for t in tset:
            inv[t].append(i)

    def kw_rank(gi):
        sc = defaultdict(float)
        q = tg[gi]
        for t in q:
            for i in inv.get(t, ()):
                sc[i] += 1 / max(1, len(q))
        return [i for i, _ in heapq.nlargest(1000, sc.items(), key=lambda kv: kv[1])]

    report_cross(kw_rank, "keyword")


if __name__ == "__main__":
    main()
