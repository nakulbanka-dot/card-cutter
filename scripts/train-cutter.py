"""
Train the model that decides what a tag is actually asking for.

The question the live system has to answer is not "is this paragraph about
nuclear power" — keyword scoring already answers that, and answers it badly,
because every paragraph in a nuclear article is about nuclear power. The
question is the one a debater answers when they cut: this tag states a claim,
does THIS paragraph make it?

That relationship exists, written down, four million times over. Every card is
a human answering exactly this question: the tag is the claim, the underlined
body is the text they judged sufficient to make it. So the model is trained on
cards, in two stages:

  stage 1  openCaselist. Hundreds of thousands of (tag, evidence) pairs, with
           negatives mined from other cards in the same file — same topic,
           same season, same vocabulary, a different claim. Random negatives
           would teach topic matching, which is the failure we are replacing.

  stage 2  Real articles a debater opened, where the negatives are the
           paragraphs they read and passed over. Smaller and noisier, but it
           is the live distribution exactly: web prose, not pre-cut cards.

Starting point is a cross-encoder already trained for query/passage relevance,
so we are teaching debate on top of general relevance rather than from nothing.
"""
import argparse, json, math, os, random, time
from pathlib import Path

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification

BASE = "cross-encoder/ms-marco-MiniLM-L6-v2"
SEED = 17
TITLES = Path("data/training/titles.json")

random.seed(SEED)
torch.manual_seed(SEED)

# The app never shows the model a bare paragraph — it prepends the headline,
# because a paragraph can spend its whole length describing the position its
# article goes on to reject. Training on bare paragraphs would teach a task
# the app does not perform, so the training input is built the same way.
_titles = json.loads(TITLES.read_text()) if TITLES.exists() else {}


def with_title(row):
    t = _titles.get(row.get("url") or "")
    return f"{t}\n\n{row['text']}" if t else row["text"]


class Pairs(Dataset):
    """
    Reservoir-sampled, never truncated.

    The pairs file is written parquet by parquet, so its first 200,000 lines
    are the first thirty-odd files and a fraction of the topics. Taking the
    head would train on whatever seasons happened to be sorted first and call
    it a sample of debate. A reservoir draws uniformly across all 675,861
    without holding them all in memory.
    """
    def __init__(self, path, limit=None):
        self.rows = []
        seen = 0
        with open(path) as f:
            for line in f:
                if not line.strip():
                    continue
                r = json.loads(line)
                row = (r["tag"], with_title(r), float(r["label"]))
                seen += 1
                if limit is None or len(self.rows) < limit:
                    self.rows.append(row)
                else:
                    j = random.randrange(seen)
                    if j < limit:
                        self.rows[j] = row
        random.shuffle(self.rows)

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return self.rows[i]


def collate(batch, tok, max_len):
    tags, texts, labels = zip(*batch)
    enc = tok(list(tags), list(texts), padding=True, truncation=True,
              max_length=max_len, return_tensors="pt")
    enc["labels"] = torch.tensor(labels, dtype=torch.float)
    return enc


def run_epoch(model, loader, opt, device, sched=None, log_every=100, tag=""):
    model.train()
    lossf = torch.nn.BCEWithLogitsLoss()
    total, seen, t0 = 0.0, 0, time.time()
    for step, batch in enumerate(loader, 1):
        labels = batch.pop("labels").to(device)
        batch = {k: v.to(device) for k, v in batch.items()}
        logits = model(**batch).logits.squeeze(-1)
        loss = lossf(logits, labels)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if sched:
            sched.step()
        opt.zero_grad(set_to_none=True)

        total += loss.item() * len(labels)
        seen += len(labels)
        if step % log_every == 0:
            rate = seen / (time.time() - t0)
            left = (len(loader) - step) * loader.batch_size / rate / 60
            print(f"  {tag} step {step}/{len(loader)}  loss {total/seen:.4f}  "
                  f"{rate:.0f} ex/s  ~{left:.1f}m left", flush=True)
    return total / max(1, seen)


@torch.no_grad()
def score_split(model, tok, path, device, max_len, batch_size=24):
    """Rank each article's paragraphs against its tag, the way the app does."""
    model.eval()
    groups = {}
    for line in open(path):
        if not line.strip():
            continue
        r = json.loads(line)
        groups.setdefault(f"{r['url']} {r['tag']}", {"tag": r["tag"], "rows": []})
        groups[f"{r['url']} {r['tag']}"]["rows"].append(r)

    usable = [g for g in groups.values()
              if any(r["label"] == 1 for r in g["rows"])
              and any(r["label"] == 0 for r in g["rows"])]

    out = []
    for g in usable:
        scores = []
        for i in range(0, len(g["rows"]), batch_size):
            chunk = g["rows"][i:i + batch_size]
            enc = tok([g["tag"]] * len(chunk), [with_title(c) for c in chunk],
                      padding=True, truncation=True, max_length=max_len,
                      return_tensors="pt").to(device)
            logits = model(**enc).logits.squeeze(-1)
            scores += torch.sigmoid(logits).float().cpu().tolist()
        out.append([{"label": r["label"], "score": s}
                    for r, s in zip(g["rows"], scores)])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="data/training/corpus-pairs.jsonl")
    ap.add_argument("--corpus-limit", type=int, default=200_000)
    ap.add_argument("--max-len", type=int, default=192)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr-corpus", type=float, default=3e-5)
    ap.add_argument("--lr-finetune", type=float, default=2e-5)
    ap.add_argument("--finetune-epochs", type=int, default=3)
    ap.add_argument("--skip-corpus", action="store_true")
    # Stage 1 is three hours of compute. Resuming from its checkpoint means a
    # change to stage 2 costs a rerun of stage 2, not of both.
    ap.add_argument("--init", default=None,
                    help="checkpoint to start from (default: the ms-marco base)")
    ap.add_argument("--out", default="models/cutter")
    args = ap.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    start = args.init or BASE
    print(f"device: {device}  init: {start}  titles: {len(_titles):,}")

    tok = AutoTokenizer.from_pretrained(start)
    model = AutoModelForSequenceClassification.from_pretrained(
        start, num_labels=1).to(device)

    coll = lambda b: collate(b, tok, args.max_len)

    if not args.skip_corpus and Path(args.corpus).exists():
        ds = Pairs(args.corpus, limit=args.corpus_limit)
        print(f"stage 1 — openCaselist: {len(ds):,} pairs")
        dl = DataLoader(ds, batch_size=args.batch, shuffle=True, collate_fn=coll)
        opt = torch.optim.AdamW(model.parameters(), lr=args.lr_corpus)
        sched = torch.optim.lr_scheduler.OneCycleLR(
            opt, max_lr=args.lr_corpus, total_steps=len(dl), pct_start=0.1)
        run_epoch(model, dl, opt, device, sched, tag="corpus")
        Path(args.out).mkdir(parents=True, exist_ok=True)
        model.save_pretrained(f"{args.out}-stage1")
        tok.save_pretrained(f"{args.out}-stage1")

    train = Pairs("data/training/splits/train.jsonl")
    print(f"stage 2 — real articles: {len(train):,} rows")
    dl = DataLoader(train, batch_size=args.batch, shuffle=True, collate_fn=coll)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr_finetune)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr_finetune,
        total_steps=len(dl) * args.finetune_epochs, pct_start=0.1)

    best = -1.0
    Path(args.out).mkdir(parents=True, exist_ok=True)
    for epoch in range(1, args.finetune_epochs + 1):
        run_epoch(model, dl, opt, device, sched, tag=f"ft e{epoch}")
        scored = score_split(model, tok, "data/training/splits/val.jsonl",
                             device, args.max_len)
        json.dump(scored, open("data/training/trained-val.json", "w"))
        # Selection on val precision@1 — the number the reader actually sees.
        p1 = sum(max(g, key=lambda r: r["score"])["label"] == 1 for g in scored) / len(scored)
        print(f"epoch {epoch}: val precision@1 {p1:.4f}", flush=True)
        if p1 > best:
            best = p1
            model.save_pretrained(args.out)
            tok.save_pretrained(args.out)
            print(f"  saved (best so far)", flush=True)

    print(f"\nbest val precision@1 {best:.4f}  ->  {args.out}")


if __name__ == "__main__":
    main()
