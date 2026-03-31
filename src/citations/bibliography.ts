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
  EditorView,
} from "@codemirror/view";
import { type EditorState, type Extension, type Transaction } from "@codemirror/state";
import { type CslJsonItem, extractFirstFamilyName, extractYear, formatCslAuthors } from "./bibtex-parser";
import { type BibStore, bibDataEffect, bibDataField, findCitations } from "./citation-render";
import {
  type CitationBacklink,
  type CslProcessor,
  collectCitationBacklinksFromReferences,
  collectCitedIdsFromReferences,
} from "./csl-processor";
import { CSS } from "../constants/css-classes";
import { RenderWidget, buildDecorations, createDecorationsField, sanitizeCslHtml } from "../render/render-core";
import { ensureCitationsRegistered } from "../render/reference-render";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";

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
    private readonly backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const section = document.createElement("div");
    section.className = CSS.bibliography;

    const heading = document.createElement("h2");
    heading.className = CSS.bibliographyHeading;
    heading.textContent = "References";
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = CSS.bibliographyList;

    if (this.cslHtml.length > 0) {
      // Use CSL-formatted entries (already include [1] numbering for IEEE)
      for (let i = 0; i < this.cslHtml.length; i++) {
        const entry = this.entries[i];
        const div = document.createElement("div");
        div.className = CSS.bibliographyEntry;
        div.id = `bib-${entry.id}`;
        div.innerHTML = sanitizeCslHtml(this.cslHtml[i]);
        appendBacklinks(div, entry.id, this.backlinks);
        list.appendChild(div);
      }
    } else {
      // Fallback: plain text format with numbering
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        const div = document.createElement("div");
        div.className = CSS.bibliographyEntry;
        div.id = `bib-${entry.id}`;
        div.textContent = `[${i + 1}] ${formatBibEntry(entry)}`;
        appendBacklinks(div, entry.id, this.backlinks);
        list.appendChild(div);
      }
    }

    section.appendChild(list);
    return section;
  }

  override toDOM(view?: EditorView): HTMLElement {
    const section = this.createDOM();
    if (!view) return section;
    for (const link of section.querySelectorAll<HTMLElement>(`.${CSS.bibliographyBacklink}`)) {
      const from = Number(link.dataset.sourceFrom ?? "-1");
      link.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (from < 0) return;
        view.focus();
        view.dispatch({
          selection: { anchor: from },
          scrollIntoView: true,
        });
      });
    }
    return section;
  }

  eq(other: BibliographyWidget): boolean {
    if (this.entries.length !== other.entries.length) return false;
    if (this.cslHtml.length !== other.cslHtml.length) return false;
    if (!this.entries.every((e, i) => e.id === other.entries[i].id)) return false;
    if (!this.cslHtml.every((html, i) => html === other.cslHtml[i])) return false;
    return this.entries.every((entry) => sameBacklinks(this.backlinks.get(entry.id), other.backlinks.get(entry.id)));
  }
}

function sameBacklinks(
  left: readonly CitationBacklink[] | undefined,
  right: readonly CitationBacklink[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((backlink, index) =>
    backlink.occurrence === right[index].occurrence &&
    backlink.from === right[index].from &&
    backlink.to === right[index].to,
  );
}

function appendBacklinks(
  entryEl: HTMLElement,
  id: string,
  backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
): void {
  const refs = backlinks.get(id);
  if (!refs || refs.length === 0) return;

  const container = document.createElement("span");
  container.className = CSS.bibliographyBacklinks;
  container.append("cited at ");

  for (const backlink of refs) {
    const link = document.createElement("a");
    link.className = CSS.bibliographyBacklink;
    link.href = `#cite-ref-${backlink.occurrence}`;
    link.dataset.sourceFrom = String(backlink.from);
    link.textContent = `↩${backlink.occurrence}`;
    link.setAttribute("aria-label", `Jump to citation ${backlink.occurrence}`);
    if (container.childNodes.length > 1) {
      container.append(" ");
    }
    container.appendChild(link);
  }

  entryEl.append(" ");
  entryEl.appendChild(container);
}

export function buildBibliographyDecorations(
  state: EditorState,
  entries: readonly CslJsonItem[],
  cslHtml: readonly string[],
  backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
): DecorationSet {
  const widget = new BibliographyWidget(entries, cslHtml, backlinks);
  return buildDecorations([
    Decoration.widget({ widget, side: 1, block: true }).range(state.doc.length),
  ]);
}

interface BibliographyCacheEntry {
  readonly citedKey: string;
  readonly cslHtml: readonly string[];
  readonly processorRevision: number;
  readonly store: BibStore;
}

const bibliographyCache = new WeakMap<CslProcessor, BibliographyCacheEntry>();

function getCitedIdsKey(citedIds: readonly string[]): string {
  return citedIds.join("\0");
}

function getCitationBacklinksKey(
  references: readonly Parameters<typeof collectCitationBacklinksFromReferences>[0][number][],
  store: BibStore,
): string {
  return [...collectCitationBacklinksFromReferences(references, store).entries()]
    .map(([id, backlinks]) =>
      `${id}\0${backlinks.map((backlink) =>
        `${backlink.occurrence}\0${backlink.from}\0${backlink.to}`).join("\u0001")}`)
    .join("\u0002");
}

export function bibliographyDependenciesChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  const beforeBib = beforeState.field(bibDataField);
  const afterBib = afterState.field(bibDataField);
  if (
    beforeBib.store !== afterBib.store ||
    beforeBib.cslProcessor !== afterBib.cslProcessor ||
    beforeBib.processorRevision !== afterBib.processorRevision
  ) {
    return true;
  }

  const beforeAnalysis = beforeState.field(documentAnalysisField);
  const afterAnalysis = afterState.field(documentAnalysisField);
  const referenceSliceUnchanged =
    beforeAnalysis.references === afterAnalysis.references &&
    beforeAnalysis.referenceByFrom === afterAnalysis.referenceByFrom &&
    getDocumentAnalysisSliceRevision(beforeAnalysis, "references")
      === getDocumentAnalysisSliceRevision(afterAnalysis, "references");

  if (referenceSliceUnchanged) {
    return false;
  }

  return getCitationBacklinksKey(beforeAnalysis.references, beforeBib.store)
    !== getCitationBacklinksKey(afterAnalysis.references, afterBib.store);
}

function bibliographyShouldRebuild(tr: Transaction): boolean {
  return (
    tr.effects.some((effect) => effect.is(bibDataEffect)) ||
    bibliographyDependenciesChanged(tr.startState, tr.state)
  );
}

function buildBibliographyDecorationsFromState(state: EditorState): DecorationSet {
  const { store, cslProcessor, processorRevision } = state.field(bibDataField);
  if (store.size === 0) return Decoration.none;

  // Use the incrementally-maintained document analysis instead of
  // re-parsing the entire document from scratch (#514).
  const analysis = state.field(documentAnalysisField);
  const citedIds = collectCitedIdsFromReferences(analysis.references, store);
  if (citedIds.length === 0) return Decoration.none;
  const backlinks = collectCitationBacklinksFromReferences(analysis.references, store);

  let cslHtml: readonly string[] = [];
  if (cslProcessor) {
    const citedKey = getCitedIdsKey(citedIds);
    const cached = bibliographyCache.get(cslProcessor);
    if (
      !cached ||
      cached.citedKey !== citedKey ||
      cached.processorRevision !== processorRevision ||
      cached.store !== store
    ) {
      ensureCitationsRegistered(analysis, store, cslProcessor);
      cslHtml = cslProcessor.bibliography(citedIds);
      bibliographyCache.set(cslProcessor, {
        citedKey,
        cslHtml,
        processorRevision,
        store,
      });
    } else {
      cslHtml = cached.cslHtml;
    }
  }

  const entries = cslHtml.length > 0
    ? citedIds.map((id) => store.get(id)).filter((e): e is CslJsonItem => e !== undefined)
    : sortBibEntries(
        citedIds.map((id) => store.get(id)).filter((e): e is CslJsonItem => e !== undefined),
      );

  return buildBibliographyDecorations(state, entries, cslHtml, backlinks);
}

/** CM6 extension that renders a bibliography section at the end of the document. */
export const bibliographyPlugin: Extension = createDecorationsField(
  buildBibliographyDecorationsFromState,
  bibliographyShouldRebuild,
  true,
);
