#!/bin/bash
# Guard: blocks manual creation of closure-verified marker files via Bash.
# Forces markers to be written by completeness review agents using the Write tool
# with valid JSON content.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# List of file-creating tools (word boundaries via \b, no trailing space needed)
WRITE_TOOLS='(touch|echo|printf|tee|cp|mv|install|python3?|node|perl|ruby|dd|sponge|cat\s*<<|>\s*[^&]|>>)'

# Check 1: command mentions closure-verified AND uses a write tool
if echo "$COMMAND" | grep -qE 'closure-verified' && \
   echo "$COMMAND" | grep -qE "$WRITE_TOOLS"; then
  echo "BLOCKED: Closure markers cannot be created via Bash commands."
  echo ""
  echo "Closure markers must be written by a completeness review agent using"
  echo "the Write tool with valid JSON content containing:"
  echo '  {"issue": N, "verdict": "COMPLETE", "criteria": [...]}'
  exit 2
fi

# Check 2: command targets .claude/state/ with a write tool AND mentions closure/verified
# (catches variable-split paths like: F=closure; cp /tmp/x .claude/state/$F-verified-42)
if echo "$COMMAND" | grep -qE '\.claude/state/' && \
   echo "$COMMAND" | grep -qE "$WRITE_TOOLS" && \
   echo "$COMMAND" | grep -qE '(verified|closure)'; then
  echo "BLOCKED: Suspected closure marker creation via Bash."
  echo ""
  echo "Use the Write tool with valid JSON content instead."
  exit 2
fi

exit 0
