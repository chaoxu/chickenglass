import type { Tree } from "@lezer/common";
import { extractStructuralWindow } from "./incremental/window-extractor";
import { buildHeadingSlice } from "./incremental/slices/heading-slice";
import {
  buildFootnoteSlice,
  type FootnoteSlice,
} from "./incremental/slices/footnote-slice";
import { buildEquationSlice } from "./incremental/slices/equation-slice";
import { buildMathSlice } from "./incremental/slices/math-slice";
import { deriveIncludeSlice } from "./incremental/slices/include-slice";
import { buildReferenceSlice } from "./incremental/slices/reference-slice";

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

function isFootnoteSlice(value: FootnoteSemantics): value is FootnoteSlice {
  return "numberById" in value && "orderedEntries" in value;
}

// ---------------------------------------------------------------------------
// Public per-category analyzers (thin wrappers for backward compatibility)
// ---------------------------------------------------------------------------

export function analyzeHeadings(doc: TextSource, tree: Tree): HeadingSemantics[] {
  return [...buildHeadingSlice(extractStructuralWindow(doc, tree)).headings];
}

export function analyzeFootnotes(doc: TextSource, tree: Tree): FootnoteSemantics {
  const structural = extractStructuralWindow(doc, tree);
  return buildFootnoteSlice(structural);
}

export function numberFootnotes(
  footnotes: FootnoteSemantics,
): ReadonlyMap<string, number> {
  if (isFootnoteSlice(footnotes)) {
    return footnotes.numberById;
  }

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
  if (isFootnoteSlice(footnotes)) {
    return [...footnotes.orderedEntries];
  }

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
  return [...buildEquationSlice(extractStructuralWindow(doc, tree)).equations];
}

export function analyzeMath(doc: TextSource, tree: Tree): MathSemantics[] {
  return [...buildMathSlice(extractStructuralWindow(doc, tree)).mathRegions];
}

export function analyzeReferences(doc: TextSource, tree: Tree): ReferenceSemantics[] {
  return [...buildReferenceSlice(doc, extractStructuralWindow(doc, tree)).references];
}

// ---------------------------------------------------------------------------
// Canonical full-document analysis (single walk + assembly)
// ---------------------------------------------------------------------------

export function analyzeDocumentSemantics(
  doc: TextSource,
  tree: Tree,
): DocumentSemantics {
  const structural = extractStructuralWindow(doc, tree);

  const headingSlice = buildHeadingSlice(structural);
  const footnotes = buildFootnoteSlice(structural);
  const fencedDivs = structural.fencedDivs;
  const equationSlice = buildEquationSlice(structural);
  const equations = equationSlice.equations;
  const mathRegions = buildMathSlice(structural).mathRegions;
  const referenceSlice = buildReferenceSlice(doc, structural);
  const references = referenceSlice.references;

  const includes = deriveIncludeSlice(doc, fencedDivs);

  return {
    headings: headingSlice.headings,
    headingByFrom: headingSlice.headingByFrom,
    footnotes,
    fencedDivs,
    fencedDivByFrom: new Map(fencedDivs.map((div) => [div.from, div])),
    equations,
    equationById: equationSlice.equationById,
    mathRegions,
    references,
    referenceByFrom: referenceSlice.referenceByFrom,
    includes,
    includeByFrom: new Map(includes.map((inc) => [inc.from, inc])),
  };
}
