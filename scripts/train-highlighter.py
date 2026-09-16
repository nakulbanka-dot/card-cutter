"""
Predict which sentences a debater would underline.

Given a tag and a sentence from the passage, does this sentence do the
argumentative work, or is it context kept for honesty? Trained on the
character spans in the user's own cards — 211,555 sentences they underlined
or passed over by hand.

This is a product feature as much as a model: the app can hand back a passage
with the card already marked up, which is otherwise the slowest manual step
in cutting. It is also a useful check on the ranker — a paragraph where
nothing scores highly is probably not cuttable at all.

Split by source FILE, not by sentence. Sentences from one card share its tag,
its article and its author; splitting by row would put near-identical rows on
both sides and report a score the model has not earned. That mistake has been
made once in this project already.
"""
import argparse, json, random, time
from collections import defaultdict
from pathlib import Path

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification

BASE = "cross-encoder/ms-marco-MiniLM-L6-v2"
SEED = 17
random.seed(SEED)
torch.manual_seed(SEED)


def load(path):
    by_src = defaultdict(list)
    for line in open(path):
        if not line.strip():
            continue
        r = json.loads(line)
        by_src[r.get("source", "")].append(r)
    srcs = sorted(by_src)
    random.shuffle(srcs)
    n = len(srcs)
    cut = {"train": srcs[: int(n * .8)], "val": srcs[int(n * .8):]}
    out = {}
    for name, keys in cut.items():
        rows = [r for k in keys for r in by_src[k]]
        random.shuffle(rows)
        out[name] = rows
        pos = sum(r["label"] for r in rows)
        print(f"  {name:5s} {len(keys):5,} files  {len(rows):7,} sentences  "
              f"{pos/len(rows):.1%} underlined")
    return out


class Rows(Dataset):
    def __init__(self, rows): self.rows = rows
    def __len__(self): return len(self.rows)
    def __getitem__(self, i):
        r = self.rows[i]
        return r["tag"], r["sentence"], float(r["label"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/training/highlight.jsonl")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--max-len", type=int, default=160)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--out", default="models/highlighter")
    args = ap.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"device {device}")
    data = load(args.data)

    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForSequenceClassification.from_pretrained(
        BASE, num_labels=1).to(device)

    def collate(b):
        tags, sents, y = zip(*b)
        enc = tok(list(tags), list(sents), padding=True, truncation=True,
                  max_length=args.max_len, return_tensors="pt")
        enc["labels"] = torch.tensor(y, dtype=torch.float)
        return enc

    dl = DataLoader(Rows(data["train"]), batch_size=args.batch, shuffle=True,
                    collate_fn=collate)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, total_steps=len(dl) * args.epochs, pct_start=0.1)
    lossf = torch.nn.BCEWithLogitsLoss()

    model.train()
    t0, seen, total = time.time(), 0, 0.0
    for epoch in range(1, args.epochs + 1):
        for step, batch in enumerate(dl, 1):
            y = batch.pop("labels").to(device)
            batch = {k: v.to(device) for k, v in batch.items()}
            loss = lossf(model(**batch).logits.squeeze(-1), y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
            total += loss.item() * len(y); seen += len(y)
            if step % 200 == 0:
                rate = seen / (time.time() - t0)
                left = (len(dl) * args.epochs - step) * args.batch / rate / 60
                print(f"  e{epoch} step {step}/{len(dl)}  loss {total/seen:.4f}  "
                      f"{rate:.0f} ex/s  ~{left:.1f}m left", flush=True)

    # --- validation: AUC, and accuracy against always guessing "not underlined" ---
    model.eval()
    scores, labels = [], []
    with torch.no_grad():
        rows = data["val"]
        for i in range(0, len(rows), 64):
            ch = rows[i:i + 64]
            enc = tok([r["tag"] for r in ch], [r["sentence"] for r in ch],
                      padding=True, truncation=True, max_length=args.max_len,
                      return_tensors="pt").to(device)
            scores += torch.sigmoid(model(**enc).logits.squeeze(-1)).float().cpu().tolist()
            labels += [r["label"] for r in ch]

    pairs = sorted(zip(scores, labels))
    npos = sum(labels); nneg = len(labels) - npos
    rank_sum = sum(i + 1 for i, (_, l) in enumerate(pairs) if l == 1)
    auc = (rank_sum - npos * (npos + 1) / 2) / (npos * nneg)
    acc = sum((s >= .5) == bool(l) for s, l in zip(scores, labels)) / len(labels)
    print(f"\nval AUC {auc:.4f}   accuracy {acc:.4f}   "
          f"(always-'no' would score {1 - npos/len(labels):.4f})")

    Path(args.out).mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.out); tok.save_pretrained(args.out)
    print(f"saved -> {args.out}")


if __name__ == "__main__":
    main()
