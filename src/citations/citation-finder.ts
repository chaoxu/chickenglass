/**
 * Citation data types and standalone finders.
 *
 * Supports:
 * - [@id] parenthetical citations: "(Author, Year)"
 * - @id narrative citations: "Author (Year)"
 * - [@a; @b] multiple citations: "(Author1, Year1; Author2, Year2)"
 */

import { getDocumentAnalysis } from "../semantics/incremental/cached-document-analysis";
import type { CitationIdLookup } from "./citation-matching";

/**
 * Match for a citation reference found in the document text.
 */
interface CitationMatch {
  /** Start offset in the document. */
  from: number;
  /** End offset in the document. */
  to: number;
  /** Whether this is a parenthetical citation ([@id]) vs narrative (@id). */
  parenthetical: boolean;
  /** The citation ids referenced. */
  ids: string[];
  /** Locator strings parallel to ids (e.g. "chap. 36", "pp. 100-120"). */
  locators: (string | undefined)[];
}

/**
 * Find all citation matches in the document text.
 * Only includes matches where at least one id exists in the bib store.
 *
 * Uses the shared standalone markdown semantics helper so CM6-free callers
 * see the same citation/reference extraction as the editor.
 */
export function findCitations(
  text: string,
  store: CitationIdLookup,
  documentPath?: string,
): CitationMatch[] {
  const analysis = getDocumentAnalysis(text, documentPath);
  return analysis.references
    .filter((ref) => ref.ids.some((id) => store.has(id)))
    .map((ref) => ({
      from: ref.from,
      to: ref.to,
      parenthetical: ref.bracketed,
      ids: [...ref.ids],
      locators: [...ref.locators],
    }));
}
