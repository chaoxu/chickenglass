import type { SyntaxNodeRef, Tree } from "@lezer/common";
import { NODE } from "../../constants/node-types";
import {
  isDisplayMath,
  isFencedDivFence,
} from "../../lib/syntax-tree-helpers";
import { extractDivClass } from "../../parser/fenced-div-attrs";
import { readBracedLabelId } from "../../parser/label-utils";
import type {
  EquationSemantics,
  FencedDivSemantics,
  FootnoteDefinition,
  FootnoteReference,
  HeadingSemantics,
  MathSemantics,
  ReferenceSemantics,
  TextSource,
} from "../document";
import {
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
} from "../document";
import {
  matchBracketedReference,
  NARRATIVE_REFERENCE_RE,
} from "../reference-parts";

export interface StructuralWindow {
  readonly from: number;
  readonly to: number;
}

export type HeadingStructure = Omit<HeadingSemantics, "number">;
export type EquationStructure = Omit<EquationSemantics, "number">;

export interface ExcludedRange {
  readonly from: number;
  readonly to: number;
}

export interface StructuralWindowExtraction {
  readonly headings: HeadingStructure[];
  readonly footnoteRefs: FootnoteReference[];
  readonly footnoteDefs: FootnoteDefinition[];
  readonly fencedDivs: FencedDivSemantics[];
  readonly equations: EquationStructure[];
  readonly mathRegions: MathSemantics[];
  readonly bracketedRefs: ReferenceSemantics[];
  readonly narrativeRefs: ReferenceSemantics[];
  readonly excludedRanges: ExcludedRange[];
}

const ATX_HEADING_RE = /^ATXHeading(\d)$/;

function createStructuralWindowExtraction(): StructuralWindowExtraction {
  return {
    headings: [],
    footnoteRefs: [],
    footnoteDefs: [],
    fencedDivs: [],
    equations: [],
    mathRegions: [],
    bracketedRefs: [],
    narrativeRefs: [],
    excludedRanges: [],
  };
}

function normalizeWindow(
  doc: TextSource,
  window?: StructuralWindow,
): StructuralWindow {
  const from = Math.max(0, Math.min(window?.from ?? 0, doc.length));
  const to = Math.max(from, Math.min(window?.to ?? doc.length, doc.length));
  return { from, to };
}

function extractHeadingId(text: string): string | undefined {
  const attrs = findTrailingHeadingAttributes(text);
  if (!attrs) return undefined;
  const match = /(?:^|\s)#([^\s}]+)/.exec(attrs.content);
  return match?.[1];
}

function extractDisplayMathLatex(raw: string): string {
  const text = raw.trim();
  if (text.startsWith("$$") && text.endsWith("$$")) {
    return text.slice(2, -2).trim();
  }
  if (text.startsWith("\\[") && text.endsWith("\\]")) {
    return text.slice(2, -2).trim();
  }
  return text;
}

function collectHeading(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
  level: number,
): void {
  const rawText = doc.slice(node.from, node.to);
  const headerMark = node.node.getChild(NODE.HeaderMark);
  const textFrom = headerMark ? headerMark.to : node.from;
  const rawHeadingText = doc.slice(textFrom, node.to).trim();
  const attrs = findTrailingHeadingAttributes(rawHeadingText);
  const text = attrs
    ? rawHeadingText.slice(0, attrs.index).trim()
    : rawHeadingText;

  result.headings.push({
    from: node.from,
    to: node.to,
    level,
    text,
    id: extractHeadingId(rawHeadingText),
    unnumbered: hasUnnumberedHeadingAttributes(rawText),
  });
}

function collectFootnoteRef(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  result.footnoteRefs.push({
    id: doc.slice(node.from + 2, node.to - 1),
    from: node.from,
    to: node.to,
  });
}

function collectFootnoteDef(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const labelNode = node.node.getChild("FootnoteDefLabel");
  if (!labelNode) return;

  result.footnoteDefs.push({
    id: doc.slice(labelNode.from + 2, labelNode.to - 2),
    from: node.from,
    to: node.to,
    content: doc.slice(labelNode.to, node.to).trim(),
    labelFrom: labelNode.from,
    labelTo: labelNode.to,
  });
}

function collectFencedDiv(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const divNode = node.node;
  let classes: readonly string[] = [];
  let primaryClass: string | undefined;
  let id: string | undefined;
  let title: string | undefined;
  let openFenceFrom = node.from;
  let openFenceTo = node.from;
  let attrFrom: number | undefined;
  let attrTo: number | undefined;
  let titleFrom: number | undefined;
  let titleTo: number | undefined;
  let closeFenceFrom = -1;
  let closeFenceTo = -1;

  const fences = divNode.getChildren(NODE.FencedDivFence);
  if (fences.length > 0) {
    openFenceFrom = fences[0].from;
    openFenceTo = fences[0].to;
  }

  let closeFenceNode = fences.length > 1 ? fences[1] : undefined;
  if (!closeFenceNode) {
    const next = divNode.nextSibling;
    if (isFencedDivFence(next)) {
      closeFenceNode = next;
    }
  }

  let singleLine = false;
  if (
    closeFenceNode &&
    closeFenceNode.from >= 0 &&
    closeFenceNode.from <= doc.length
  ) {
    const closePos = closeFenceNode.from;
    const openLine = doc.lineAt(openFenceFrom);
    const closeLine = doc.lineAt(closePos);
    singleLine = openLine.from === closeLine.from;
    if (singleLine) {
      closeFenceFrom = closePos;
      closeFenceTo = closeFenceNode.to;
    } else {
      closeFenceFrom = closeLine.from;
      closeFenceTo = closeLine.to;
    }
  }

  let keyValueTitle: string | undefined;
  const attrNode = divNode.getChild(NODE.FencedDivAttributes);
  if (attrNode) {
    const attrs = extractDivClass(doc.slice(attrNode.from, attrNode.to));
    if (attrs) {
      classes = [...attrs.classes];
      primaryClass = attrs.classes[0];
      id = attrs.id;
      keyValueTitle = attrs.keyValues.title;
    }
    attrFrom = attrNode.from;
    attrTo = attrNode.to;
    openFenceTo = Math.max(openFenceTo, attrNode.to);
  }

  const titleNode = divNode.getChild("FencedDivTitle");
  if (titleNode) {
    title = doc.slice(titleNode.from, titleNode.to).trim();
    titleFrom = titleNode.from;
    titleTo = titleNode.to;
    openFenceTo = Math.max(openFenceTo, titleNode.to);
  } else if (keyValueTitle) {
    title = keyValueTitle;
  }

  const isSelfClosing =
    closeFenceFrom >= 0 &&
    !doc.slice(openFenceFrom, closeFenceTo).includes("\n");

  result.fencedDivs.push({
    from: node.from,
    to: node.to,
    openFenceFrom,
    openFenceTo,
    attrFrom,
    attrTo,
    titleFrom,
    titleTo,
    closeFenceFrom,
    closeFenceTo,
    singleLine,
    isSelfClosing,
    classes,
    primaryClass,
    id,
    title,
  });
}

function collectMath(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const isDisplay = isDisplayMath(node);
  const markName = isDisplay ? "DisplayMathMark" : "InlineMathMark";
  const marks = node.node.getChildren(markName);
  const equationLabel = isDisplay ? node.node.getChild(NODE.EquationLabel) : null;
  const contentFrom = marks.length >= 1 ? marks[0].to : node.from;
  const contentTo = marks.length >= 2 ? marks[marks.length - 1].from : node.to;
  const labelFrom =
    equationLabel && marks.length >= 2
      ? marks[marks.length - 1].to
      : undefined;
  const latex = contentFrom <= contentTo
    ? doc.slice(contentFrom, contentTo)
    : "";

  result.mathRegions.push({
    from: node.from,
    to: node.to,
    isDisplay,
    contentFrom,
    contentTo,
    labelFrom,
    latex,
  });

  if (equationLabel) {
    const labelId = readBracedLabelId(
      doc.slice(equationLabel.from, equationLabel.to),
      0,
      equationLabel.to - equationLabel.from,
      "eq:",
    );
    if (labelId) {
      result.equations.push({
        id: labelId,
        from: node.from,
        to: node.to,
        labelFrom: equationLabel.from,
        labelTo: equationLabel.to,
        latex: extractDisplayMathLatex(doc.slice(node.from, equationLabel.from)),
      });
    }
  }

  if (!isDisplay) {
    result.excludedRanges.push({ from: node.from, to: node.to });
  }
}

function collectLink(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const raw = doc.slice(node.from, node.to);
  const refMatch = matchBracketedReference(raw);
  if (refMatch) {
    result.bracketedRefs.push({
      from: node.from,
      to: node.to,
      bracketed: true,
      ids: [...refMatch.ids],
      locators: [...refMatch.locators],
    });
  }
  result.excludedRanges.push({ from: node.from, to: node.to });
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
        case "InlineCode":
        case "InlineMath":
        case "Link":
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
