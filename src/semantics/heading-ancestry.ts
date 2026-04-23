/**
 * Shared heading extraction and ancestry computation.
 *
 * Used by both the breadcrumb bar and the outline panel to determine
 * which headings "contain" the cursor position.
 */

import { type EditorState } from "@codemirror/state";
import {
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
} from "./document";
import type { DocumentAnalysis } from "./document";
import { documentSemanticsField } from "../state/document-analysis";

/** A single heading entry extracted from the document. */
export interface HeadingEntry {
  /** Heading level (1-6). */
  level: number;
  /** Heading text (without # markers or attribute blocks). */
  text: string;
  /** Hierarchical section number (e.g., "1.2.3"), or "" for unnumbered headings. */
  number: string;
  /** Document position of the heading node. */
  pos: number;
}

/**
 * Regex matching Pandoc unnumbered heading attributes.
 * Matches `{-}`, `{.unnumbered}`, or attribute blocks containing either
 * (e.g. `{- .someclass}`, `{.unnumbered #id}`).
 */
export { findTrailingHeadingAttributes, hasUnnumberedHeadingAttributes };

export function headingEntriesFromAnalysis(
  analysis: Pick<DocumentAnalysis, "headings">,
): HeadingEntry[] {
  return analysis.headings.map((heading) => ({
    level: heading.level,
    text: heading.text,
    number: heading.number,
    pos: heading.from,
  }));
}

/**
 * Extract all headings from the editor state.
 *
 * Walks the syntax tree for ATXHeading nodes and builds hierarchical
 * section numbers. Headings with Pandoc unnumbered attributes ({-} or
 * {.unnumbered}) are included but without a section number.
 * Returns entries sorted by document position.
 */
export function extractHeadings(state: EditorState): HeadingEntry[] {
  return headingEntriesFromAnalysis(state.field(documentSemanticsField));
}

/**
 * Find the heading ancestry at a given cursor position.
 *
 * Returns the chain of headings that "contain" the cursor, from
 * outermost (lowest level number, e.g. h1) to innermost. A heading
 * "contains" the cursor if it is the most recent heading at that
 * level before the cursor position.
 *
 * Example: given headings `# A`, `## B`, `## C`, `### D` and cursor
 * inside D's content, returns [A, C, D].
 *
 * Algorithm:
 * 1. Binary-search the last heading whose position is ≤ `cursorPos`.
 * 2. Walk backwards from that heading, collecting headings with strictly
 *    decreasing level numbers into `ancestry`. The `Infinity` sentinel
 *    initialises `currentLevel` so that the innermost heading (any level)
 *    is always accepted on the first iteration.
 * 3. Stop early when `currentLevel` reaches 1 — no ancestor can have a
 *    lower level number, so further traversal is unnecessary.
 * 4. `ancestry` is built in reverse order via `unshift`, so the result is
 *    sorted outermost-first (h1 → h2 → … → deepest enclosing heading).
 *
 * Complexity: O(log n + depth), without allocating a filtered heading array.
 */
export function headingAncestryAt(
  headings: ReadonlyArray<HeadingEntry>,
  cursorPos: number,
): HeadingEntry[] {
  const activeIndex = activeHeadingIndex(headings, cursorPos);
  if (activeIndex < 0) return [];

  const ancestry: HeadingEntry[] = [];
  let currentLevel = Infinity;

  for (let i = activeIndex; i >= 0; i--) {
    const h = headings[i];
    if (h.level < currentLevel) {
      ancestry.unshift(h);
      currentLevel = h.level;
      if (currentLevel === 1) break;
    }
  }

  return ancestry;
}

/**
 * Find the index of the active (innermost) heading at a cursor position.
 *
 * Returns the index into the headings array of the last heading whose
 * position is at or before the cursor, or -1 if the cursor is before
 * all headings.
 */
export function activeHeadingIndex(
  headings: ReadonlyArray<HeadingEntry>,
  cursorPos: number,
): number {
  let low = 0;
  let high = headings.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (headings[mid].pos <= cursorPos) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}
