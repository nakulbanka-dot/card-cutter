#!/usr/bin/env bash
# Stage 2: fine-tune the stage-1 checkpoint on real articles.
#
# Stage 1 (openCaselist, ~3h) is already done and on disk. This picks up from
# that checkpoint, so nothing is repeated. Takes roughly 110 minutes and logs
# to /tmp/train-stage2.log — safe to close the terminal, it is detached.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d models/cutter-stage1 ]; then
  echo "No stage-1 checkpoint at models/cutter-stage1 — stage 1 did not finish."
  echo "Run the full training instead:  .venv-train/bin/python scripts/train-cutter.py"
  exit 1
fi

nohup .venv-train/bin/python scripts/train-cutter.py \
  --skip-corpus --init models/cutter-stage1 \
  > /tmp/train-stage2.log 2>&1 &

echo "Stage 2 started (pid $!). Progress:  tail -f /tmp/train-stage2.log"
