import { $getRoot, type LexicalEditor } from "lexical";

export interface HeadlessMarkdownServiceSnapshot {
  readonly hasPooledEditor: boolean;
  readonly pooledEditorCreateCount: number;
  readonly resetCount: number;
}

export interface HeadlessMarkdownService {
  readonly resetPooledEditor: () => void;
  readonly snapshot: () => HeadlessMarkdownServiceSnapshot;
  readonly withPooledEditor: <T>(task: (editor: LexicalEditor) => T) => T;
}

export function createHeadlessMarkdownService(
  createEditor: () => LexicalEditor,
): HeadlessMarkdownService {
  let pooledEditor: LexicalEditor | null = null;
  let pooledEditorCreateCount = 0;
  let resetCount = 0;

  const getPooledEditor = () => {
    if (!pooledEditor) {
      pooledEditor = createEditor();
      pooledEditorCreateCount += 1;
    }
    return pooledEditor;
  };

  const resetEditor = (editor: LexicalEditor) => {
    editor.update(() => {
      $getRoot().clear();
    }, { discrete: true, tag: "headless-markdown-reset" });
    resetCount += 1;
  };

  return {
    resetPooledEditor() {
      if (pooledEditor) {
        resetEditor(pooledEditor);
      }
    },
    snapshot() {
      return {
        hasPooledEditor: pooledEditor !== null,
        pooledEditorCreateCount,
        resetCount,
      };
    },
    withPooledEditor(task) {
      const editor = getPooledEditor();
      resetEditor(editor);
      try {
        return task(editor);
      } finally {
        resetEditor(editor);
      }
    },
  };
}
