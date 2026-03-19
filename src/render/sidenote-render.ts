/**
 * CM6 StateField that renders footnotes as Tufte-style sidenotes.
 *
 * - FootnoteRef [^id] outside cursor → superscript number widget
 * - FootnoteDef [^id]: content outside cursor → margin-positioned sidenote widget
 *   with the definition line hidden (replaced by the sidenote in the margin)
 *
 * Uses a StateField (not ViewPlugin) so that line decorations and
 * block-level replace decorations are permitted by CM6.
 */

import {
  type DecorationSet,
  Decoration,
  EditorView,
} from "@codemirror/view";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  buildDecorations,
  cursorContainedIn,
  RenderWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./render-utils";

/** Split text by $...$ inline math, returning alternating text/math segments. */
export function splitByInlineMath(
  text: string,
): Array<{ isMath: boolean; content: string }> {
  const segments: Array<{ isMath: boolean; content: string }> = [];
  const regex = /\$([^$\n]+)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ isMath: false, content: text.slice(lastIndex, match.index) });
    }
    segments.push({ isMath: true, content: match[1] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ isMath: false, content: text.slice(lastIndex) });
  }

  return segments;
}

export interface FootnoteRef {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

export interface FootnoteDef {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly content: string;
  readonly labelTo: number;
}

/** Collect footnote references and definitions from the syntax tree. */
export function collectFootnotes(state: EditorState): {
  refs: FootnoteRef[];
  defs: Map<string, FootnoteDef>;
} {
  const refs: FootnoteRef[] = [];
  const defs = new Map<string, FootnoteDef>();
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.type.name === "FootnoteRef") {
        const text = state.sliceDoc(node.from, node.to);
        // Extract id from [^id]
        const id = text.slice(2, -1);
        refs.push({ id, from: node.from, to: node.to });
      } else if (node.type.name === "FootnoteDef") {
        const text = state.sliceDoc(node.from, node.to);
        // Extract id from [^id]: content
        const bracketEnd = text.indexOf("]:");
        if (bracketEnd >= 0) {
          const id = text.slice(2, bracketEnd);
          // Content starts after "]: " (with optional space)
          let contentStart = bracketEnd + 2;
          if (contentStart < text.length && text.charCodeAt(contentStart) === 32) {
            contentStart++;
          }
          const content = text.slice(contentStart);

          // Find the FootnoteDefLabel child to get its end position
          let labelTo = node.from + bracketEnd + 2;
          const defNode = node.node;
          const labelChild = defNode.getChild("FootnoteDefLabel");
          if (labelChild) {
            labelTo = labelChild.to;
          }

          defs.set(id, {
            id,
            from: node.from,
            to: node.to,
            content,
            labelTo,
          });
        }
      }
    },
  });

  return { refs, defs };
}

/** Widget for a footnote reference rendered as a superscript number. */
class FootnoteRefWidget extends RenderWidget {
  constructor(
    private readonly number: number,
    private readonly id: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const sup = document.createElement("sup");
    sup.className = "cg-sidenote-ref";
    sup.textContent = String(this.number);
    sup.title = `Footnote ${this.id}`;
    sup.setAttribute("data-footnote-id", this.id);
    return sup;
  }

  eq(other: FootnoteRefWidget): boolean {
    return this.number === other.number && this.id === other.id;
  }
}

/** Build sidenote decorations from editor state. */
function buildSidenoteDecorations(state: EditorState, focused: boolean): DecorationSet {
  const { refs, defs } = collectFootnotes(state);
  const items: Range<Decoration>[] = [];

  // Assign numbers to footnotes in order of first reference appearance
  const numberMap = new Map<string, number>();
  let nextNumber = 1;
  for (const ref of refs) {
    if (!numberMap.has(ref.id)) {
      numberMap.set(ref.id, nextNumber++);
    }
  }

  // Render refs as superscript numbers
  for (const ref of refs) {
    if (focused && cursorContainedIn(state, ref.from, ref.to)) continue;

    const num = numberMap.get(ref.id) ?? 0;
    const widget = new FootnoteRefWidget(num, ref.id);
    widget.sourceFrom = ref.from;
    items.push(Decoration.replace({ widget }).range(ref.from, ref.to));
  }

  // Hide footnote definition lines (content is rendered in React margin column).
  // When cursor is inside a def, show the source text for editing.
  for (const [, def] of defs) {
    if (focused && cursorContainedIn(state, def.from, def.to)) continue;

    // Collapse the definition line to zero height
    items.push(
      Decoration.line({ class: "cg-sidenote-def-line" }).range(def.from),
    );
    // Replace text content (after label) with empty widget to hide it visually
    if (def.labelTo < def.to) {
      items.push(
        Decoration.replace({}).range(def.labelTo, def.to),
      );
    }
  }

  return buildDecorations(items);
}

/**
 * CM6 StateField that provides sidenote rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) are permitted.
 */
const sidenoteDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildSidenoteDecorations(state, false);
  },

  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(focusEffect)) ||
      syntaxTree(tr.state).length > syntaxTree(tr.startState).length
    ) {
      const focused = tr.state.field(editorFocusField, false) ?? false;
      return buildSidenoteDecorations(tr.state, focused);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** Minimum vertical gap in pixels between stacked sidenotes. */
const SIDENOTE_GAP = 4;

/** Measurement data for a single sidenote used by the collision resolver. */
export interface SidenoteMeasurement {
  readonly top: number;
  readonly height: number;
}

/**
 * Compute translateY offsets to resolve vertical overlap between sidenotes.
 *
 * Walks top-to-bottom, tracking the bottom edge of the last placed sidenote.
 * If the next sidenote's top is above that edge (plus gap), it gets pushed down.
 *
 * Returns an array of pixel offsets (0 means no adjustment needed).
 */
export function computeSidenoteOffsets(
  measurements: readonly SidenoteMeasurement[],
  gap: number = SIDENOTE_GAP,
): number[] {
  const offsets = new Array<number>(measurements.length).fill(0);
  let prevBottom = -Infinity;

  for (let i = 0; i < measurements.length; i++) {
    const { top, height } = measurements[i];
    if (top < prevBottom + gap) {
      offsets[i] = prevBottom + gap - top;
    }
    prevBottom = top + offsets[i] + height;
  }

  return offsets;
}


/** CM6 extension that renders footnote refs as superscripts and hides defs.
 *  Sidenote content is rendered by the React SidenoteMargin component. */
export const sidenoteRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  sidenoteDecorationField,
];
