#!/usr/bin/env bash
# Everything still owed, in order, unattended.
#
# Serial on purpose. Three models on an 8GB machine would thrash and finish
# later than running them one at a time — that is measured, not assumed: batch
# 32 collapsed to 7 ex/s from swapping when batch 16 held 24.
#
# Each stage writes its own log and checkpoints, so an interruption costs one
# stage rather than the chain. Progress: tail -f /tmp/runall.log
set -uo pipefail
cd "$(dirname "$0")/.."
PY=.venv-train/bin/python

say() { echo; echo "=============== $* ==============="; date "+%F %T"; echo; }

# ---------- 1. wait for the retriever ----------
if pgrep -f train-biencoder.py >/dev/null; then
  say "WAITING for bi-encoder to finish"
  while pgrep -f train-biencoder.py >/dev/null; do sleep 30; done
fi

# ---------- 2. does semantic retrieval beat keywords? ----------
say "EVAL retriever (the test that decides whether it ships)"
nice -n 10 $PY scripts/eval-retriever.py --model models/retriever --split test \
  2>&1 | grep -viE "^warning|loading weights" | tee /tmp/eval-retriever.txt

# ---------- 2b. does the DEPLOYED artifact score the same? ----------
# int8 preserved the ranking order on a probe but cut the proving-vs-topical
# margin from 0.034 to 0.004. Shipping a quantised model without measuring it
# is shipping an unmeasured model.
say "EXPORT retriever to ONNX and score the quantised artifact"
nice -n 10 $PY scripts/export-retriever-onnx.py 2>&1 | tail -6
nice -n 10 $PY scripts/eval-retriever.py --model models/retriever-onnx \
  --onnx models/retriever-onnx/onnx/model_quantized.onnx --split test \
  2>&1 | grep -viE "^warning|loading weights" | tee /tmp/eval-retriever-int8.txt

# ---------- 3. cross-encoder, retrained on leak-free data ----------
# The existing checkpoint learned from a corpus that contained held-out text.
# It has to be retrained before any of its numbers mean anything.
say "TRAIN cross-encoder stage 1 (clean corpus, four negative kinds)"
nice -n 10 $PY scripts/train-cutter.py \
  --corpus data/training/corpus-pairs-hard.jsonl \
  --corpus-limit 150000 --batch 16 \
  --finetune-epochs 2 \
  --out models/cutter2 2>&1 | tail -400 > /tmp/train-cutter2.log
tail -5 /tmp/train-cutter2.log

# ---------- 4. score it on the clean test set ----------
say "EVAL cross-encoder on the clean test set"
nice -n 10 $PY scripts/eval-cutter.py --model models/cutter2 --split test \
  --out data/training/trained2-test.json 2>&1 | tail -2
python3 scripts/metrics.py \
  data/training/keyword-real-test2.json \
  data/training/trained2-test.json | tee /tmp/eval-cutter2.txt

# ---------- 5. the underlining model ----------
say "TRAIN highlighter (which sentences a debater would underline)"
nice -n 10 $PY scripts/train-highlighter.py --batch 16 \
  2>&1 | grep -viE "^warning|loading weights" | tail -40 | tee /tmp/train-highlighter.txt

say "ALL DONE"
echo "retriever   : /tmp/eval-retriever.txt"
echo "cross-enc   : /tmp/eval-cutter2.txt"
echo "highlighter : /tmp/train-highlighter.txt"
echo "int8 check  : /tmp/eval-retriever-int8.txt"
