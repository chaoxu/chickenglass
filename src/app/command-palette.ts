/**
 * Command palette types.
 *
 * The vanilla-JS CommandPalette class has been replaced by the React
 * component in `components/command-palette.tsx`. This module retains
 * the `PaletteCommand` interface used by `editor/commands.ts`.
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
