/**
 * Editor commands for the command palette.
 *
 * Registers commands for inserting block types, math, navigating
 * to headings, and toggling editor modes.
 */

import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { PaletteCommand } from "../app/command-palette";

/** Insert a fenced div block at the cursor. */
function insertBlock(view: EditorView, className: string): void {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  // Insert on a new line if cursor is not at the start of an empty line
  const prefix = line.text.trim() === "" && from === line.from ? "" : "\n";
  const block = `${prefix}::: {.${className}}\n\n:::\n`;
  view.dispatch({
    changes: { from, to, insert: block },
    // Place cursor inside the block (after the opening fence + newline)
    selection: { anchor: from + prefix.length + `::: {.${className}}\n`.length },
  });
  view.focus();
}

/** Block types available for insertion. */
const BLOCK_TYPES = [
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "conjecture",
  "definition",
  "proof",
  "remark",
  "example",
  "algorithm",
] as const;

/** Create commands for inserting each block type. */
function createBlockCommands(): PaletteCommand[] {
  return BLOCK_TYPES.map((type) => ({
    id: `insert-${type}`,
    label: `Insert ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    action: (view: EditorView) => insertBlock(view, type),
  }));
}

/** Create commands for inserting math. */
function createMathCommands(): PaletteCommand[] {
  return [
    {
      id: "insert-inline-math",
      label: "Insert Inline Math ($...$)",
      action: (view: EditorView) => {
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to);
        const text = `$${selected}$`;
        view.dispatch({
          changes: { from, to, insert: text },
          // Place cursor between the dollar signs if no selection
          selection: {
            anchor: selected ? from + text.length : from + 1,
          },
        });
        view.focus();
      },
    },
    {
      id: "insert-display-math",
      label: "Insert Display Math ($$...$$)",
      action: (view: EditorView) => {
        const { from, to } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);
        const prefix =
          line.text.trim() === "" && from === line.from ? "" : "\n";
        const selected = view.state.sliceDoc(from, to);
        const text = `${prefix}$$\n${selected}\n$$\n`;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: {
            anchor: from + prefix.length + 3 + (selected ? selected.length : 0),
          },
        });
        view.focus();
      },
    },
  ];
}

/** Extract headings from the editor for "Navigate to heading" commands. */
function extractHeadings(
  view: EditorView,
): Array<{ text: string; pos: number; level: number }> {
  const headings: Array<{ text: string; pos: number; level: number }> = [];
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      const m = /^ATXHeading(\d)$/.exec(node.name);
      if (!m) return;

      const level = Number(m[1]);
      const lineText = view.state.doc.lineAt(node.from).text;
      const text = lineText.replace(/^#+\s*/, "");

      headings.push({ text, pos: node.from, level });
    },
  });

  return headings;
}

/** Create dynamic heading navigation commands from the current document. */
export function createHeadingCommands(view: EditorView): PaletteCommand[] {
  const headings = extractHeadings(view);
  return headings.map((h, i) => ({
    id: `goto-heading-${i}`,
    label: `${"  ".repeat(h.level - 1)}${h.text}`,
    action: (v: EditorView) => {
      v.dispatch({
        selection: { anchor: h.pos },
        scrollIntoView: true,
      });
      v.focus();
    },
  }));
}

/** All static editor commands for the palette. */
export function getEditorCommands(): PaletteCommand[] {
  return [
    ...createBlockCommands(),
    ...createMathCommands(),
    {
      id: "toggle-focus-mode",
      label: "Toggle Focus Mode",
      action: (_view: EditorView) => {
        console.log("[chickenglass] Focus mode toggled (placeholder)");
      },
    },
  ];
}
