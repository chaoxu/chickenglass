import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  cursorInRange,
  cursorContainedIn,
  collectNodes,
  buildDecorations,
  RenderWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./render-utils";
import { getMathMacros } from "./math-macros";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";

export const MATH_TYPES = new Set(["InlineMath", "DisplayMath"]);

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
export function stripMathDelimiters(raw: string, isDisplay: boolean): string {
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

    const widget = new MathWidget(latex, raw, isDisplay, macros);
    widget.sourceFrom = node.from;

    items.push(
      Decoration.replace({
        widget,
        // block: true breaks CM6 height tracking for subsequent lines
        block: false,
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
 * Build math decorations from EditorState.
 * Used by the StateField to produce block-safe decorations.
 * When the editor is focused, nodes containing the cursor show source.
 */
function buildMathDecorationsFromState(state: EditorState, focused: boolean): DecorationSet {
  const macros = getMathMacros(state);
  const nodes = collectNodes(state, MATH_TYPES);
  const items: Range<Decoration>[] = [];

  // Find FencedDivs that contain the cursor — math inside these must be
  // raw text so CM6 can correctly map click positions (no mixed widget/text).
  const activeRanges: Array<{ from: number; to: number }> = [];
  if (focused) {
    const cursor = state.selection.main;
    // Use ensureSyntaxTree to guarantee FencedDiv nodes are parsed
    const tree = ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state);
    tree.iterate({
      enter(n: SyntaxNodeRef) {
        if (n.name === "FencedDiv") {
          const lineFrom = state.doc.lineAt(n.from).from;
          const closeLine = state.doc.lineAt(n.to);
          const lineTo = closeLine.number < state.doc.lines
            ? state.doc.line(closeLine.number + 1).to
            : closeLine.to;
          if (cursor.from >= lineFrom && cursor.to <= lineTo) {
            activeRanges.push({ from: n.from, to: n.to });
          }
        }
      },
    });
  }

  for (const node of nodes) {
    if (focused && cursorContainedIn(state, node.from, node.to)) continue;
    // Skip math inside a block that's in source mode
    const skipped = activeRanges.some(r => node.from >= r.from && node.to <= r.to);
    if (skipped) {
      console.log(`[MATH-SKIP] Skipping math at ${node.from}-${node.to} (inside active block)`);
      continue;
    }

    const raw = state.sliceDoc(node.from, node.to);
    const isDisplay = node.type === "DisplayMath";
    const latex = stripMathDelimiters(raw, isDisplay);

    const widget = new MathWidget(latex, raw, isDisplay, macros);
    widget.sourceFrom = node.from;

    items.push(
      Decoration.replace({
        widget,
        // block: true breaks CM6 height tracking for subsequent lines
        block: false,
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
    return buildMathDecorationsFromState(state, false);
  },

  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(focusEffect))) {
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
export const mathRenderPlugin: Extension = [editorFocusField, focusTracker, mathDecorationField];
