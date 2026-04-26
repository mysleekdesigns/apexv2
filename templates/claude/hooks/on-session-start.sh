#!/usr/bin/env bash
# apex-managed: on-session-start
# This file is owned by APEX. The header line above is the idempotency token
# the uninstaller (apex uninstall) uses to detect and remove it. Do not edit.
set -euo pipefail

EVENT="session-start"
ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
ERR_LOG="${ROOT}/.apex/episodes/.hook-errors.log"
mkdir -p "$(dirname "$ERR_LOG")" 2>/dev/null || true

# Resolve the apex CLI: prefer a locally-installed copy, fall back to npx.
CLI_LOCAL="${ROOT}/node_modules/apex-cc/dist/cli/index.js"
if [ -x "$(command -v node 2>/dev/null)" ] && [ -f "$CLI_LOCAL" ]; then
  CMD=(node "$CLI_LOCAL" hook "$EVENT")
elif [ -x "$(command -v npx 2>/dev/null)" ]; then
  CMD=(npx --yes apex hook "$EVENT")
else
  echo "apex hook ${EVENT}: no node or npx found" >> "$ERR_LOG" 2>/dev/null || true
  exit 0
fi

# Hard timeout. SessionStart hot path budget is 800ms p99 (specs/compatibility.md).
if command -v timeout >/dev/null 2>&1; then
  timeout 1s "${CMD[@]}" || echo "{\"event\":\"${EVENT}\",\"error\":\"timeout-or-failure\",\"rc\":$?}" >> "$ERR_LOG" 2>/dev/null || true
else
  "${CMD[@]}" || echo "{\"event\":\"${EVENT}\",\"error\":\"failure\",\"rc\":$?}" >> "$ERR_LOG" 2>/dev/null || true
fi

# Hooks must NEVER block Claude Code: exit 0 unconditionally.
exit 0
