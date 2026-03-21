/**
 * CM6 decoration provider for fenced code blocks (```lang ... ```).
 *
 * For each FencedCode node in the syntax tree:
 * - When cursor is outside: hide opening/closing fence lines with
 *   decorationHidden, add Decoration.line with data-language and cg-codeblock
 *   class. Language label shown via CSS ::before.
 * - When cursor is inside: show source (no hiding decorations).
 *
 * Uses a StateField (not ViewPlugin) so that Decoration.line is permitted
 * by CM6.
 */

import {
  type DecorationSet,
  Decoration,
  EditorView,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  cursorInRange,
  buildDecorations,
  decorationHidden,
  RenderWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./render-utils";

/** Widget that renders a copy-to-clipboard button in the code block header. */
class CopyButtonWidget extends RenderWidget {
  constructor(private readonly code: string) {
    super();
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "cg-codeblock-copy";
    btn.textContent = "Copy";
    btn.title = "Copy code to clipboard";
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.writeText(this.code).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy"; }, 1500);
      });
    });
    return btn;
  }

  eq(other: CopyButtonWidget): boolean {
    return this.code === other.code;
  }
}

interface CodeBlockInfo {
  /** Start of the FencedCode node (opening fence line start). */
  readonly from: number;
  /** End of the FencedCode node (closing fence line end). */
  readonly to: number;
  /** Start of opening fence line. */
  readonly openFenceFrom: number;
  /** End of opening fence line (including language tag). */
  readonly openFenceTo: number;
  /** Start of closing fence line. */
  readonly closeFenceFrom: number;
  /** End of closing fence line. */
  readonly closeFenceTo: number;
  /** Language identifier (empty string if none). */
  readonly language: string;
}

/** Extract info about FencedCode nodes from the syntax tree. */
function collectCodeBlocks(state: EditorState): CodeBlockInfo[] {
  const results: CodeBlockInfo[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.type.name !== "FencedCode") return;

      // The opening fence line is the first line of the FencedCode node.
      const openLine = state.doc.lineAt(node.from);
      const openFenceFrom = openLine.from;
      const openFenceTo = openLine.to;

      // The closing fence line is the last line of the FencedCode node.
      const closeLine = state.doc.lineAt(node.to);
      const closeFenceFrom = closeLine.from;
      const closeFenceTo = closeLine.to;

      // Extract language from CodeInfo child node.
      let language = "";
      const codeInfoNode = node.node.getChild("CodeInfo");
      if (codeInfoNode) {
        language = state.doc.sliceString(codeInfoNode.from, codeInfoNode.to).trim();
      }

      results.push({
        from: node.from,
        to: node.to,
        openFenceFrom,
        openFenceTo,
        closeFenceFrom,
        closeFenceTo,
        language,
      });
    },
  });

  return results;
}

/** Build decorations for all fenced code blocks. */
function buildCodeBlockDecorations(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  const blocks = collectCodeBlocks(state);
  const items: Range<Decoration>[] = [];

  for (const block of blocks) {
    const cursorInside = focused && cursorInRange(state, block.from, block.to);

    if (cursorInside) {
      // Source mode: show raw markdown with monospace font on all lines.
      // Apply cg-codeblock-source to every line so code keeps its
      // monospace font even when render decorations are off.
      const openLine = state.doc.lineAt(block.openFenceFrom);
      const closeLine = state.doc.lineAt(block.closeFenceFrom);
      for (let ln = openLine.number; ln <= closeLine.number; ln++) {
        const line = state.doc.line(ln);
        items.push(
          Decoration.line({ class: "cg-codeblock cg-codeblock-source" }).range(line.from),
        );
      }
      continue;
    }

    // Rendered mode: unified container appearance via per-line classes.

    const openLine = state.doc.lineAt(block.openFenceFrom);
    const closeLine = state.doc.lineAt(block.closeFenceFrom);
    const bodyLineCount = closeLine.number - openLine.number - 1;

    // Header line: language label via ::before, fence text hidden, position:relative for copy btn
    items.push(
      Decoration.line({
        class: "cg-codeblock-header",
        attributes: block.language ? { "data-language": block.language } : {},
      }).range(block.openFenceFrom),
    );
    items.push(decorationHidden.range(block.openFenceFrom, block.openFenceTo));

    // Copy button widget in the header line
    if (bodyLineCount > 0) {
      const codeText = state.doc.sliceString(
        state.doc.line(openLine.number + 1).from,
        state.doc.line(closeLine.number - 1).to,
      );
      items.push(
        Decoration.widget({
          widget: new CopyButtonWidget(codeText),
          side: 1,
        }).range(block.openFenceFrom),
      );
    }

    // Body lines: side borders only (no top/bottom)
    for (let ln = openLine.number + 1; ln < closeLine.number; ln++) {
      const line = state.doc.line(ln);
      const isLast = ln === closeLine.number - 1;
      items.push(
        Decoration.line({
          class: isLast ? "cg-codeblock-last" : "cg-codeblock-body",
        }).range(line.from),
      );
    }

    // If no body lines, header also gets bottom border
    if (bodyLineCount === 0) {
      // Single empty code block — header is also the last line
      items.push(
        Decoration.line({ class: "cg-codeblock-last" }).range(block.openFenceFrom),
      );
    }

    // Hide closing fence line and collapse to zero height
    if (block.closeFenceFrom !== block.openFenceFrom) {
      items.push(decorationHidden.range(block.closeFenceFrom, block.closeFenceTo));
      items.push(
        Decoration.line({ class: "cg-include-fence" }).range(block.closeFenceFrom),
      );
    }
  }

  return buildDecorations(items);
}

/**
 * CM6 StateField that provides code block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) are
 * permitted by CM6.
 */
const codeBlockDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildCodeBlockDecorations(state);
  },

  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(focusEffect)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildCodeBlockDecorations(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** CM6 extension that renders fenced code blocks with language label and fence hiding. */
export const codeBlockRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  codeBlockDecorationField,
];
