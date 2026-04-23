import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
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
} from "../document-model";
import {
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
} from "../heading-attributes";
import { matchBracketedReference } from "../reference-parts";

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

export function createStructuralWindowExtraction(): StructuralWindowExtraction {
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

export function collectHeading(
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

export function collectFootnoteRef(
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

export function collectFootnoteDef(
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

interface NodeSpan {
  readonly from: number;
  readonly to: number;
}

interface FencedDivChildNodes {
  readonly openFenceNode?: NodeSpan;
  readonly closeFenceNode?: NodeSpan;
  readonly attrNode?: NodeSpan;
  readonly titleNode?: NodeSpan;
}

function collectFencedDivChildren(divNode: SyntaxNode): FencedDivChildNodes {
  let openFenceNode: NodeSpan | undefined;
  let closeFenceNode: NodeSpan | undefined;
  let attrNode: NodeSpan | undefined;
  let titleNode: NodeSpan | undefined;

  const cursor = divNode.cursor();
  if (!cursor.firstChild()) {
    return {
      openFenceNode,
      closeFenceNode,
      attrNode,
      titleNode,
    };
  }

  do {
    const span = {
      from: cursor.from,
      to: cursor.to,
    };
    switch (cursor.name) {
      case NODE.FencedDivFence:
        if (!openFenceNode) {
          openFenceNode = span;
        } else if (!closeFenceNode) {
          closeFenceNode = span;
        }
        break;
      case NODE.FencedDivAttributes:
        if (!attrNode) {
          attrNode = span;
        }
        break;
      case "FencedDivTitle":
        if (!titleNode) {
          titleNode = span;
        }
        break;
    }
  } while (cursor.nextSibling());

  return {
    openFenceNode,
    closeFenceNode,
    attrNode,
    titleNode,
  };
}

export function collectFencedDiv(
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
  let titleSourceFrom: number | undefined;
  let titleSourceTo: number | undefined;
  let closeFenceFrom = -1;
  let closeFenceTo = -1;

  const {
    openFenceNode,
    closeFenceNode: childCloseFenceNode,
    attrNode,
    titleNode,
  } = collectFencedDivChildren(divNode);
  if (openFenceNode) {
    openFenceFrom = openFenceNode.from;
    openFenceTo = openFenceNode.to;
  }

  let closeFenceNode = childCloseFenceNode;
  if (!closeFenceNode) {
    const next = divNode.nextSibling;
    if (next && isFencedDivFence(next)) {
      closeFenceNode = {
        from: next.from,
        to: next.to,
      };
    }
  }

  let singleLine = false;
  if (
    closeFenceNode
    && closeFenceNode.from >= 0
    && closeFenceNode.from <= doc.length
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
  let keyValueTitleFrom: number | undefined;
  let keyValueTitleTo: number | undefined;
  if (attrNode) {
    const attrs = extractDivClass(doc.slice(attrNode.from, attrNode.to));
    if (attrs) {
      classes = [...attrs.classes];
      primaryClass = attrs.classes[0];
      id = attrs.id;
      keyValueTitle = attrs.keyValues.title;
      const titleRange = attrs.keyValueRanges.title;
      if (titleRange) {
        keyValueTitleFrom = attrNode.from + titleRange.valueFrom;
        keyValueTitleTo = attrNode.from + titleRange.valueTo;
      }
    }
    attrFrom = attrNode.from;
    attrTo = attrNode.to;
    openFenceTo = Math.max(openFenceTo, attrNode.to);
  }

  if (titleNode) {
    title = doc.slice(titleNode.from, titleNode.to).trim();
    titleFrom = titleNode.from;
    titleTo = titleNode.to;
    titleSourceFrom = titleNode.from;
    titleSourceTo = titleNode.to;
    openFenceTo = Math.max(openFenceTo, titleNode.to);
  } else if (keyValueTitle) {
    title = keyValueTitle;
    titleSourceFrom = keyValueTitleFrom;
    titleSourceTo = keyValueTitleTo;
  }

  const isSelfClosing =
    closeFenceFrom >= 0
    && !doc.slice(openFenceFrom, closeFenceTo).includes("\n");

  result.fencedDivs.push({
    from: node.from,
    to: node.to,
    openFenceFrom,
    openFenceTo,
    attrFrom,
    attrTo,
    titleFrom,
    titleTo,
    titleSourceFrom,
    titleSourceTo,
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

export function collectMath(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const isDisplay = isDisplayMath(node);
  const markName = isDisplay ? "DisplayMathMark" : "InlineMathMark";
  let markCount = 0;
  let firstMarkTo: number | undefined;
  let lastMarkFrom: number | undefined;
  let lastMarkTo: number | undefined;
  let equationLabelFrom: number | undefined;
  let equationLabelTo: number | undefined;
  const cursor = node.node.cursor();

  if (cursor.firstChild()) {
    do {
      if (cursor.name === markName) {
        markCount++;
        if (firstMarkTo === undefined) {
          firstMarkTo = cursor.to;
        }
        lastMarkFrom = cursor.from;
        lastMarkTo = cursor.to;
      } else if (isDisplay && cursor.name === NODE.EquationLabel) {
        equationLabelFrom = cursor.from;
        equationLabelTo = cursor.to;
      }
    } while (cursor.nextSibling());
  }

  const contentFrom = firstMarkTo ?? node.from;
  const contentTo = markCount >= 2 && lastMarkFrom !== undefined
    ? lastMarkFrom
    : node.to;
  const labelFrom =
    equationLabelFrom !== undefined && markCount >= 2
      ? lastMarkTo
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

  if (
    equationLabelFrom !== undefined
    && equationLabelTo !== undefined
  ) {
    const labelId = readBracedLabelId(
      doc.slice(equationLabelFrom, equationLabelTo),
      0,
      equationLabelTo - equationLabelFrom,
      "eq:",
    );
    if (labelId) {
      result.equations.push({
        id: labelId,
        from: node.from,
        to: node.to,
        labelFrom: equationLabelFrom,
        labelTo: equationLabelTo,
        latex: extractDisplayMathLatex(doc.slice(node.from, equationLabelFrom)),
      });
    }
  }

  result.excludedRanges.push({ from: node.from, to: node.to });
}

export function collectLink(
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
