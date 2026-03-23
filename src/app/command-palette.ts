/**
 * @deprecated Import from `../lib/command-palette` instead.
 *
 * Re-exports from the canonical location so existing app/ imports continue
 * to work without changes.
 *
 * The vanilla-JS CommandPalette class has been replaced by the React
 * component in `components/command-palette.tsx`. This module retains
 * the `PaletteCommand` interface used by `editor/commands.ts`.
 */
export type { PaletteCommand } from "../lib/command-palette";
