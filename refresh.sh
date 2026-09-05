#!/usr/bin/env bash
# Regenerate the catalogue and audio, then commit them.
#
# Deployment is GitHub's job: pushing to main runs the tests and deploys. This
# script only rebuilds the generated data that the app ships with, which is
# committed so that CI needs neither Python nor the 615 MB of upstream dumps.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ -x .venv/bin/frcog ] || { echo "No virtualenv. Run: python3 -m venv .venv && .venv/bin/pip install -e ." >&2; exit 1; }

if [ ! -f data/raw/kaikki-fr.jsonl ]; then
  say "Fetching the Wiktionary extract (578 MB, once)"
  .venv/bin/frcog fetch
fi

say "Rebuilding the ranking"
.venv/bin/frcog build

say "Filling in any missing audio"
.venv/bin/frcog audio

say "Exporting the catalogue"
.venv/bin/frcog app --no-serve

say "What changed"
git add -A data/media app/static/catalogue data/french.db
git status --short data/media app/static/catalogue data/french.db | head -20
echo
echo "Commit and push to deploy:"
echo "  git commit -m 'Refresh catalogue and audio' && git push"
