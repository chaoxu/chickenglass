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
import { type WidgetType } from "@codemirror/view";
import { SimpleTextRenderWidget } from "../render/render-core";
import { analyzeMarkdownSemantics } from "../semantics/markdown-analysis";
import type { BibStore } from "../state/bib-data";
export {
  type BibData,
  type BibStore,
  bibDataEffect,
  bibDataField,
} from "../state/bib-data";

/**
 * Widget that renders a citation reference.
 *
 * Handles both parenthetical citations like "(Karger, 2000)" and narrative
 * citations like "Karger (2000)". Pass `narrative: true` for the latter.
 */
export class CitationWidget extends SimpleTextRenderWidget {
  private readonly idsKey: string;

  constructor(
    private readonly text: string,
    ids: readonly string[],
    private readonly narrative: boolean = false,
  ) {
    super({
      tagName: "span",
      className: narrative ? "cf-citation cf-citation-narrative" : "cf-citation",
      text,
      attrs: { "aria-label": ids.join("; ") },
    });
    this.idsKey = ids.join("\0");
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CitationWidget &&
      this.text === other.text &&
      this.idsKey === other.idsKey &&
      this.narrative === other.narrative
    );
  }
}

/**
 * @deprecated Use `new CitationWidget(text, [id], true)` instead.
 *
 * Kept for backwards compatibility with external consumers and tests.
 */
export class NarrativeCitationWidget extends CitationWidget {
  constructor(text: string, id: string) {
    super(text, [id], true);
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
): CitationMatch[] {
  const analysis = analyzeMarkdownSemantics(text);
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
