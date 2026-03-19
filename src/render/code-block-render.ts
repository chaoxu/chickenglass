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
  cursorContainedIn,
  buildDecorations,
  decorationHidden,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./render-utils";

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
    const cursorInside = focused && cursorContainedIn(state, block.from, block.to);

    if (cursorInside) {
      // Source mode: show raw markdown, just add a subtle wrapper class.
      items.push(
        Decoration.line({ class: "cg-codeblock cg-codeblock-source" }).range(block.openFenceFrom),
      );
      continue;
    }

    // Rendered mode: add line decoration on opening fence line with language label,
    // then hide the opening and closing fence lines.

    // Line decoration on the opening fence: block class + data-language attribute.
    items.push(
      Decoration.line({
        class: "cg-codeblock cg-codeblock-header",
        attributes: block.language ? { "data-language": block.language } : {},
      }).range(block.openFenceFrom),
    );

    // Hide opening fence line (the ``` and language tag).
    items.push(decorationHidden.range(block.openFenceFrom, block.openFenceTo));

    // Add cg-codeblock background to every body line inside the block.
    const openLine = state.doc.lineAt(block.openFenceFrom);
    const closeLine = state.doc.lineAt(block.closeFenceFrom);
    for (let ln = openLine.number + 1; ln < closeLine.number; ln++) {
      const line = state.doc.line(ln);
      items.push(Decoration.line({ class: "cg-codeblock" }).range(line.from));
    }

    // Hide closing fence line (the closing ```).
    // Only hide if closing fence is on a different line than opening.
    if (block.closeFenceFrom !== block.openFenceFrom) {
      items.push(decorationHidden.range(block.closeFenceFrom, block.closeFenceTo));
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
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(focusEffect))) {
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
