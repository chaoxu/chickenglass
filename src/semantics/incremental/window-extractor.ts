import type { SyntaxNodeRef, Tree } from "@lezer/common";
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
  const headerMark = node.node.getChild("HeaderMark");
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

  const fences = divNode.getChildren("FencedDivFence");
  if (fences.length > 0) {
    openFenceFrom = fences[0].from;
    openFenceTo = fences[0].to;
  }

  let closeFenceNode = fences.length > 1 ? fences[1] : undefined;
  if (!closeFenceNode) {
    const next = divNode.nextSibling;
    if (next?.type.name === "FencedDivFence") {
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
  const attrNode = divNode.getChild("FencedDivAttributes");
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
  const isDisplay = node.type.name === "DisplayMath";
  const markName = isDisplay ? "DisplayMathMark" : "InlineMathMark";
  const marks = node.node.getChildren(markName);
  const equationLabel = isDisplay ? node.node.getChild("EquationLabel") : null;
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
 * Walk the Lezer tree within a range and collect excluded ranges
 * (InlineCode, InlineMath, Link).  This provides fresh, authoritative
 * exclusion data from the current parse tree — unlike merged excluded
 * ranges which can be stale when a delimiter edit outside the dirty
 * window changes which regions are code/math/link spans.
 */
export function collectExcludedRangesInWindow(
  tree: Tree,
  range: StructuralWindow,
): ExcludedRange[] {
  const result: ExcludedRange[] = [];
  tree.iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      switch (node.type.name) {
        case "InlineCode":
        case "InlineMath":
        case "Link":
          result.push({ from: node.from, to: node.to });
          break;
      }
    },
  });
  return result;
}

export function collectStructuralWindow(
  doc: TextSource,
  tree: Tree,
  result: StructuralWindowExtraction,
  window?: StructuralWindow,
): StructuralWindowExtraction {
  const range = normalizeWindow(doc, window);

  tree.iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const name = node.type.name;

      const headingMatch = ATX_HEADING_RE.exec(name);
      if (headingMatch) {
        collectHeading(doc, node, result, Number(headingMatch[1]));
        return;
      }

      switch (name) {
        case "FootnoteRef":
          collectFootnoteRef(doc, node, result);
          return;
        case "FootnoteDef":
          collectFootnoteDef(doc, node, result);
          return;
        case "FencedDiv":
          collectFencedDiv(doc, node, result);
          return;
        case "InlineMath":
        case "DisplayMath":
          collectMath(doc, node, result);
          return;
        case "InlineCode":
          result.excludedRanges.push({ from: node.from, to: node.to });
          return;
        case "Link":
          collectLink(doc, node, result);
          return;
      }
    },
  });

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
