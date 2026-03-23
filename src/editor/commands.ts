/**
 * Editor commands for the command palette.
 *
 * Registers commands for inserting block types, math, navigating
 * to headings, and toggling editor modes.
 */

import type { EditorView } from "@codemirror/view";
import type { PaletteCommand } from "../lib/command-palette";
import { insertTable } from "../render";
import { extractHeadings } from "../semantics/heading-ancestry";
import { BLOCK_MANIFEST_ENTRIES } from "../constants/block-manifest";

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

/**
 * Block types available for insertion via the command palette.
 *
 * Derived from BLOCK_MANIFEST — excludes embed types (iframe-based) and
 * blockquote (special rendering) since those are not standard insertable blocks.
 */
const BLOCK_TYPES: readonly string[] = BLOCK_MANIFEST_ENTRIES
  .filter((e) => e.specialBehavior !== "embed" && e.specialBehavior !== "blockquote")
  .map((e) => e.name);

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

/** Create dynamic heading navigation commands from the current document. */
export function createHeadingCommands(view: EditorView): PaletteCommand[] {
  const headings = extractHeadings(view.state);
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
      id: "insert-table",
      label: "Insert Table",
      action: (view: EditorView) => insertTable(view),
    },
  ];
}
