#!/usr/bin/env python3
"""Pre-process markdown math delimiters for Pandoc import.

Converts:
  - \\[...\\] on own lines to $$...$$
  - \\(...\\) inline to $...$
  - Bare \\begin{env}...\\end{env} blocks to $$\\begin{env}...\\end{env}$$
    (only when not already inside $$ or \\[)
"""
import sys
import re

with open(sys.argv[1]) as f:
    lines = f.readlines()

result = []
i = 0
in_math = False  # Track if we're inside $$ or \[

while i < len(lines):
    line = lines[i]
    stripped = line.rstrip()

    # \[ on its own line → $$
    if re.match(r'^\s*\\\[\s*$', stripped):
        result.append('$$\n')
        in_math = True
        i += 1
        continue

    # \] on its own line → $$
    if re.match(r'^\s*\\\]\s*$', stripped):
        result.append('$$\n')
        in_math = False
        i += 1
        continue

    # $$ toggles math mode
    if stripped == '$$':
        in_math = not in_math
        result.append(line)
        i += 1
        continue

    # Bare \begin{env} on its own line, not inside math
    begin_match = re.match(r'^\s*\\begin\{(\w+\*?)\}', stripped) if not in_math else None
    if begin_match:
        env = begin_match.group(1)
        # Collect until matching \end{env}
        block_lines = [line]
        i += 1
        while i < len(lines):
            block_lines.append(lines[i])
            if re.match(r'^\s*\\end\{' + re.escape(env) + r'\}', lines[i].rstrip()):
                i += 1
                break
            i += 1
        result.append('$$\n')
        result.extend(block_lines)
        result.append('$$\n')
        continue

    # Inline \( → $ and \) → $
    line = re.sub(r'(?<!\\)\\\(', '$', line)
    line = re.sub(r'(?<!\\)\\\)', '$', line)

    result.append(line)
    i += 1

with open(sys.argv[2], 'w') as f:
    f.writelines(result)
