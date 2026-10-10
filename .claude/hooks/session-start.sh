#!/bin/bash
# Sets up a Claude Code on the web session for card-cutter.
#
# The cloud machine starts fresh, and git only ever carried the code: the
# training data lives outside it (.gitignore leaves out /data/ on purpose).
# So every session needs three things put back:
#
#   1. Node packages, for the app, the tests, lint and the build.
#   2. Your own training data, cloned from a private card-cutter-data repo
#      into data/ — when that repo exists and this session can reach it.
#   3. Optionally, the public openCaselist corpus (~10 GB), downloaded fresh
#      rather than stored anywhere. Off unless CARD_CUTTER_FETCH_CORPUS=1.
#
# Only the Node install can fail this hook. A missing data repo or a blocked
# download is reported and skipped: the code still works without them.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
export GIT_TERMINAL_PROMPT=0
# onnxruntime-node's install step downloads its CUDA (GPU) binaries from
# nuget. These machines have no GPU, the CPU runtime the models use ships in
# the package itself, and the download is blocked by the default network
# policy — which failed the whole install.
export ONNXRUNTIME_NODE_INSTALL=skip

say() { echo "[session-start] $*"; }

# ---------- 1. Node packages ----------
# install, not ci: the container is cached after this hook, and install reuses
# what is already there.
#
# With npm 11, the version that wrote package-lock.json. This machine's npm 10
# rewrites the lockfile (it drops the libc fields) and installs a dozen
# packages npm 11 knows to skip, so every session would start with a modified
# lockfile. If npm 11 cannot be fetched, the local npm still installs, told
# not to touch the lockfile.
if npx --yes npm@11 install --no-audit --no-fund --loglevel=error; then
  say "node packages ready"
else
  npm install --no-save --no-audit --no-fund --loglevel=error
  say "node packages ready (local npm $(npm --version); lockfile left as is)"
fi

# ---------- 2. Your training data ----------
DATA_REPO="${CARD_CUTTER_DATA_REPO:-nakulbanka-dot/card-cutter-data}"
DATA_URL="${CARD_CUTTER_DATA_URL:-https://github.com/${DATA_REPO}.git}"

if git ls-remote --exit-code "$DATA_URL" HEAD >/dev/null 2>&1; then
  if [ -d data/.git ]; then
    git -C data pull --ff-only --quiet && say "data/ updated from ${DATA_REPO}" \
      || say "data/ has local changes; left as is (pull it yourself)"
  else
    # data/ may already hold files the app wrote (data/feedback.jsonl), so
    # clone into it in place rather than requiring it to be empty.
    branch=$(git ls-remote --symref "$DATA_URL" HEAD 2>/dev/null \
      | sed -n 's|^ref: refs/heads/\(.*\)\tHEAD$|\1|p' || true)
    branch="${branch:-main}"
    # Chained rather than left to set -e, so a failure here skips the data
    # instead of failing the session.
    if mkdir -p data \
      && git -C data init --quiet \
      && { git -C data remote add origin "$DATA_URL" 2>/dev/null \
           || git -C data remote set-url origin "$DATA_URL"; } \
      && git -C data fetch --quiet origin "$branch" \
      && git -C data checkout --quiet -f -B "$branch" "origin/$branch" \
      && git -C data branch --quiet --set-upstream-to "origin/$branch"; then
      say "data/ cloned from ${DATA_REPO} ($(du -sh data | cut -f1))"
    else
      say "could not clone ${DATA_REPO}; skipping training data this session"
    fi
  fi
  if [ -f data/.gitattributes ] && grep -q "filter=lfs" data/.gitattributes; then
    if command -v git-lfs >/dev/null 2>&1; then
      git -C data lfs pull && say "large files pulled" || say "git lfs pull failed"
    else
      say "data repo uses Git LFS but git-lfs is not installed; large files are pointers only"
    fi
  fi
else
  say "no access to ${DATA_REPO}; skipping training data."
  say "  To get it: push data/ from the machine that has it to that private repo,"
  say "  install the Claude GitHub App on it, and select it when starting a session."
fi

# ---------- 3. The openCaselist corpus (opt-in) ----------
if [ "${CARD_CUTTER_FETCH_CORPUS:-0}" = "1" ]; then
  if curl -sfI --max-time 15 "https://huggingface.co/api/datasets/Yusuf5/OpenCaselist" >/dev/null; then
    # pyarrow only — the full training environment (torch) is a separate,
    # much larger install: pip install -r requirements-train.txt.
    if { [ -x .venv-train/bin/python ] || python3 -m venv .venv-train; } \
      && .venv-train/bin/pip install --quiet --disable-pip-version-check pyarrow \
      && mkdir -p data/opencaselist; then
      # Hours, not seconds: run it in the background so the session can start.
      # The script skips parts it already has, so an interrupted run resumes.
      nohup .venv-train/bin/python scripts/fetch-opencaselist.py \
        > data/opencaselist/fetch.log 2>&1 &
      say "openCaselist corpus downloading in the background; progress in data/opencaselist/fetch.log"
    else
      say "could not set up pyarrow for the corpus download; skipped"
    fi
  else
    say "CARD_CUTTER_FETCH_CORPUS=1 but huggingface.co is not reachable;"
    say "  allow it under the environment's network access settings."
  fi
fi
