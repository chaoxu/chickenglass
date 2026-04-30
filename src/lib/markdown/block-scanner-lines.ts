export function computeLineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

export function lineStartOffset(lineOffsets: readonly number[], lineIndex: number): number {
  return lineOffsets[lineIndex] ?? 0;
}

export function lineEndOffset(
  lines: readonly string[],
  lineOffsets: readonly number[],
  lineIndex: number,
): number {
  return lineStartOffset(lineOffsets, lineIndex) + (lines[lineIndex]?.length ?? 0);
}

export function offsetAfterLine(
  lines: readonly string[],
  lineOffsets: readonly number[],
  lineIndex: number,
): number {
  const lineEnd = lineEndOffset(lines, lineOffsets, lineIndex);
  return lineIndex < lines.length - 1 ? lineEnd + 1 : lineEnd;
}
