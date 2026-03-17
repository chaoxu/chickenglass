import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { type Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { toggleDebugInspector } from "../render/debug-inspector";
import type { SourceMap } from "../app/source-map";

/**
 * Jump to the source file when cursor is in an include region.
 * Dispatches a custom DOM event that the App listens for.
 */
function jumpToSourceFile(view: EditorView): boolean {
  const sourceMap = (
    window as unknown as { __cgSourceMap?: SourceMap | null }
  ).__cgSourceMap;
  if (!sourceMap) return false;

  const pos = view.state.selection.main.head;
  const region = sourceMap.regionAt(pos);
  if (!region) return false;

  view.dom.dispatchEvent(
    new CustomEvent("cg-open-file", { detail: region.file, bubbles: true }),
  );
  return true;
}

/** Default keybindings for the editor. */
export const editorKeybindings: Extension = [
  history(),
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
    { key: "Mod-Shift-d", run: toggleDebugInspector },
    { key: "Mod-Shift-o", run: jumpToSourceFile },
  ]),
];
