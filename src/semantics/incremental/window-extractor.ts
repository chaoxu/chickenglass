import type { Tree } from "@lezer/common";
import { NODE } from "../../constants/node-types";
import { scanReferenceTokens } from "../../lib/reference-tokens";
import type { FencedDivSemantics, MathSemantics, ReferenceSemantics, TextSource } from "../document";
import {
  collectFencedDiv,
  collectFootnoteDef,
  collectFootnoteRef,
  collectHeading,
  collectLink,
  collectMath,
  createStructuralWindowExtraction,
  type ExcludedRange,
  type StructuralWindow,
  type StructuralWindowExtraction,
} from "./window-collectors";

export type {
  EquationStructure,
  ExcludedRange,
  HeadingStructure,
  StructuralWindow,
  StructuralWindowExtraction,
} from "./window-collectors";

export interface FencedDivExpansionExtraction {
  readonly fencedDivs: readonly FencedDivSemantics[];
  readonly mathRegions: readonly MathSemantics[];
}

interface StructuralWindowExtractOptions {
  readonly includeNarrativeRefs?: boolean;
}

const ATX_HEADING_RE = /^ATXHeading(\d)$/;

function normalizeWindow(
  doc: TextSource,
  window?: StructuralWindow,
): StructuralWindow {
  const from = Math.max(0, Math.min(window?.from ?? 0, doc.length));
  const to = Math.max(from, Math.min(window?.to ?? doc.length, doc.length));
  return { from, to };
}

function shouldDescendIntoStructuralNode(name: string): boolean {
  switch (name) {
    case NODE.InlineCode:
    case NODE.InlineMath:
    case NODE.DisplayMath:
    case NODE.Link:
    case NODE.FootnoteRef:
      return false;
    default:
      return true;
  }
}

/**
 * Collect narrative `@id` references within a window by using the shared
 * reference scanner and filtering out matches that fall inside any excluded
 * range (code, math, links).
 *
 * One character of document context before the window is included so
 * the regex lookbehind `(?<![[@\w])` works correctly at the boundary.
 */
export function collectNarrativeRefsInWindow(
  doc: TextSource,
  excludedRanges: readonly ExcludedRange[],
  range: StructuralWindow,
  result: ReferenceSemantics[],
): void {
  const prefixLen = range.from > 0 ? 1 : 0;
  const text = doc.slice(range.from - prefixLen, range.to);
  if (text.indexOf("@", prefixLen) === -1) {
    return;
  }

  let exIdx = 0;
  for (const token of scanReferenceTokens(text)) {
    if (token.bracketed || token.from < prefixLen) {
      continue;
    }

    const from = range.from - prefixLen + token.from;
    const to = range.from - prefixLen + token.to;

    // Linear sweep: advance past excluded ranges that end before this match.
    while (exIdx < excludedRanges.length && excludedRanges[exIdx].to <= from) {
      exIdx++;
    }
    if (
      exIdx < excludedRanges.length
      && from >= excludedRanges[exIdx].from
      && to <= excludedRanges[exIdx].to
    ) {
      continue;
    }

    result.push({
      from,
      to,
      bracketed: false,
      ids: [token.id],
      locators: [undefined],
    });
  }
}

/**
 * Find the start of the paragraph containing `pos` — walk backward past
 * non-blank lines until we hit a blank line or the document start.
 * In standard markdown, inline elements (code spans, math, links) cannot
 * cross blank-line paragraph breaks, so the paragraph is the natural
 * maximum scope for exclusion changes.
 */
function paragraphStart(doc: TextSource, pos: number): number {
  let line = doc.lineAt(pos);
  while (line.from > 0) {
    const prev = doc.lineAt(line.from - 1);
    if (prev.from === prev.to || prev.text.trim() === "") break;
    line = prev;
  }
  return line.from;
}

/** Find the end of the paragraph containing `pos`. */
function paragraphEnd(doc: TextSource, pos: number): number {
  let line = doc.lineAt(pos);
  while (line.to < doc.length) {
    const next = doc.lineAt(line.to + 1);
    if (next.from === next.to || next.text.trim() === "") break;
    line = next;
  }
  return line.to;
}

export function expandRangeToParagraphBoundaries(
  doc: TextSource,
  range: StructuralWindow,
): StructuralWindow {
  return {
    from: Math.min(range.from, paragraphStart(doc, range.from)),
    to: Math.max(range.to, paragraphEnd(doc, range.to)),
  };
}

/**
 * Compute the narrative-ref extraction range and its fresh excluded ranges.
 *
 * Expands to the full paragraph containing the dirty window, then walks the
 * Lezer tree for that range to collect current InlineCode/InlineMath/Link
 * exclusions.  Paragraph scope is correct because inline elements cannot
 * cross blank-line paragraph breaks in standard markdown — this ensures
 * that any exclusion change within the paragraph (grow, shrink, appear, or
 * disappear) is caught, even when the edit doesn't overlap the old
 * exclusion range.
 */
export function computeNarrativeExtractionRange(
  doc: TextSource,
  tree: Tree,
  windowFrom: number,
  windowTo: number,
): { range: StructuralWindow; excludedRanges: readonly ExcludedRange[] } {
  const range = expandRangeToParagraphBoundaries(doc, {
    from: windowFrom,
    to: windowTo,
  });

  const excludedRanges: ExcludedRange[] = [];
  const c = tree.cursor();
  scan: for (;;) {
    if (c.from <= range.to && c.to >= range.from) {
      const name = c.name;
      switch (c.name) {
        case NODE.InlineCode:
        case NODE.InlineMath:
        case NODE.DisplayMath:
        case NODE.Link:
          excludedRanges.push({ from: c.from, to: c.to });
          break;
      }
      if (shouldDescendIntoStructuralNode(name) && c.firstChild()) continue;
    }
    for (;;) {
      if (c.nextSibling()) break;
      if (!c.parent()) break scan;
    }
  }

  return { range, excludedRanges };
}

export function collectStructuralWindow(
  doc: TextSource,
  tree: Tree,
  result: StructuralWindowExtraction,
  window?: StructuralWindow,
  options?: StructuralWindowExtractOptions,
): StructuralWindowExtraction {
  const range = normalizeWindow(doc, window);

  const c = tree.cursor();
  scan: for (;;) {
    if (c.from <= range.to && c.to >= range.from) {
      const name = c.name;
      let shouldDescend = shouldDescendIntoStructuralNode(name);

      const headingMatch = ATX_HEADING_RE.exec(name);
      if (headingMatch) {
        collectHeading(doc, c, result, Number(headingMatch[1]));
      } else {
        switch (name) {
          case NODE.FootnoteRef:
            collectFootnoteRef(doc, c, result);
            break;
          case NODE.FootnoteDef:
            collectFootnoteDef(doc, c, result);
            break;
          case NODE.FencedDiv:
            collectFencedDiv(doc, c, result);
            break;
          case NODE.InlineMath:
          case NODE.DisplayMath:
            collectMath(doc, c, result);
            shouldDescend = false;
            break;
          case NODE.InlineCode:
            result.excludedRanges.push({ from: c.from, to: c.to });
            shouldDescend = false;
            break;
          case NODE.Link:
            collectLink(doc, c, result);
            shouldDescend = false;
            break;
        }
      }
      if (shouldDescend && c.firstChild()) continue;
    }
    for (;;) {
      if (c.nextSibling()) break;
      if (!c.parent()) break scan;
    }
  }

  if (options?.includeNarrativeRefs !== false) {
    collectNarrativeRefsInWindow(doc, result.excludedRanges, range, result.narrativeRefs);
  }

  return result;
}

export function collectInlineStructuralWindow(
  doc: TextSource,
  tree: Tree,
  result: StructuralWindowExtraction,
  window?: StructuralWindow,
): StructuralWindowExtraction {
  const range = normalizeWindow(doc, window);

  const c = tree.cursor();
  scan: for (;;) {
    if (c.from <= range.to && c.to >= range.from) {
      const name = c.name;
      let shouldDescend = shouldDescendIntoStructuralNode(name);

      switch (name) {
        case NODE.InlineMath:
        case NODE.DisplayMath:
          collectMath(doc, c, result);
          shouldDescend = false;
          break;
        case NODE.InlineCode:
          result.excludedRanges.push({ from: c.from, to: c.to });
          shouldDescend = false;
          break;
        case NODE.Link:
          collectLink(doc, c, result);
          shouldDescend = false;
          break;
      }

      if (shouldDescend && c.firstChild()) continue;
    }
    for (;;) {
      if (c.nextSibling()) break;
      if (!c.parent()) break scan;
    }
  }

  return result;
}

export function extractStructuralWindow(
  doc: TextSource,
  tree: Tree,
  window?: StructuralWindow,
  options?: StructuralWindowExtractOptions,
): StructuralWindowExtraction {
  return collectStructuralWindow(
    doc,
    tree,
    createStructuralWindowExtraction(),
    window,
    options,
  );
}

export function extractInlineStructuralWindow(
  doc: TextSource,
  tree: Tree,
  window?: StructuralWindow,
): StructuralWindowExtraction {
  return collectInlineStructuralWindow(
    doc,
    tree,
    createStructuralWindowExtraction(),
    window,
  );
}

export function extractFencedDivExpansionWindow(
  doc: TextSource,
  tree: Tree,
  window?: StructuralWindow,
): FencedDivExpansionExtraction {
  const range = normalizeWindow(doc, window);
  const structural = createStructuralWindowExtraction();

  const c = tree.cursor();
  scan: for (;;) {
    if (c.from <= range.to && c.to >= range.from) {
      let shouldDescend = true;
      switch (c.name) {
        case NODE.FencedDiv:
          collectFencedDiv(doc, c, structural);
          break;
        case NODE.InlineMath:
        case NODE.DisplayMath:
          collectMath(doc, c, structural);
          shouldDescend = false;
          break;
      }
      if (shouldDescend && c.firstChild()) continue;
    }
    for (;;) {
      if (c.nextSibling()) break;
      if (!c.parent()) break scan;
    }
  }

  return {
    fencedDivs: structural.fencedDivs,
    mathRegions: structural.mathRegions,
  };
}
