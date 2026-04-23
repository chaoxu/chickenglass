import type { Tree } from "@lezer/common";
import {
  createDocumentAnalysis,
  createDocumentArtifacts,
  type DocumentArtifacts,
} from "./incremental/engine";
import { extractStructuralWindow } from "./incremental/window-extractor";
import { buildHeadingSlice } from "./incremental/slices/heading-slice";
import {
  buildFootnoteSlice,
  type FootnoteSlice,
} from "./incremental/slices/footnote-slice";
import { buildEquationSlice } from "./incremental/slices/equation-slice";
import { buildMathSlice } from "./incremental/slices/math-slice";
import { buildReferenceSlice } from "./incremental/slices/reference-slice";
import {
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
  type TrailingHeadingAttributes,
} from "./heading-attributes";
import type {
  DocumentSemantics,
  EquationSemantics,
  FencedDivSemantics,
  FootnoteSemantics,
  HeadingSemantics,
  MathSemantics,
  OrderedFootnoteEntry,
  ReferenceSemantics,
  TextSource,
} from "./document-model";
export type {
  DocumentAnalysis,
  DocumentSemantics,
  EquationSemantics,
  FencedDivSemantics,
  FootnoteDefinition,
  FootnoteReference,
  FootnoteSemantics,
  HeadingSemantics,
  MathSemantics,
  OrderedFootnoteEntry,
  ReferenceSemantics,
  TextSource,
  TextSourceLine,
} from "./document-model";
export {
  getEquationNumbersCacheKey,
  stringTextSource,
} from "./document-model";

// Equation label extraction now lives in the shared window extractor, which
// still uses readBracedLabelId from src/parser/label-utils.ts.
export type { DocumentArtifacts };
export {
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
  type TrailingHeadingAttributes,
};

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
  return [...buildReferenceSlice(extractStructuralWindow(doc, tree)).references];
}

// ---------------------------------------------------------------------------
// Canonical full-document analysis (single walk + assembly)
// ---------------------------------------------------------------------------

export function analyzeDocumentSemantics(
  doc: TextSource,
  tree: Tree,
): DocumentSemantics {
  return createDocumentAnalysis(doc, tree);
}

export function analyzeDocumentArtifacts(
  doc: TextSource,
  tree: Tree,
): DocumentArtifacts {
  return createDocumentArtifacts(doc, tree);
}
