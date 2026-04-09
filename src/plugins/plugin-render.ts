/**
 * CM6 decoration provider for rendering fenced divs using the block plugin system.
 *
 * For each FencedDiv node in the syntax tree:
 * - If a plugin is registered for its class, render using CSS marks and line
 *   decorations (Typora-style: hide syntax, show block label via ::before).
 * - If no plugin is registered, render as a plain styled div.
 *
 * Uses Decoration.mark to hide fence syntax and Decoration.line with
 * data-block-label for the rendered header. The DOM structure never changes
 * between source and rendered mode — only CSS classes are toggled.
 *
 * Uses a StateField (not ViewPlugin) so that line decorations (Decoration.line)
 * are permitted by CM6.
 */

import type { Transaction } from "@codemirror/state";
import { type Extension } from "@codemirror/state";
import { activeFencedOpenFenceStarts } from "../editor/shell-ownership";
import { hasStructureEditEffect } from "../editor/structure-edit-state";
import {
  createFencedBlockDecorationField,
  editorFocusField,
  focusTracker,
} from "../render/render-core";
import { fenceProtectionExtension } from "./fence-protection";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { buildBlockDecorations } from "./plugin-render-decorations";

function activeShellStartsChanged(tr: Transaction): boolean {
  const before = activeFencedOpenFenceStarts(tr.startState);
  const after = activeFencedOpenFenceStarts(tr.state);
  if (before.size !== after.size) return true;
  for (const start of before) {
    if (!after.has(start)) return true;
  }
  return false;
}

/**
 * CM6 StateField that provides block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) and
 * mark decorations are permitted by CM6.
 */
const blockDecorationField = createFencedBlockDecorationField(buildBlockDecorations, {
  extraShouldRebuild: hasStructureEditEffect,
  selectionShouldRebuild: activeShellStartsChanged,
});

/** Exported for unit testing decoration logic without a browser. */
export { blockDecorationField as _blockDecorationFieldForTest };

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  documentSemanticsField,
  editorFocusField,
  focusTracker,
  blockDecorationField,
  fenceProtectionExtension,
];
