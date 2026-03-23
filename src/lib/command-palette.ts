/**
 * Command palette types.
 *
 * No dependency on CM6 or React beyond the EditorView type reference —
 * safe to import from editor/ and other subsystems.
 */

import type { EditorView } from "@codemirror/view";

/** A command that can be executed from the palette. */
export interface PaletteCommand {
  /** Unique command identifier. */
  id: string;
  /** Display label shown in the palette list. */
  label: string;
  /** Optional keyboard shortcut hint (display only). */
  shortcut?: string;
  /** Action to execute when the command is selected. */
  action: (view: EditorView) => void;
}
