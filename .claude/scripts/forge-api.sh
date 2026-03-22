#!/bin/bash
# Forge API wrapper for GitHub using gh CLI
# Usage: forge-api.sh <METHOD> <PATH> [BODY]
# Example: forge-api.sh GET "/repos/chaoxu/coflat/issues?state=open"
# Example: forge-api.sh PATCH "/repos/chaoxu/coflat/issues/1" '{"state":"closed"}'

set -e

METHOD="${1:?Usage: forge-api.sh METHOD PATH [BODY]}"
PATH_ARG="${2:?Usage: forge-api.sh METHOD PATH [BODY]}"
BODY="${3:-}"

if [ "$METHOD" = "GET" ]; then
  gh api "$PATH_ARG"
elif [ -n "$BODY" ]; then
  echo "$BODY" | gh api "$PATH_ARG" --method "$METHOD" --input -
else
  gh api "$PATH_ARG" --method "$METHOD"
fi
