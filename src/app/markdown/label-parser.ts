import type { HeadingDefinition } from "./headings";
import { extractHeadingDefinitions } from "./headings";
import { maskMarkdownCodeSpansAndBlocks } from "./masking";
import { getTextLines } from "./text-lines";

const LABEL_ID_RE = /#([A-Za-z0-9_][\w.:-]*)/;
const BRACED_LABEL_ID_RE = /\{#([A-Za-z0-9_][\w.:-]*)\}/;
const CLASS_RE = /\.([A-Za-z][\w-]*)/;
const BRACKETED_REFERENCE_RE = /\[(?:[^\]\n]|\\.)*?@[^\]\n]*\]/g;
const REFERENCE_ID_RE = /(?<![\w@])@([A-Za-z0-9_](?:[\w.:-]*\w)?)(?![\w@])/g;

export interface DocumentLabelReference {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly clusterFrom: number;
  readonly clusterTo: number;
  readonly clusterIndex: number;
  readonly bracketed: boolean;
  readonly locator?: string;
}

export interface MarkdownBlock {
  readonly from: number;
  readonly to: number;
  readonly id?: string;
  readonly labelFrom?: number;
  readonly labelTo?: number;
  readonly blockType?: string;
  readonly title?: string;
  readonly content: string;
}

export interface MarkdownEquation {
  readonly from: number;
  readonly to: number;
  readonly id?: string;
  readonly labelFrom?: number;
  readonly labelTo?: number;
  readonly text: string;
}

export interface DocumentLabelParseSnapshot {
  readonly doc: string;
  readonly scanDoc: string;
  readonly headings: readonly HeadingDefinition[];
  readonly blocks: readonly MarkdownBlock[];
  readonly equations: readonly MarkdownEquation[];
  readonly references: readonly DocumentLabelReference[];
}

interface OpenBlock {
  readonly fenceLength: number;
  readonly from: number;
  readonly id?: string;
  readonly labelFrom?: number;
  readonly labelTo?: number;
  readonly blockType?: string;
  readonly title?: string;
  readonly bodyFrom: number;
}

function getBracedLabelSpan(lineText: string, lineStart: number): {
  id?: string;
  labelFrom?: number;
  labelTo?: number;
} {
  const labelMatch = lineText.match(BRACED_LABEL_ID_RE);
  if (!labelMatch) {
    return {};
  }
  const id = labelMatch[1];
  const tokenIndex = lineText.indexOf(`{#${id}}`);
  return {
    id,
    labelFrom: lineStart + tokenIndex + 2,
    labelTo: lineStart + tokenIndex + 2 + id.length,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimTrailingReferencePunctuation(id: string): string {
  return id.replace(/\.+$/, "");
}

function parseBlockHeader(rest: string): {
  readonly id?: string;
  readonly labelFromInHeader?: number;
  readonly blockType?: string;
  readonly title?: string;
} {
  const trimmed = rest.trimStart();
  if (!trimmed.startsWith("{")) {
    return {
      title: trimmed.trim() || undefined,
    };
  }

  const closingIndex = trimmed.indexOf("}");
  if (closingIndex < 0) {
    return {};
  }

  const attrs = trimmed.slice(0, closingIndex + 1);
  const title = trimmed.slice(closingIndex + 1).trim() || undefined;
  const idMatch = attrs.match(LABEL_ID_RE);
  const classMatch = attrs.match(CLASS_RE);
  return {
    id: idMatch?.[1],
    labelFromInHeader: idMatch ? trimmed.indexOf(`#${idMatch[1]}`) + 1 : undefined,
    blockType: classMatch?.[1],
    title,
  };
}

export function extractMarkdownBlocks(doc: string, scanDoc = doc): MarkdownBlock[] {
  const lines = getTextLines(doc);
  const scanLines = getTextLines(scanDoc);
  const stack: OpenBlock[] = [];
  const blocks: MarkdownBlock[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const scanLine = scanLines[lineIndex];
    const match = scanLine.text.match(/^\s*(:{3,})(.*)$/);
    if (!match) {
      continue;
    }

    const fenceLength = match[1].length;
    const rest = match[2];
    if (/^\s*$/.test(rest)) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const open = stack[index];
        if (fenceLength < open.fenceLength) {
          continue;
        }
        stack.splice(index, 1);
        const contentEnd = line.start > 0 && doc[line.start - 1] === "\n"
          ? line.start - 1
          : line.start;
        blocks.push({
          from: open.from,
          to: line.end,
          id: open.id,
          labelFrom: open.labelFrom,
          labelTo: open.labelTo,
          blockType: open.blockType,
          title: open.title,
          content: doc.slice(open.bodyFrom, contentEnd),
        });
        break;
      }
      continue;
    }

    const header = parseBlockHeader(rest);
    stack.push({
      fenceLength,
      from: line.start,
      id: header.id,
      labelFrom: header.id && header.labelFromInHeader !== undefined
        ? line.start + line.text.indexOf(rest) + header.labelFromInHeader
        : undefined,
      labelTo: header.id && header.labelFromInHeader !== undefined
        ? line.start + line.text.indexOf(rest) + header.labelFromInHeader + header.id.length
        : undefined,
      blockType: header.blockType,
      title: header.title,
      bodyFrom: line.end < doc.length ? line.end + 1 : line.end,
    });
  }

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    blocks.push({
      from: open.from,
      to: doc.length,
      id: open.id,
      labelFrom: open.labelFrom,
      labelTo: open.labelTo,
      blockType: open.blockType,
      title: open.title,
      content: doc.slice(open.bodyFrom),
    });
  }

  return blocks;
}

export function extractMarkdownEquations(doc: string, scanDoc = doc): MarkdownEquation[] {
  const lines = getTextLines(doc);
  const scanLines = getTextLines(scanDoc);
  const equations: MarkdownEquation[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const scanLine = scanLines[lineIndex];
    const trimmed = scanLine.text.trim();

    if (trimmed.startsWith("$$")) {
      const secondFence = scanLine.text.indexOf("$$", scanLine.text.indexOf("$$") + 2);
      if (secondFence >= 0) {
        const afterFence = line.text.slice(secondFence + 2);
        const { id, labelFrom, labelTo } = getBracedLabelSpan(afterFence, line.start + secondFence + 2);
        equations.push({
          from: line.start,
          to: line.end,
          id,
          labelFrom,
          labelTo,
          text: line.text.slice(line.text.indexOf("$$") + 2, secondFence).trim(),
        });
        continue;
      }

      for (let endIndex = lineIndex + 1; endIndex < lines.length; endIndex += 1) {
        const endLine = lines[endIndex];
        const scanEndLine = scanLines[endIndex];
        if (!scanEndLine.text.trim().startsWith("$$")) {
          continue;
        }
        const { id, labelFrom, labelTo } = getBracedLabelSpan(endLine.text, endLine.start);
        const text = lines
          .slice(lineIndex + 1, endIndex)
          .map((entry) => entry.text)
          .join("\n")
          .trim();
        equations.push({
          from: line.start,
          to: endLine.end,
          id,
          labelFrom,
          labelTo,
          text,
        });
        lineIndex = endIndex;
        break;
      }
      continue;
    }

    if (trimmed === "\\[") {
      for (let endIndex = lineIndex + 1; endIndex < lines.length; endIndex += 1) {
        const endLine = lines[endIndex];
        const scanEndLine = scanLines[endIndex];
        if (!scanEndLine.text.trim().startsWith("\\]")) {
          continue;
        }
        const { id, labelFrom, labelTo } = getBracedLabelSpan(endLine.text, endLine.start);
        const text = lines
          .slice(lineIndex + 1, endIndex)
          .map((entry) => entry.text)
          .join("\n")
          .trim();
        equations.push({
          from: line.start,
          to: endLine.end,
          id,
          labelFrom,
          labelTo,
          text,
        });
        lineIndex = endIndex;
        break;
      }
    }
  }

  return equations;
}

export function extractDocumentLabelReferences(doc: string, scanDoc = doc): DocumentLabelReference[] {
  const references: DocumentLabelReference[] = [];
  const coveredRanges: Array<{ from: number; to: number }> = [];

  for (const match of scanDoc.matchAll(BRACKETED_REFERENCE_RE)) {
    const raw = match[0];
    const clusterFrom = match.index ?? 0;
    const clusterTo = clusterFrom + raw.length;
    const body = raw.slice(1, -1);
    let clusterIndex = 0;

    for (const refMatch of body.matchAll(REFERENCE_ID_RE)) {
      const id = trimTrailingReferencePunctuation(refMatch[1]);
      if (!id) {
        continue;
      }
      const relativeFrom = refMatch.index ?? 0;
      const tokenFrom = clusterFrom + 1 + relativeFrom;
      const tokenTo = tokenFrom + 1 + id.length;
      const nextRelativeFrom = (refMatch.index ?? 0) + refMatch[0].length;
      const nextReference = body
        .slice(nextRelativeFrom)
        .search(REFERENCE_ID_RE);
      const locatorSlice = nextReference >= 0
        ? body.slice(nextRelativeFrom, nextRelativeFrom + nextReference)
        : body.slice(nextRelativeFrom);

      references.push({
        id,
        from: tokenFrom,
        to: tokenTo,
        labelFrom: tokenFrom + 1,
        labelTo: tokenTo,
        clusterFrom,
        clusterTo,
        clusterIndex,
        bracketed: true,
        locator: normalizeText(locatorSlice.replace(/^[\s;,:-]+|[\s;,:-]+$/g, "")) || undefined,
      });
      clusterIndex += 1;
    }

    coveredRanges.push({ from: clusterFrom, to: clusterTo });
  }

  outer: for (const match of scanDoc.matchAll(REFERENCE_ID_RE)) {
    const tokenFrom = match.index ?? 0;
    for (const covered of coveredRanges) {
      if (tokenFrom >= covered.from && tokenFrom < covered.to) {
        continue outer;
      }
    }

    const id = trimTrailingReferencePunctuation(match[1]);
    if (!id) {
      continue;
    }
    const tokenTo = tokenFrom + 1 + id.length;
    references.push({
      id,
      from: tokenFrom,
      to: tokenTo,
      labelFrom: tokenFrom + 1,
      labelTo: tokenTo,
      clusterFrom: tokenFrom,
      clusterTo: tokenTo,
      clusterIndex: 0,
      bracketed: false,
    });
  }

  references.sort((left, right) => left.from - right.from);
  return references;
}

export function buildDocumentLabelParseSnapshot(
  doc: string,
  scanDoc = maskMarkdownCodeSpansAndBlocks(doc),
): DocumentLabelParseSnapshot {
  return {
    doc,
    scanDoc,
    headings: extractHeadingDefinitions(doc, scanDoc),
    blocks: extractMarkdownBlocks(doc, scanDoc),
    equations: extractMarkdownEquations(doc, scanDoc),
    references: extractDocumentLabelReferences(doc, scanDoc),
  };
}
