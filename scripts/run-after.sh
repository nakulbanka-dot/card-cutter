#!/usr/bin/env bash
# Runs once the main chain finishes. Kept separate because editing a bash
# script while bash is executing it can corrupt the run — bash reads the file
# lazily, so a rewrite shifts the byte offset it resumes from.
set -uo pipefail
cd "$(dirname "$0")/.."
PY=.venv-train/bin/python

say() { echo; echo "=============== $* ==============="; date "+%F %T"; echo; }

while pgrep -f "run-all.sh" >/dev/null; do sleep 30; done

# ---------- export the reranker, and check the file we would ship ----------
# The retriever's int8 came out identical to fp32 on R@1, but that is a fact
# about that model, not a law. Measure this one too.
say "EXPORT cross-encoder to ONNX"
nice -n 10 $PY scripts/export-onnx.py --model models/cutter2 --out models/cutter2-onnx \
  2>&1 | tail -6

say "EVAL the quantised reranker against the torch one"
nice -n 10 $PY scripts/eval-cutter.py --model models/cutter2 --split test \
  --out data/training/cutter2-torch.json 2>&1 | tail -1
python3 scripts/metrics.py \
  data/training/keyword-real-test2.json \
  data/training/cutter2-torch.json | tee /tmp/final-cutter.txt

say "EVERYTHING FINISHED"
date "+%F %T"
