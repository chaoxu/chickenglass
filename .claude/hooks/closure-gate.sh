#!/bin/bash
# Closure gate hook: blocks `tea issue close` (or `gh issue close`) unless a
# completeness review agent has written a verified marker with valid JSON.
#
# Flow:
#   1. Completeness review agent passes → writes JSON marker via Write tool
#   2. `tea issue close N` triggers this hook
#   3. Hook validates marker content → allows if valid (deletes marker), blocks if invalid/absent
#
# Two-pass design: validate ALL markers first, then delete ALL.
# This prevents consuming a valid marker when a later one fails.

set -euo pipefail

# Anchor to repo root via script location (not CWD)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$REPO_ROOT/.claude/state"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Intercept both `tea issue close` and `gh issue close`
if echo "$COMMAND" | grep -qE 'tea\s+issue\s+close\s+'; then
  CLOSE_ARGS=$(echo "$COMMAND" | sed -E 's/.*tea[[:space:]]+issue[[:space:]]+close[[:space:]]+//')
elif echo "$COMMAND" | grep -qE 'gh\s+issue\s+close\s+'; then
  CLOSE_ARGS=$(echo "$COMMAND" | sed -E 's/.*gh[[:space:]]+issue[[:space:]]+close[[:space:]]+//')
else
  exit 0
fi

# Extract issue number(s) — all bare digits
ISSUE_NUMBERS=$(echo "$CLOSE_ARGS" | grep -oE '^([0-9]+([[:space:]]+[0-9]+)*)' | grep -oE '[0-9]+' || true)

if [ -z "$ISSUE_NUMBERS" ]; then
  echo "BLOCKED: Could not extract issue number from: $COMMAND"
  echo ""
  echo "Issue numbers must be literal digits."
  echo "Use: tea issue close 42"
  exit 2
fi

# Pass 1: validate ALL markers (no deletions — safe if any fail)
for ISSUE in $ISSUE_NUMBERS; do
  MARKER="$STATE_DIR/closure-verified-$ISSUE"

  if [ ! -f "$MARKER" ]; then
    echo "BLOCKED: Issue #$ISSUE has no completeness verification marker."
    echo ""
    echo "A completeness review agent must write a JSON marker at:"
    echo "  $MARKER"
    echo ""
    echo "Required format: {\"issue\": $ISSUE, \"verdict\": \"COMPLETE\", \"criteria\": [...]}"
    exit 2
  fi

  if ! jq -e --argjson n "$ISSUE" \
    '.verdict == "COMPLETE" and .issue == $n and (.criteria | type == "array") and (.criteria | length >= 3)' \
    "$MARKER" >/dev/null 2>&1; then
    echo "BLOCKED: Marker for #$ISSUE has invalid content."
    echo ""
    echo "Required: {\"issue\": $ISSUE, \"verdict\": \"COMPLETE\", \"criteria\": [...]}"
    echo ""
    echo "Current content:"
    cat "$MARKER" 2>/dev/null || echo "(empty file)"
    exit 2
  fi
done

# Pass 2: all validated — consume markers
for ISSUE in $ISSUE_NUMBERS; do
  rm -f "$STATE_DIR/closure-verified-$ISSUE"
done

exit 0
