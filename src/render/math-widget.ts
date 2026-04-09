import type { EditorState } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import katexStyles from "katex/dist/katex.min.css?inline";
import { CSS } from "../constants/css-classes";
import { isPlainPrimaryMouseEvent } from "../editor/mouse-selection-core";
import { documentAnalysisField } from "../semantics/codemirror-source";
import type { MathSemantics } from "../semantics/document";
import { clearKatexHtmlCache, renderKatexToHtml } from "./inline-shared";
import { resolveClickToSourcePos } from "./math-interactions";
import { findMathRegionAtPos } from "./math-source";
import { MacroAwareWidget, widgetSourceMap } from "./source-widget";
import {
  activateStructureEditTarget,
  createStructureEditTargetAt,
} from "../editor/structure-edit-state";
import {
  clearBlockWidgetHeightBinding,
  estimatedBlockWidgetHeight,
  observeBlockWidgetHeight,
  type BlockWidgetHeightBinding,
} from "./block-widget-height";

const KATEX_STYLE_ID = "cf-katex-styles";
const displayMathHeightCache = new Map<string, number>();

function ensureKatexStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(KATEX_STYLE_ID)) return;

  const styleEl = document.createElement("style");
  styleEl.id = KATEX_STYLE_ID;
  styleEl.textContent = katexStyles;
  document.head.appendChild(styleEl);
}

ensureKatexStyles();

export function clearKatexCache(): void {
  clearKatexHtmlCache();
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
    element.innerHTML = renderKatexToHtml(latex, isDisplay, macros);
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
  } catch {
    // Ignore stale DOM nodes during transient redraws.
  }

  const widgetRoot = el.closest<HTMLElement>(`.${CSS.mathInline}, .${CSS.mathDisplay}`);
  if (widgetRoot && widgetRoot !== el) {
    try {
      addPos(view.posAtDOM(widgetRoot));
    } catch {
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
export class MathWidget extends MacroAwareWidget {
  private readonly displayHeightBinding: BlockWidgetHeightBinding = {
    resizeObserver: null,
    resizeMeasureFrame: null,
  };
  private readonly displayMeasurementKey: string;

  constructor(
    private readonly latex: string,
    private readonly raw: string,
    private readonly isDisplay: boolean,
    private readonly macros: Record<string, string> = {},
    private readonly contentOffset = 0,
    private readonly equationNumber?: number,
  ) {
    super(macros);
    this.displayMeasurementKey = [
      this.raw,
      this.macrosKey,
      this.equationNumber === undefined ? "" : String(this.equationNumber),
    ].join("\u0001");
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

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement(this.isDisplay ? "div" : "span");
      el.className = this.isDisplay ? CSS.mathDisplay : CSS.mathInline;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", this.latex);
      if (this.isDisplay) {
        const content = document.createElement("div");
        renderKatex(content, this.latex, this.isDisplay, this.macros);
        content.className = CSS.mathDisplayContent;
        el.appendChild(content);
        this.syncDisplayLayout(el);
        this.syncDisplayEquationNumber(el);
        return el;
      }
      renderKatex(el, this.latex, this.isDisplay, this.macros);
      return el;
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
    this.setSourceRangeAttrs(el);

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

    dom.className = this.isDisplay ? CSS.mathDisplay : CSS.mathInline;
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

    this.setSourceRangeAttrs(dom);
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
    return estimatedBlockWidgetHeight(
      displayMathHeightCache,
      this.displayMeasurementKey,
    );
  }

  override ignoreEvent(): boolean {
    return this.isDisplay;
  }
}
