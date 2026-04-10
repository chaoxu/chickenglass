import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { focusEffect } from "../state/editor-focus";

export {
  createBooleanToggleField,
  editorFocusField,
  focusEffect,
} from "../state/editor-focus";

/**
 * Extension that dispatches focus-change effects when the editor gains or loses focus.
 */
export const focusTracker: Extension = EditorView.focusChangeEffect.of(
  (_state, focusing) => focusEffect.of(focusing),
);
