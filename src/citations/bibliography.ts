/**
 * Bibliography section renderer.
 *
 * Renders a "References" section at the end of the document listing
 * all cited entries. Implemented as a CM6 StateField so it can use a
 * block widget at document end without inheriting the final line's styles.
 */
import {
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { type EditorState, type Extension } from "@codemirror/state";
import { type CslJsonItem, extractFirstFamilyName, extractYear, formatCslAuthors } from "./bibtex-parser";
import { type BibStore, bibDataEffect, bibDataField, findCitations } from "./citation-render";
import { RenderWidget, buildDecorations, createDecorationsField, sanitizeCslHtml } from "../render/render-core";
import { ensureCitationsRegistered } from "../render/reference-render";
import { documentAnalysisField } from "../semantics/codemirror-source";

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
export function formatBibEntry(entry: CslJsonItem): string {
  const parts: string[] = [];

  const authorStr = formatCslAuthors(entry.author);
  if (authorStr) {
    parts.push(authorStr);
  }

  if (entry.title) {
    parts.push(entry.title);
  }

  const venue = entry["container-title"];
  if (venue) {
    let venuePart = venue;
    if (entry.volume) {
      venuePart += `, ${entry.volume}`;
      if (entry.issue) {
        venuePart += `(${entry.issue})`;
      }
    }
    if (entry.page) {
      venuePart += `, ${entry.page}`;
    }
    parts.push(venuePart);
  }

  const year = extractYear(entry);
  if (year) {
    parts.push(year);
  }

  return parts.join(". ") + ".";
}

/**
 * Sort bibliography entries alphabetically by first author's last name,
 * then by year.
 */
export function sortBibEntries(entries: CslJsonItem[]): CslJsonItem[] {
  return [...entries].sort((a, b) => {
    const nameA = extractFirstFamilyName(a.author, a.id).toLowerCase();
    const nameB = extractFirstFamilyName(b.author, b.id).toLowerCase();
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    const yearA = extractYear(a) ?? "";
    const yearB = extractYear(b) ?? "";
    return yearA < yearB ? -1 : yearA > yearB ? 1 : 0;
  });
}

/** Widget that renders the full bibliography section. */
export class BibliographyWidget extends RenderWidget {
  constructor(
    private readonly entries: readonly CslJsonItem[],
    private readonly cslHtml: readonly string[],
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const section = document.createElement("div");
    section.className = "cf-bibliography";

    const heading = document.createElement("h2");
    heading.className = "cf-bibliography-heading";
    heading.textContent = "References";
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "cf-bibliography-list";

    if (this.cslHtml.length > 0) {
      // Use CSL-formatted entries (already include [1] numbering for IEEE)
      for (let i = 0; i < this.cslHtml.length; i++) {
        const div = document.createElement("div");
        div.className = "cf-bibliography-entry";
        div.innerHTML = sanitizeCslHtml(this.cslHtml[i]);
        list.appendChild(div);
      }
    } else {
      // Fallback: plain text format with numbering
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        const div = document.createElement("div");
        div.className = "cf-bibliography-entry";
        div.id = `bib-${entry.id}`;
        div.textContent = `[${i + 1}] ${formatBibEntry(entry)}`;
        list.appendChild(div);
      }
    }

    section.appendChild(list);
    return section;
  }

  eq(other: BibliographyWidget): boolean {
    if (this.entries.length !== other.entries.length) return false;
    if (this.cslHtml.length !== other.cslHtml.length) return false;
    return this.entries.every((e, i) => e.id === other.entries[i].id)
      && this.cslHtml.every((html, i) => html === other.cslHtml[i]);
  }
}

export function buildBibliographyDecorations(
  state: EditorState,
  entries: readonly CslJsonItem[],
  cslHtml: readonly string[],
): DecorationSet {
  const widget = new BibliographyWidget(entries, cslHtml);
  return buildDecorations([
    Decoration.widget({ widget, side: 1, block: true }).range(state.doc.length),
  ]);
}

// Cache: skip citeproc when cited IDs haven't changed.
let _prevCitedKey = "";
let _prevCslHtml: string[] = [];

function buildBibliographyDecorationsFromState(state: EditorState): DecorationSet {
  const { store, cslProcessor } = state.field(bibDataField);
  if (store.size === 0) return Decoration.none;

  // Use the incrementally-maintained document analysis instead of
  // re-parsing the entire document from scratch (#514).
  const analysis = state.field(documentAnalysisField);
  const seen = new Set<string>();
  const citedIds: string[] = [];
  for (const ref of analysis.references) {
    for (const id of ref.ids) {
      if (!seen.has(id) && store.has(id)) {
        seen.add(id);
        citedIds.push(id);
      }
    }
  }
  if (citedIds.length === 0) return Decoration.none;

  let cslHtml: string[] = [];
  if (cslProcessor) {
    // Only re-run citeproc when citation IDs or their order changed.
    // citeproc is ~30ms per call — too expensive for every keystroke.
    const citedKey = citedIds.join("\0") + "\0" + cslProcessor.revision;
    if (citedKey !== _prevCitedKey) {
      ensureCitationsRegistered(analysis, store, cslProcessor);
      cslHtml = cslProcessor.bibliography(citedIds);
      _prevCitedKey = citedKey;
      _prevCslHtml = cslHtml;
    } else {
      cslHtml = _prevCslHtml;
    }
  }

  const entries = cslHtml.length > 0
    ? citedIds.map((id) => store.get(id)).filter((e): e is CslJsonItem => e !== undefined)
    : sortBibEntries(
        citedIds.map((id) => store.get(id)).filter((e): e is CslJsonItem => e !== undefined),
      );

  return buildBibliographyDecorations(state, entries, cslHtml);
}

/** CM6 extension that renders a bibliography section at the end of the document. */
export const bibliographyPlugin: Extension = createDecorationsField(
  buildBibliographyDecorationsFromState,
  (tr) =>
    tr.docChanged ||
    tr.effects.some((effect) => effect.is(bibDataEffect)) ||
    // Rebuild when document analysis changes so citation registration
    // can pick up new/moved references for correct bibliography output. (#466)
    tr.state.field(documentAnalysisField) !== tr.startState.field(documentAnalysisField),
);
