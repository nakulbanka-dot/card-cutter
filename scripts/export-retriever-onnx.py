"""
Export the retriever to ONNX for transformers.js.

Different shape from the cross-encoder export: this model returns token
embeddings, not a score, so the pooling and normalisation happen in the app.
Exporting the raw encoder keeps it that way rather than baking a pooling
choice into the graph where it cannot be inspected.

Size is the point. Both models are 22M parameters; quantized to int8 they are
roughly 23MB each, so the retriever and the reranker together fit inside a
serverless function. That matters beyond packaging: the deployed app currently
calls a hosted API because the old stance runtime was ~600MB, and that call is
why production shows testers a third of the passages a local run does.
"""
import argparse
from pathlib import Path

import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="models/retriever")
ap.add_argument("--out", default="models/retriever-onnx")
ap.add_argument("--max-len", type=int, default=160)
args = ap.parse_args()

out = Path(args.out)
(out / "onnx").mkdir(parents=True, exist_ok=True)

tok = AutoTokenizer.from_pretrained(args.model)
model = AutoModel.from_pretrained(args.model).eval()
tok.save_pretrained(out)
model.config.save_pretrained(out)

enc = tok("a debate tag about nuclear power", return_tensors="pt",
          padding="max_length", truncation=True, max_length=args.max_len)
inputs = (enc["input_ids"], enc["attention_mask"], enc["token_type_ids"])

fp32 = out / "onnx" / "model.onnx"
torch.onnx.export(
    model, inputs, str(fp32),
    input_names=["input_ids", "attention_mask", "token_type_ids"],
    output_names=["last_hidden_state"],
    dynamic_axes={
        "input_ids": {0: "batch", 1: "seq"},
        "attention_mask": {0: "batch", 1: "seq"},
        "token_type_ids": {0: "batch", 1: "seq"},
        "last_hidden_state": {0: "batch", 1: "seq"},
    },
    opset_version=17, do_constant_folding=True,
)
print(f"fp32  {fp32.stat().st_size / 1e6:.1f} MB")

from onnxruntime.quantization import quantize_dynamic, QuantType

q8 = out / "onnx" / "model_quantized.onnx"
quantize_dynamic(str(fp32), str(q8), weight_type=QuantType.QInt8)
print(f"int8  {q8.stat().st_size / 1e6:.1f} MB  -> {q8}")

# Quantisation that shifts the ranking would be worse than none, and file size
# alone would never show it. Compare on the thing we actually use: whether the
# proving passage still outranks the merely topical one.
import onnxruntime as ort


def pool(h, mask):
    m = mask[..., None].astype("float32")
    v = (h * m).sum(1) / np.clip(m.sum(1), 1e-9, None)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


tag = "nuclear power solves climate change"
cands = [
    "Reactors supply firm low-carbon electricity around the clock, and no country "
    "has decarbonised its grid at speed without them.",
    "Nuclear plants are large industrial facilities employing thousands during construction.",
    "Construction delays mean new reactors arrive far too late to matter for emissions.",
]

sess = ort.InferenceSession(str(q8), providers=["CPUExecutionProvider"])


def onnx_vec(texts):
    e = tok(texts, padding=True, truncation=True, max_length=args.max_len,
            return_tensors="np")
    h = sess.run(None, {k: v for k, v in e.items()})[0]
    return pool(h, e["attention_mask"])


def torch_vec(texts):
    e = tok(texts, padding=True, truncation=True, max_length=args.max_len,
            return_tensors="pt")
    with torch.no_grad():
        h = model(**e).last_hidden_state.numpy()
    return pool(h, e["attention_mask"].numpy())

for name, fn in (("torch", torch_vec), ("onnx-int8", onnx_vec)):
    q, d = fn([tag]), fn(cands)
    print(f"  {name:<10} " + "  ".join(f"{s:.3f}" for s in (d @ q.T).ravel()))
print("  (higher is better; first candidate is the one that proves the tag)")
