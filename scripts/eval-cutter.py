"""
Score a split with a trained checkpoint, in the format metrics.py reads.

Same grouping and the same input the app builds (title prepended), so the
number lands beside the keyword and NLI baselines and means the same thing.
"""
import argparse, json, sys
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--split", default="val")
ap.add_argument("--dir", default="data/training/splits2",
                help="clustered, leak-checked splits")
ap.add_argument("--max-len", type=int, default=192)
ap.add_argument("--batch", type=int, default=64)
ap.add_argument("--out", default=None)
args = ap.parse_args()

TITLES = Path("data/training/titles.json")
titles = json.loads(TITLES.read_text()) if TITLES.exists() else {}

device = "mps" if torch.backends.mps.is_available() else "cpu"
tok = AutoTokenizer.from_pretrained(args.model)
model = AutoModelForSequenceClassification.from_pretrained(args.model).to(device).eval()

groups = {}
for line in open(f"{args.dir}/{args.split}.jsonl"):
    if not line.strip():
        continue
    r = json.loads(line)
    k = f"{r['url']} {r['tag']}"
    groups.setdefault(k, {"tag": r["tag"], "rows": []})["rows"].append(r)

usable = [g for g in groups.values()
          if any(x["label"] == 1 for x in g["rows"])
          and any(x["label"] == 0 for x in g["rows"])]
print(f"{len(usable)} rankable groups", flush=True)

out = []
with torch.no_grad():
    for n, g in enumerate(usable, 1):
        scores = []
        for i in range(0, len(g["rows"]), args.batch):
            chunk = g["rows"][i:i + args.batch]
            texts = [(f"{titles[c['url']]}\n\n{c['text']}"
                      if titles.get(c["url"]) else c["text"]) for c in chunk]
            enc = tok([g["tag"]] * len(chunk), texts, padding=True, truncation=True,
                      max_length=args.max_len, return_tensors="pt").to(device)
            scores += torch.sigmoid(model(**enc).logits.squeeze(-1)).float().cpu().tolist()
        out.append([{"label": r["label"], "score": s} for r, s in zip(g["rows"], scores)])
        if n % 100 == 0:
            print(f"  {n}/{len(usable)}", flush=True)

dest = args.out or f"data/training/trained-{args.split}.json"
json.dump(out, open(dest, "w"))
print(f"wrote {dest}")
