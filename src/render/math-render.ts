import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  cursorInRange,
  buildDecorations,
  serializeMacros,
  RenderWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./render-utils";
import { mathMacrosField } from "./math-macros";

export const MATH_TYPES = new Set(["InlineMath", "DisplayMath"]);

/** Mark decoration for math source when cursor is inside — uses KaTeX italic font. */
const mathSourceDecoration = Decoration.mark({ class: "cg-math-source" });

/** A pair of opening and closing delimiters for math expressions. */
export interface MathDelimiterPair {
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

/** Strip math delimiters from raw source. contentTo is the exclusive end of math content (before any label). */
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
    element.className = "cg-math-error";
    element.textContent = err instanceof Error ? err.message : "KaTeX error";
  }
}

/** Unified widget that renders both inline and display math via KaTeX. */
export class MathWidget extends RenderWidget {
  private readonly macrosKey: string;

  constructor(
    private readonly latex: string,
    private readonly raw: string,
    private readonly isDisplay: boolean,
    private readonly macros: Record<string, string> = {},
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
  }

  createDOM(): HTMLElement {
    const el = document.createElement(this.isDisplay ? "div" : "span");
    el.className = this.isDisplay ? "cg-math-display" : "cg-math-inline";
    renderKatex(el, this.latex, this.isDisplay, this.macros);
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
        // Cursor inside: apply math-source styling (italic math font)
        // so raw LaTeX like $e^{i\pi}$ looks natural
        items.push(mathSourceDecoration.range(node.from, node.to));
        return false;
      }

      const raw = state.sliceDoc(node.from, node.to);
      const isDisplay = node.type.name === "DisplayMath";

      // For display math, check for an EquationLabel child to determine content boundary
      let contentTo: number | undefined;
      if (isDisplay) {
        const labelNode = node.node.getChild("EquationLabel");
        if (labelNode) {
          // Content ends where the label begins (relative to node start)
          contentTo = labelNode.from - node.from;
        }
      }

      const latex = stripMathDelimiters(raw, isDisplay, contentTo);

      const widget = new MathWidget(latex, raw, isDisplay, macros);
      widget.sourceFrom = node.from;

      items.push(
        Decoration.replace({
          widget,
          // block: true breaks CM6 height tracking for subsequent lines
          block: false,
        }).range(node.from, node.to),
      );

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

/** Build a DecorationSet for math elements (convenience wrapper). */
export function mathDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectMathRanges(view));
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
const mathDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildMathDecorationsFromState(state, false);
  },

  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(focusEffect)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      const focused = tr.state.field(editorFocusField, false) ?? false;
      return buildMathDecorationsFromState(tr.state, focused);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** CM6 extension that renders math expressions with KaTeX (Typora-style toggle). */
export const mathRenderPlugin: Extension = [editorFocusField, focusTracker, mathMacrosField, mathDecorationField];
