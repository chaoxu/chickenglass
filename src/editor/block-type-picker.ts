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
 * Uses a capture-phase keydown listener so picker navigation (ArrowUp/Down,
 * Enter, Escape) is handled before CM6's keymap processing, which would
 * otherwise consume ArrowDown/Enter for cursor movement/newline insertion.
 */

import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { computePosition, flip, shift, offset } from "@floating-ui/dom";
import { pluginRegistryField, type PluginRegistryState } from "../plugins";
import { editorModeField } from "./editor";
import { BLOCK_MANIFEST_ENTRIES } from "../constants/block-manifest";

// ---------------------------------------------------------------------------
// Nesting depth calculation
// ---------------------------------------------------------------------------

/**
 * Count the FencedDiv nesting depth at a given document position by walking
 * up the Lezer syntax tree.
 *
 * IMPORTANT: Must be called BEFORE the `:::` is inserted on the line.
 * Once `:::` appears, the parser treats it as a closing fence and the
 * position is no longer inside the parent FencedDiv.
 */
function fencedDivDepth(view: EditorView, pos: number): number {
  let depth = 0;
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "FencedDiv") {
      depth++;
    }
    node = node.parent;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Picker UI
// ---------------------------------------------------------------------------

/** Block type entry shown in the picker. */
interface PickerEntry {
  readonly name: string;
  readonly title: string;
}

/**
 * Build the list of block types to show in the picker.
 *
 * Uses the plugin registry for registered types and supplements with
 * the block manifest for ordering. Excludes embed-family types (embed,
 * iframe, youtube, gist) and include since those are not user-authored
 * blocks.
 */
function getPickerEntries(registry: PluginRegistryState): PickerEntry[] {
  const entries: PickerEntry[] = [];
  const seen = new Set<string>();

  // Track embed names so the second loop can skip them too
  const embedNames = new Set<string>();
  for (const entry of BLOCK_MANIFEST_ENTRIES) {
    if (entry.specialBehavior === "embed") {
      embedNames.add(entry.name);
    }
  }

  // Add entries in manifest order for consistency
  for (const entry of BLOCK_MANIFEST_ENTRIES) {
    if (entry.specialBehavior === "embed") continue;
    const plugin = registry.plugins.get(entry.name);
    if (plugin) {
      entries.push({ name: plugin.name, title: plugin.title });
      seen.add(plugin.name);
    }
  }

  // Add any custom (frontmatter-defined) plugins not in the manifest
  for (const [name, plugin] of registry.plugins) {
    if (seen.has(name)) continue;
    if (name === "include") continue;
    if (embedNames.has(name)) continue;
    if (plugin.specialBehavior === "embed") continue;
    entries.push({ name: plugin.name, title: plugin.title });
  }

  return entries;
}

/** Singleton picker element. */
let pickerEl: HTMLDivElement | null = null;
/** Currently active picker state — null when hidden. */
let activePicker: {
  view: EditorView;
  lineFrom: number;
  lineTo: number;
  selectedIndex: number;
  entries: PickerEntry[];
  /** Nesting depth computed before ::: was inserted (tree is still correct). */
  nestingDepth: number;
  onDismiss: () => void;
} | null = null;

function getPickerEl(): HTMLDivElement {
  if (!pickerEl) {
    pickerEl = document.createElement("div");
    pickerEl.className = "cf-block-picker";
    pickerEl.style.display = "none";
    pickerEl.setAttribute("role", "listbox");
    document.body.appendChild(pickerEl);
  }
  return pickerEl;
}

/** Render picker items into the picker element. */
function renderPickerItems(entries: PickerEntry[], selectedIndex: number): void {
  const el = getPickerEl();
  el.innerHTML = "";

  for (let i = 0; i < entries.length; i++) {
    const item = document.createElement("div");
    item.className = "cf-block-picker-item";
    if (i === selectedIndex) {
      item.classList.add("cf-block-picker-item-selected");
      item.setAttribute("aria-selected", "true");
    }
    item.setAttribute("role", "option");
    item.dataset.index = String(i);
    item.textContent = entries[i].title;
    el.appendChild(item);
  }
}

/**
 * Show the picker near the given position in the editor.
 */
function showPicker(
  view: EditorView,
  lineFrom: number,
  lineTo: number,
  entries: PickerEntry[],
  nestingDepth: number,
): void {
  if (entries.length === 0) return;

  const el = getPickerEl();
  const selectedIndex = 0;

  renderPickerItems(entries, selectedIndex);
  el.style.display = "";
  el.setAttribute("data-visible", "false");

  // Position using a virtual anchor at the cursor position
  const coords = view.coordsAtPos(lineFrom);
  if (!coords) {
    hidePicker();
    return;
  }

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
    Object.assign(el.style, {
      left: `${x}px`,
      top: `${y}px`,
    });
    requestAnimationFrame(() => {
      el.setAttribute("data-visible", "true");
    });
  });

  // Set up click handler for picker items
  const onClick = (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest(".cf-block-picker-item") as HTMLElement | null;
    if (!target || !activePicker) return;
    const idx = Number(target.dataset.index);
    if (Number.isFinite(idx) && idx >= 0 && idx < entries.length) {
      insertBlock(activePicker.view, activePicker.lineFrom, activePicker.lineTo, entries[idx].name, activePicker.nestingDepth);
      hidePicker();
    }
  };
  el.addEventListener("click", onClick);

  activePicker = {
    view,
    lineFrom,
    lineTo,
    selectedIndex,
    entries,
    nestingDepth,
    onDismiss: () => {
      el.removeEventListener("click", onClick);
    },
  };
}

/** Hide the picker and clean up. */
function hidePicker(): void {
  if (pickerEl) {
    pickerEl.setAttribute("data-visible", "false");
    pickerEl.style.display = "none";
    pickerEl.innerHTML = "";
  }
  if (activePicker) {
    activePicker.onDismiss();
    activePicker = null;
  }
}

/** Whether the picker is currently visible. */
export function isPickerVisible(): boolean {
  return activePicker !== null;
}

// ---------------------------------------------------------------------------
// Block insertion
// ---------------------------------------------------------------------------

/**
 * Insert a fenced div block at the given line range.
 *
 * Replaces the `:::` line with a complete fenced div:
 * - Opening fence with correct colon count (3 + nesting depth)
 * - Empty content line (cursor placed here)
 * - Closing fence with matching colon count
 */
function insertBlock(
  view: EditorView,
  lineFrom: number,
  lineTo: number,
  blockType: string,
  nestingDepth: number,
): void {
  const colonCount = 3 + nestingDepth;
  const colons = ":".repeat(colonCount);

  const opening = `${colons} {.${blockType}}`;
  const closing = colons;
  const insert = `${opening}\n\n${closing}`;

  // Place cursor on the empty line between fences
  const cursorPos = lineFrom + opening.length + 1;

  view.dispatch({
    changes: { from: lineFrom, to: lineTo, insert },
    selection: { anchor: cursorPos },
  });
  view.focus();
}

// ---------------------------------------------------------------------------
// Keyboard navigation (capture-phase listener)
// ---------------------------------------------------------------------------

/**
 * Handle keyboard events while the picker is visible.
 *
 * Called from a capture-phase keydown listener on the editor DOM so it
 * runs before CM6's keymap processing. Without capture phase, CM6 would
 * handle ArrowDown (cursor move) and Enter (newline) before we see them.
 */
function handlePickerKey(e: KeyboardEvent): void {
  if (!activePicker) return;

  const { entries } = activePicker;

  switch (e.key) {
    case "ArrowDown": {
      e.preventDefault();
      e.stopImmediatePropagation();
      activePicker.selectedIndex = (activePicker.selectedIndex + 1) % entries.length;
      renderPickerItems(entries, activePicker.selectedIndex);
      scrollSelectedIntoView();
      break;
    }
    case "ArrowUp": {
      e.preventDefault();
      e.stopImmediatePropagation();
      activePicker.selectedIndex = (activePicker.selectedIndex - 1 + entries.length) % entries.length;
      renderPickerItems(entries, activePicker.selectedIndex);
      scrollSelectedIntoView();
      break;
    }
    case "Enter": {
      e.preventDefault();
      e.stopImmediatePropagation();
      const entry = entries[activePicker.selectedIndex];
      insertBlock(activePicker.view, activePicker.lineFrom, activePicker.lineTo, entry.name, activePicker.nestingDepth);
      hidePicker();
      break;
    }
    case "Escape": {
      e.preventDefault();
      e.stopImmediatePropagation();
      // The `::` was already removed when the picker appeared.
      // Just dismiss the picker.
      const { view: escView } = activePicker;
      hidePicker();
      escView.focus();
      break;
    }
    default: {
      // Any other character key dismisses the picker
      // but let it propagate so the character is typed normally
      if (e.key.length === 1) {
        hidePicker();
      }
      break;
    }
  }
}

/** Scroll the selected picker item into view. */
function scrollSelectedIntoView(): void {
  const el = getPickerEl();
  const selected = el.querySelector(".cf-block-picker-item-selected");
  if (selected) {
    selected.scrollIntoView({ block: "nearest" });
  }
}

// ---------------------------------------------------------------------------
// CM6 Extension
// ---------------------------------------------------------------------------

/**
 * ViewPlugin that attaches a capture-phase keydown listener for picker
 * navigation. The capture phase is essential because CM6's keymap
 * processes keydown in the bubble phase — without capture, ArrowDown
 * and Enter would be consumed by the default keymap before we see them.
 */
const pickerKeyPlugin = ViewPlugin.define((view) => {
  const onKeyDown = (e: KeyboardEvent) => {
    if (activePicker) {
      handlePickerKey(e);
    }
  };

  const onMouseDown = (e: MouseEvent) => {
    if (activePicker) {
      const target = e.target as HTMLElement;
      if (!pickerEl?.contains(target)) {
        // The `::` was already removed when the picker appeared.
        // Just dismiss the picker on outside click.
        hidePicker();
        view.focus();
      }
    }
  };

  // Attach to the editor's root DOM in capture phase
  view.dom.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", onMouseDown);

  return {
    destroy() {
      view.dom.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown);
      hidePicker();
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

    // Compute nesting depth BEFORE the `:::` appears on the line.
    // The `::` is parsed as paragraph text, so the syntax tree still shows
    // this position inside the parent FencedDiv (if any). Once `:::` forms,
    // the parser treats it as a closing fence and the nesting is lost.
    const nestingDepth = fencedDivDepth(view, from);

    // Remove the `::` instead of completing `:::`. This avoids the closing
    // fence protection filter which would block edits on `:::` lines.
    // The picker will insert the full block at the clean line position.
    view.dispatch({
      changes: { from: line.from, to: Math.max(to, from), insert: "" },
      selection: { anchor: line.from },
    });

    // Show the picker at the now-empty line
    const updatedLine = view.state.doc.lineAt(line.from);
    showPicker(view, updatedLine.from, updatedLine.to, entries, nestingDepth);

    return true;
  }),

  // Capture-phase key handler for picker navigation
  pickerKeyPlugin,
];
