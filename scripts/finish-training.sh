#!/usr/bin/env bash
# Stage 2: fine-tune the stage-1 checkpoint on real articles.
#
# Stage 1 (openCaselist, ~3h) is already done and on disk. This picks up from
# that checkpoint, so nothing is repeated.
#
# Tuned to leave the machine usable. On 8GB, batch 32 drove the earlier run
# into swap and everything else on the desktop with it. Batch 16 measured at
# 23.0 ex/s against 24.9 — eight percent slower for roughly half the peak
# activation memory — and `nice` means your own work wins the CPU whenever it
# wants it. Expect ~110 minutes rather than ~95.
#
# Logs to /tmp/train-stage2.log. Detached: safe to close the terminal.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d models/cutter-stage1 ]; then
  echo "No stage-1 checkpoint at models/cutter-stage1 — stage 1 did not finish."
  echo "Run the full training instead:  .venv-train/bin/python scripts/train-cutter.py"
  exit 1
fi

BATCH="${BATCH:-16}"

nohup nice -n 10 .venv-train/bin/python scripts/train-cutter.py \
  --skip-corpus --init models/cutter-stage1 --batch "$BATCH" \
  > /tmp/train-stage2.log 2>&1 &

echo "Stage 2 started (pid $!, batch $BATCH, niced)."
echo "Progress:  tail -f /tmp/train-stage2.log"
