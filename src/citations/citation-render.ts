/**
 * Citation data types, state fields, widget classes, and standalone finders.
 *
 * The ViewPlugin that rendered citations has been merged into the unified
 * `referenceRenderPlugin` in `../render/reference-render.ts`. This module
 * still exports everything needed by bibliography, HTML export, hover-preview,
 * CSL processor, and the unified plugin itself.
 *
 * Supports:
 * - [@id] parenthetical citations: "(Author, Year)"
 * - @id narrative citations: "Author (Year)"
 * - [@a; @b] multiple citations: "(Author1, Year1; Author2, Year2)"
 */
import { SimpleTextReferenceWidget } from "../render/render-core";
import { CSS } from "../constants/css-classes";
import { getDocumentAnalysis } from "../semantics/incremental/cached-document-analysis";
import type { BibStore } from "../state/bib-data";

/**
 * Widget that renders a citation reference.
 *
 * Handles both parenthetical citations like "(Karger, 2000)" and narrative
 * citations like "Karger (2000)". Pass `narrative: true` for the latter.
 */
export class CitationWidget extends SimpleTextReferenceWidget {
  constructor(
    text: string,
    ids: readonly string[],
    narrative: boolean = false,
  ) {
    super({
      className: narrative ? CSS.citationNarrative : CSS.citation,
      text,
      ariaLabel: ids.join("; "),
    });
  }
}

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
  store: BibStore,
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
