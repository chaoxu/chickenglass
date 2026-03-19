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
  ViewPlugin,
  type ViewUpdate,
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
import { renderKatex } from "./math-render";
import { getMathMacros } from "./math-macros";

/** Split text by $...$ inline math, returning alternating text/math segments. */
function splitByInlineMath(
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

interface FootnoteRef {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

interface FootnoteDef {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly content: string;
  readonly labelTo: number;
}

/** Collect footnote references and definitions from the syntax tree. */
function collectFootnotes(state: EditorState): {
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
    return sup;
  }

  eq(other: FootnoteRefWidget): boolean {
    return this.number === other.number && this.id === other.id;
  }
}

/** Widget for a footnote definition rendered as a margin sidenote. */
class SidenoteWidget extends RenderWidget {
  constructor(
    private readonly number: number,
    private readonly content: string,
    private readonly macros: Record<string, string>,
    private readonly macrosKey: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const aside = document.createElement("span");
    aside.className = "cg-sidenote";

    const numSpan = document.createElement("span");
    numSpan.className = "cg-sidenote-number";
    numSpan.textContent = String(this.number);
    aside.appendChild(numSpan);

    const contentSpan = document.createElement("span");
    contentSpan.className = "cg-sidenote-content";

    for (const seg of splitByInlineMath(this.content)) {
      if (!seg.isMath) {
        // Render bold (**text**) and italic (*text*) simply
        const processed = seg.content
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>");
        const frag = document.createElement("span");
        frag.innerHTML = processed;
        contentSpan.appendChild(frag);
      } else {
        const mathEl = document.createElement("span");
        renderKatex(mathEl, seg.content, false, this.macros);
        contentSpan.appendChild(mathEl);
      }
    }

    aside.appendChild(contentSpan);
    return aside;
  }

  eq(other: SidenoteWidget): boolean {
    return (
      this.number === other.number &&
      this.content === other.content &&
      this.macrosKey === other.macrosKey
    );
  }
}

/** Build sidenote decorations from editor state. */
function buildSidenoteDecorations(state: EditorState, focused: boolean): DecorationSet {
  const { refs, defs } = collectFootnotes(state);
  const items: Range<Decoration>[] = [];
  const macros = getMathMacros(state);
  const macrosKey =
    Object.keys(macros).length > 0
      ? Object.keys(macros)
          .sort()
          .map((k) => `${k}=${macros[k]}`)
          .join("\0")
      : "";

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

  // Render defs as margin sidenotes
  for (const [id, def] of defs) {
    if (focused && cursorContainedIn(state, def.from, def.to)) continue;

    const num = numberMap.get(id) ?? 0;
    const widget = new SidenoteWidget(num, def.content, macros, macrosKey);
    widget.sourceFrom = def.from;

    // Replace the entire definition line with the sidenote widget
    items.push(Decoration.replace({ widget }).range(def.from, def.to));

    // Add a line class to hide the definition block visually when replaced
    items.push(
      Decoration.line({ class: "cg-sidenote-def-line" }).range(def.from),
    );
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

/**
 * ViewPlugin that resolves vertical overlap between sidenotes after layout.
 *
 * After each update that may change sidenote positions, it measures all
 * .cg-sidenote elements, computes collision-free offsets, and applies
 * CSS transforms to push overlapping sidenotes downward.
 */
const sidenoteLayoutPlugin = ViewPlugin.fromClass(
  class {
    private rafId = 0;

    constructor(private view: EditorView) {
      // Run synchronously on first layout to avoid one-frame overlap flash
      this.resolveOverlaps();
    }

    update(_update: ViewUpdate) {
      this.scheduleLayout();
    }

    private scheduleLayout() {
      cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(() => this.resolveOverlaps());
    }

    private resolveOverlaps() {
      const sidenotes = [
        ...this.view.dom.querySelectorAll(".cg-sidenote"),
      ] as HTMLElement[];

      if (sidenotes.length === 0) return;

      // Reset transforms to measure natural (anchor) positions
      for (const s of sidenotes) s.style.transform = "";
      void sidenotes[0].offsetHeight; // force reflow

      // Measure natural positions
      const measured = sidenotes.map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, naturalTop: rect.top, height: rect.height };
      });

      // Sort by natural anchor position (document order)
      measured.sort((a, b) => a.naturalTop - b.naturalTop);

      // Stack: each sidenote goes at max(its anchor, previous bottom + gap).
      // This ensures they never overlap — they form a top-to-bottom list
      // with gaps, anchored as close to their reference as possible.
      let nextAvailableTop = -Infinity;

      for (const m of measured) {
        const targetTop = Math.max(m.naturalTop, nextAvailableTop);
        const offset = targetTop - m.naturalTop;
        if (offset > 0.5) {
          m.el.style.transform = `translateY(${offset}px)`;
        } else {
          m.el.style.transform = "";
        }
        nextAvailableTop = targetTop + m.height + SIDENOTE_GAP;
      }
    }

    destroy() {
      cancelAnimationFrame(this.rafId);
    }
  },
);

/** CM6 extension that renders footnotes as Tufte-style sidenotes. */
export const sidenoteRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  sidenoteDecorationField,
  sidenoteLayoutPlugin,
];
