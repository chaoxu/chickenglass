/**
 * CM6 bibliography section renderer.
 *
 * Renders a "References" section at the end of the document listing all cited
 * entries. Implemented as a CM6 StateField so it can use a block widget at
 * document end without inheriting the final line's styles.
 */
import { type EditorState, type Extension, type Transaction } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";

import {
  buildCitationBacklinkAriaLabel,
  buildCitationBacklinkContextFromDoc,
  COMPACT_CITATION_BACKLINK_TEXT,
} from "../citations/bibliography-backlinks";
import { formatBibEntry, sortBibEntries } from "../citations/bibliography";
import { ensureCitationsRegistered } from "../citations/citation-registration";
import {
  type CitationBacklink,
  collectCitationBacklinksFromAnalysis,
  collectCitedIdsFromReferenceIndex,
  getAnalysisCitationBacklinkKey,
  getAnalysisCitationRegistrationKey,
} from "../citations/citation-matching";
import {
  type CslBibliographyEntry,
  type CslProcessor,
} from "../citations/csl-processor";
import { type CslJsonItem } from "../citations/csl-json";
import { CSS } from "../constants/css-classes";
import { sanitizeCslHtml } from "../lib/sanitize-csl-html";
import { type BibStore, bibDataEffect, bibDataField } from "../state/bib-data";
import {
  documentAnalysisField,
} from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";
import { HOVER_DELAY_MS } from "../constants";
import { createPreviewSurfaceBody } from "../preview-surface";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import { buildPreviewBlockOptions } from "./hover-preview-block-options";
import {
  createHoverPreviewContent,
  createHoverPreviewHeader,
} from "./hover-preview-elements";
import {
  floatingTooltipContains,
  hideFloatingTooltip,
  showFloatingTooltip,
  type TooltipPlan,
} from "./hover-tooltip";
import { EMPTY_LOCAL_MEDIA_DEPENDENCIES } from "./media-preview";
import { buildDecorations, createDecorationsField, RenderWidget } from "./render-core";

/** Widget that renders the full bibliography section. */
export class BibliographyWidget extends RenderWidget {
  private readonly domEventHandlers = new WeakMap<HTMLElement, {
    mouseDown: (event: MouseEvent) => void;
    mouseOver: (event: MouseEvent) => void;
    mouseOut: (event: MouseEvent) => void;
    focusIn: (event: FocusEvent) => void;
    focusOut: (event: FocusEvent) => void;
    destroy: () => void;
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
      // Use CSL-formatted entries (already include [1] numbering for IEEE).
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
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let currentPreviewLink: HTMLElement | null = null;

    const clearHoverTimer = (): void => {
      if (hoverTimer === null) return;
      clearTimeout(hoverTimer);
      hoverTimer = null;
    };

    const refreshBacklinkContext = (link: HTMLElement): void => {
      const from = Number(link.dataset.sourceFrom ?? "-1");
      if (from < 0) return;
      const context = buildCitationBacklinkContextFromDoc(view.state.doc, { from });
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

    const showBacklinkPreview = (link: HTMLElement, delay: number): void => {
      refreshBacklinkContext(link);
      clearHoverTimer();
      currentPreviewLink = link;
      hoverTimer = setTimeout(() => {
        if (!link.isConnected || currentPreviewLink !== link) return;
        const plan = buildCitationBacklinkTooltipPlan(view, link);
        if (!plan) return;
        showFloatingTooltip(link, plan);
      }, delay);
    };

    const hideBacklinkPreview = (): void => {
      clearHoverTimer();
      currentPreviewLink = null;
      hideFloatingTooltip();
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
      if (link === currentPreviewLink) return;
      showBacklinkPreview(link, HOVER_DELAY_MS);
    };

    const handleMouseOut = (event: MouseEvent): void => {
      const relatedTarget = event.relatedTarget;
      if (floatingTooltipContains(relatedTarget)) return;
      if (getBacklink(relatedTarget)) return;
      hideBacklinkPreview();
    };

    const handleFocusIn = (event: FocusEvent): void => {
      const link = getBacklink(event.target);
      if (!link) return;
      showBacklinkPreview(link, 0);
    };

    const handleFocusOut = (event: FocusEvent): void => {
      const relatedTarget = event.relatedTarget;
      if (floatingTooltipContains(relatedTarget)) return;
      if (getBacklink(relatedTarget)) return;
      hideBacklinkPreview();
    };

    section.querySelectorAll<HTMLElement>(`.${CSS.bibliographyBacklink}`)
      .forEach((link) => refreshBacklinkContext(link));

    this.domEventHandlers.set(section, {
      mouseDown: handleMouseDown,
      mouseOver: handleMouseOver,
      mouseOut: handleMouseOut,
      focusIn: handleFocusIn,
      focusOut: handleFocusOut,
      destroy: hideBacklinkPreview,
    });
    section.addEventListener("mousedown", handleMouseDown);
    section.addEventListener("mouseover", handleMouseOver);
    section.addEventListener("mouseout", handleMouseOut);
    section.addEventListener("focusin", handleFocusIn);
    section.addEventListener("focusout", handleFocusOut);
    return section;
  }

  override destroy(dom: HTMLElement): void {
    const handlers = this.domEventHandlers.get(dom);
    if (!handlers) return;
    dom.removeEventListener("mousedown", handlers.mouseDown);
    dom.removeEventListener("mouseover", handlers.mouseOver);
    dom.removeEventListener("mouseout", handlers.mouseOut);
    dom.removeEventListener("focusin", handlers.focusIn);
    dom.removeEventListener("focusout", handlers.focusOut);
    handlers.destroy();
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

function buildCitationBacklinkTooltipPlan(
  view: EditorView,
  link: HTMLElement,
): TooltipPlan | null {
  const from = Number(link.dataset.sourceFrom ?? "-1");
  if (from < 0) return null;

  const position = Math.max(0, Math.min(from, view.state.doc.length));
  const line = view.state.doc.lineAt(position);
  const macros = view.state.field(mathMacrosField, false) ?? {};

  return {
    buildContent: () => {
      const container = createHoverPreviewContent();
      container.appendChild(createHoverPreviewHeader(`Line ${line.number}`));

      const body = createPreviewSurfaceBody(CSS.hoverPreviewBody);
      renderPreviewBlockContentToDom(
        body,
        line.text,
        buildPreviewBlockOptions(view, macros),
      );
      container.appendChild(body);
      return container;
    },
    cacheScope: view.state,
    dependsOnBibliography: true,
    dependsOnMacros: true,
    key: `citation-backlink\0${from}\0${line.number}\0${line.text}`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  };
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
  readonly cslEntries: readonly CslBibliographyEntry[];
  readonly processorRevision: number;
  readonly store: BibStore;
}

const bibliographyCache = new WeakMap<CslProcessor, BibliographyCacheEntry>();

function getCitedIdsKey(citedIds: readonly string[]): string {
  return citedIds.join("\0");
}

function getBibliographyDependencyKey(state: EditorState): string {
  const { store } = state.field(bibDataField);
  const analysis = state.field(documentAnalysisField);
  return [
    getAnalysisCitationRegistrationKey(analysis, store),
    getAnalysisCitationBacklinkKey(analysis, store),
  ].join("\u0003");
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

  return getBibliographyDependencyKey(beforeState) !== getBibliographyDependencyKey(afterState);
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
  const backlinks = collectCitationBacklinksFromAnalysis(analysis, store);

  let cslEntries: readonly CslBibliographyEntry[] = [];
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
      cslEntries = cslProcessor.bibliographyEntries(citedIds);
      bibliographyCache.set(cslProcessor, {
        citedKey,
        cslEntries,
        processorRevision,
        store,
      });
    } else {
      cslEntries = cached.cslEntries;
    }
  }

  const cslRows = cslEntries
    .map((entry) => ({ entry: store.get(entry.id), html: entry.html }))
    .filter((row): row is { readonly entry: CslJsonItem; readonly html: string } => row.entry !== undefined);
  const cslHtml = cslRows.map((row) => row.html);
  const entries = cslRows.length > 0
    ? cslRows.map((row) => row.entry)
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
