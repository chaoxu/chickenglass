import type { Tree } from "@lezer/common";
import {
  extractStructuralWindow,
  type EquationStructure,
  type HeadingStructure,
} from "./incremental/window-extractor";
import { buildMathSlice } from "./incremental/slices/math-slice";
import { NARRATIVE_REFERENCE_RE } from "./reference-parts";

// Equation label extraction now lives in the shared window extractor, which
// still uses readBracedLabelId from src/parser/label-utils.ts.

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

function finalizeHeadings(headings: readonly HeadingStructure[]): HeadingSemantics[] {
  const headingCounters = [0, 0, 0, 0, 0, 0, 0];

  return headings.map((heading) => {
    let number = "";
    if (!heading.unnumbered) {
      headingCounters[heading.level]++;
      for (let i = heading.level + 1; i <= 6; i++) headingCounters[i] = 0;
      const parts: number[] = [];
      for (let i = 1; i <= heading.level; i++) {
        if (headingCounters[i] !== 0) parts.push(headingCounters[i]);
      }
      number = parts.join(".");
    }

    return {
      ...heading,
      number,
    };
  });
}

function buildFootnoteSemantics(
  refs: readonly FootnoteReference[],
  defs: readonly FootnoteDefinition[],
): FootnoteSemantics {
  const footnoteDefs = new Map<string, FootnoteDefinition>();
  const footnoteRefByFrom = new Map<number, FootnoteReference>();
  const footnoteDefByFrom = new Map<number, FootnoteDefinition>();

  for (const ref of refs) {
    footnoteRefByFrom.set(ref.from, ref);
  }

  for (const def of defs) {
    footnoteDefs.set(def.id, def);
    footnoteDefByFrom.set(def.from, def);
  }

  return {
    refs,
    defs: footnoteDefs,
    refByFrom: footnoteRefByFrom,
    defByFrom: footnoteDefByFrom,
  };
}

function finalizeEquations(
  equations: readonly EquationStructure[],
): EquationSemantics[] {
  let equationCounter = 0;
  return equations.map((equation) => ({
    ...equation,
    number: ++equationCounter,
  }));
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

  // Sort excluded ranges by `from` for binary search. The shared structural
  // extractor already emits them in document order, but we sort defensively
  // here to keep the fallback independent from extractor internals.
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
  return finalizeHeadings(extractStructuralWindow(doc, tree).headings);
}

export function analyzeFootnotes(doc: TextSource, tree: Tree): FootnoteSemantics {
  const structural = extractStructuralWindow(doc, tree);
  return buildFootnoteSemantics(structural.footnoteRefs, structural.footnoteDefs);
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
  return extractStructuralWindow(doc, tree).fencedDivs;
}

export function analyzeEquations(doc: TextSource, tree: Tree): EquationSemantics[] {
  return finalizeEquations(extractStructuralWindow(doc, tree).equations);
}

export function analyzeMath(doc: TextSource, tree: Tree): MathSemantics[] {
  return [...buildMathSlice(extractStructuralWindow(doc, tree)).mathRegions];
}

export function analyzeReferences(doc: TextSource, tree: Tree): ReferenceSemantics[] {
  const structural = extractStructuralWindow(doc, tree);
  const refs = [
    ...structural.bracketedRefs,
    ...collectNarrativeReferences(doc, structural.excludedRanges),
  ];
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
  const structural = extractStructuralWindow(doc, tree);

  const headings = finalizeHeadings(structural.headings);
  const footnotes = buildFootnoteSemantics(
    structural.footnoteRefs,
    structural.footnoteDefs,
  );
  const fencedDivs = structural.fencedDivs;
  const equations = finalizeEquations(structural.equations);
  const mathRegions = buildMathSlice(structural).mathRegions;

  const narrativeRefs = collectNarrativeReferences(doc, structural.excludedRanges);
  const references = [...structural.bracketedRefs, ...narrativeRefs];
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
