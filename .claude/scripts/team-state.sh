#!/bin/bash
# State management for run orchestrator
# Usage:
#   team-state.sh write <mode> '<json>'
#   team-state.sh read <mode>
#   team-state.sh clear <mode>

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
STATE_DIR="$REPO_ROOT/.claude/state"
mkdir -p "$STATE_DIR"

ACTION="${1:?Usage: team-state.sh write|read|clear MODE [JSON]}"
MODE="${2:?Usage: team-state.sh write|read|clear MODE [JSON]}"
STATE_FILE="$STATE_DIR/${MODE}-state.json"

case "$ACTION" in
  write)
    JSON="${3:?write requires JSON argument}"
    echo "$JSON" > "$STATE_FILE"
    ;;
  read)
    if [ -f "$STATE_FILE" ]; then
      cat "$STATE_FILE"
    else
      echo "{}"
    fi
    ;;
  clear)
    rm -f "$STATE_FILE"
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 1
    ;;
esac
