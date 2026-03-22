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
} from "../semantics/document";
import { documentSemanticsField } from "../semantics/codemirror-source";

/** A single heading entry extracted from the document. */
export interface HeadingEntry {
  /** Heading level (1–6). */
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

/**
 * Extract all headings from the editor state.
 *
 * Walks the syntax tree for ATXHeading nodes and builds hierarchical
 * section numbers. Headings with Pandoc unnumbered attributes ({-} or
 * {.unnumbered}) are included but without a section number.
 * Returns entries sorted by document position.
 */
export function extractHeadings(state: EditorState): HeadingEntry[] {
  return state.field(documentSemanticsField).headings.map((heading) => ({
    level: heading.level,
    text: heading.text,
    number: heading.number,
    pos: heading.from,
  }));
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
 */
export function headingAncestryAt(
  headings: ReadonlyArray<HeadingEntry>,
  cursorPos: number,
): HeadingEntry[] {
  // Collect headings at or before cursor
  const before = headings.filter((h) => h.pos <= cursorPos);
  if (before.length === 0) return [];

  // Walk backwards: collect each heading with a strictly decreasing level
  const ancestry: HeadingEntry[] = [];
  let currentLevel = Infinity;

  for (let i = before.length - 1; i >= 0; i--) {
    const h = before[i];
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
  let active = -1;
  for (let i = headings.length - 1; i >= 0; i--) {
    if (headings[i].pos <= cursorPos) {
      active = i;
      break;
    }
  }
  return active;
}
