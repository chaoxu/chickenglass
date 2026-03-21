#!/bin/bash
#
# Import blog posts from the Hakyll source repo into Chickenglass demo/blog/.
#
# Uses Pandoc to parse and re-emit markdown, with a Lua filter that:
#   - Converts > blockquotes to ::: Blockquote fenced divs
#   - Removes trailing # Reference headings
#
# Pandoc also normalizes indented code blocks to fenced code blocks
# via the --wrap=preserve and fenced_code_blocks extension.
#
# Usage:
#   ./scripts/import-blog.sh /path/to/chaoxu.github.io
#   ./scripts/import-blog.sh  # defaults to /tmp/chickenglass-blog-source
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="${1:-/tmp/chickenglass-blog-source}"
DEST="$REPO_ROOT/demo/blog"
FILTER="$SCRIPT_DIR/import-filter.lua"

if [ ! -d "$SRC/posts" ]; then
  echo "Error: $SRC/posts not found"
  echo "Usage: $0 /path/to/chaoxu.github.io"
  exit 1
fi

if ! command -v pandoc &>/dev/null; then
  echo "Error: pandoc not found. Install with: brew install pandoc"
  exit 1
fi

echo "Importing from: $SRC"
echo "Destination: $DEST"
echo "Using Pandoc $(pandoc --version | head -1)"
echo ""

# Update reference.bib
if [ -f "$SRC/reference.bib" ]; then
  cp "$SRC/reference.bib" "$DEST/reference.bib"
  echo "Updated reference.bib"
fi

# Process each post through Pandoc
COUNT=0
ERRORS=0
for src_file in "$SRC"/posts/*.md; do
  name="$(basename "$src_file")"
  dest_file="$DEST/posts/$name"

  if pandoc \
    -f markdown+fenced_divs+tex_math_dollars+tex_math_double_backslash+footnotes+yaml_metadata_block \
    -t markdown+fenced_divs+tex_math_dollars+tex_math_double_backslash+footnotes+yaml_metadata_block-simple_tables-multiline_tables+pipe_tables \
    --wrap=preserve \
    --columns=9999 \
    --lua-filter="$FILTER" \
    --standalone \
    --markdown-headings=atx \
    --tab-stop=4 \
    -o "$dest_file" \
    "$src_file" 2>/dev/null; then
    COUNT=$((COUNT + 1))
  else
    echo "ERROR: Failed to convert $name"
    # Fall back to direct copy
    cp "$src_file" "$dest_file"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
echo "Converted $COUNT posts ($ERRORS errors)"
echo "Total: $(ls "$DEST"/posts/*.md | wc -l | tr -d ' ') posts in $DEST/posts/"
