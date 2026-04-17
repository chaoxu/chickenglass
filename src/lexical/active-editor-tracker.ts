import type { LexicalEditor } from "lexical";

let activeEditor: LexicalEditor | null = null;

export function getActiveEditor(): LexicalEditor | null {
  // Editors whose root element has been torn down (document reload, nested
  // editor unmount) should not be reported as active — their state is frozen
  // and unrelated to whatever the user is now interacting with. Headless
  // editors throw on getRootElement(), so guard the call.
  if (activeEditor) {
    let stillAttached = false;
    try {
      stillAttached = activeEditor.getRootElement()?.isConnected ?? false;
    } catch {
      stillAttached = true;
    }
    if (!stillAttached) {
      activeEditor = null;
    }
  }
  return activeEditor;
}

export function setActiveEditor(editor: LexicalEditor): void {
  activeEditor = editor;
}

export function clearActiveEditor(): void {
  activeEditor = null;
}
