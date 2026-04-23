/**
 * Re-export from canonical location `src/semantics/heading-ancestry.ts`.
 *
 * Kept for backward compatibility — existing app/ imports continue to work.
 * New code should import from `../semantics/heading-ancestry` directly.
 */
export {
  type HeadingEntry,
  extractHeadings,
  headingEntriesFromAnalysis,
  headingAncestryAt,
  activeHeadingIndex,
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
} from "../semantics/heading-ancestry";
