import type { Tree } from "@lezer/common";
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
        const level = Number(headingMatch[1]);
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
        return;
      }

      if (name === "FootnoteRef") {
        result.footnoteRefs.push({
          id: doc.slice(node.from + 2, node.to - 1),
          from: node.from,
          to: node.to,
        });
        return;
      }

      if (name === "FootnoteDef") {
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
        return;
      }

      if (name === "FencedDiv") {
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
        return;
      }

      if (name === "InlineMath" || name === "DisplayMath") {
        const isDisplay = name === "DisplayMath";
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
      }

      if (name === "InlineCode" || name === "InlineMath") {
        result.excludedRanges.push({ from: node.from, to: node.to });
        return;
      }

      if (name === "Link") {
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
    },
  });

  return result;
}

export function extractStructuralWindow(
  doc: TextSource,
  tree: Tree,
  window?: StructuralWindow,
): StructuralWindowExtraction {
  return collectStructuralWindow(doc, tree, createStructuralWindowExtraction(), window);
}
