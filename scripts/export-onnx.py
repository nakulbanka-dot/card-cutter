"""
Export the trained cutter to ONNX, quantized, for transformers.js.

Why this matters beyond packaging: the deployed app could not run the old
stance model at all. Its runtime is ~600MB installed, far past a serverless
function, which is why production called a hosted API — 4.4s a paragraph
against 0.2s locally, and the reason testers saw a third as many passages as
a local run did.

This model is 22M parameters. Quantized to int8 it is small enough to sit in
the function itself, so production and local run the same weights.
"""
import argparse, shutil
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="models/cutter")
ap.add_argument("--out", default="models/cutter-onnx")
ap.add_argument("--max-len", type=int, default=192)
args = ap.parse_args()

out = Path(args.out)
(out / "onnx").mkdir(parents=True, exist_ok=True)

tok = AutoTokenizer.from_pretrained(args.model)
model = AutoModelForSequenceClassification.from_pretrained(args.model).eval()

# transformers.js looks for the tokenizer and config beside the onnx/ dir.
tok.save_pretrained(out)
model.config.save_pretrained(out)

# Two examples, not one.
#
# With a dummy batch of 1 every axis of length 1 looks alike, and the
# quantiser's shape inference resolved the classifier output against the
# hidden size instead of the batch: "Inferred shape and existing shape differ
# in dimension 0: (384) vs (1)". A batch of 2 makes the batch axis
# unambiguous. The retriever escaped this because its output has three
# dimensions; a (batch, 1) output is exactly the ambiguous case.
enc = tok(["a claim about nuclear power", "a second claim, so batch > 1"],
          ["a paragraph of evidence supporting it", "another paragraph of evidence"],
          return_tensors="pt", padding="max_length", truncation=True,
          max_length=args.max_len)
inputs = (enc["input_ids"], enc["attention_mask"], enc["token_type_ids"])

fp32 = out / "onnx" / "model.onnx"
torch.onnx.export(
    model,
    inputs,
    str(fp32),
    input_names=["input_ids", "attention_mask", "token_type_ids"],
    output_names=["logits"],
    dynamic_axes={
        "input_ids": {0: "batch", 1: "seq"},
        "attention_mask": {0: "batch", 1: "seq"},
        "token_type_ids": {0: "batch", 1: "seq"},
        "logits": {0: "batch"},
    },
    opset_version=17,
    do_constant_folding=True,
    # Legacy TorchScript exporter, not the dynamo one torch 2.14 defaults to.
    #
    # The dynamo graph is correct — it loads and returns (2, 1) — but it lowers
    # the CLS pick as Gather followed by Gemm in a way onnx's shape inference
    # misreads, resolving the classifier output against the hidden size:
    # "differ in dimension 0: (384) vs (1)". That fails inside quantize_dynamic,
    # so there is no int8 file at all. The retriever avoided it by returning a
    # three-dimensional tensor; a (batch, 1) output is the ambiguous case.
    dynamo=False,
)
print(f"fp32  {fp32.stat().st_size / 1e6:.1f} MB")

from onnxruntime.quantization import quantize_dynamic, QuantType

q8 = out / "onnx" / "model_quantized.onnx"
quantize_dynamic(str(fp32), str(q8), weight_type=QuantType.QInt8)
print(f"int8  {q8.stat().st_size / 1e6:.1f} MB  -> {q8}")

# Agreement check. Quantization that silently changes the ranking would be
# worse than not quantizing, and the file size alone would not show it.
import numpy as np
import onnxruntime as ort

sess = ort.InferenceSession(str(q8), providers=["CPUExecutionProvider"])
with torch.no_grad():
    ref = model(**enc).logits.squeeze(-1).numpy()
got = sess.run(None, {k: v.numpy() for k, v in enc.items()})[0].squeeze(-1)
print(f"torch {ref}  onnx-int8 {got}  max abs diff {np.abs(ref - got).max():.4f}")
