"""
Score the highlighter, torch against the quantised file we would ship.

Same split the trainer used — seed 17, grouped by source FILE — so the numbers
line up with the ones training reported. Sentences from one card share its tag,
its article and its author; splitting by row would report a score the model has
not earned.

The int8 logits differ from torch by up to 0.19 here, more than the reranker's
0.11. That may vanish under sigmoid and thresholding, or it may not.
"""
import argparse, json, random
from collections import defaultdict

import numpy as np
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="models/highlighter")
ap.add_argument("--onnx", default=None)
ap.add_argument("--max-len", type=int, default=160)
args = ap.parse_args()

random.seed(17)
by_src = defaultdict(list)
for line in open("data/training/highlight.jsonl"):
    if line.strip():
        r = json.loads(line)
        by_src[r.get("source", "")].append(r)
srcs = sorted(by_src)
random.shuffle(srcs)
val = [r for k in srcs[int(len(srcs) * .8):] for r in by_src[k]]
print(f"{len(val):,} held-out sentences from {len(srcs) - int(len(srcs)*.8):,} files")

tok = AutoTokenizer.from_pretrained(args.model)
if args.onnx:
    import onnxruntime as ort
    sess = ort.InferenceSession(args.onnx, providers=["CPUExecutionProvider"])

    def score(tags, sents):
        e = tok(tags, sents, padding=True, truncation=True,
                max_length=args.max_len, return_tensors="np")
        lg = sess.run(None, {k: v for k, v in e.items()})[0].squeeze(-1)
        return (1 / (1 + np.exp(-lg))).tolist()
else:
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = AutoModelForSequenceClassification.from_pretrained(args.model).to(device).eval()

    def score(tags, sents):
        e = tok(tags, sents, padding=True, truncation=True,
                max_length=args.max_len, return_tensors="pt").to(device)
        with torch.no_grad():
            return torch.sigmoid(model(**e).logits.squeeze(-1)).float().cpu().tolist()

scores, labels = [], []
for i in range(0, len(val), 64):
    ch = val[i:i + 64]
    scores += score([r["tag"] for r in ch], [r["sentence"] for r in ch])
    labels += [r["label"] for r in ch]

pairs = sorted(zip(scores, labels))
npos = sum(labels); nneg = len(labels) - npos
auc = (sum(i + 1 for i, (_, l) in enumerate(pairs) if l == 1)
       - npos * (npos + 1) / 2) / (npos * nneg)

print(f"\n{'ONNX int8' if args.onnx else 'torch fp32'}")
print(f"  AUC        {auc:.4f}")
for t in (0.3, 0.4, 0.5, 0.6):
    tp = sum(1 for s, l in zip(scores, labels) if s >= t and l == 1)
    fp = sum(1 for s, l in zip(scores, labels) if s >= t and l == 0)
    fn = sum(1 for s, l in zip(scores, labels) if s < t and l == 1)
    prec = tp / max(1, tp + fp); rec = tp / max(1, tp + fn)
    marked = (tp + fp) / len(labels)
    print(f"  cut at {t:.1f}   precision {prec:.3f}  recall {rec:.3f}  "
          f"marks {marked:.0%} of sentences   (humans marked {npos/len(labels):.0%})")
