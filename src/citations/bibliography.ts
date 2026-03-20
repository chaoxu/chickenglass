/**
 * Bibliography section renderer.
 *
 * Renders a "References" section at the end of the document listing
 * all cited entries. Implemented as a CM6 ViewPlugin that appends
 * a widget decoration after the last line.
 */
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { type BibEntry, extractLastName } from "./bibtex-parser";
import { type BibStore, bibDataEffect, bibDataField, findCitations } from "./citation-render";
import { RenderWidget, buildDecorations } from "../render/render-utils";

/**
 * Collect all citation ids referenced in the document text.
 * Returns a deduplicated set of ids in order of first appearance.
 */
export function collectCitedIds(text: string, store: BibStore): string[] {
  const matches = findCitations(text, store);
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const match of matches) {
    for (const id of match.ids) {
      if (!seen.has(id) && store.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids;
}

/**
 * Format a bibliography entry as a text string.
 * Uses a simplified format: Author. Title. Venue, Year.
 */
export function formatBibEntry(entry: BibEntry): string {
  const parts: string[] = [];

  if (entry.author) {
    parts.push(entry.author);
  }

  if (entry.title) {
    parts.push(entry.title);
  }

  const venue = entry.journal ?? entry.booktitle;
  if (venue) {
    let venuePart = venue;
    if (entry.volume) {
      venuePart += `, ${entry.volume}`;
      if (entry.number) {
        venuePart += `(${entry.number})`;
      }
    }
    if (entry.pages) {
      venuePart += `, ${entry.pages}`;
    }
    parts.push(venuePart);
  }

  if (entry.year) {
    parts.push(entry.year);
  }

  return parts.join(". ") + ".";
}

/**
 * Sort bibliography entries alphabetically by first author's last name,
 * then by year.
 */
export function sortBibEntries(entries: BibEntry[]): BibEntry[] {
  return [...entries].sort((a, b) => {
    const nameA = a.author ? extractLastName(a.author).toLowerCase() : a.id.toLowerCase();
    const nameB = b.author ? extractLastName(b.author).toLowerCase() : b.id.toLowerCase();
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    const yearA = a.year ?? "";
    const yearB = b.year ?? "";
    return yearA < yearB ? -1 : yearA > yearB ? 1 : 0;
  });
}

/** Widget that renders the full bibliography section. */
export class BibliographyWidget extends RenderWidget {
  constructor(
    private readonly entries: readonly BibEntry[],
    private readonly cslHtml: readonly string[],
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const section = document.createElement("div");
    section.className = "cg-bibliography";

    const heading = document.createElement("h2");
    heading.className = "cg-bibliography-heading";
    heading.textContent = "References";
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "cg-bibliography-list";

    if (this.cslHtml.length > 0) {
      // Use CSL-formatted entries (already include [1] numbering for IEEE)
      for (let i = 0; i < this.cslHtml.length; i++) {
        const div = document.createElement("div");
        div.className = "cg-bibliography-entry";
        // Strip whitespace between CSL HTML tags to prevent inline spacing artifacts
        div.innerHTML = this.cslHtml[i].replace(/>\s+</g, "><").trim();
        list.appendChild(div);
      }
    } else {
      // Fallback: plain text format
      for (const entry of this.entries) {
        const div = document.createElement("div");
        div.className = "cg-bibliography-entry";
        div.id = `bib-${entry.id}`;
        div.textContent = formatBibEntry(entry);
        list.appendChild(div);
      }
    }

    section.appendChild(list);
    return section;
  }

  eq(other: BibliographyWidget): boolean {
    if (this.entries.length !== other.entries.length) return false;
    if (this.cslHtml.length !== other.cslHtml.length) return false;
    return this.entries.every((e, i) => e.id === other.entries[i].id);
  }
}

class BibliographyPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildAll(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(bibDataEffect)),
      )
    ) {
      this.decorations = this.buildAll(update.view);
    }
  }

  private buildAll(view: EditorView): DecorationSet {
    const { store, cslProcessor } = view.state.field(bibDataField);
    if (store.size === 0) return Decoration.none;

    const text = view.state.doc.toString();
    const citedIds = collectCitedIds(text, store);
    if (citedIds.length === 0) return Decoration.none;

    // Try CSL-formatted bibliography first
    let cslHtml: string[] = [];
    if (cslProcessor) {
      cslHtml = cslProcessor.bibliography();
    }

    const entries = cslHtml.length > 0
      ? citedIds.map((id) => store.get(id)).filter((e): e is BibEntry => e !== undefined)
      : sortBibEntries(
          citedIds.map((id) => store.get(id)).filter((e): e is BibEntry => e !== undefined),
        );

    const endPos = view.state.doc.length;
    const widget = new BibliographyWidget(entries, cslHtml);

    return buildDecorations([
      Decoration.widget({ widget, side: 1 }).range(endPos),
    ]);
  }
}

/** CM6 extension that renders a bibliography section at the end of the document. */
export const bibliographyPlugin: Extension = ViewPlugin.fromClass(
  BibliographyPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
