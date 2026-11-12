#!/bin/bash
# Move the files git never carried from the old Mac to this one, and set
# this Mac up to run and retrain.
#
# Run it on the NEW Mac, inside a fresh clone of this repo:
#
#   scripts/move-from-old-mac.sh USER@OLD-MAC.local:~/card-cutter
#   scripts/move-from-old-mac.sh /Volumes/SomeDrive/card-cutter      # from a drive
#
# On the old Mac first: System Settings > General > Sharing > Remote Login on.
# `scutil --get LocalHostName` there gives OLD-MAC, `whoami` gives USER.
# You type the old Mac's password once; one SSH connection serves the run.
#
# What it does:
#   1. Looks at the old project: uncommitted or unpushed work, the exact
#      training package versions, sizes, and every file git ignores.
#   2. Copies data/, models/, the .env files and .vercel/ — the things a
#      clone does not bring. Rerunning resumes; files already here are skipped.
#   3. Checks every folder arrived with the same number of files and bytes.
#   4. Sets this Mac up: Node packages, the Python training environment
#      (pinned to the old Mac's versions), USE_TRAINED_MODELS=1.
#   5. Proves the models in ml/ load and rank (build + check:bundle), and
#      records the reranker's baseline score on the test split, so a
#      retrained model has a number to beat.
#
# Options:
#   --copy-only      stop after step 3
#   --no-baseline    skip the baseline score (it takes a few minutes)
#
# Compatible with the bash 3.2 and rsync that ship with macOS. Paths must
# not contain spaces.
set -euo pipefail

SRC=""
SETUP=1
BASELINE=1
for arg in "$@"; do
  case "$arg" in
    --copy-only) SETUP=0 ;;
    --no-baseline) BASELINE=0 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) SRC="$arg" ;;
  esac
done
if [ -z "$SRC" ]; then
  echo "usage: $0 USER@OLD-MAC.local:~/card-cutter   (or a local/drive path)" >&2
  exit 2
fi

# Keep this Mac awake for the whole run; a sleeping laptop drops the copy.
if [ "$(uname)" = Darwin ] && [ -z "${MOVE_CAFFEINATED:-}" ] && command -v caffeinate >/dev/null; then
  MOVE_CAFFEINATED=1 exec caffeinate -i "$0" "$@"
fi

cd "$(git rev-parse --show-toplevel)"
ROOT="$PWD"
WARNINGS=""

step() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; WARNINGS="${WARNINGS}  - $*\n"; }

# ---------- where the old project is ----------
REMOTE=0
case "$SRC" in
  *:*) REMOTE=1; HOST="${SRC%%:*}"; OLD="${SRC#*:}" ;;
  *) OLD="$SRC" ;;
esac
OLD="${OLD%/}"

CTL="${TMPDIR:-/tmp}/move-from-old-mac-$$"
SSH="ssh -o ControlMaster=auto -o ControlPath=$CTL -o ControlPersist=900"
cleanup() { [ "$REMOTE" = 1 ] && $SSH -O exit "$HOST" 2>/dev/null || true; }
trap cleanup EXIT

if [ "$REMOTE" = 1 ]; then
  # A path typed as ~/... must expand on the old Mac, not here.
  # shellcheck disable=SC2088
  case "$OLD" in
    "~") OLDCD="cd ~" ;;
    "~/"*) OLDCD="cd ~/'${OLD#\~/}'" ;;
    *) OLDCD="cd '$OLD'" ;;
  esac
fi

# Run a shell command inside the old project folder.
on_old() {
  if [ "$REMOTE" = 1 ]; then
    $SSH "$HOST" "$OLDCD && $1"
  else
    (cd "$OLD" && bash -c "$1")
  fi
}

# rsync from the old project; $1 is a path inside it, $2 the destination here.
RSYNC_PROGRESS=""
if rsync --version 2>/dev/null | head -1 | grep -q 'version 3'; then
  RSYNC_PROGRESS="--info=progress2"
fi
pull() {
  if [ "$REMOTE" = 1 ]; then
    rsync -a $RSYNC_PROGRESS -e "$SSH" "$HOST:$OLD/$1" "$2"
  else
    rsync -a $RSYNC_PROGRESS "$OLD/$1" "$2"
  fi
}

# "<files> <bytes>" for a folder, the same way on both machines (BSD and GNU).
COUNT='find "$0" -type f -exec ls -ln {} + 2>/dev/null | awk "{n++; s+=\$5} END {print n+0, s+0}"'
count_old() { on_old "bash -c '$COUNT' $1"; }

# "<bytes> <path>" for every file in a folder, sorted, run from the project
# root on either machine. Verifying with this rather than totals means files
# made here later (the baseline score in data/) never read as a bad copy.
LIST='find "$0" -type f -exec ls -ln {} + 2>/dev/null | awk "{s=\$5; \$1=\$2=\$3=\$4=\$5=\$6=\$7=\$8=\"\"; sub(/^ +/, \"\"); print s, \$0}" | LC_ALL=C sort'
list_old() { on_old "bash -c '$LIST' $1"; }
list_new() { (cd "$ROOT" && bash -c "$LIST" "$1"); }
human() { awk -v b="$1" 'BEGIN { split("B KB MB GB TB", u); i=1; while (b>=1024 && i<5) { b/=1024; i++ } printf "%.1f %s", b, u[i] }'; }

# ---------- 1. look at the old project ----------
step "Connecting to the old project at $SRC"
on_old 'test -f package.json && grep -q "\"name\": \"card-cutter\"" package.json' \
  || { echo "That folder is not the card-cutter project." >&2; exit 1; }
note "found it"

if [ "$REMOTE" = 1 ]; then
  # The old Mac can sleep mid-copy too. Three hours is longer than any copy.
  on_old 'command -v caffeinate >/dev/null && (nohup caffeinate -i -t 10800 </dev/null >/dev/null 2>&1 &) ; true'
fi

step "Checking for work that only exists on the old Mac"
dirty="$(on_old 'git status --porcelain' || true)"
unpushed="$(on_old 'git log --oneline "@{u}.." 2>/dev/null' || true)"
if [ -n "$dirty" ]; then
  warn "the old Mac has uncommitted changes; commit and push them there:"
  printf '%s\n' "$dirty" | sed 's/^/        /'
fi
if [ -n "$unpushed" ]; then
  warn "the old Mac has commits it never pushed; run git push there:"
  printf '%s\n' "$unpushed" | sed 's/^/        /'
fi
[ -z "$dirty$unpushed" ] && note "none: everything there is in git"

step "Recording the old Mac's exact training versions"
oldpy="$(on_old '[ -x .venv-train/bin/python ] && .venv-train/bin/python -c "import sys; print(\"%d.%d\" % sys.version_info[:2])"' || true)"
if [ -n "$oldpy" ]; then
  on_old '.venv-train/bin/pip freeze > requirements-train.lock.txt'
  note "Python $oldpy; package versions written to requirements-train.lock.txt"
else
  warn "no .venv-train on the old Mac; training will use requirements-train.txt"
fi

# What to bring: the things a clone does not.
ITEMS=""
for d in data models .vercel; do
  if on_old "test -d $d"; then ITEMS="$ITEMS $d/"; fi
done
ENVFILES="$(on_old 'ls -a | grep "^\.env" | grep -v "^\.env\.example$"' || true)"
for f in $ENVFILES; do ITEMS="$ITEMS $f"; done
[ -n "$oldpy" ] && ITEMS="$ITEMS requirements-train.lock.txt"

step "Sizing what will be copied"
need=0
for item in $ITEMS; do
  case "$item" in
    */)
      # shellcheck disable=SC2046  # "<files> <bytes>", split on purpose
      set -- $(count_old "${item%/}")
      note "$(printf '%-30s %8s files  %s' "$item" "$1" "$(human "$2")")"
      need=$((need + $2)) ;;
    *) note "$item" ;;
  esac
done
[ -z "$ENVFILES" ] && warn "no .env files on the old Mac; you will need to re-enter API keys"

free_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
if [ $((need / 1024 * 11 / 10)) -gt "$free_kb" ]; then
  echo "Not enough free space here: need about $(human $need), have $(human $((free_kb * 1024)))." >&2
  exit 1
fi
note "this Mac has $(human $((free_kb * 1024))) free"

# Anything else git ignores, so nothing is left behind without a decision.
others="$(on_old 'git status --ignored --porcelain' | sed -n 's/^!! //p' \
  | grep -vE '^(node_modules/|\.next/|\.venv-train/|data/|models/|\.vercel/|\.env|.*\.tsbuildinfo$|next-env\.d\.ts$|requirements-train\.lock\.txt$)' || true)"
if [ -n "$others" ]; then
  warn "other files git ignores on the old Mac were not copied; check whether you need them:"
  printf '%s\n' "$others" | sed 's/^/        /'
fi

# ---------- 2. copy ----------
step "Copying (rerun to resume if it stops)"
for item in $ITEMS; do
  note "$item"
  case "$item" in
    */) mkdir -p "$ROOT/$item"; pull "$item" "$ROOT/$item" ;;
    *) pull "$item" "$ROOT/" ;;
  esac
done

# ---------- 3. verify ----------
step "Checking everything arrived"
bad=0
for item in $ITEMS; do
  case "$item" in
    */)
      list_old "${item%/}" > "$CTL.old"; list_new "${item%/}" > "$CTL.new"
      missing="$(LC_ALL=C comm -23 "$CTL.old" "$CTL.new" | wc -l | tr -d ' ')"
      if [ "$missing" = 0 ]; then
        note "$item: all $(wc -l < "$CTL.old" | tr -d ' ') files here, same sizes"
      else
        warn "$item: $missing files missing or a different size here; rerun to resume"
        LC_ALL=C comm -23 "$CTL.old" "$CTL.new" | head -5 | sed 's/^/        /'
        bad=1
      fi
      rm -f "$CTL.old" "$CTL.new" ;;
    *)
      [ -f "$ROOT/$item" ] && note "$item present" || { warn "$item missing"; bad=1; } ;;
  esac
done
[ "$bad" = 1 ] && { printf '\nCopy incomplete. Rerun the same command to finish it.\n'; exit 1; }

if [ "$SETUP" = 0 ]; then
  printf '\nCopied and verified. Setup skipped (--copy-only).\n'
  [ -n "$WARNINGS" ] && printf '\nCheck these:\n%b' "$WARNINGS"
  exit 0
fi

# ---------- 4. set this Mac up ----------
step "Turning the trained models on for local runs"
touch .env.local
if grep -q '^USE_TRAINED_MODELS=' .env.local; then
  note "USE_TRAINED_MODELS already set in .env.local"
else
  echo 'USE_TRAINED_MODELS=1' >> .env.local
  note "added USE_TRAINED_MODELS=1 to .env.local"
fi

NODE_OK=0
step "Node packages"
if command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=9)?0:1)'; then
  npm install --no-audit --no-fund --loglevel=error
  NODE_OK=1
  note "installed (Node $(node --version))"
else
  warn "Node 20.9+ not found; install it (brew install node@22) and run: npm install"
fi

step "Python training environment"
PY=""
for cand in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$cand" >/dev/null && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PY="$cand"; break
  fi
done
if [ -n "$oldpy" ] && command -v "python$oldpy" >/dev/null; then PY="python$oldpy"; fi
if [ -z "$PY" ]; then
  warn "no Python 3.10+ found; install one (brew install python@3.12), then:"
  warn "  python3.12 -m venv .venv-train && .venv-train/bin/pip install -r requirements-train.lock.txt"
else
  [ -x .venv-train/bin/python ] || "$PY" -m venv .venv-train
  .venv-train/bin/pip install --quiet --disable-pip-version-check --upgrade pip
  if [ -f requirements-train.lock.txt ] && .venv-train/bin/pip install --quiet --disable-pip-version-check -r requirements-train.lock.txt; then
    note "installed the old Mac's exact versions"
  else
    [ -f requirements-train.lock.txt ] && warn "the old Mac's exact versions would not install here; used requirements-train.txt"
    .venv-train/bin/pip install --quiet --disable-pip-version-check -r requirements-train.txt
  fi
  gpu="$(.venv-train/bin/python -c 'import torch; print(torch.backends.mps.is_available())' 2>/dev/null || echo error)"
  if [ "$gpu" = True ]; then
    note "torch $(.venv-train/bin/python -c 'import torch; print(torch.__version__)') sees the Mac's GPU (mps)"
  else
    warn "torch cannot use the Mac's GPU (mps: $gpu); training would run on the CPU"
  fi
fi

# ---------- 5. prove the models work here ----------
if [ "$NODE_OK" = 1 ]; then
  step "Loading the shipped models the way the site does"
  if npm run --silent build >/dev/null 2>&1 && npm run --silent check:bundle; then
    note "the models in ml/ load and rank"
  else
    warn "build or check:bundle failed; run them yourself to see why: npm run build && npm run check:bundle"
  fi

  if [ "$BASELINE" = 1 ] && [ -f data/training/splits2/test.jsonl ] && [ -f data/training/titles.json ]; then
    step "Baseline: the current reranker on the held-out test split"
    out="data/baseline-reranker-$(date +%Y-%m-%d).txt"
    if USE_TRAINED_MODELS=1 node scripts/eval-reranker-ts.mjs > "$out" 2>&1; then
      sed -n '/Precision@1/,/MRR/p' "$out" | sed 's/^/    /'
      note "saved to $out — a retrained model has to beat this"
    else
      warn "baseline did not run; see $out"
    fi
  fi
fi

printf '\nDone. The project, its data and the training environment are on this Mac.\n'
printf 'Start the app: npm run dev, then open http://localhost:3000/cut\n'
if [ -n "$WARNINGS" ]; then
  printf '\nCheck these:\n%b' "$WARNINGS"
fi
