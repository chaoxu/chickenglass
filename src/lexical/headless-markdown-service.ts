import { $getRoot, type LexicalEditor } from "lexical";

export interface HeadlessMarkdownService {
  readonly withPooledEditor: <T>(task: (editor: LexicalEditor) => T) => T;
}

export function createHeadlessMarkdownService(
  createEditor: () => LexicalEditor,
): HeadlessMarkdownService {
  let pooledEditor: LexicalEditor | null = null;

  const getPooledEditor = () => {
    pooledEditor ??= createEditor();
    return pooledEditor;
  };

  return {
    withPooledEditor(task) {
      const editor = getPooledEditor();
      editor.update(() => {
        $getRoot().clear();
      }, { discrete: true });
      return task(editor);
    },
  };
}
