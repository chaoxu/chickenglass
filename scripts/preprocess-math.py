#!/usr/bin/env python3
"""Pre-process markdown math delimiters for Pandoc import.

Converts all LaTeX math delimiters to $ / $$ before Pandoc sees the file,
because Pandoc's tex_math_single_backslash extension corrupts \\begin/\\end.

Conversions:
  - \\[ → $$  and  \\] → $$  (display math, anywhere on the line)
  - \\( → $   and  \\) → $   (inline math)
  - Bare \\begin{env}...\\end{env} blocks → wrapped in $$
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

    # $$ toggles math mode tracking
    if stripped == '$$':
        in_math = not in_math
        result.append(line)
        i += 1
        continue

    # Replace \[ and \] with $$ (display math delimiters)
    # These can appear at start of line, end of line, or inline with \begin
    line = re.sub(r'\\\[', '$$', line)
    line = re.sub(r'\\\]', '$$', line)

    # Track math mode after replacement
    for m in re.finditer(r'\$\$', line):
        in_math = not in_math

    # Replace \( and \) with $ (inline math delimiters)
    line = re.sub(r'(?<!\\)\\\(', '$', line)
    line = re.sub(r'(?<!\\)\\\)', '$', line)

    # Bare \begin{env} on its own line, not inside math
    begin_match = re.match(r'^\s*\\begin\{(\w+\*?)\}', stripped) if not in_math else None
    if begin_match:
        env = begin_match.group(1)
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

    result.append(line)
    i += 1

with open(sys.argv[2], 'w') as f:
    f.writelines(result)
