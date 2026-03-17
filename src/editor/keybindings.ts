import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { toggleDebugInspector } from "../render/debug-inspector";

/** Default keybindings for the editor. */
export const editorKeybindings: Extension = [
  history(),
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
    { key: "Mod-Shift-d", run: toggleDebugInspector },
  ]),
];
