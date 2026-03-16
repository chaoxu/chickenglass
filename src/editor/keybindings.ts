import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/** Default keybindings for the editor. */
export const editorKeybindings: Extension = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
];
