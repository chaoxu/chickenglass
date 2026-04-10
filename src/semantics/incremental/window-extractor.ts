import type { Tree } from "@lezer/common";
import { NODE } from "../../constants/node-types";
import type { ReferenceSemantics, TextSource } from "../document";
import { NARRATIVE_REFERENCE_RE } from "../reference-parts";
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

const ATX_HEADING_RE = /^ATXHeading(\d)$/;

function normalizeWindow(
  doc: TextSource,
  window?: StructuralWindow,
): StructuralWindow {
  const from = Math.max(0, Math.min(window?.from ?? 0, doc.length));
  const to = Math.max(from, Math.min(window?.to ?? doc.length, doc.length));
  return { from, to };
}

/**
 * Collect narrative `@id` references within a window by running
 * {@link NARRATIVE_REFERENCE_RE} on the window text and filtering out
 * matches that fall inside any excluded range (code, math, links).
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

  NARRATIVE_REFERENCE_RE.lastIndex = prefixLen;
  let match: RegExpExecArray | null;
  let exIdx = 0;
  while ((match = NARRATIVE_REFERENCE_RE.exec(text)) !== null) {
    const from = range.from - prefixLen + match.index;
    const to = from + match[0].length;

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
      ids: [match[1]],
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
      switch (c.name) {
        case NODE.InlineCode:
        case NODE.InlineMath:
        case NODE.Link:
          excludedRanges.push({ from: c.from, to: c.to });
          break;
      }
      if (c.firstChild()) continue;
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
): StructuralWindowExtraction {
  const range = normalizeWindow(doc, window);

  const c = tree.cursor();
  scan: for (;;) {
    if (c.from <= range.to && c.to >= range.from) {
      const name = c.name;

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
            break;
          case NODE.InlineCode:
            result.excludedRanges.push({ from: c.from, to: c.to });
            break;
          case NODE.Link:
            collectLink(doc, c, result);
            break;
        }
      }
      if (c.firstChild()) continue;
    }
    for (;;) {
      if (c.nextSibling()) break;
      if (!c.parent()) break scan;
    }
  }

  collectNarrativeRefsInWindow(doc, result.excludedRanges, range, result.narrativeRefs);

  return result;
}

export function extractStructuralWindow(
  doc: TextSource,
  tree: Tree,
  window?: StructuralWindow,
): StructuralWindowExtraction {
  return collectStructuralWindow(doc, tree, createStructuralWindowExtraction(), window);
}
