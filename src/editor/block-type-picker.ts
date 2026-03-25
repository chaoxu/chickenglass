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
import { pluginRegistryField, type PluginRegistryState, fenceOperationAnnotation } from "../plugins";
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
/** Ancestor fence info for colon upgrades. */
interface AncestorFence {
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
  colons: number;
}

let activePicker: {
  view: EditorView;
  lineFrom: number;
  lineTo: number;
  selectedIndex: number;
  allEntries: PickerEntry[];
  filteredEntries: PickerEntry[];
  filter: string;
  nestingDepth: number;
  ancestorFences: AncestorFence[];
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

/** Render picker with search input and filtered items. */
function renderPicker(
  allEntries: PickerEntry[],
  filter: string,
  selectedIndex: number,
): PickerEntry[] {
  const el = getPickerEl();

  // Ensure search input exists
  let input = el.querySelector(".cf-block-picker-input") as HTMLInputElement | null;
  if (!input) {
    el.innerHTML = "";
    input = document.createElement("input");
    input.className = "cf-block-picker-input";
    input.type = "text";
    input.placeholder = "Block type...";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    el.appendChild(input);
  }
  input.value = filter;

  // Filter entries
  const lower = filter.toLowerCase();
  const filtered = lower
    ? allEntries.filter(e => e.name.includes(lower) || e.title.toLowerCase().includes(lower))
    : allEntries;

  // Remove old items (keep input)
  const oldItems = el.querySelectorAll(".cf-block-picker-item");
  for (const item of oldItems) item.remove();

  // Render filtered items
  for (let i = 0; i < filtered.length; i++) {
    const item = document.createElement("div");
    item.className = "cf-block-picker-item";
    if (i === selectedIndex) {
      item.classList.add("cf-block-picker-item-selected");
      item.setAttribute("aria-selected", "true");
    }
    item.setAttribute("role", "option");
    item.dataset.index = String(i);
    item.textContent = filtered[i].title;
    el.appendChild(item);
  }

  return filtered;
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
  ancestorFences: AncestorFence[] = [],
): void {
  if (entries.length === 0) return;

  const el = getPickerEl();
  const selectedIndex = 0;
  const filter = "";

  const filteredEntries = renderPicker(entries, filter, selectedIndex);
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
    if (Number.isFinite(idx) && idx >= 0 && idx < activePicker.filteredEntries.length) {
      insertBlock(activePicker.view, activePicker.lineFrom, activePicker.lineTo, activePicker.filteredEntries[idx].name, activePicker.nestingDepth, activePicker.ancestorFences);
      hidePicker();
    }
  };
  el.addEventListener("click", onClick);

  // Keydown handler on the picker itself (for when input has focus)
  const onPickerKeyDown = (e: KeyboardEvent) => {
    handlePickerKey(e);
  };
  el.addEventListener("keydown", onPickerKeyDown);

  activePicker = {
    view,
    lineFrom,
    lineTo,
    selectedIndex,
    allEntries: entries,
    filteredEntries,
    filter,
    nestingDepth,
    ancestorFences,
    onDismiss: () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onPickerKeyDown);
    },
  };

  // Focus the input after positioning
  requestAnimationFrame(() => {
    const input = el.querySelector(".cf-block-picker-input") as HTMLInputElement | null;
    input?.focus();
  });
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
/**
 * Insert a fenced div block. The new block always uses ::: (minimum).
 * If any ancestor FencedDiv also uses ::: , upgrade it to :::: so the
 * child's closing ::: doesn't close the parent. This maintains the
 * invariant: children use fewer colons than parents.
 */
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
  _nestingDepth: number,
  ancestorFences?: { openFrom: number; openTo: number; closeFrom: number; closeTo: number; colons: number }[],
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

  switch (e.key) {
    case "ArrowDown": {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (activePicker.filteredEntries.length > 0) {
        activePicker.selectedIndex = (activePicker.selectedIndex + 1) % activePicker.filteredEntries.length;
        renderPicker(activePicker.allEntries, activePicker.filter, activePicker.selectedIndex);
        scrollSelectedIntoView();
      }
      break;
    }
    case "ArrowUp": {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (activePicker.filteredEntries.length > 0) {
        const len = activePicker.filteredEntries.length;
        activePicker.selectedIndex = (activePicker.selectedIndex - 1 + len) % len;
        renderPicker(activePicker.allEntries, activePicker.filter, activePicker.selectedIndex);
        scrollSelectedIntoView();
      }
      break;
    }
    case "Enter": {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (activePicker.filteredEntries.length > 0) {
        const entry = activePicker.filteredEntries[activePicker.selectedIndex];
        insertBlock(activePicker.view, activePicker.lineFrom, activePicker.lineTo, entry.name, activePicker.nestingDepth, activePicker.ancestorFences);
      }
      hidePicker();
      break;
    }
    case "Escape": {
      e.preventDefault();
      e.stopImmediatePropagation();
      const { view: escView } = activePicker;
      hidePicker();
      escView.focus();
      break;
    }
    case "Backspace": {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (activePicker.filter.length > 0) {
        activePicker.filter = activePicker.filter.slice(0, -1);
        activePicker.selectedIndex = 0;
        activePicker.filteredEntries = renderPicker(activePicker.allEntries, activePicker.filter, 0);
      } else {
        const { view: bsView } = activePicker;
        hidePicker();
        bsView.focus();
      }
      break;
    }
    default: {
      // Printable character — add to filter
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        activePicker.filter += e.key;
        activePicker.selectedIndex = 0;
        activePicker.filteredEntries = renderPicker(activePicker.allEntries, activePicker.filter, 0);
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
    showPicker(view, updatedLine.from, updatedLine.to, entries, nestingDepth, ancestorFences);

    return true;
  }),

  // Capture-phase key handler for picker navigation
  pickerKeyPlugin,
];
