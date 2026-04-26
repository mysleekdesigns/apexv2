#!/usr/bin/env bash
# apex-managed: on-session-end
# Owned by APEX. SessionEnd is allowed a longer timeout (5s) so meta.json
# rewrite + reflection-job enqueue have headroom.
set -euo pipefail

EVENT="session-end"
ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
ERR_LOG="${ROOT}/.apex/episodes/.hook-errors.log"
mkdir -p "$(dirname "$ERR_LOG")" 2>/dev/null || true

CLI_LOCAL="${ROOT}/node_modules/apex-cc/dist/cli/index.js"
if [ -x "$(command -v node 2>/dev/null)" ] && [ -f "$CLI_LOCAL" ]; then
  CMD=(node "$CLI_LOCAL" hook "$EVENT")
elif [ -x "$(command -v npx 2>/dev/null)" ]; then
  CMD=(npx --yes apex hook "$EVENT")
else
  echo "apex hook ${EVENT}: no node or npx found" >> "$ERR_LOG" 2>/dev/null || true
  exit 0
fi

if command -v timeout >/dev/null 2>&1; then
  timeout 5s "${CMD[@]}" || echo "{\"event\":\"${EVENT}\",\"error\":\"timeout-or-failure\",\"rc\":$?}" >> "$ERR_LOG" 2>/dev/null || true
else
  "${CMD[@]}" || echo "{\"event\":\"${EVENT}\",\"error\":\"failure\",\"rc\":$?}" >> "$ERR_LOG" 2>/dev/null || true
fi

exit 0
