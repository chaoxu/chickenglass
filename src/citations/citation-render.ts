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
import { StateEffect, StateField } from "@codemirror/state";
import { type WidgetType } from "@codemirror/view";
import { parser as baseParser } from "@lezer/markdown";
import { type CslJsonItem } from "./bibtex-parser";
import { CslProcessor } from "./csl-processor";
// Direct import: barrel would create circular dependency (citations/citation-render → render/index → hover-preview → citations/...)
import { SimpleTextRenderWidget } from "../render/render-utils";
import { markdownExtensions } from "../parser";
import {
  analyzeDocumentSemantics,
  stringTextSource,
} from "../semantics/document";

/** A store of bibliography entries keyed by citation id. */
export type BibStore = ReadonlyMap<string, CslJsonItem>;

/** Bibliography data stored in the editor state. */
export interface BibData {
  store: BibStore;
  cslProcessor: CslProcessor;
}

/** StateEffect for updating bibliography data. */
export const bibDataEffect = StateEffect.define<BibData>();

/** StateField that holds the current bibliography data. */
export const bibDataField = StateField.define<BibData>({
  create() {
    return { store: new Map(), cslProcessor: CslProcessor.empty() };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(bibDataEffect)) return effect.value;
    }
    return value;
  },
});

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
      title: ids.join("; "),
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

/** Standalone Lezer parser (same extensions as CM6 editor). */
const mdParser = baseParser.configure(markdownExtensions);

/**
 * Find all citation matches in the document text.
 * Only includes matches where at least one id exists in the bib store.
 *
 * Parses the text with the standalone Lezer parser internally,
 * then uses `analyzeDocumentSemantics` for reference discovery.
 * This supports CM6-free callers (e.g., `markdownToHtml`, `collectCitedIds`).
 */
export function findCitations(
  text: string,
  store: BibStore,
): CitationMatch[] {
  const tree = mdParser.parse(text);
  const analysis = analyzeDocumentSemantics(stringTextSource(text), tree);
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
