/**
 * Intercepts `:::` typed at line start in rich mode and shows a block-type picker.
 *
 * When the user types `:` and the line becomes `:::` (3+ colons), this extension
 * intercepts the input, removes the colons, and shows a floating popup listing
 * available block types from the plugin registry. Selecting a type inserts a
 * properly nested fenced div with the correct colon count based on nesting depth.
 *
 * Only active in rich mode — source mode is unaffected.
 *
 * The CodeMirror extension still owns trigger detection, fence upgrades,
 * insertion, and lifecycle cleanup. The popup UI itself is delegated to
 * `cmdk` so filtering, keyboard navigation, and ARIA behavior come from the
 * shared command-menu library instead of custom DOM code.
 */

import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { Command as CommandPrimitive } from "cmdk";
import { computePosition, flip, shift, offset } from "@floating-ui/dom";
import {
  createElement,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { fenceOperationAnnotation } from "../plugins";
import type { PluginRegistryState } from "../state/plugin-registry-core";
import { editorModeField } from "./editor";
import { BLOCK_MANIFEST_ENTRIES } from "../constants/block-manifest";
import { pluginRegistryField } from "../state/plugin-registry";

// ---------------------------------------------------------------------------
// Ancestor fence collection
// ---------------------------------------------------------------------------

/** Collect ancestor FencedDiv fence positions for colon upgrades. */
function collectAncestorFences(view: EditorView, pos: number): AncestorFence[] {
  const fences: AncestorFence[] = [];
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "FencedDiv") {
      let openFence: SyntaxNode | null = null;
      let closeFence: SyntaxNode | null = null;
      let child = node.firstChild;
      while (child) {
        if (child.name === "FencedDivFence") {
          if (!openFence) openFence = child;
          else closeFence = child;
        }
        child = child.nextSibling;
      }
      if (openFence) {
        const openText = view.state.sliceDoc(openFence.from, openFence.to);
        fences.push({
          openFrom: openFence.from,
          openTo: openFence.to,
          closeFrom: closeFence ? closeFence.from : -1,
          closeTo: closeFence ? closeFence.to : -1,
          colons: openText.length,
        });
      }
    }
    node = node.parent;
  }
  return fences;
}

// ---------------------------------------------------------------------------
// Picker UI
// ---------------------------------------------------------------------------

/** Block type entry shown in the picker. */
interface PickerEntry {
  readonly name: string;
  readonly title: string;
}

/** Ancestor fence info for colon upgrades. */
interface AncestorFence {
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
  colons: number;
}

/**
 * Build the list of block types to show in the picker.
 *
 * Uses the plugin registry for registered types and supplements with
 * the block manifest for ordering.
 */
function getPickerEntries(registry: PluginRegistryState): PickerEntry[] {
  const entries: PickerEntry[] = [];
  const seen = new Set<string>();

  // Add entries in manifest order for consistency
  for (const entry of BLOCK_MANIFEST_ENTRIES) {
    const plugin = registry.plugins.get(entry.name);
    if (plugin) {
      entries.push({ name: plugin.name, title: plugin.title });
      seen.add(plugin.name);
    }
  }

  // Add any custom (frontmatter-defined) plugins not in the manifest
  for (const [name, plugin] of registry.plugins) {
    if (seen.has(name)) continue;
    entries.push({ name: plugin.name, title: plugin.title });
  }

  return entries;
}

/** Singleton picker element. */
let pickerEl: HTMLDivElement | null = null;
let pickerRoot: Root | null = null;
let nextPickerRequestId = 1;

let activePicker: {
  requestId: number;
  view: EditorView;
  ancestorFences: AncestorFence[];
} | null = null;

function getPickerEl(): HTMLDivElement {
  if (!pickerEl) {
    pickerEl = document.createElement("div");
    pickerEl.className = "cf-block-picker";
    pickerEl.style.display = "none";
    document.body.appendChild(pickerEl);
  }
  return pickerEl;
}

function getPickerRoot(): Root {
  if (!pickerRoot) {
    pickerRoot = createRoot(getPickerEl());
  }
  return pickerRoot;
}

interface BlockPickerMenuProps {
  readonly entries: readonly PickerEntry[];
  readonly onSelect: (blockType: string) => void;
  readonly onClose: () => void;
}

function BlockPickerMenu({ entries, onSelect, onClose }: BlockPickerMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Backspace" && event.currentTarget.value === "") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return createElement(
    CommandPrimitive,
    {
      label: "Block type picker",
      loop: true,
      className: "cf-block-picker-command",
    },
    createElement(CommandPrimitive.Input, {
      ref: inputRef,
      className: "cf-block-picker-input",
      placeholder: "Block type...",
      autoComplete: "off",
      spellCheck: false,
      onKeyDown: onInputKeyDown,
    }),
    createElement(
      CommandPrimitive.List,
      { className: "cf-block-picker-list" },
      createElement(
        CommandPrimitive.Empty,
        { className: "cf-block-picker-empty" },
        "No block types found.",
      ),
      ...entries.map((entry) =>
        createElement(
          CommandPrimitive.Item,
          {
            key: entry.name,
            value: entry.name,
            keywords: [entry.title],
            className: "cf-block-picker-item",
            onSelect: () => onSelect(entry.name),
          },
          entry.title,
        ),
      ),
    ),
  );
}

function renderPickerMenu(props: BlockPickerMenuProps | null): void {
  if (props === null) {
    if (!pickerRoot) return;
    pickerRoot.unmount();
    pickerRoot = null;
    return;
  }
  flushSync(() => {
    getPickerRoot().render(createElement(BlockPickerMenu, props));
  });
}

/**
 * Show the picker near the given position in the editor.
 */
function showPicker(
  view: EditorView,
  lineFrom: number,
  lineTo: number,
  entries: PickerEntry[],
  ancestorFences: AncestorFence[] = [],
): void {
  if (entries.length === 0) return;

  // Clean up any prior picker state so event listeners don't leak
  // when showPicker is called without a preceding hidePicker (#500).
  hidePicker();

  const el = getPickerEl();
  el.style.display = "";
  el.setAttribute("data-visible", "false");
  const requestId = nextPickerRequestId++;
  activePicker = {
    requestId,
    view,
    ancestorFences,
  };
  const coords = view.coordsAtPos(lineFrom);
  if (!coords) {
    hidePicker();
    return;
  }

  renderPickerMenu({
    entries,
    onSelect: (blockType) => {
      insertBlock(view, lineFrom, lineTo, blockType, ancestorFences);
      hidePicker();
    },
    onClose: () => {
      hidePicker();
      view.focus();
    },
  });

  const virtualAnchor = {
    getBoundingClientRect: () => ({
      x: coords.left,
      y: coords.top,
      width: 0,
      height: coords.bottom - coords.top,
      top: coords.top,
      right: coords.left,
      bottom: coords.bottom,
      left: coords.left,
    }),
  };

  void computePosition(virtualAnchor as HTMLElement, el, {
    placement: "bottom-start",
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  }).then(({ x, y }) => {
    if (activePicker?.requestId !== requestId) return;
    Object.assign(el.style, {
      left: `${x}px`,
      top: `${y}px`,
    });
    requestAnimationFrame(() => {
      if (activePicker?.requestId !== requestId) return;
      el.setAttribute("data-visible", "true");
    });
  });
}

/** Hide the picker and clean up. */
function hidePicker(): void {
  activePicker = null;
  renderPickerMenu(null);
  if (!pickerEl) return;
  pickerEl.setAttribute("data-visible", "false");
  pickerEl.style.display = "none";
}

/** Whether the picker is currently visible. */
export function isPickerVisible(): boolean {
  return activePicker !== null;
}

// ---------------------------------------------------------------------------
// Block insertion
// ---------------------------------------------------------------------------

/**
 * Insert a fenced div block. Always uses ::: (minimum colons).
 * If inside an ancestor that also uses :::, upgrades ancestors first
 * so the child's closing ::: doesn't close the parent.
 *
 * Uses ancestorFences (computed before :: removal) to know which
 * ancestors need upgrading.
 */
function insertBlock(
  view: EditorView,
  lineFrom: number,
  lineTo: number,
  blockType: string,
  ancestorFences?: AncestorFence[],
): void {
  // Step 1: Upgrade ancestors so each has MORE colons than its child.
  // ancestorFences[0] is the direct parent, [1] is grandparent, etc.
  // New block uses 3 colons. Parent needs > 3, grandparent needs > parent, etc.
  if (ancestorFences && ancestorFences.length > 0) {
    const upgrades: { from: number; to: number; insert: string }[] = [];
    let requiredMin = 3; // child's colon count
    for (const fence of ancestorFences) {
      if (fence.colons <= requiredMin) {
        const newCount = requiredMin + 1;
        const newColons = ":".repeat(newCount);
        upgrades.push({ from: fence.openFrom, to: fence.openTo, insert: newColons });
        if (fence.closeFrom >= 0) {
          upgrades.push({ from: fence.closeFrom, to: fence.closeTo, insert: newColons });
        }
        requiredMin = newCount; // next ancestor must have even more
      } else {
        break; // this ancestor and all above already have enough colons
      }
    }
    if (upgrades.length > 0) {
      view.dispatch({ changes: upgrades, annotations: fenceOperationAnnotation.of(true) });
      // Recompute lineFrom after the upgrade shifted positions
      // Each upgrade adds 1 character per fence (: -> ::). Count upgrades before lineFrom.
      let shift = 0;
      for (const u of upgrades) {
        if (u.from < lineFrom) shift += u.insert.length - (u.to - u.from);
      }
      lineFrom += shift;
      lineTo += shift;
    }
  }

  // Step 2: Insert the new block with ::: (minimum)
  const colons = ":::";
  const opening = `${colons} {.${blockType}}`;
  const closing = colons;
  const insertText = `${opening}\n\n${closing}`;
  const cursorPos = lineFrom + opening.length + 1;

  view.dispatch({
    changes: { from: lineFrom, to: lineTo, insert: insertText },
    selection: { anchor: cursorPos },
  });
  view.focus();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * ViewPlugin that dismisses the picker on outside clicks and when the owning
 * editor view is destroyed.
 */
const pickerLifecyclePlugin = ViewPlugin.define((view) => {
  const onMouseDown = (e: MouseEvent) => {
    if (activePicker?.view !== view) return;
    const target = e.target as HTMLElement;
    if (!pickerEl?.contains(target)) {
      // The `::` was already removed when the picker appeared.
      // Just dismiss the picker on outside click.
      hidePicker();
      view.focus();
    }
  };

  document.addEventListener("mousedown", onMouseDown);

  return {
    destroy() {
      document.removeEventListener("mousedown", onMouseDown);
      // Only dismiss if this view owns the picker (multi-view safety)
      if (activePicker?.view === view) hidePicker();
    },
  };
});

/**
 * CM6 extension that intercepts `:::` at line start in rich mode
 * and shows a block-type picker.
 */
export const blockTypePickerExtension: Extension = [
  // Input handler: intercept the third `:` that forms `:::`
  EditorView.inputHandler.of((view, from, to, text) => {
    // Only intercept single `:` character input
    if (text !== ":") return false;

    // Only in rich mode
    const mode = view.state.field(editorModeField, false);
    if (mode !== "rich" && mode !== undefined) return false;

    // Check if the line up to the insertion point is `::`
    const line = view.state.doc.lineAt(from);
    const lineTextBefore = view.state.sliceDoc(line.from, from);
    // Must be exactly `::` — no other content before
    if (lineTextBefore !== "::") return false;
    // No content after the cursor on this line (or just more colons)
    const lineTextAfter = view.state.sliceDoc(to, line.to);
    if (lineTextAfter.length > 0 && !/^:*$/.test(lineTextAfter)) return false;

    // Get the registry
    const registry = view.state.field(pluginRegistryField, false);
    if (!registry) return false;

    const entries = getPickerEntries(registry);
    if (entries.length === 0) return false;

    // Collect ancestor fences BEFORE the `:::` appears on the line.
    // The `::` is parsed as paragraph text, so the syntax tree still shows
    // this position inside the parent FencedDiv (if any). Once `:::` forms,
    // the parser treats it as a closing fence and the nesting is lost.
    const ancestorFences = collectAncestorFences(view, from);

    // Remove the `::` instead of completing `:::`. This avoids the closing
    // fence protection filter which would block edits on `:::` lines.
    // The picker will insert the full block at the clean line position.
    const removeFrom = line.from;
    const removeTo = Math.max(to, from);
    const removeLen = removeTo - removeFrom;
    view.dispatch({
      changes: { from: removeFrom, to: removeTo, insert: "" },
      selection: { anchor: removeFrom },
    });

    // Adjust ancestor fence positions for the :: removal shift.
    // Positions after the removal point shift by -removeLen.
    for (const fence of ancestorFences) {
      if (fence.openFrom > removeFrom) fence.openFrom -= removeLen;
      if (fence.openTo > removeFrom) fence.openTo -= removeLen;
      if (fence.closeFrom > removeFrom) fence.closeFrom -= removeLen;
      if (fence.closeTo > removeFrom) fence.closeTo -= removeLen;
    }

    // Show the picker at the now-empty line
    const updatedLine = view.state.doc.lineAt(removeFrom);
    showPicker(view, updatedLine.from, updatedLine.to, entries, ancestorFences);

    return true;
  }),

  pickerLifecyclePlugin,
];

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

/** Exported for unit testing without a browser. */
export {
  getPickerEntries as _getPickerEntriesForTest,
  insertBlock as _insertBlockForTest,
  collectAncestorFences as _collectAncestorFencesForTest,
};
export type {
  PickerEntry as _PickerEntryForTest,
  AncestorFence as _AncestorFenceForTest,
};
