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
import { type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type EditorView,
  type WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { parser as baseParser } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import { type BibEntry, extractLastName } from "./bibtex-parser";
import { type CslProcessor, registerCitationsWithProcessor } from "./csl-processor";
import { cursorInRange, RenderWidget } from "../render/render-utils";
import { markdownExtensions } from "../parser";
import {
  analyzeDocumentSemantics,
  stringTextSource,
} from "../semantics/document";
import { extractReferenceCluster } from "../semantics/reference-parts";

/** Format a citation label: "(Author, Year)" or "(Author, Year, locator)". */
export function formatCitation(entry: BibEntry, locator?: string): string {
  const author = entry.author ? extractLastName(entry.author) : entry.id;
  const year = entry.year ?? "";
  let text = `${author}, ${year}`;
  if (locator) text += `, ${locator}`;
  return text;
}

/** Format a narrative citation: "Author (Year)". */
export function formatNarrativeCitation(entry: BibEntry): string {
  const author = entry.author ? extractLastName(entry.author) : entry.id;
  const year = entry.year ?? "";
  return `${author} (${year})`;
}

/** A store of bibliography entries keyed by citation id. */
export type BibStore = ReadonlyMap<string, BibEntry>;

/** Bibliography data stored in the editor state. */
export interface BibData {
  store: BibStore;
  cslProcessor: CslProcessor | null;
}

/** StateEffect for updating bibliography data. */
export const bibDataEffect = StateEffect.define<BibData>();

/** StateField that holds the current bibliography data. */
export const bibDataField = StateField.define<BibData>({
  create() {
    return { store: new Map(), cslProcessor: null };
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
export class CitationWidget extends RenderWidget {
  constructor(
    private readonly text: string,
    private readonly ids: readonly string[],
    private readonly narrative: boolean = false,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.narrative
      ? "cf-citation cf-citation-narrative"
      : "cf-citation";
    el.textContent = this.text;
    el.title = this.ids.join("; ");
    return el;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CitationWidget &&
      this.text === other.text &&
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
 * Pattern for parenthetical citations inside Link nodes.
 * Matches: [@id], [@id, locator], [@id1; @id2; ...].
 */
const PAREN_CITE_RE = /^\[(@[a-zA-Z0-9_][\w:./-]*(?:,[^;\]]*)?(?:\s*;\s*@[a-zA-Z0-9_][\w:./-]*(?:,[^;\]]*)?)*)\]$/;

/** Pattern for narrative citations: @id (not preceded by [ or another @) */
const NARRATIVE_CITE_RE = /(?<![[@\w])@([a-zA-Z0-9_][\w:./-]*)/g;

/** Extract citation ids and locators from a parenthetical citation match. */
export function extractCitations(raw: string): { ids: string[]; locators: (string | undefined)[] } {
  const { ids, locators } = extractReferenceCluster(raw);
  return { ids: [...ids], locators: [...locators] };
}

/**
 * Find all citation matches by walking a Lezer syntax tree.
 *
 * Parenthetical citations ([@id], [@id, locator], [@id1; @id2]) are found
 * as Link nodes whose text matches the `[@...]` pattern.
 * Narrative citations (@id) are found by scanning text outside Link nodes.
 *
 * Only includes matches where at least one id exists in the bib store.
 */
export function findCitationsFromTree(
  topNode: SyntaxNode,
  doc: string,
  store: BibStore,
): CitationMatch[] {
  const matches: CitationMatch[] = [];
  const linkRanges: { from: number; to: number }[] = [];

  // 1. Walk the tree for Link nodes — parenthetical citations like [@id]
  topNode.cursor().iterate((node) => {
    if (node.name !== "Link") return;

    const text = doc.slice(node.from, node.to);
    const parenMatch = PAREN_CITE_RE.exec(text);
    if (parenMatch) {
      const { ids, locators } = extractCitations(parenMatch[1]);
      if (ids.some((id) => store.has(id))) {
        matches.push({
          from: node.from,
          to: node.to,
          parenthetical: true,
          ids,
          locators,
        });
      }
    }

    linkRanges.push({ from: node.from, to: node.to });
  });

  // 2. Scan full text for narrative @id refs, skipping Link ranges
  NARRATIVE_CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NARRATIVE_CITE_RE.exec(doc)) !== null) {
    const id = m[1];
    const matchFrom = m.index;
    const matchTo = m.index + m[0].length;

    // Skip if inside a Link node
    const insideLink = linkRanges.some(
      (r) => matchFrom >= r.from && matchTo <= r.to,
    );
    if (insideLink) continue;

    if (store.has(id)) {
      matches.push({
        from: matchFrom,
        to: matchTo,
        parenthetical: false,
        ids: [id],
        locators: [undefined],
      });
    }
  }

  // Sort by document position
  matches.sort((a, b) => a.from - b.from);

  return matches;
}

/**
 * Find all citation matches in the document text.
 * Only includes matches where at least one id exists in the bib store.
 *
 * Parses the text with the standalone Lezer parser internally,
 * then delegates to `findCitationsFromTree`. This supports CM6-free
 * callers (e.g., `markdownToHtml`, `collectCitedIds`).
 */
export function findCitations(
  text: string,
  store: BibStore,
): CitationMatch[] {
  const tree = mdParser.parse(text);
  const analysis = analyzeDocumentSemantics(stringTextSource(text), tree);
  return citationMatchesFromReferences(analysis.references, store);
}

/**
 * Format a parenthetical citation string from multiple ids.
 * Returns "(Author1, Year1; Author2, Year2)" or "(Author, Year, locator)" format.
 */
export function formatParenthetical(
  ids: readonly string[],
  store: BibStore,
  locators?: readonly (string | undefined)[],
): string {
  const parts = ids.map((id, i) => {
    const entry = store.get(id);
    const locator = locators?.[i];
    return entry ? formatCitation(entry, locator) : id;
  });
  return `(${parts.join("; ")})`;
}

/** Collect decoration ranges for citations outside the cursor. */
export function collectCitationRanges(
  view: EditorView,
  store: BibStore,
  cslProcessor?: CslProcessor | null,
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  const text = view.state.doc.toString();
  const matches = findCitationsFromTree(tree.topNode, text, store);

  // Register all citations with CSL processor first (needed for numeric styles)
  if (cslProcessor) {
    registerCitationsWithProcessor(matches, cslProcessor);
  }

  for (const match of matches) {
    if (cursorInRange(view, match.from, match.to)) continue;

    if (match.parenthetical) {
      // Use CSL processor when available for proper style formatting
      const rendered = cslProcessor
        ? cslProcessor.cite([...match.ids], match.locators ? [...match.locators] : undefined)
        : formatParenthetical(match.ids, store, match.locators);
      const widget = new CitationWidget(rendered, match.ids);
      widget.sourceFrom = match.from;
      widget.sourceTo = match.to;
      items.push(
        Decoration.replace({ widget }).range(match.from, match.to),
      );
    } else {
      const entry = store.get(match.ids[0]);
      if (entry) {
        const rendered = cslProcessor
          ? cslProcessor.citeNarrative(match.ids[0])
          : formatNarrativeCitation(entry);
        const widget = new CitationWidget(rendered, match.ids, true);
        widget.sourceFrom = match.from;
        widget.sourceTo = match.to;
        items.push(
          Decoration.replace({ widget }).range(match.from, match.to),
        );
      }
    }
  }

  return items;
}

/**
 * @deprecated Use `referenceRenderPlugin` from `../render/reference-render` instead.
 * The standalone citation ViewPlugin has been merged into the unified
 * reference render plugin. This module still exports widget classes,
 * state fields, and standalone functions used by bibliography, HTML export,
 * hover-preview, and CSL processor.
 */
