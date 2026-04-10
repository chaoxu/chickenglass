import { extractMarkdownBlocks } from "./markdown/labels";

const HEADING_RE = /^(#{1,6})[ \t]+/;
const CODE_FENCE_RE = /^\s*(```|~~~)/;
const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:/;
const FOOTNOTE_REF_RE = /\[\^[^\]]+\]/g;

function countTableStarts(lines: readonly string[]): number {
  let count = 0;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() ?? "";
    const divider = lines[index + 1]?.trim() ?? "";
    if (!header.includes("|")) {
      continue;
    }
    if (!/^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(divider)) {
      continue;
    }
    count += 1;
  }
  return count;
}

export function buildLegacyTreeString(doc: string): string {
  const lines = doc.split("\n");
  const names: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      names.push(`ATXHeading${headingMatch[1].length}`);
    }
    if (CODE_FENCE_RE.test(line)) {
      names.push("FencedCode");
    }
    if (FOOTNOTE_DEF_RE.test(line)) {
      names.push("FootnoteDefinition");
    }
    const footnoteRefMatches = line.match(FOOTNOTE_REF_RE) ?? [];
    for (const _match of footnoteRefMatches) {
      names.push("FootnoteRef");
    }
  }

  for (let index = 0; index < countTableStarts(lines); index += 1) {
    names.push("Table");
  }

  for (const block of extractMarkdownBlocks(doc)) {
    names.push("FencedDiv");
    if (block.blockType) {
      names.push(`FencedDiv:${block.blockType}`);
    }
  }

  return names.join("\n");
}
