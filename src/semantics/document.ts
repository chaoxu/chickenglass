import type { Tree } from "@lezer/common";
import { extractDivClass } from "../parser/fenced-div-attrs";
import { readBracedLabelId } from "../parser/label-utils";
import {
  matchBracketedReference,
  NARRATIVE_REFERENCE_RE,
} from "./reference-parts";

export interface TextSourceLine {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface TextSource {
  readonly length: number;
  slice(from: number, to: number): string;
  lineAt(pos: number): TextSourceLine;
}

export function stringTextSource(text: string): TextSource {
  return {
    length: text.length,
    slice(from, to) {
      return text.slice(from, to);
    },
    lineAt(pos) {
      const safePos = Math.max(0, Math.min(pos, text.length));
      const from = Math.max(0, text.lastIndexOf("\n", Math.max(0, safePos - 1)) + 1);
      const nextBreak = text.indexOf("\n", safePos);
      const to = nextBreak === -1 ? text.length : nextBreak;
      return {
        from,
        to,
        text: text.slice(from, to),
      };
    },
  };
}

export interface HeadingSemantics {
  readonly from: number;
  readonly to: number;
  readonly level: number;
  readonly text: string;
  readonly id?: string;
  readonly number: string;
  readonly unnumbered: boolean;
}

export interface FootnoteReference {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

export interface FootnoteDefinition {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly content: string;
  readonly labelFrom: number;
  readonly labelTo: number;
}

export interface FootnoteSemantics {
  readonly refs: readonly FootnoteReference[];
  readonly defs: ReadonlyMap<string, FootnoteDefinition>;
  readonly refByFrom: ReadonlyMap<number, FootnoteReference>;
  readonly defByFrom: ReadonlyMap<number, FootnoteDefinition>;
}

export interface OrderedFootnoteEntry {
  readonly id: string;
  readonly number: number;
  readonly def: FootnoteDefinition;
}

export interface FencedDivSemantics {
  readonly from: number;
  readonly to: number;
  readonly openFenceFrom: number;
  readonly openFenceTo: number;
  readonly attrFrom?: number;
  readonly attrTo?: number;
  readonly titleFrom?: number;
  readonly titleTo?: number;
  readonly closeFenceFrom: number;
  readonly closeFenceTo: number;
  readonly singleLine: boolean;
  readonly isSelfClosing: boolean;
  readonly classes: readonly string[];
  readonly primaryClass?: string;
  readonly id?: string;
  readonly title?: string;
}

export interface EquationSemantics {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly number: number;
  readonly latex: string;
}

export interface ReferenceSemantics {
  readonly from: number;
  readonly to: number;
  readonly bracketed: boolean;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

export interface DocumentAnalysis {
  readonly headings: readonly HeadingSemantics[];
  readonly headingByFrom: ReadonlyMap<number, HeadingSemantics>;
  readonly footnotes: FootnoteSemantics;
  readonly fencedDivs: readonly FencedDivSemantics[];
  readonly fencedDivByFrom: ReadonlyMap<number, FencedDivSemantics>;
  readonly equations: readonly EquationSemantics[];
  readonly equationById: ReadonlyMap<string, EquationSemantics>;
  readonly references: readonly ReferenceSemantics[];
  readonly referenceByFrom: ReadonlyMap<number, ReferenceSemantics>;
}

export type DocumentSemantics = DocumentAnalysis;

export interface TrailingHeadingAttributes {
  readonly index: number;
  readonly raw: string;
  readonly content: string;
}

export function findTrailingHeadingAttributes(
  text: string,
): TrailingHeadingAttributes | null {
  const match = /\s*\{([^}]*)\}\s*$/.exec(text);
  if (!match || match.index === undefined) return null;
  return {
    index: match.index,
    raw: match[0],
    content: match[1],
  };
}

export function hasUnnumberedHeadingAttributes(text: string): boolean {
  const attrs = findTrailingHeadingAttributes(text);
  return attrs !== null && /(?:^|\s)(?:-|\.unnumbered)(?=\s|$)/.test(attrs.content);
}

function extractHeadingId(text: string): string | undefined {
  const attrs = findTrailingHeadingAttributes(text);
  if (!attrs) return undefined;
  const match = /(?:^|\s)#([^\s}]+)/.exec(attrs.content);
  return match?.[1];
}

export function analyzeHeadings(doc: TextSource, tree: Tree): HeadingSemantics[] {
  const headings: HeadingSemantics[] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0];

  tree.iterate({
    enter(node) {
      const match = /^ATXHeading(\d)$/.exec(node.name);
      if (!match) return;

      const level = Number(match[1]);
      const rawText = doc.slice(node.from, node.to);
      const unnumbered = hasUnnumberedHeadingAttributes(rawText);

      let number = "";
      if (!unnumbered) {
        counters[level]++;
        for (let i = level + 1; i <= 6; i++) counters[i] = 0;
        const parts: number[] = [];
        for (let i = 1; i <= level; i++) parts.push(counters[i]);
        number = parts.join(".");
      }

      const headerMark = node.node.getChild("HeaderMark");
      const textFrom = headerMark ? headerMark.to : node.from;
      const rawHeadingText = doc.slice(textFrom, node.to).trim();
      const attrs = findTrailingHeadingAttributes(rawHeadingText);
      const text = attrs
        ? rawHeadingText.slice(0, attrs.index).trim()
        : rawHeadingText;

      headings.push({
        from: node.from,
        to: node.to,
        level,
        text,
        id: extractHeadingId(rawHeadingText),
        number,
        unnumbered,
      });
    },
  });

  return headings;
}

export function analyzeFootnotes(doc: TextSource, tree: Tree): FootnoteSemantics {
  const refs: FootnoteReference[] = [];
  const defs = new Map<string, FootnoteDefinition>();
  const refByFrom = new Map<number, FootnoteReference>();
  const defByFrom = new Map<number, FootnoteDefinition>();

  tree.iterate({
    enter(node) {
      if (node.type.name === "FootnoteRef") {
        const id = doc.slice(node.from + 2, node.to - 1);
        const ref = { id, from: node.from, to: node.to };
        refs.push(ref);
        refByFrom.set(node.from, ref);
        return;
      }

      if (node.type.name !== "FootnoteDef") return;

      const labelNode = node.node.getChild("FootnoteDefLabel");
      if (!labelNode) return;

      const id = doc.slice(labelNode.from + 2, labelNode.to - 2);
      const def: FootnoteDefinition = {
        id,
        from: node.from,
        to: node.to,
        content: doc.slice(labelNode.to, node.to).trim(),
        labelFrom: labelNode.from,
        labelTo: labelNode.to,
      };
      defs.set(id, def);
      defByFrom.set(node.from, def);
    },
  });

  return { refs, defs, refByFrom, defByFrom };
}

export function numberFootnotes(
  footnotes: FootnoteSemantics,
): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  let nextNumber = 1;
  for (const ref of footnotes.refs) {
    if (!numbers.has(ref.id)) {
      numbers.set(ref.id, nextNumber++);
    }
  }
  return numbers;
}

export function orderedFootnoteEntries(
  footnotes: FootnoteSemantics,
): OrderedFootnoteEntry[] {
  const numbers = numberFootnotes(footnotes);
  const seen = new Set<string>();
  const entries: OrderedFootnoteEntry[] = [];

  for (const ref of footnotes.refs) {
    const def = footnotes.defs.get(ref.id);
    if (!def || seen.has(ref.id)) continue;
    seen.add(ref.id);
    entries.push({
      id: ref.id,
      number: numbers.get(ref.id) ?? 0,
      def,
    });
  }

  return entries;
}

export function analyzeFencedDivs(doc: TextSource, tree: Tree): FencedDivSemantics[] {
  const divs: FencedDivSemantics[] = [];

  tree.iterate({
    enter(node) {
      if (node.type.name !== "FencedDiv") return;

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

      divs.push({
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
    },
  });

  return divs;
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

export function analyzeEquations(doc: TextSource, tree: Tree): EquationSemantics[] {
  const equations: EquationSemantics[] = [];
  let counter = 0;

  tree.iterate({
    enter(node) {
      if (node.type.name !== "EquationLabel") return;
      const id = readBracedLabelId(doc.slice(node.from, node.to), 0, node.to - node.from, "eq:");
      if (!id) return;

      const parent = node.node.parent;
      if (!parent || parent.type.name !== "DisplayMath") return;

      counter++;
      equations.push({
        id,
        from: parent.from,
        to: parent.to,
        labelFrom: node.from,
        labelTo: node.to,
        number: counter,
        latex: extractDisplayMathLatex(doc.slice(parent.from, node.from)),
      });
    },
  });

  return equations;
}

export function analyzeReferences(doc: TextSource, tree: Tree): ReferenceSemantics[] {
  const refs: ReferenceSemantics[] = [];
  const linkRanges: { from: number; to: number }[] = [];
  const fullText = doc.slice(0, doc.length);

  tree.iterate({
    enter(node) {
      if (node.name !== "Link") return;

      const raw = doc.slice(node.from, node.to);
      const match = matchBracketedReference(raw);
      if (match) {
        refs.push({
          from: node.from,
          to: node.to,
          bracketed: true,
          ids: [...match.ids],
          locators: [...match.locators],
        });
      }
      linkRanges.push({ from: node.from, to: node.to });
    },
  });

  NARRATIVE_REFERENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NARRATIVE_REFERENCE_RE.exec(fullText)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const insideLink = linkRanges.some((range) => from >= range.from && to <= range.to);
    if (insideLink) continue;

    refs.push({
      from,
      to,
      bracketed: false,
      ids: [match[1]],
      locators: [undefined],
    });
  }

  refs.sort((a, b) => a.from - b.from);
  return refs;
}

export function analyzeDocumentSemantics(
  doc: TextSource,
  tree: Tree,
): DocumentSemantics {
  const headings = analyzeHeadings(doc, tree);
  const footnotes = analyzeFootnotes(doc, tree);
  const fencedDivs = analyzeFencedDivs(doc, tree);
  const equations = analyzeEquations(doc, tree);
  const references = analyzeReferences(doc, tree);

  return {
    headings,
    headingByFrom: new Map(headings.map((heading) => [heading.from, heading])),
    footnotes,
    fencedDivs,
    fencedDivByFrom: new Map(fencedDivs.map((div) => [div.from, div])),
    equations,
    equationById: new Map(equations.map((equation) => [equation.id, equation])),
    references,
    referenceByFrom: new Map(references.map((reference) => [reference.from, reference])),
  };
}
