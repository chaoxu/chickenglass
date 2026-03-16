import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  selectionOverlaps,
  cursorInRange,
  collectNodes,
  buildDecorations,
  RenderWidget,
} from "./render-utils";
import { getMathMacros } from "./math-macros";

const MATH_TYPES = new Set(["InlineMath", "DisplayMath"]);

/** Delimiter patterns for extracting LaTeX content from math nodes. */
const INLINE_DELIMITERS: ReadonlyArray<{ open: string; close: string }> = [
  { open: "\\(", close: "\\)" },
  { open: "$", close: "$" },
];

const DISPLAY_DELIMITERS: ReadonlyArray<{ open: string; close: string }> = [
  { open: "\\[", close: "\\]" },
  { open: "$$", close: "$$" },
];

/** Regex matching a trailing equation label like {#eq:foo}. */
const EQUATION_LABEL_SUFFIX = /\s*\{#eq:[^}\s]+\}\s*$/;

/** Strip math delimiters (and any trailing equation label) from raw source. */
function stripMathDelimiters(raw: string, isDisplay: boolean): string {
  // Remove trailing equation label before checking for closing delimiter
  const stripped = isDisplay ? raw.replace(EQUATION_LABEL_SUFFIX, "") : raw;
  const delimiters = isDisplay ? DISPLAY_DELIMITERS : INLINE_DELIMITERS;
  for (const { open, close } of delimiters) {
    if (stripped.startsWith(open) && stripped.endsWith(close)) {
      return stripped.slice(open.length, stripped.length - close.length);
    }
  }
  return raw;
}

/**
 * Serialize macros to a stable string for use in widget equality checks.
 * Returns an empty string when there are no macros.
 */
function serializeMacros(macros: Record<string, string>): string {
  const keys = Object.keys(macros);
  if (keys.length === 0) return "";
  keys.sort();
  return keys.map((k) => `${k}=${macros[k]}`).join("\0");
}

/** Widget that renders inline math via KaTeX. */
export class InlineMathWidget extends RenderWidget {
  private readonly macrosKey: string;

  constructor(
    private readonly latex: string,
    private readonly raw: string,
    private readonly macros: Record<string, string> = {},
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cg-math-inline";
    try {
      katex.render(this.latex, span, {
        displayMode: false,
        throwOnError: false,
        output: "htmlAndMathml",
        macros: { ...this.macros },
      });
    } catch (err: unknown) {
      span.className = "cg-math-error";
      span.textContent = err instanceof Error ? err.message : "KaTeX error";
    }
    return span;
  }

  eq(other: InlineMathWidget): boolean {
    return this.raw === other.raw && this.macrosKey === other.macrosKey;
  }
}

/** Widget that renders display math via KaTeX. */
export class DisplayMathWidget extends RenderWidget {
  private readonly macrosKey: string;

  constructor(
    private readonly latex: string,
    private readonly raw: string,
    private readonly macros: Record<string, string> = {},
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cg-math-display";
    try {
      katex.render(this.latex, div, {
        displayMode: true,
        throwOnError: false,
        output: "htmlAndMathml",
        macros: { ...this.macros },
      });
    } catch (err: unknown) {
      div.className = "cg-math-error";
      div.textContent = err instanceof Error ? err.message : "KaTeX error";
    }
    return div;
  }

  eq(other: DisplayMathWidget): boolean {
    return this.raw === other.raw && this.macrosKey === other.macrosKey;
  }
}

/**
 * Collect decoration ranges for math nodes outside the cursor.
 *
 * Reads macros from the frontmatter state field and passes them
 * to each math widget for KaTeX rendering.
 */
export function collectMathRanges(view: EditorView): Range<Decoration>[] {
  const macros = getMathMacros(view.state);
  const nodes = collectNodes(view, MATH_TYPES);
  const items: Range<Decoration>[] = [];

  for (const node of nodes) {
    if (cursorInRange(view, node.from, node.to)) continue;

    const raw = view.state.sliceDoc(node.from, node.to);
    const isDisplay = node.type === "DisplayMath";
    const latex = stripMathDelimiters(raw, isDisplay);

    const widget = isDisplay
      ? new DisplayMathWidget(latex, raw, macros)
      : new InlineMathWidget(latex, raw, macros);

    items.push(
      Decoration.replace({
        widget,
        block: isDisplay,
      }).range(node.from, node.to),
    );
  }

  return items;
}

/** Build a DecorationSet for math elements (convenience wrapper). */
export function mathDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectMathRanges(view));
}

/**
 * Build math decorations from EditorState (no view needed).
 * Used by the StateField to produce block-safe decorations.
 */
function buildMathDecorationsFromState(state: EditorState): DecorationSet {
  const macros = getMathMacros(state);
  const nodes = collectNodes(state, MATH_TYPES);
  const items: Range<Decoration>[] = [];

  for (const node of nodes) {
    if (selectionOverlaps(state, node.from, node.to)) continue;

    const raw = state.sliceDoc(node.from, node.to);
    const isDisplay = node.type === "DisplayMath";
    const latex = stripMathDelimiters(raw, isDisplay);

    const widget = isDisplay
      ? new DisplayMathWidget(latex, raw, macros)
      : new InlineMathWidget(latex, raw, macros);

    items.push(
      Decoration.replace({
        widget,
        block: isDisplay,
      }).range(node.from, node.to),
    );
  }

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
    return buildMathDecorationsFromState(state);
  },

  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return buildMathDecorationsFromState(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** CM6 extension that renders math expressions with KaTeX (Typora-style toggle). */
export const mathRenderPlugin: Extension = mathDecorationField;
