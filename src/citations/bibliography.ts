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
  EditorView,
} from "@codemirror/view";
import { type EditorState, type Extension, StateField } from "@codemirror/state";
import { type BibEntry, extractLastName } from "./bibtex-parser";
import { type BibStore, getBibStore, getCslProcessor, findCitations } from "./citation-render";
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
    private readonly cslEntries: readonly string[] | null,
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

    const list = document.createElement("ol");
    list.className = "cg-bibliography-list";

    if (this.cslEntries && this.cslEntries.length > 0) {
      // Use CSL-formatted HTML entries
      for (const html of this.cslEntries) {
        const li = document.createElement("li");
        li.className = "cg-bibliography-entry";
        li.innerHTML = html;
        list.appendChild(li);
      }
    } else {
      // Fallback: simple text formatting
      for (const entry of this.entries) {
        const li = document.createElement("li");
        li.className = "cg-bibliography-entry";
        li.id = `bib-${entry.id}`;
        li.textContent = formatBibEntry(entry);
        list.appendChild(li);
      }
    }

    section.appendChild(list);
    return section;
  }

  eq(other: BibliographyWidget): boolean {
    if (this.entries.length !== other.entries.length) return false;
    return this.entries.every((e, i) => e.id === other.entries[i].id);
  }
}

/** Build bibliography decorations from state. */
function buildBibDecorations(state: EditorState): DecorationSet {
  const store = getBibStore();
  if (store.size === 0) return Decoration.none;

  const text = state.doc.toString();
  const citedIds = collectCitedIds(text, store);
  if (citedIds.length === 0) return Decoration.none;

  const entries = sortBibEntries(
    citedIds
      .map((id) => store.get(id))
      .filter((e): e is BibEntry => e !== undefined),
  );

  const cslProcessor = getCslProcessor();
  const cslEntries = cslProcessor ? cslProcessor.bibliography() : null;
  const widget = new BibliographyWidget(entries, cslEntries);

  return buildDecorations([
    Decoration.widget({ widget, side: 1, block: true }).range(state.doc.length),
  ]);
}

/**
 * CM6 StateField that renders a bibliography section at the end of the document.
 * Uses StateField (not ViewPlugin) so block widgets are permitted by CM6.
 */
const bibliographyField = StateField.define<DecorationSet>({
  create(state) {
    return buildBibDecorations(state);
  },

  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return buildBibDecorations(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** CM6 extension that renders a bibliography section at the end of the document. */
export const bibliographyPlugin: Extension = bibliographyField;
