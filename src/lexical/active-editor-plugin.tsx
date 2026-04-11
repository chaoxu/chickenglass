import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, FOCUS_COMMAND } from "lexical";

import { setActiveEditor } from "./active-editor-tracker";

export function ActiveEditorPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          setActiveEditor(editor);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );

  return null;
}
