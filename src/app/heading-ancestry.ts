/**
 * Shared heading extraction and ancestry computation.
 *
 * Used by both the breadcrumb bar and the outline panel to determine
 * which headings "contain" the cursor position.
 */

import { type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/** A single heading entry extracted from the document. */
export interface HeadingEntry {
  /** Heading level (1–6). */
  level: number;
  /** Heading text (without # markers). */
  text: string;
  /** Hierarchical section number (e.g., "1.2.3"). */
  number: string;
  /** Document position of the heading node. */
  pos: number;
}

/**
 * Extract all headings from the editor state.
 *
 * Walks the syntax tree for ATXHeading nodes and builds hierarchical
 * section numbers. Returns entries sorted by document position.
 */
export function extractHeadings(state: EditorState): HeadingEntry[] {
  const entries: HeadingEntry[] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      const m = /^ATXHeading(\d)$/.exec(node.name);
      if (!m) return;

      const level = Number(m[1]);
      counters[level]++;
      for (let i = level + 1; i <= 6; i++) counters[i] = 0;

      const parts: number[] = [];
      for (let i = 1; i <= level; i++) parts.push(counters[i]);

      const lineText = state.doc.lineAt(node.from).text;
      const text = lineText.replace(/^#+\s*/, "");

      entries.push({
        level,
        text,
        number: parts.join("."),
        pos: node.from,
      });
    },
  });

  return entries;
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
