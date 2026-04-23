import type { HeadingDefinition } from "./headings";
import { collectSourceBlockRanges } from "./block-scanner";
import {
  parseStructuredDisplayMathRaw,
  parseStructuredFencedDivRaw,
} from "./block-syntax";
import { extractHeadingDefinitions } from "./headings";
import { maskMarkdownCodeSpansAndBlocks } from "./masking";
import { measureSync } from "../perf";
import { scanReferenceTokens } from "../reference-tokens";

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

export function extractMarkdownBlocks(doc: string, scanDoc = doc): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];

  function collect(markdown: string, scanMarkdown: string, offset: number): void {
    for (const range of collectSourceBlockRanges(scanMarkdown)) {
      if (range.variant !== "fenced-div") {
        continue;
      }
      const raw = markdown.slice(range.from, range.to);
      const parsed = parseStructuredFencedDivRaw(raw);
      const labelToken = parsed.id ? `#${parsed.id}` : undefined;
      const labelTokenIndex = labelToken ? raw.indexOf(labelToken) : -1;
      const from = offset + range.from;
      const to = offset + range.to;
      blocks.push({
        from,
        to,
        id: parsed.id,
        labelFrom: parsed.id && labelTokenIndex >= 0
          ? from + labelTokenIndex + 1
          : undefined,
        labelTo: parsed.id && labelTokenIndex >= 0
          ? from + labelTokenIndex + 1 + parsed.id.length
          : undefined,
        blockType: parsed.blockType,
        title: parsed.title,
        content: parsed.bodyMarkdown,
      });

      const bodyOffset = raw.indexOf(parsed.bodyMarkdown);
      if (bodyOffset >= 0 && parsed.bodyMarkdown.includes(":::")) {
        collect(parsed.bodyMarkdown, scanMarkdown.slice(range.from + bodyOffset, range.from + bodyOffset + parsed.bodyMarkdown.length), from + bodyOffset);
      }
    }
  }

  collect(doc, scanDoc, 0);
  blocks.sort((left, right) => left.from - right.from || right.to - left.to);
  return blocks;
}

export function extractMarkdownEquations(doc: string, scanDoc = doc): MarkdownEquation[] {
  const equations: MarkdownEquation[] = [];

  for (const range of collectSourceBlockRanges(scanDoc)) {
    if (range.variant !== "display-math") {
      continue;
    }
    const raw = doc.slice(range.from, range.to);
    const parsed = parseStructuredDisplayMathRaw(raw);
    equations.push({
      from: range.from,
      to: range.to,
      id: parsed.id,
      labelFrom: parsed.id && parsed.labelFrom !== undefined
        ? range.from + parsed.labelFrom
        : undefined,
      labelTo: parsed.id && parsed.labelTo !== undefined
        ? range.from + parsed.labelTo
        : undefined,
      text: parsed.body,
    });
  }

  return equations;
}

export function extractDocumentLabelReferences(_doc: string, scanDoc = _doc): DocumentLabelReference[] {
  return scanReferenceTokens(scanDoc);
}

// Single-entry cache keyed by `doc` identity — subsequent calls with the
// same doc string (e.g. re-renders that didn't change the document) reuse
// the prior snapshot instead of repeating the full scan. Addresses #174
// for the non-keystroke re-render path; keystrokes still recompute because
// the doc string changes.
let cachedSnapshotDoc: string | null = null;
let cachedSnapshot: DocumentLabelParseSnapshot | null = null;

export function buildDocumentLabelParseSnapshot(
  doc: string,
  scanDoc?: string,
): DocumentLabelParseSnapshot {
  if (scanDoc === undefined && cachedSnapshot && cachedSnapshotDoc === doc) {
    return cachedSnapshot;
  }
  return measureSync("markdown.parseSnapshot", () => {
    const resolvedScanDoc = scanDoc ?? maskMarkdownCodeSpansAndBlocks(doc);
    const snapshot: DocumentLabelParseSnapshot = {
      doc,
      scanDoc: resolvedScanDoc,
      headings: extractHeadingDefinitions(doc, resolvedScanDoc),
      blocks: extractMarkdownBlocks(doc, resolvedScanDoc),
      equations: extractMarkdownEquations(doc, resolvedScanDoc),
      references: extractDocumentLabelReferences(doc, resolvedScanDoc),
    };
    if (scanDoc === undefined) {
      cachedSnapshotDoc = doc;
      cachedSnapshot = snapshot;
    }
    return snapshot;
  }, { category: "markdown", detail: `${doc.length} chars` });
}
