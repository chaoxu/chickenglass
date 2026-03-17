/**
 * CM6 ViewPlugin that renders citation references in the document.
 *
 * Finds [@id] patterns and renders them as formatted citations when the
 * id matches a bibliography entry. Unmatched ids are left for the
 * cross-reference system to handle.
 *
 * Supports:
 * - [@id] parenthetical citations: "(Author, Year)"
 * - @id narrative citations: "Author (Year)"
 * - [@a; @b] multiple citations: "(Author1, Year1; Author2, Year2)"
 */
import { type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  type WidgetType,
} from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import {
  type BibEntry,
  formatCitation,
  formatNarrativeCitation,
} from "./bibtex-parser";
import { cursorInRange, buildDecorations, RenderWidget } from "../render/render-utils";

/** A store of bibliography entries keyed by citation id. */
export type BibStore = ReadonlyMap<string, BibEntry>;

/** StateField-compatible facet for providing bibliography data to the plugin. */
let globalBibStore: BibStore = new Map();

/** Set the global bibliography store. */
export function setBibStore(store: BibStore): void {
  globalBibStore = store;
}

/** Get the current bibliography store. */
export function getBibStore(): BibStore {
  return globalBibStore;
}

/** Widget that renders a parenthetical citation like "(Karger, 2000)". */
export class CitationWidget extends RenderWidget {
  constructor(
    private readonly text: string,
    private readonly ids: readonly string[],
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cg-citation";
    el.textContent = this.text;
    el.title = this.ids.join("; ");
    return el;
  }

  eq(other: WidgetType): boolean {
    return other instanceof CitationWidget && this.text === other.text;
  }
}

/** Widget that renders a narrative citation like "Karger (2000)". */
export class NarrativeCitationWidget extends RenderWidget {
  constructor(
    private readonly text: string,
    private readonly id: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cg-citation cg-citation-narrative";
    el.textContent = this.text;
    el.title = this.id;
    return el;
  }

  eq(other: WidgetType): boolean {
    return other instanceof NarrativeCitationWidget && this.text === other.text;
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
}

/** Pattern for parenthetical citations: [@id] or [@id1; @id2; ...] */
const PAREN_CITE_RE = /\[(@[a-zA-Z0-9_][\w:.-]*(?:\s*;\s*@[a-zA-Z0-9_][\w:.-]*)*)\]/g;

/** Pattern for narrative citations: @id (not preceded by [ or another @) */
const NARRATIVE_CITE_RE = /(?<![[@\w])@([a-zA-Z0-9_][\w:.-]*)/g;

/** Extract individual citation ids from a parenthetical citation match. */
function extractCitationIds(raw: string): string[] {
  return raw.split(";").map((part) => {
    const trimmed = part.trim();
    return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  });
}

/**
 * Find all citation matches in the document text.
 * Only includes matches where at least one id exists in the bib store.
 */
export function findCitations(
  text: string,
  store: BibStore,
): CitationMatch[] {
  const matches: CitationMatch[] = [];

  // Find parenthetical citations: [@id] and [@id1; @id2]
  PAREN_CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAREN_CITE_RE.exec(text)) !== null) {
    const ids = extractCitationIds(m[1]);
    // Only treat as citation if at least one id is in the bib store
    if (ids.some((id) => store.has(id))) {
      matches.push({
        from: m.index,
        to: m.index + m[0].length,
        parenthetical: true,
        ids,
      });
    }
  }

  // Build a set of ranges covered by parenthetical matches to avoid overlap
  const coveredRanges = matches.map((cm) => ({ from: cm.from, to: cm.to }));

  // Find narrative citations: @id
  NARRATIVE_CITE_RE.lastIndex = 0;
  while ((m = NARRATIVE_CITE_RE.exec(text)) !== null) {
    const id = m[1];
    const matchFrom = m.index;
    const matchTo = m.index + m[0].length;

    // Skip if this match overlaps with a parenthetical citation
    const overlaps = coveredRanges.some(
      (r) => matchFrom >= r.from && matchTo <= r.to,
    );
    if (overlaps) continue;

    if (store.has(id)) {
      matches.push({
        from: matchFrom,
        to: matchTo,
        parenthetical: false,
        ids: [id],
      });
    }
  }

  return matches;
}

/**
 * Format a parenthetical citation string from multiple ids.
 * Returns "(Author1, Year1; Author2, Year2)" format.
 */
export function formatParenthetical(
  ids: readonly string[],
  store: BibStore,
): string {
  const parts = ids.map((id) => {
    const entry = store.get(id);
    return entry ? formatCitation(entry) : id;
  });
  return `(${parts.join("; ")})`;
}

/** Collect decoration ranges for citations outside the cursor. */
export function collectCitationRanges(
  view: EditorView,
  store: BibStore,
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const text = view.state.doc.toString();
  const matches = findCitations(text, store);

  for (const match of matches) {
    if (cursorInRange(view, match.from, match.to)) continue;

    if (match.parenthetical) {
      const rendered = formatParenthetical(match.ids, store);
      const widget = new CitationWidget(rendered, match.ids);
      widget.sourceFrom = match.from;
      items.push(
        Decoration.replace({ widget }).range(match.from, match.to),
      );
    } else {
      const entry = store.get(match.ids[0]);
      if (entry) {
        const rendered = formatNarrativeCitation(entry);
        const widget = new NarrativeCitationWidget(rendered, match.ids[0]);
        widget.sourceFrom = match.from;
        items.push(
          Decoration.replace({ widget }).range(match.from, match.to),
        );
      }
    }
  }

  return items;
}

class CitationRenderPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildAll(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged
    ) {
      this.decorations = this.buildAll(update.view);
    }
  }

  private buildAll(view: EditorView): DecorationSet {
    return buildDecorations(collectCitationRanges(view, globalBibStore));
  }
}

/** CM6 extension that renders citation references as formatted citations. */
export const citationRenderPlugin: Extension = ViewPlugin.fromClass(
  CitationRenderPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
