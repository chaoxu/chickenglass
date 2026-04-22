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
import { type CslJsonItem, extractFirstFamilyName, extractYear, formatCslAuthors } from "./csl-json";
import { ensureCitationsRegistered } from "./citation-registration";
import {
  type CitationBacklink,
  type CslProcessor,
  collectCitationBacklinksFromReferences,
  collectCitedIdsFromReferenceIndex,
} from "./csl-processor";
import {
  buildCitationBacklinkAriaLabel,
  buildCitationBacklinkContextFromDoc,
  COMPACT_CITATION_BACKLINK_TEXT,
} from "./bibliography-backlinks";
import { CSS } from "../constants/css-classes";
import { containsMarkdownMath } from "../lib/markdown-math";
import { RenderWidget, buildDecorations, createDecorationsField, sanitizeCslHtml } from "../render/render-core";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
import { type BibStore, bibDataEffect, bibDataField } from "../state/bib-data";

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

export function buildCitationBacklinkMap(
  backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
): Map<string, readonly CitationBacklink[]> {
  return new Map(backlinks);
}

export function buildBibliographyEntries(
  store: BibStore,
  citedIds: readonly string[],
  cslHtml: readonly string[],
): Array<{
  readonly id: string;
  readonly plainText: string;
  readonly renderedHtml?: string;
}> {
  const entries = citedIds
    .map((id) => store.get(id))
    .filter((entry): entry is CslJsonItem => entry !== undefined);

  if (cslHtml.length > 0) {
    return entries.map((entry, index) => {
      const plainText = formatBibEntry(entry);
      return {
        id: entry.id,
        plainText,
        renderedHtml: containsMarkdownMath(plainText)
          ? undefined
          : sanitizeCslHtml(cslHtml[index] ?? ""),
      };
    });
  }

  return sortBibEntries(entries).map((entry) => ({
    id: entry.id,
    plainText: formatBibEntry(entry),
  }));
}

/** Widget that renders the full bibliography section. */
export class BibliographyWidget extends RenderWidget {
  private readonly domEventHandlers = new WeakMap<HTMLElement, {
    mouseDown: (event: MouseEvent) => void;
    mouseOver: (event: MouseEvent) => void;
    focusIn: (event: FocusEvent) => void;
  }>();

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

    const refreshBacklinkContext = (link: HTMLElement): void => {
      const from = Number(link.dataset.sourceFrom ?? "-1");
      if (from < 0) return;
      const context = buildCitationBacklinkContextFromDoc(view.state.doc, { from });
      link.title = context;
      link.setAttribute("aria-label", buildCitationBacklinkAriaLabel(context));
    };

    const getBacklink = (target: EventTarget | null): HTMLElement | null => {
      const origin = target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
      const link = origin?.closest<HTMLElement>(`.${CSS.bibliographyBacklink}`);
      return link && section.contains(link) ? link : null;
    };

    const handleMouseDown = (event: MouseEvent): void => {
      const link = getBacklink(event.target);
      if (!link) return;
      const from = Number(link.dataset.sourceFrom ?? "-1");
      event.preventDefault();
      if (from < 0) return;
      view.focus();
      view.dispatch({
        selection: { anchor: from },
        scrollIntoView: true,
      });
    };

    const handleMouseOver = (event: MouseEvent): void => {
      const link = getBacklink(event.target);
      if (!link) return;
      refreshBacklinkContext(link);
    };

    const handleFocusIn = (event: FocusEvent): void => {
      const link = getBacklink(event.target);
      if (!link) return;
      refreshBacklinkContext(link);
    };

    section.querySelectorAll<HTMLElement>(`.${CSS.bibliographyBacklink}`)
      .forEach((link) => refreshBacklinkContext(link));

    this.domEventHandlers.set(section, {
      mouseDown: handleMouseDown,
      mouseOver: handleMouseOver,
      focusIn: handleFocusIn,
    });
    section.addEventListener("mousedown", handleMouseDown);
    section.addEventListener("mouseover", handleMouseOver);
    section.addEventListener("focusin", handleFocusIn);
    return section;
  }

  override destroy(dom: HTMLElement): void {
    const handlers = this.domEventHandlers.get(dom);
    if (!handlers) return;
    dom.removeEventListener("mousedown", handlers.mouseDown);
    dom.removeEventListener("mouseover", handlers.mouseOver);
    dom.removeEventListener("focusin", handlers.focusIn);
    this.domEventHandlers.delete(dom);
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

  for (const backlink of refs) {
    const link = document.createElement("a");
    link.className = CSS.bibliographyBacklink;
    link.href = `#cite-ref-${backlink.occurrence}`;
    link.dataset.sourceFrom = String(backlink.from);
    link.textContent = COMPACT_CITATION_BACKLINK_TEXT;
    link.setAttribute("aria-label", "Jump to citation");
    if (container.childNodes.length > 0) {
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
  // Bibliography content/backlinks derive entirely from the references slice,
  // so the slice revision is the canonical invalidation signal.
  return getDocumentAnalysisSliceRevision(beforeAnalysis, "references")
    !== getDocumentAnalysisSliceRevision(afterAnalysis, "references");
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
  const citedIds = collectCitedIdsFromReferenceIndex(analysis.referenceIndex, store);
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
