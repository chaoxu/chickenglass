import {
  search,
  searchKeymap,
  openSearchPanel,
} from "@codemirror/search";
import { type Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

/**
 * Open the search panel and focus the replace input field.
 * Used by Cmd+H to open find-and-replace mode directly.
 */
function openReplacePanel(view: EditorView): boolean {
  // First open the panel (no-op if already open)
  openSearchPanel(view);

  // Then focus the replace field — defer one frame so CM6 can render the panel
  requestAnimationFrame(() => {
    const replaceField = view.dom.querySelector<HTMLInputElement>(
      ".cm-search input[name='replace']",
    );
    replaceField?.focus();
    replaceField?.select();
  });

  return true;
}

/**
 * CodeMirror search extension with custom keybindings.
 *
 * - Cmd+F: open find panel (via searchKeymap)
 * - Cmd+H: open find-and-replace panel, focus replace field
 * - Escape: close panel (via searchKeymap)
 */
export const findReplaceExtension: Extension = [
  search({ top: false }),
  keymap.of([
    ...searchKeymap,
    { key: "Mod-h", run: openReplacePanel, preventDefault: true },
  ]),
];
