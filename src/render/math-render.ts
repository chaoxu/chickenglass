import { type EditorState, type Extension, type Range, type SelectionRange, StateField, type Transaction } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import katexStyles from "katex/dist/katex.min.css?inline";
import { CSS } from "../constants/css-classes";
import {
  cursorInRange,
  buildDecorations,
  pushWidgetDecoration,
  RenderWidget,
  MacroAwareWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
  serializeMacros,
} from "./render-utils";
import { mathMacrosField } from "./math-macros";
import { documentAnalysisField } from "../semantics/codemirror-source";
import type { MathSemantics } from "../semantics/document";
import { clearKatexHtmlCache, renderKatexToHtml } from "./inline-shared";

export { renderKatexToHtml } from "./inline-shared";

export const MATH_TYPES = new Set(["InlineMath", "DisplayMath"]);

const KATEX_STYLE_ID = "cf-katex-styles";

function ensureKatexStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(KATEX_STYLE_ID)) return;

  const styleEl = document.createElement("style");
  styleEl.id = KATEX_STYLE_ID;
  styleEl.textContent = katexStyles;
  document.head.appendChild(styleEl);
}

ensureKatexStyles();

/** A pair of opening and closing delimiters for math expressions. */
interface MathDelimiterPair {
  readonly open: string;
  readonly close: string;
}

/** Delimiter patterns for extracting LaTeX content from inline math nodes. */
export const INLINE_DELIMITERS: ReadonlyArray<MathDelimiterPair> = [
  { open: "\\(", close: "\\)" },
  { open: "$", close: "$" },
];

/** Delimiter patterns for extracting LaTeX content from display math nodes. */
export const DISPLAY_DELIMITERS: ReadonlyArray<MathDelimiterPair> = [
  { open: "\\[", close: "\\]" },
  { open: "$$", close: "$$" },
];

/**
 * Compute the relative content boundary for a display math node that may
 * contain an EquationLabel child.  Returns `undefined` when there is no label,
 * meaning the whole node text is content.
 *
 * The boundary is the offset (relative to the node start) of the end of the
 * closing delimiter mark — everything after that (whitespace + `{#eq:...}`) is
 * the label and must be excluded from the LaTeX passed to KaTeX.
 */
export function getDisplayMathContentEnd(node: SyntaxNode): number | undefined {
  if (!node.getChild("EquationLabel")) return undefined;
  const marks = node.getChildren("DisplayMathMark");
  if (marks.length >= 2) {
    return marks[marks.length - 1].to - node.from;
  }
  return undefined;
}

/** Strip math delimiters from raw source. contentTo slices raw to the end of the closing delimiter (excluding any trailing label). */
export function stripMathDelimiters(raw: string, isDisplay: boolean, contentTo?: number): string {
  // When a content boundary is provided (display math with EquationLabel child), slice before it
  const trimmed = contentTo !== undefined ? raw.slice(0, contentTo) : raw;
  const delimiters = isDisplay ? DISPLAY_DELIMITERS : INLINE_DELIMITERS;
  for (const { open, close } of delimiters) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length);
    }
  }
  return trimmed;
}

/** Clear the KaTeX cache. Called when math macros change. */
export function clearKatexCache(): void {
  clearKatexHtmlCache();
}

/**
 * Render LaTeX into an HTML element using KaTeX.
 * Shared helper used by MathWidget and MathPreviewPlugin.
 * Uses a string cache to avoid redundant KaTeX calls on scroll. (#514)
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

/**
 * Find the best `data-loc-start` value for a click at (clientX, clientY)
 * inside a rendered math container.
 *
 * Picks the smallest element (by area) whose bounding box contains the
 * click point.  Returns undefined if nothing contains it, letting the
 * caller use a proportional fallback instead of snapping to a distant
 * loc'd element (e.g. clicking `(x+y)` in `(x+y)^n`).
 */
function findLocAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | undefined {
  const candidates = root.querySelectorAll<HTMLElement>("[data-loc-start]");
  if (candidates.length === 0) return undefined;

  let bestContaining: HTMLElement | null = null;
  let bestArea = Infinity;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const area = rect.width * rect.height;
      if (area < bestArea) {
        bestArea = area;
        bestContaining = el;
      }
    }
  }

  if (bestContaining) {
    const v = Number.parseInt(bestContaining.dataset.locStart ?? "", 10);
    if (Number.isFinite(v)) return v;
  }

  // No data-loc element contains the click — let the caller's
  // proportional fallback handle it rather than snapping to a
  // distant loc'd element (e.g. clicking (x+y) in (x+y)^n).
  return undefined;
}

/**
 * Snap an absolute document position to the nearest LaTeX token boundary
 * so the cursor doesn't land mid-command (e.g. inside `\alpha`).
 *
 * Exported for the math-preview panel which shares the same fallback path.
 * @internal
 */
export function _snapToTokenBoundary(
  latex: string,
  contentFrom: number,
  absPos: number,
): number {
  const rel = absPos - contentFrom;
  const starts: number[] = [];
  let i = 0;
  while (i < latex.length) {
    starts.push(i);
    if (latex[i] === "\\") {
      i++;
      if (i < latex.length && /[a-zA-Z]/.test(latex[i])) {
        while (i < latex.length && /[a-zA-Z]/.test(latex[i])) i++;
      } else if (i < latex.length) {
        i++;
      }
    } else {
      i++;
    }
  }
  starts.push(latex.length);

  let best = starts[0];
  let bestDist = Math.abs(rel - best);
  for (let j = 1; j < starts.length; j++) {
    const d = Math.abs(rel - starts[j]);
    if (d < bestDist) {
      best = starts[j];
      bestDist = d;
    } else break;
  }
  return contentFrom + best;
}

/**
 * Resolve a click on rendered math to an absolute document position.
 *
 * First tries `findLocAtPoint` (KaTeX's source-location attributes).
 * Falls back to a proportional X-offset estimate snapped to the nearest
 * LaTeX token boundary.
 */
export function resolveClickToSourcePos(
  el: HTMLElement,
  e: MouseEvent,
  latex: string,
  sourceFrom: number,
  sourceTo: number,
  contentOffset: number,
): number {
  const contentFrom = sourceFrom + contentOffset;

  const locStart = findLocAtPoint(el, e.clientX, e.clientY);
  if (locStart !== undefined) {
    return Math.max(sourceFrom, Math.min(sourceTo, contentFrom + locStart));
  }

  // Proportional fallback with token-boundary snapping
  const contentLen = sourceTo - contentFrom;
  if (contentLen > 0) {
    const rect = el.getBoundingClientRect();
    const fraction = rect.width > 0
      ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      : 0;
    const raw = Math.round(contentFrom + fraction * contentLen);
    const snapped = _snapToTokenBoundary(latex, contentFrom, raw);
    return Math.max(sourceFrom, Math.min(sourceTo, snapped));
  }
  return sourceFrom;
}

/** Unified widget that renders both inline and display math via KaTeX. */
export class MathWidget extends MacroAwareWidget {
  constructor(
    private readonly latex: string,
    private readonly raw: string,
    private readonly isDisplay: boolean,
    private readonly macros: Record<string, string> = {},
    private readonly contentOffset = 0,
  ) {
    super(macros);
  }

  protected override bindSourceReveal(
    el: HTMLElement,
    view: EditorView,
  ): void {
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.focus();

      const pos = resolveClickToSourcePos(
        el, e, this.latex, this.sourceFrom, this.sourceTo, this.contentOffset,
      );
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
        // Shrink-wrap the rendered equation so only visible math is clickable.
        content.classList.add(CSS.mathDisplayContent);
        el.appendChild(content);
        return el;
      }
      renderKatex(el, this.latex, this.isDisplay, this.macros);
      return el;
    });
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
    }

    return el;
  }

  eq(other: MathWidget): boolean {
    return (
      this.raw === other.raw &&
      this.isDisplay === other.isDisplay &&
      this.macrosKey === other.macrosKey
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    // Structural mismatch (inline ↔ display) — force full rebuild
    const expectedTag = this.isDisplay ? "DIV" : "SPAN";
    if (dom.tagName !== expectedTag) return false;

    // Reset class/role in case previous render hit a KaTeX error
    dom.className = this.isDisplay ? CSS.mathDisplay : CSS.mathInline;
    dom.setAttribute("role", "img");
    dom.setAttribute("aria-label", this.latex);

    if (this.isDisplay) {
      const content = dom.firstElementChild as HTMLElement | null;
      if (!content) return false;
      content.className = CSS.mathDisplayContent;
      renderKatex(content, this.latex, true, this.macros);
    } else {
      renderKatex(dom, this.latex, false, this.macros);
    }

    // Refresh source-range metadata so search-highlight reads correct positions
    this.setSourceRangeAttrs(dom);
    return true;
  }
}

/**
 * Binary-search the sorted math regions for the one containing the cursor.
 * Returns the matching MathSemantics or undefined if the cursor is outside
 * all math.
 *
 * Shared by both the render path (mathShouldRebuild) and the preview path
 * (MathPreviewPlugin.scheduleCheck).
 */
export function findActiveMath(
  regions: readonly MathSemantics[],
  selection: SelectionRange,
): MathSemantics | undefined {
  const { from, to } = selection;
  let lo = 0;
  let hi = regions.length - 1;
  let candidate: MathSemantics | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const region = regions[mid];
    if (region.from <= from) {
      candidate = region;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return candidate && to <= candidate.to ? candidate : undefined;
}

function mathMacrosChanged(tr: Transaction): boolean {
  const before = tr.startState.field(mathMacrosField, false) ?? {};
  const after = tr.state.field(mathMacrosField, false) ?? {};
  return before !== after && serializeMacros(before) !== serializeMacros(after);
}

function findFocusedActiveMath(state: EditorState): MathSemantics | undefined {
  const focused = state.field(editorFocusField, false) ?? false;
  return focused
    ? findActiveMath(state.field(documentAnalysisField).mathRegions, state.selection.main)
    : undefined;
}

/**
 * Build decoration ranges for math nodes, skipping nodes where
 * `shouldSkip(from, to)` returns true (typically a cursor check).
 *
 * NOTE: collectNodeRangesExcludingCursor() does not apply here.
 * This function operates on EditorState (not EditorView), because it is called
 * from both a ViewPlugin (EditorView path) and a StateField (EditorState path).
 * collectNodeRangesExcludingCursor requires an EditorView for visible ranges and
 * focus-guarded cursor checks. Additionally, when shouldSkip returns true the
 * callback adds source-mark decorations (cf-source-delimiter / cf-math-source)
 * rather than skipping - this dual-path logic cannot be expressed as a simple
 * "exclude and push widget" callback.
 */
function buildMathItems(
  state: EditorState,
  shouldSkip: (from: number, to: number) => boolean,
): Range<Decoration>[] {
  const macros = state.field(mathMacrosField);
  const regions = state.field(documentAnalysisField).mathRegions;
  const items: Range<Decoration>[] = [];

  for (const region of regions) {
    if (shouldSkip(region.from, region.to)) {
      // Opening delimiter — uses cf-source-delimiter so it doesn't push
      // the line box taller than the body content (#789)
      if (region.contentFrom > region.from) {
        items.push(
          Decoration.mark({ class: "cf-source-delimiter" }).range(region.from, region.contentFrom),
        );
      }
      if (region.contentFrom < region.contentTo) {
        items.push(
          Decoration.mark({ class: "cf-math-source" }).range(region.contentFrom, region.contentTo),
        );
      }
      // Closing delimiter — same source-delimiter treatment as opening
      const delimClose = region.isDisplay && region.labelFrom !== undefined
        ? region.labelFrom
        : region.to;
      if (delimClose > region.contentTo) {
        items.push(
          Decoration.mark({ class: "cf-source-delimiter" }).range(region.contentTo, delimClose),
        );
      }
      if (region.isDisplay && region.labelFrom !== undefined && region.to > region.labelFrom) {
        items.push(
          Decoration.mark({ class: "cf-math-source" }).range(region.labelFrom, region.to),
        );
      }
      if (region.isDisplay) {
        const raw = state.sliceDoc(region.from, region.to);
        const widget = new MathWidget(
          region.latex,
          raw,
          true,
          macros,
          region.contentFrom - region.from,
        );
        widget.sourceFrom = region.from;
        widget.sourceTo = region.to;
        items.push(
          Decoration.widget({ widget, block: true, side: 1 }).range(region.to),
        );
      }
      continue;
    }

    const raw = state.sliceDoc(region.from, region.to);

    // block: true breaks CM6 height tracking for subsequent lines
    pushWidgetDecoration(
      items,
      new MathWidget(
        region.latex,
        raw,
        region.isDisplay,
        macros,
        region.contentFrom - region.from,
      ),
      region.from,
      region.to,
    );
  }

  return items;
}

/**
 * Collect decoration ranges for math nodes outside the cursor.
 *
 * Reads macros from the frontmatter state field and passes them
 * to each math widget for KaTeX rendering.
 */
export function collectMathRanges(view: EditorView): Range<Decoration>[] {
  return buildMathItems(view.state, (from, to) => cursorInRange(view, from, to));
}

/**
 * Build math decorations from EditorState.
 * Used by the StateField to produce block-safe decorations.
 * When the editor is focused, nodes containing the cursor show source.
 */
function buildMathDecorationsFromState(state: EditorState, focused: boolean): DecorationSet {
  const items = buildMathItems(
    state,
    (from, to) => focused && cursorInRange(state, from, to),
  );
  return buildDecorations(items);
}

/**
 * Check whether math content is semantically unchanged between two region
 * arrays.  Returns true when count, LaTeX content, display mode, and node
 * size all match — meaning only document positions shifted.
 *
 * For position-only shifts the `latex` field is the same string reference
 * (carried via object spread in mapMathSemantics), so each comparison is
 * an O(1) reference check in the common case.
 */
function mathContentUnchanged(
  before: readonly MathSemantics[],
  after: readonly MathSemantics[],
): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    const b = before[i];
    const a = after[i];
    if (
      b.latex !== a.latex
      || b.isDisplay !== a.isDisplay
      || (b.to - b.from) !== (a.to - a.from)
    ) {
      return false;
    }
  }
  return true;
}

function rebuildMathDecorations(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  return buildMathDecorationsFromState(state, focused);
}

/**
 * CM6 StateField that provides math rendering decorations.
 *
 * Uses a StateField (not ViewPlugin) so that block-level replace decorations
 * for display math (which cross line breaks) are permitted by CM6.
 *
 * On document edits that only shift positions (prose edits outside math),
 * the field maps existing decorations through the changes instead of
 * rebuilding all math widgets — avoiding the dominant cost path of
 * buildMathItems → MathWidget → serializeMacros → KaTeX cache lookups.
 */
const mathDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return rebuildMathDecorations(state);
  },

  update(value, tr) {
    if (mathMacrosChanged(tr)) {
      return rebuildMathDecorations(tr.state);
    }

    const regionsBefore = tr.startState.field(documentAnalysisField).mathRegions;
    const regionsAfter = tr.state.field(documentAnalysisField).mathRegions;

    if (regionsBefore !== regionsAfter) {
      // Regions changed.  When the doc changed and only positions shifted
      // (no content, focus, or explicit selection change), map the existing
      // decoration set through the changes — O(log n) instead of O(n) widget
      // construction.
      if (
        tr.docChanged
        && tr.selection === undefined
        && !tr.effects.some((e) => e.is(focusEffect))
        && mathContentUnchanged(regionsBefore, regionsAfter)
      ) {
        const mapped = value.map(tr.changes);
        // Patch sourceFrom/sourceTo on reused widgets so click-to-edit
        // and search-highlight stay correct after position mapping.
        const cursor = mapped.iter();
        while (cursor.value) {
          const widget = cursor.value.spec?.widget;
          if (widget instanceof RenderWidget) {
            widget.updateSourceRange(cursor.from, cursor.to);
          }
          cursor.next();
        }
        return mapped;
      }
      return rebuildMathDecorations(tr.state);
    }

    // Regions unchanged — check if cursor/focus crossed a math boundary.
    const focusChanged = tr.effects.some((e) => e.is(focusEffect));
    if (tr.selection === undefined && !focusChanged) return value;

    const before = findFocusedActiveMath(tr.startState);
    const after = findFocusedActiveMath(tr.state);
    if (before?.from !== after?.from || before?.to !== after?.to) {
      return rebuildMathDecorations(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

export { mathDecorationField as _mathDecorationFieldForTest };

// ── Idle KaTeX prewarm (#625) ──────────────────────────────────────────────

/**
 * Schedule a callback during browser idle time.
 * Falls back to setTimeout in environments without requestIdleCallback.
 */
function scheduleIdle(callback: (deadline?: IdleDeadline) => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback);
  } else {
    setTimeout(() => callback(undefined), 1);
  }
}

/** Maximum time (ms) to spend prewarming per idle chunk when no deadline is available. */
const PREWARM_BUDGET_MS = 2;

/**
 * ViewPlugin that pre-populates the KaTeX HTML string cache during idle time.
 *
 * After document open or when math regions / macros change, this plugin
 * clears the shared `katexHtmlCache` (evicting stale entries from previous
 * state) and schedules idle callbacks to call `renderKatexToHtml()` for
 * every math region in the document.  Because the result is stored in the
 * shared cache, subsequent `MathWidget.createDOM()` calls hit the cache
 * instead of invoking KaTeX — eliminating the cold-path cost when math
 * first scrolls into view (#625).
 *
 * Eviction strategy:
 * - On region or macro change → clear + re-prewarm (schedulePrewarm)
 * - Safety-net size cap in renderKatexToHtml (MAX_KATEX_CACHE_ENTRIES)
 * Visible widgets are unaffected by clears because they retain their
 * DOM via `createCachedDOM` (render-utils.ts).
 */
const mathPrewarmPlugin = ViewPlugin.fromClass(
  class {
    private generation = 0;
    private lastRegions: readonly MathSemantics[] | null = null;
    private lastMacrosKey = "";

    constructor(view: EditorView) {
      this.schedulePrewarm(view.state);
    }

    update(update: ViewUpdate) {
      const regions = update.state.field(documentAnalysisField).mathRegions;
      const macros = update.state.field(mathMacrosField);
      const macrosKey = serializeMacros(macros);

      if (regions !== this.lastRegions || macrosKey !== this.lastMacrosKey) {
        this.schedulePrewarm(update.state);
      }
    }

    destroy() {
      this.generation++;
    }

    private schedulePrewarm(state: EditorState) {
      this.generation++;
      const gen = this.generation;

      const regions = state.field(documentAnalysisField).mathRegions;
      const macros = state.field(mathMacrosField);

      this.lastRegions = regions;
      this.lastMacrosKey = serializeMacros(macros);

      // Evict entries from previous document / macro state.  Visible widgets
      // retain their DOM via createCachedDOM and do not re-query this cache
      // until their content or macros actually change.
      clearKatexHtmlCache();

      if (regions.length === 0) return;

      let index = 0;

      const processChunk = (deadline?: IdleDeadline) => {
        if (this.generation !== gen) return;

        const start = performance.now();
        while (index < regions.length) {
          if (
            deadline
              ? deadline.timeRemaining() < 1
              : performance.now() - start > PREWARM_BUDGET_MS
          ) {
            break;
          }
          const region = regions[index++];
          try {
            renderKatexToHtml(region.latex, region.isDisplay, macros);
          } catch {
            // KaTeX parse error — skip; the widget will show the error on render.
          }
        }

        if (index < regions.length && this.generation === gen) {
          scheduleIdle(processChunk);
        }
      };

      scheduleIdle(processChunk);
    }
  },
);

/** CM6 extension that renders math expressions with KaTeX (Typora-style toggle). */
export const mathRenderPlugin: Extension = [editorFocusField, focusTracker, mathMacrosField, mathDecorationField, mathPrewarmPlugin];
