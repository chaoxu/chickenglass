import { type EditorState, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import { CSS } from "../constants/css-classes";
import {
  cursorInRange,
  buildDecorations,
  createDecorationsField,
  pushWidgetDecoration,
  MacroAwareWidget,
  editorFocusField,
  focusTracker,
} from "./render-utils";
import { mathMacrosField } from "./math-macros";

export const MATH_TYPES = new Set(["InlineMath", "DisplayMath"]);

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
    katex.render(latex, element, {
      displayMode: isDisplay,
      throwOnError: false,
      output: "htmlAndMathml",
      macros: { ...macros },
    });
  } catch (err: unknown) {
    element.className = "cf-math-error";
    element.setAttribute("role", "alert");
    element.textContent = err instanceof Error ? err.message : "KaTeX error";
  }
}

/** Unified widget that renders both inline and display math via KaTeX. */
export class MathWidget extends MacroAwareWidget {
  constructor(
    private readonly latex: string,
    private readonly raw: string,
    private readonly isDisplay: boolean,
    private readonly macros: Record<string, string> = {},
  ) {
    super(macros);
  }

  createDOM(): HTMLElement {
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
}

/**
 * Build decoration ranges for math nodes, skipping nodes where
 * `shouldSkip(from, to)` returns true (typically a cursor check).
 *
 * Shared helper used by both collectMathRanges() and
 * buildMathDecorationsFromState().
 *
 * NOTE: collectNodeRangesExcludingCursor() does not apply here.
 * This function operates on EditorState (not EditorView), because it is called
 * from both a ViewPlugin (EditorView path) and a StateField (EditorState path).
 * collectNodeRangesExcludingCursor requires an EditorView for visible ranges and
 * focus-guarded cursor checks. Additionally, when shouldSkip returns true the
 * callback adds Decoration.mark items (cf-math-source) rather than skipping —
 * this dual-path logic cannot be expressed as a simple "exclude and push widget"
 * callback.
 */
function buildMathItems(
  state: EditorState,
  shouldSkip: (from: number, to: number) => boolean,
): Range<Decoration>[] {
  const macros = state.field(mathMacrosField);
  const items: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (!MATH_TYPES.has(node.type.name)) return;

      if (shouldSkip(node.from, node.to)) {
        // Cursor inside math — add monospace mark on content between delimiters.
        // The delimiters ($, $$, \(, \[) already get monospace via tok-processingInstruction.
        const isDisplay = node.type.name === "DisplayMath";
        const markName = isDisplay ? "DisplayMathMark" : "InlineMathMark";
        const marks = node.node.getChildren(markName);
        if (marks.length >= 2) {
          const contentFrom = marks[0].to;
          const contentTo = marks[marks.length - 1].from;
          if (contentFrom < contentTo) {
            items.push(
              Decoration.mark({ class: "cf-math-source" }).range(contentFrom, contentTo),
            );
          }
          // Equation label after closing delimiter (e.g. {#eq:gaussian}) — also monospace
          if (isDisplay) {
            const labelFrom = marks[marks.length - 1].to;
            const labelTo = node.to;
            if (labelTo > labelFrom) {
              items.push(
                Decoration.mark({ class: "cf-math-source" }).range(labelFrom, labelTo),
              );
            }
          }
        }
        return false;
      }

      const raw = state.sliceDoc(node.from, node.to);
      const isDisplay = node.type.name === "DisplayMath";
      const contentTo = isDisplay ? getDisplayMathContentEnd(node.node) : undefined;
      const latex = stripMathDelimiters(raw, isDisplay, contentTo);

      // block: true breaks CM6 height tracking for subsequent lines
      pushWidgetDecoration(items, new MathWidget(latex, raw, isDisplay, macros), node.from, node.to);

      return false; // don't descend into math children
    },
  });

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
 * CM6 StateField that provides math rendering decorations.
 *
 * Uses a StateField (not ViewPlugin) so that block-level replace decorations
 * for display math (which cross line breaks) are permitted by CM6.
 */
const mathDecorationField = createDecorationsField((state) => {
  const focused = state.field(editorFocusField, false) ?? false;
  return buildMathDecorationsFromState(state, focused);
});

/** CM6 extension that renders math expressions with KaTeX (Typora-style toggle). */
export const mathRenderPlugin: Extension = [editorFocusField, focusTracker, mathMacrosField, mathDecorationField];
