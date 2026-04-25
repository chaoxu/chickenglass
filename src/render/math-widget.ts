import type { EditorState } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../document-surface-classes";
import { isPlainPrimaryMouseEvent } from "../state/mouse-selection";
import { documentAnalysisField } from "../state/document-analysis";
import type { MathSemantics } from "../semantics/document";
import { clearKatexHtmlCache, renderKatexToHtml } from "./inline-shared";
import { resolveClickToSourcePos } from "./math-interactions";
import { findMathRegionAtPos } from "./math-source";
import { widgetSourceMap } from "./source-widget";
import { ShellMacroAwareWidget } from "./shell-widget";
import {
  clearActiveFenceGuideClasses,
  syncActiveFenceGuideClasses,
} from "./source-widget";
import {
  activateStructureEditTarget,
  createStructureEditTargetAt,
} from "../state/cm-structure-edit";
import {
  clearBlockWidgetHeightBinding,
  estimatedBlockWidgetHeight,
  observeBlockWidgetHeight,
  type BlockWidgetHeightBinding,
} from "./block-widget-height";
import { cloneRenderedHTMLElement } from "./widget-core";

const displayMathHeightCache = new Map<string, number>();
const displayMathDomCache = new Map<string, HTMLElement>();
const inlineMathDomCache = new Map<string, HTMLElement>();
const DEFAULT_DISPLAY_MATH_HEIGHT_PX = 32;
const DISPLAY_MATH_EXTRA_LINE_HEIGHT_PX = 14;
const MAX_ESTIMATED_DISPLAY_MATH_HEIGHT_PX = 96;

function estimateDisplayMathHeight(latex: string): number {
  let lineCount = Math.max(1, latex.split("\n").length);
  if (latex.includes("\\\\") || latex.includes("\\begin{")) {
    lineCount += 1;
  }
  return Math.min(
    MAX_ESTIMATED_DISPLAY_MATH_HEIGHT_PX,
    DEFAULT_DISPLAY_MATH_HEIGHT_PX + (lineCount - 1) * DISPLAY_MATH_EXTRA_LINE_HEIGHT_PX,
  );
}

export function clearKatexCache(): void {
  clearKatexHtmlCache();
  displayMathDomCache.clear();
  inlineMathDomCache.clear();
}

/**
 * Render LaTeX into an HTML element using KaTeX.
 * Shared helper used by MathWidget and MathPreviewPlugin.
 */
export function renderKatex(
  element: HTMLElement,
  latex: string,
  isDisplay: boolean,
  macros: Record<string, string>,
): void {
  try {
    // Inline widgets dominate large-doc mounted DOM. Keep display math on the
    // full KaTeX output path, but drop the duplicated MathML subtree for inline
    // widgets because the wrapper already provides an accessible label.
    element.innerHTML = renderKatexToHtml(
      latex,
      isDisplay,
      macros,
      isDisplay ? "htmlAndMathml" : "html",
    );
  } catch (err: unknown) {
    element.className = "cf-math-error";
    element.setAttribute("role", "alert");
    element.textContent = err instanceof Error ? err.message : "KaTeX error";
  }
}

function findMathRoot(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>(`.${CSS.mathInline}, .${CSS.mathDisplay}`) ?? el;
}

function resolveLiveMathRegion(
  view: EditorView,
  el: HTMLElement,
): MathSemantics | undefined {
  const state = view.state as EditorState & {
    field?: EditorState["field"];
  };
  if (typeof state.field !== "function") return undefined;

  const regions = view.state.field(documentAnalysisField).mathRegions;
  const positions: number[] = [];
  const seen = new Set<number>();

  const addPos = (pos: number): void => {
    if (!Number.isFinite(pos) || seen.has(pos)) return;
    seen.add(pos);
    positions.push(pos);
  };

  try {
    addPos(view.posAtDOM(el));
  } catch (_error) {
    // Ignore stale DOM nodes during transient redraws.
  }

  const widgetRoot = el.closest<HTMLElement>(`.${CSS.mathInline}, .${CSS.mathDisplay}`);
  if (widgetRoot && widgetRoot !== el) {
    try {
      addPos(view.posAtDOM(widgetRoot));
    } catch (_error) {
      // Ignore stale DOM nodes during transient redraws.
    }
  }

  for (const pos of positions) {
    const region = findMathRegionAtPos(regions, pos);
    if (region) return region;
  }

  return undefined;
}

/** Unified widget that renders both inline and display math via KaTeX. */
export class MathWidget extends ShellMacroAwareWidget {
  private readonly displayHeightBinding: BlockWidgetHeightBinding = {
    resizeObserver: null,
    resizeMeasureFrame: null,
    reconnectObserver: null,
    detachedMeasureWarned: false,
  };
  private readonly inlineDomCacheKey: string;
  private readonly displayMeasurementKey: string;
  private readonly displayDomCacheKey: string;

  constructor(
    private readonly latex: string,
    private readonly raw: string,
    private readonly isDisplay: boolean,
    private readonly macros: Record<string, string> = {},
    private readonly contentOffset = 0,
    private readonly equationNumber?: number,
  ) {
    super(macros);
    this.inlineDomCacheKey = [
      this.latex,
      this.macrosKey,
    ].join("\u0001");
    this.displayMeasurementKey = [
      this.raw,
      this.macrosKey,
      this.equationNumber === undefined ? "" : String(this.equationNumber),
    ].join("\u0001");
    this.displayDomCacheKey = [
      this.latex,
      this.raw,
      this.macrosKey,
      this.equationNumber === undefined ? "" : String(this.equationNumber),
    ].join("\u0001");
  }

  override updateSourceRange(from: number, to: number): void {
    super.updateSourceRange(from, to);
    if (!this.isDisplay) {
      this.shellSurfaceFrom = -1;
      this.shellSurfaceTo = -1;
    }
  }

  private syncDisplayLayout(el: HTMLElement): void {
    el.classList.toggle(
      CSS.mathDisplayNumbered,
      this.equationNumber !== undefined,
    );
  }

  private syncDisplayEquationNumber(el: HTMLElement): void {
    const selector = `.${CSS.mathDisplayNumber}`;
    const numberText = this.equationNumber !== undefined
      ? `(${this.equationNumber})`
      : undefined;
    const numberEl = el.querySelector<HTMLElement>(selector);

    if (!numberText) {
      numberEl?.remove();
      return;
    }

    if (numberEl) {
      numberEl.textContent = numberText;
      return;
    }

    const nextNumberEl = document.createElement("span");
    nextNumberEl.className = CSS.mathDisplayNumber;
    nextNumberEl.textContent = numberText;
    el.appendChild(nextNumberEl);
  }

  protected override bindSourceReveal(
    el: HTMLElement,
    view: EditorView,
  ): void {
    el.style.cursor = "pointer";
    const eventType = this.isDisplay ? "mousedown" : "click";
    el.addEventListener(eventType, (event) => {
      if (!isPlainPrimaryMouseEvent(event)) return;
      event.preventDefault();
      view.focus();

      const root = findMathRoot(el);
      const currentWidget = widgetSourceMap.get(root);
      const liveWidget = currentWidget instanceof MathWidget ? currentWidget : this;
      // Prefer live semantics when possible so click-to-source stays correct
      // even if CM6 briefly reuses DOM or widget instances during remapping.
      const region = resolveLiveMathRegion(view, root);
      const sourceFrom = region?.from ?? liveWidget.sourceFrom;
      const sourceTo = region?.to ?? liveWidget.sourceTo;
      const contentOffset = region
        ? region.contentFrom - region.from
        : liveWidget.contentOffset;
      const latex = region?.latex ?? liveWidget.latex;

      const pos = resolveClickToSourcePos(
        el,
        event,
        latex,
        sourceFrom,
        sourceTo,
        contentOffset,
      );
      if (region?.isDisplay ?? liveWidget.isDisplay) {
        const target = createStructureEditTargetAt(view.state, sourceFrom);
        if (target) {
          activateStructureEditTarget(view, target, pos);
          return;
        }
      }
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    });
  }

  private createSharedDisplayDOM(): HTMLElement {
    const cached = displayMathDomCache.get(this.displayDomCacheKey);
    if (cached) {
      return cloneRenderedHTMLElement(cached);
    }

    const el = document.createElement("div");
    el.className = documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.displayMath,
      CSS.mathDisplay,
    );
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", this.latex);
    const content = document.createElement("div");
    renderKatex(content, this.latex, this.isDisplay, this.macros);
    content.className = CSS.mathDisplayContent;
    el.appendChild(content);
    this.syncDisplayLayout(el);
    this.syncDisplayEquationNumber(el);
    displayMathDomCache.set(this.displayDomCacheKey, cloneRenderedHTMLElement(el));
    return el;
  }

  private createSharedInlineDOM(): HTMLElement {
    const cached = inlineMathDomCache.get(this.inlineDomCacheKey);
    if (cached) {
      return cloneRenderedHTMLElement(cached);
    }

    const el = document.createElement("span");
    el.className = CSS.mathInline;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", this.latex);
    renderKatex(el, this.latex, this.isDisplay, this.macros);
    inlineMathDomCache.set(this.inlineDomCacheKey, cloneRenderedHTMLElement(el));
    return el;
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      if (this.isDisplay) {
        return this.createSharedDisplayDOM();
      }
      return this.createSharedInlineDOM();
    });
  }

  private heightBinding(): BlockWidgetHeightBinding {
    return this.displayHeightBinding;
  }

  private observeDisplayHeight(
    el: HTMLElement,
    view: EditorView,
  ): void {
    if (!this.isDisplay) return;
    observeBlockWidgetHeight(
      this.heightBinding(),
      el,
      view,
      displayMathHeightCache,
      this.displayMeasurementKey,
    );
  }

  override toDOM(view?: EditorView): HTMLElement {
    if (!this.isDisplay) return super.toDOM(view);

    const el = this.createDOM();
    this.syncWidgetAttrs(el, view);
    el.dataset.activeFenceGuides = "true";
    syncActiveFenceGuideClasses(el, view, this.sourceFrom, this.sourceTo);

    if (this.sourceFrom >= 0 && view) {
      const content = el.querySelector<HTMLElement>(`.${CSS.mathDisplayContent}`);
      if (content) {
        this.bindSourceReveal(content, view);
        el.addEventListener("mousedown", (event) => {
          if (event.target instanceof Node && content.contains(event.target)) return;
          event.preventDefault();
          view.focus();
        });
      } else {
        this.bindSourceReveal(el, view);
      }
      this.observeDisplayHeight(el, view);
    }

    return el;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof MathWidget &&
      this.raw === other.raw &&
      this.isDisplay === other.isDisplay &&
      this.macrosKey === other.macrosKey &&
      this.equationNumber === other.equationNumber
    );
  }

  updateDOM(dom: HTMLElement, view?: EditorView, from?: WidgetType): boolean {
    const expectedTag = this.isDisplay ? "DIV" : "SPAN";
    if (dom.tagName !== expectedTag) return false;

    if (from instanceof MathWidget) {
      from.clearDisplayHeightMeasurement();
    }

    dom.className = this.isDisplay
      ? documentSurfaceClassNames(DOCUMENT_SURFACE_CLASS.displayMath, CSS.mathDisplay)
      : CSS.mathInline;
    dom.setAttribute("role", "img");
    dom.setAttribute("aria-label", this.latex);

    if (this.isDisplay) {
      const content = dom.firstElementChild as HTMLElement | null;
      if (!content) return false;
      content.className = CSS.mathDisplayContent;
      renderKatex(content, this.latex, true, this.macros);
      this.syncDisplayLayout(dom);
      this.syncDisplayEquationNumber(dom);
    } else {
      renderKatex(dom, this.latex, false, this.macros);
    }

    this.syncWidgetAttrs(dom, view);
    if (this.isDisplay) {
      dom.dataset.activeFenceGuides = "true";
      syncActiveFenceGuideClasses(dom, view, this.sourceFrom, this.sourceTo);
    } else {
      delete dom.dataset.activeFenceGuides;
      clearActiveFenceGuideClasses(dom);
    }
    if (this.isDisplay && view) {
      this.observeDisplayHeight(dom, view);
    }
    return true;
  }

  private clearDisplayHeightMeasurement(): void {
    clearBlockWidgetHeightBinding(this.heightBinding());
  }

  destroy(_dom?: HTMLElement): void {
    this.clearDisplayHeightMeasurement();
  }

  get estimatedHeight(): number {
    if (!this.isDisplay) return -1;
    const cached = estimatedBlockWidgetHeight(
      displayMathHeightCache,
      this.displayMeasurementKey,
    );
    return cached >= 0 ? cached : estimateDisplayMathHeight(this.latex);
  }

  override ignoreEvent(): boolean {
    return this.isDisplay;
  }
}
