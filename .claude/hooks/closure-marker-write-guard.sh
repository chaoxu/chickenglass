#!/bin/bash
# Guard: blocks the Write tool from creating closure-verified marker files
# UNLESS the content is valid JSON with the required schema.
#
# This prevents the lead from writing a quick marker without running
# a completeness review. The review agent produces structured JSON naturally;
# a manual bypass requires constructing fake criterion-level evidence.
#
# Note: this cannot distinguish lead vs subagent (hooks lack caller context).
# The friction is in requiring valid structured content, not in blocking writes.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only intercept writes to closure-verified marker files
if ! echo "$FILE_PATH" | grep -qE 'closure-verified-[0-9]+$'; then
  exit 0
fi

CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')

# Extract issue number from filename
ISSUE=$(echo "$FILE_PATH" | grep -oE '[0-9]+$')

# Validate content is proper JSON with required fields
if ! echo "$CONTENT" | jq -e --argjson n "$ISSUE" \
  '.verdict == "COMPLETE" and .issue == $n and (.criteria | type == "array") and (.criteria | length >= 3)' \
  >/dev/null 2>&1; then
  echo "BLOCKED: Closure marker content is invalid or insufficient."
  echo ""
  echo "Required: JSON with verdict=COMPLETE, matching issue number, and >= 3 criteria."
  echo "This ensures a real completeness review produced the marker."
  echo ""
  echo "Got: $(echo "$CONTENT" | head -c 200)"
  exit 2
fi

exit 0
