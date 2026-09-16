"""
A debate-specific embedding model — the retrieval layer we never had.

The cross-encoder can only judge paragraphs it is shown, and what shows it
paragraphs today is keyword overlap. That is the ceiling on the whole system:
a paragraph that argues your tag in different words is never a candidate, so
no amount of reranking can find it. Generic embeddings do not fix this — they
answer "is this the same topic", and every paragraph in a nuclear article is
the same topic.

This trains the encoder on the one relationship the corpus actually contains:
a tag, and the passage a human judged sufficient to prove it. Afterwards a tag
should sit near passages that prove it and far from passages that merely
mention its subject.

Trained with in-batch negatives (the other passages in the batch) plus an
explicit mined hard negative per example, which is the part that matters --
in-batch negatives alone are mostly easy, since a random other passage is
usually a different topic entirely.

One guard: two cards in a batch can legitimately share a passage, and treating
that as a negative teaches the opposite of what we want. Rows carrying the same
normalised passage are masked out of each other's negatives.
"""
import argparse, json, random, re, time, unicodedata
from collections import defaultdict
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModel

BASE = "sentence-transformers/all-MiniLM-L6-v2"
SEED = 17
random.seed(SEED)
torch.manual_seed(SEED)


def key(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()[:160]


class Triples(Dataset):
    """(tag, passage that proves it, passage that looks like it but does not)."""

    def __init__(self, path, limit=None, prefer=("near-tag", "opposite-side", "same-topic")):
        pos, negs = {}, defaultdict(lambda: defaultdict(list))
        for line in open(path):
            if not line.strip():
                continue
            r = json.loads(line)
            t = r["tag"]
            if r["label"] == 1:
                pos.setdefault(t, r["text"])
            else:
                negs[t][r.get("kind", "same-topic")].append(r["text"])

        self.rows = []
        for t, p in pos.items():
            pool = negs.get(t)
            if not pool:
                continue
            # Hardest available kind first.
            for kind in prefer:
                if pool.get(kind):
                    self.rows.append((t, p, random.choice(pool[kind])))
                    break
        random.shuffle(self.rows)
        if limit:
            self.rows = self.rows[:limit]

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return self.rows[i]


def encode(model, enc):
    """Mean-pool over real tokens, then L2 normalise."""
    out = model(**enc).last_hidden_state
    mask = enc["attention_mask"].unsqueeze(-1).float()
    v = (out * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
    return F.normalize(v, dim=-1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/training/corpus-pairs-hard.jsonl")
    ap.add_argument("--limit", type=int, default=120_000)
    ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--tag-len", type=int, default=48)
    ap.add_argument("--passage-len", type=int, default=160)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--scale", type=float, default=20.0)
    ap.add_argument("--out", default="models/retriever")
    # Save periodically. Stage 1 survived an interruption because it
    # checkpointed; this script saved only at the end, so an OOM kill on a
    # machine sitting at 7% free memory would have cost the whole run.
    ap.add_argument("--save-every", type=int, default=400)
    args = ap.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModel.from_pretrained(BASE).to(device)

    ds = Triples(args.data, limit=args.limit)
    print(f"device {device}  triples {len(ds):,}", flush=True)

    def collate(b):
        tags, poss, negs = zip(*b)
        return (
            tok(list(tags), padding=True, truncation=True,
                max_length=args.tag_len, return_tensors="pt"),
            tok(list(poss), padding=True, truncation=True,
                max_length=args.passage_len, return_tensors="pt"),
            tok(list(negs), padding=True, truncation=True,
                max_length=args.passage_len, return_tensors="pt"),
            [key(p) for p in poss] + [key(n) for n in negs],
        )

    dl = DataLoader(ds, batch_size=args.batch, shuffle=True, collate_fn=collate,
                    drop_last=True)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, total_steps=len(dl) * args.epochs, pct_start=0.1)

    model.train()
    t0, seen, total = time.time(), 0, 0.0
    for epoch in range(1, args.epochs + 1):
        for step, (tg, po, ne, keys) in enumerate(dl, 1):
            tg = {k: v.to(device) for k, v in tg.items()}
            po = {k: v.to(device) for k, v in po.items()}
            ne = {k: v.to(device) for k, v in ne.items()}

            q = encode(model, tg)                      # B x d
            docs = torch.cat([encode(model, po), encode(model, ne)], 0)   # 2B x d
            sims = q @ docs.T * args.scale             # B x 2B
            target = torch.arange(q.size(0), device=device)

            # Mask duplicate passages so a legitimate second copy of the
            # positive is not scored as a negative.
            B = q.size(0)
            for i in range(B):
                for j in range(2 * B):
                    if j != i and keys[j] == keys[i]:
                        sims[i, j] = -1e4

            loss = F.cross_entropy(sims, target)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad(set_to_none=True)

            total += loss.item() * B; seen += B
            if step % args.save_every == 0:
                Path(args.out).mkdir(parents=True, exist_ok=True)
                model.save_pretrained(args.out); tok.save_pretrained(args.out)
                print(f"  checkpoint saved at step {step}", flush=True)
            if step % 100 == 0:
                rate = seen / (time.time() - t0)
                left = (len(dl) * args.epochs - (epoch - 1) * len(dl) - step) * B / rate / 60
                acc = (sims.argmax(1) == target).float().mean().item()
                print(f"  e{epoch} step {step}/{len(dl)}  loss {total/seen:.4f}  "
                      f"batch-acc {acc:.3f}  {rate:.0f} ex/s  ~{left:.1f}m left", flush=True)

    Path(args.out).mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.out)
    tok.save_pretrained(args.out)
    print(f"saved -> {args.out}")


if __name__ == "__main__":
    main()
