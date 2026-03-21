#!/bin/bash
#
# Import blog posts from the Hakyll source repo into Chickenglass demo/blog/.
#
# Usage:
#   ./scripts/import-blog.sh /path/to/chaoxu.github.io
#   ./scripts/import-blog.sh  # defaults to /tmp/chickenglass-blog-source
#
# What it does:
#   1. Copies all .md files from source/posts/ to demo/blog/posts/
#   2. Updates reference.bib from source
#   3. Converts > blockquotes to ::: Blockquote fenced divs
#   4. Converts {Theorem}(title) indented blocks to ::: Theorem title fenced divs
#   5. Removes trailing # Reference headings (empty Hakyll markers)
#   6. Wraps bare \begin{align*}...\end{align*} in $$ delimiters
#

set -euo pipefail

SRC="${1:-/tmp/chickenglass-blog-source}"
DEST="$(git rev-parse --show-toplevel)/demo/blog"

if [ ! -d "$SRC/posts" ]; then
  echo "Error: $SRC/posts not found"
  echo "Usage: $0 /path/to/chaoxu.github.io"
  exit 1
fi

echo "Importing from: $SRC"
echo "Destination: $DEST"

# 1. Copy posts
cp "$SRC"/posts/*.md "$DEST/posts/" 2>/dev/null || true
echo "Copied $(ls "$SRC"/posts/*.md | wc -l | tr -d ' ') posts"

# 2. Update reference.bib
if [ -f "$SRC/reference.bib" ]; then
  cp "$SRC/reference.bib" "$DEST/reference.bib"
  echo "Updated reference.bib"
fi

# 3. Convert > blockquotes to ::: Blockquote fenced divs
for f in "$DEST"/posts/*.md; do
  if grep -q "^>" "$f"; then
    python3 -c "
import re, sys

with open('$f', 'r') as fh:
    content = fh.read()

def convert_blockquotes(text):
    lines = text.split('\n')
    result = []
    i = 0
    while i < len(lines):
        if lines[i].startswith('> ') or lines[i] == '>':
            # Collect blockquote lines
            bq_lines = []
            while i < len(lines) and (lines[i].startswith('> ') or lines[i] == '>'):
                bq_lines.append(lines[i][2:] if lines[i].startswith('> ') else '')
                i += 1
            result.append('::: Blockquote')
            result.extend(bq_lines)
            result.append(':::')
        else:
            result.append(lines[i])
            i += 1
    return '\n'.join(result)

content = convert_blockquotes(content)
with open('$f', 'w') as fh:
    fh.write(content)
" 2>/dev/null && echo "Converted blockquotes in $(basename "$f")"
  fi
done

# 4. Convert Hakyll {Block}(title) syntax to fenced divs
for f in "$DEST"/posts/*.md; do
  if grep -q "^{[A-Z]" "$f"; then
    python3 -c "
import re, sys

with open('$f', 'r') as fh:
    lines = fh.read().split('\n')

result = []
i = 0
while i < len(lines):
    m = re.match(r'^\{(\w+)\}(?:\(([^)]*)\))?\s*$', lines[i])
    if m:
        block_type = m.group(1)
        title = m.group(2) or ''
        opener = f'::: {block_type} {title}'.rstrip() if title else f'::: {block_type}'
        result.append(opener)
        i += 1
        # Skip blank lines
        while i < len(lines) and lines[i].strip() == '':
            i += 1
        # Collect indented content
        while i < len(lines):
            if lines[i].startswith('    ') or lines[i].startswith('\t'):
                content = lines[i][4:] if lines[i].startswith('    ') else lines[i][1:]
                result.append(content)
                i += 1
            elif lines[i].strip() == '':
                if i + 1 < len(lines) and (lines[i+1].startswith('    ') or lines[i+1].startswith('\t')):
                    result.append('')
                    i += 1
                else:
                    break
            else:
                break
        result.append(':::')
        result.append('')
    else:
        result.append(lines[i])
        i += 1

output = '\n'.join(result)
# NOTE: bare \begin{} wrapping removed — it cannot reliably detect
# whether the environment is already inside \[...\] or $$...$$.
# Bare environments should be wrapped manually or handled by the editor.

with open('$f', 'w') as fh:
    fh.write(output)
" 2>/dev/null && echo "Converted Hakyll blocks in $(basename "$f")"
  fi
done

# 5. Remove trailing # Reference headings
for f in "$DEST"/posts/*.md; do
  if grep -q "^# [Rr]eference" "$f"; then
    sed -i '' '/^# [Rr]eference[s]*$/d' "$f"
    # Remove trailing blank lines
    sed -i '' -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$f"
    echo "Removed Reference heading from $(basename "$f")"
  fi
done

echo ""
echo "Done. $(ls "$DEST"/posts/*.md | wc -l | tr -d ' ') total posts in $DEST/posts/"
