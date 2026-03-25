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

export interface MathSemantics {
  readonly from: number;
  readonly to: number;
  readonly isDisplay: boolean;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly labelFrom?: number;
  readonly latex: string;
}

export interface ReferenceSemantics {
  readonly from: number;
  readonly to: number;
  readonly bracketed: boolean;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

export interface IncludeSemantics {
  readonly from: number;
  readonly to: number;
  readonly path: string;
}

export interface DocumentAnalysis {
  readonly headings: readonly HeadingSemantics[];
  readonly headingByFrom: ReadonlyMap<number, HeadingSemantics>;
  readonly footnotes: FootnoteSemantics;
  readonly fencedDivs: readonly FencedDivSemantics[];
  readonly fencedDivByFrom: ReadonlyMap<number, FencedDivSemantics>;
  readonly equations: readonly EquationSemantics[];
  readonly equationById: ReadonlyMap<string, EquationSemantics>;
  readonly mathRegions: readonly MathSemantics[];
  readonly references: readonly ReferenceSemantics[];
  readonly referenceByFrom: ReadonlyMap<number, ReferenceSemantics>;
  readonly includes: readonly IncludeSemantics[];
  readonly includeByFrom: ReadonlyMap<number, IncludeSemantics>;
}

export type DocumentSemantics = DocumentAnalysis;

export interface TrailingHeadingAttributes {
  readonly index: number;
  readonly raw: string;
  readonly content: string;
}

/**
 * Pandoc attribute token: #id, .class, key=value, key="value", or the
 * dash/unnumbered shorthand flags ({-}, {.unnumbered}).
 *
 * The regex matches sequences of these tokens separated by whitespace.
 * If the brace content does NOT consist entirely of such tokens, the braces
 * are treated as literal text (e.g. `{1,2,3}` in a math heading).
 */
const PANDOC_ATTR_TOKEN_RE =
  /^(?:#[\w:.:-]+|\.[\w-]+|\w[\w-]*="[^"]*"|\w[\w-]*=\S+|-|\.unnumbered)$/;

function isPandocAttributeContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return false;
  return trimmed.split(/\s+/).every((tok) => PANDOC_ATTR_TOKEN_RE.test(tok));
}

export function findTrailingHeadingAttributes(
  text: string,
): TrailingHeadingAttributes | null {
  const match = /\s*\{([^}]*)\}\s*$/.exec(text);
  if (!match || match.index === undefined) return null;
  if (!isPandocAttributeContent(match[1])) return null;
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

const ATX_HEADING_RE = /^ATXHeading(\d)$/;

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

// ---------------------------------------------------------------------------
// Unified single-pass tree walk
// ---------------------------------------------------------------------------

interface UnifiedWalkResult {
  headings: HeadingSemantics[];
  footnoteRefs: FootnoteReference[];
  footnoteDefs: Map<string, FootnoteDefinition>;
  footnoteRefByFrom: Map<number, FootnoteReference>;
  footnoteDefByFrom: Map<number, FootnoteDefinition>;
  fencedDivs: FencedDivSemantics[];
  equations: EquationSemantics[];
  mathRegions: MathSemantics[];
  bracketedRefs: ReferenceSemantics[];
  linkRanges: { from: number; to: number }[];
  codeMathRanges: { from: number; to: number }[];
}

/**
 * Single tree.iterate() pass that collects headings, footnotes, fenced divs,
 * equations, and link/reference data. All node-type dispatch happens here so
 * the tree is walked exactly once.
 */
function unifiedTreeWalk(doc: TextSource, tree: Tree): UnifiedWalkResult {
  const headings: HeadingSemantics[] = [];
  const headingCounters = [0, 0, 0, 0, 0, 0, 0];

  const footnoteRefs: FootnoteReference[] = [];
  const footnoteDefs = new Map<string, FootnoteDefinition>();
  const footnoteRefByFrom = new Map<number, FootnoteReference>();
  const footnoteDefByFrom = new Map<number, FootnoteDefinition>();

  const fencedDivs: FencedDivSemantics[] = [];

  const equations: EquationSemantics[] = [];
  let equationCounter = 0;
  const mathRegions: MathSemantics[] = [];

  const bracketedRefs: ReferenceSemantics[] = [];
  const linkRanges: { from: number; to: number }[] = [];
  const codeMathRanges: { from: number; to: number }[] = [];

  tree.iterate({
    enter(node) {
      const name = node.type.name;

      // --- Headings (ATXHeading1 … ATXHeading6) ---
      const headingMatch = ATX_HEADING_RE.exec(name);
      if (headingMatch) {
        const level = Number(headingMatch[1]);
        const rawText = doc.slice(node.from, node.to);
        const unnumbered = hasUnnumberedHeadingAttributes(rawText);

        let number = "";
        if (!unnumbered) {
          headingCounters[level]++;
          for (let i = level + 1; i <= 6; i++) headingCounters[i] = 0;
          // Skip intermediate levels with counter=0 (e.g. `# A` then `### C` → "1.1" not "1.0.1")
          const parts: number[] = [];
          for (let i = 1; i <= level; i++) {
            if (headingCounters[i] !== 0) parts.push(headingCounters[i]);
          }
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
        return;
      }

      // --- Footnote references ---
      if (name === "FootnoteRef") {
        const id = doc.slice(node.from + 2, node.to - 1);
        const ref = { id, from: node.from, to: node.to };
        footnoteRefs.push(ref);
        footnoteRefByFrom.set(node.from, ref);
        return;
      }

      // --- Footnote definitions ---
      if (name === "FootnoteDef") {
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
        footnoteDefs.set(id, def);
        footnoteDefByFrom.set(node.from, def);
        return;
      }

      // --- Fenced divs ---
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

        fencedDivs.push({
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

      // --- Math spans (shared render metadata) ---
      if (name === "InlineMath" || name === "DisplayMath") {
        const isDisplay = name === "DisplayMath";
        const markName = isDisplay ? "DisplayMathMark" : "InlineMathMark";
        const marks = node.node.getChildren(markName);
        const contentFrom = marks.length >= 1 ? marks[0].to : node.from;
        const contentTo = marks.length >= 2 ? marks[marks.length - 1].from : node.to;
        const labelFrom = isDisplay && node.node.getChild("EquationLabel") && marks.length >= 2
          ? marks[marks.length - 1].to
          : undefined;
        const latex = contentFrom <= contentTo
          ? doc.slice(contentFrom, contentTo)
          : "";

        mathRegions.push({
          from: node.from,
          to: node.to,
          isDisplay,
          contentFrom,
          contentTo,
          labelFrom,
          latex,
        });
      }

      // --- Equation labels ---
      if (name === "EquationLabel") {
        const labelId = readBracedLabelId(doc.slice(node.from, node.to), 0, node.to - node.from, "eq:");
        if (!labelId) return;

        const parent = node.node.parent;
        if (!parent || parent.type.name !== "DisplayMath") return;

        equationCounter++;
        equations.push({
          id: labelId,
          from: parent.from,
          to: parent.to,
          labelFrom: node.from,
          labelTo: node.to,
          number: equationCounter,
          latex: extractDisplayMathLatex(doc.slice(parent.from, node.from)),
        });
        return;
      }

      // --- Inline code / inline math (exclude from narrative ref scan) ---
      if (name === "InlineCode" || name === "InlineMath") {
        codeMathRanges.push({ from: node.from, to: node.to });
        return;
      }

      // --- Links (for bracketed references) ---
      if (name === "Link") {
        const raw = doc.slice(node.from, node.to);
        const refMatch = matchBracketedReference(raw);
        if (refMatch) {
          bracketedRefs.push({
            from: node.from,
            to: node.to,
            bracketed: true,
            ids: [...refMatch.ids],
            locators: [...refMatch.locators],
          });
        }
        linkRanges.push({ from: node.from, to: node.to });
      }
    },
  });

  return {
    headings,
    footnoteRefs,
    footnoteDefs,
    footnoteRefByFrom,
    footnoteDefByFrom,
    fencedDivs,
    equations,
    mathRegions,
    bracketedRefs,
    linkRanges,
    codeMathRanges,
  };
}

/**
 * Binary search for the rightmost excluded range whose `from` <= target.
 * Returns the index, or -1 if no such range exists.
 */
function upperBoundExcluded(
  ranges: readonly { from: number; to: number }[],
  target: number,
): number {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid].from <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Check whether position [from, to] falls inside any excluded range,
 * using binary search on the sorted array. O(log n) per check.
 */
function isInsideExcludedRange(
  sorted: readonly { from: number; to: number }[],
  from: number,
  to: number,
): boolean {
  // Find the last range that starts at or before `from`
  const idx = upperBoundExcluded(sorted, from);
  if (idx < 0) return false;
  return from >= sorted[idx].from && to <= sorted[idx].to;
}

/**
 * Post-process narrative (non-bracketed) references via regex scan,
 * excluding ranges inside Link, InlineCode, or InlineMath nodes
 * collected during the tree walk.
 *
 * Uses binary search on sorted excludedRanges for O(matches * log(excludedRanges))
 * instead of O(matches * excludedRanges).
 */
function collectNarrativeReferences(
  doc: TextSource,
  excludedRanges: readonly { from: number; to: number }[],
): ReferenceSemantics[] {
  const refs: ReferenceSemantics[] = [];
  const fullText = doc.slice(0, doc.length);

  // Sort excluded ranges by `from` for binary search. The tree walk
  // produces them in document order, but the caller merges two arrays
  // (linkRanges + codeMathRanges), so we sort once here.
  const sorted = excludedRanges.slice().sort((a, b) => a.from - b.from);

  NARRATIVE_REFERENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NARRATIVE_REFERENCE_RE.exec(fullText)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (isInsideExcludedRange(sorted, from, to)) continue;

    refs.push({
      from,
      to,
      bracketed: false,
      ids: [match[1]],
      locators: [undefined],
    });
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Public per-category analyzers (thin wrappers for backward compatibility)
// ---------------------------------------------------------------------------

export function analyzeHeadings(doc: TextSource, tree: Tree): HeadingSemantics[] {
  return unifiedTreeWalk(doc, tree).headings;
}

export function analyzeFootnotes(doc: TextSource, tree: Tree): FootnoteSemantics {
  const w = unifiedTreeWalk(doc, tree);
  return {
    refs: w.footnoteRefs,
    defs: w.footnoteDefs,
    refByFrom: w.footnoteRefByFrom,
    defByFrom: w.footnoteDefByFrom,
  };
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
  return unifiedTreeWalk(doc, tree).fencedDivs;
}

export function analyzeEquations(doc: TextSource, tree: Tree): EquationSemantics[] {
  return unifiedTreeWalk(doc, tree).equations;
}

export function analyzeMath(doc: TextSource, tree: Tree): MathSemantics[] {
  return unifiedTreeWalk(doc, tree).mathRegions;
}

export function analyzeReferences(doc: TextSource, tree: Tree): ReferenceSemantics[] {
  const w = unifiedTreeWalk(doc, tree);
  const excludedRanges = [...w.linkRanges, ...w.codeMathRanges];
  const refs = [...w.bracketedRefs, ...collectNarrativeReferences(doc, excludedRanges)];
  refs.sort((a, b) => a.from - b.from);
  return refs;
}

// ---------------------------------------------------------------------------
// Include extraction from fenced divs
// ---------------------------------------------------------------------------

/**
 * Derive include entries from fenced divs with class "include".
 *
 * For single-line form (`::: {.include} chapter1.md :::`), the path is in the
 * title field. For multi-line form, the path is the trimmed content between
 * the opening fence line and the closing fence line.
 */
function extractIncludesFromDivs(
  doc: TextSource,
  divs: readonly FencedDivSemantics[],
): IncludeSemantics[] {
  const includes: IncludeSemantics[] = [];
  for (const div of divs) {
    if (div.primaryClass !== "include") continue;

    // Single-line: `::: {.include} chapter1.md :::`  — path lives in the title
    if (div.title) {
      const path = div.title.trim();
      if (path.length > 0) {
        includes.push({ from: div.from, to: div.to, path });
        continue;
      }
    }

    // Multi-line: path is the body between the opening and closing fences
    if (div.closeFenceFrom >= 0 && div.openFenceTo < div.closeFenceFrom) {
      const path = doc.slice(div.openFenceTo, div.closeFenceFrom).trim();
      if (path.length > 0) {
        includes.push({ from: div.from, to: div.to, path });
      }
    }
  }
  return includes;
}

// ---------------------------------------------------------------------------
// Canonical full-document analysis (single walk + assembly)
// ---------------------------------------------------------------------------

export function analyzeDocumentSemantics(
  doc: TextSource,
  tree: Tree,
): DocumentSemantics {
  const w = unifiedTreeWalk(doc, tree);

  const headings = w.headings;
  const footnotes: FootnoteSemantics = {
    refs: w.footnoteRefs,
    defs: w.footnoteDefs,
    refByFrom: w.footnoteRefByFrom,
    defByFrom: w.footnoteDefByFrom,
  };
  const fencedDivs = w.fencedDivs;
  const equations = w.equations;
  const mathRegions = w.mathRegions;

  const excludedRanges = [...w.linkRanges, ...w.codeMathRanges];
  const narrativeRefs = collectNarrativeReferences(doc, excludedRanges);
  const references = [...w.bracketedRefs, ...narrativeRefs];
  references.sort((a, b) => a.from - b.from);

  const includes = extractIncludesFromDivs(doc, fencedDivs);

  return {
    headings,
    headingByFrom: new Map(headings.map((heading) => [heading.from, heading])),
    footnotes,
    fencedDivs,
    fencedDivByFrom: new Map(fencedDivs.map((div) => [div.from, div])),
    equations,
    equationById: new Map(equations.map((equation) => [equation.id, equation])),
    mathRegions,
    references,
    referenceByFrom: new Map(references.map((reference) => [reference.from, reference])),
    includes,
    includeByFrom: new Map(includes.map((inc) => [inc.from, inc])),
  };
}
