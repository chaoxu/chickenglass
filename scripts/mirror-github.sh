#!/usr/bin/env bash
# Mirror `origin/main` to GitHub.
# Usage: ./scripts/mirror-github.sh [--scheduled] [--dry-run]
# Intended for manual runs and cron.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ORIGIN_REMOTE="${ORIGIN_REMOTE:-origin}"
GITHUB_REMOTE_NAME="${GITHUB_REMOTE_NAME:-github}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
GITHUB_USER="${GITHUB_USER:-chaoxu}"
GITHUB_REPO="${GITHUB_REPO:-chaoxu/coflat}"
DRY_RUN_FLAG=""
PUSH_ARGS=(--force --no-verify)
SCHEDULED_MODE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run|-n)
      DRY_RUN_FLAG="--dry-run"
      PUSH_ARGS=(--dry-run --force --no-verify)
      ;;
    --scheduled)
      SCHEDULED_MODE=1
      ;;
    *)
      echo "Usage: $0 [--scheduled] [--dry-run]" >&2
      exit 1
      ;;
  esac
  shift
done

# Only the launchd midnight job should run unattended. This makes the old
# 03:17 cron entry a no-op until the system cron lock is cleared.
if [ "$SCHEDULED_MODE" -ne 1 ] && [ ! -t 1 ]; then
  echo "Skipping headless invocation without --scheduled."
  exit 0
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
  GITHUB_PUSH_TARGET="https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git"
elif git -C "$REPO_DIR" remote get-url "$GITHUB_REMOTE_NAME" >/dev/null 2>&1; then
  GITHUB_PUSH_TARGET="$GITHUB_REMOTE_NAME"
else
  echo "Error: configure ${GITHUB_REMOTE_NAME} or set GITHUB_TOKEN." >&2
  exit 1
fi

SOURCE_REF="refs/remotes/${ORIGIN_REMOTE}/${TARGET_BRANCH}"
DESTINATION_REF="refs/heads/${TARGET_BRANCH}"

cd "$REPO_DIR"

git fetch "$ORIGIN_REMOTE" "+refs/heads/${TARGET_BRANCH}:${SOURCE_REF}" --tags --prune

SOURCE_SHA="$(git rev-parse "$SOURCE_REF")"
echo "Syncing ${SOURCE_REF} (${SOURCE_SHA}) to GitHub ${DESTINATION_REF}"

git push "${PUSH_ARGS[@]}" "$GITHUB_PUSH_TARGET" "${SOURCE_REF}:${DESTINATION_REF}"
git push "${PUSH_ARGS[@]}" "$GITHUB_PUSH_TARGET" --tags

if [ -n "$DRY_RUN_FLAG" ]; then
  echo "Dry run complete."
else
  echo "Mirrored ${TARGET_BRANCH} + tags to GitHub."
fi
