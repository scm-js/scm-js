#!/usr/bin/env bash
# The Vite dev server plus Electron pointed at it. Closing the window or Ctrl-C stops both.
# Arguments go to Electron: scripts/dev-desktop.sh --remote-debugging-port=9222
set -euo pipefail
cd "$(dirname "$0")/.."

# Job control puts Vite in its own process group, so Ctrl-C reaches only Electron
# and the trap can take down Vite's whole tree (npm -> sh -> vite) at once.
set -m
npm run dev -- --strictPort &
vite_group=$!
trap 'kill -- -"$vite_group" 2>/dev/null || true' EXIT

until curl -sf -o /dev/null http://localhost:5173; do
  kill -0 "$vite_group" 2>/dev/null || { echo "Vite exited before it was ready" >&2; exit 1; }
  sleep 0.3
done

SCMJS_DEV_URL=http://localhost:5173 npm run desktop -- "$@"
