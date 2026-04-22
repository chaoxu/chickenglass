import { $generateNodesFromSerializedNodes } from "@lexical/clipboard";
import { $setSelection, type EditorUpdateOptions, type LexicalEditor } from "lexical";

import { measureSync } from "../app/perf";
import { createMinimalEditorDocumentChanges } from "../lib/editor-doc-change";
import { parseMarkdownFragmentToJSON } from "./headless-markdown-parse";
import { createSourceSpanIndex } from "./source-spans";

export function applyIncrementalRichDocumentSync(
  editor: LexicalEditor,
  previousDoc: string,
  nextDoc: string,
  options?: Pick<EditorUpdateOptions, "tag">,
): boolean {
  const changes = createMinimalEditorDocumentChanges(previousDoc, nextDoc);
  if (changes.length !== 1) {
    return false;
  }

  const [change] = changes;
  const replacedLength = change.to - change.from;
  const delta = change.insert.length - replacedLength;
  let applied = false;

  measureSync("lexical.incrementalRichSync", () => {
    editor.update(() => {
      const spanIndex = createSourceSpanIndex(previousDoc);
      const location = spanIndex.findNearestLocation(change.from);
      const topLevel = location?.node.getTopLevelElement();
      if (!topLevel || topLevel.getType() !== "paragraph") {
        return;
      }

      const blockFrom = spanIndex.getNodeStart(topLevel);
      const blockTo = spanIndex.getNodeEnd(topLevel);
      if (blockFrom === null || blockTo === null) {
        return;
      }
      if (change.from < blockFrom || change.to > blockTo) {
        return;
      }

      const nextBlockTo = blockTo + delta;
      if (nextBlockTo < blockFrom || nextBlockTo > nextDoc.length) {
        return;
      }

      const nextBlockSource = nextDoc.slice(blockFrom, nextBlockTo);
      if (/\n\s*\n/.test(nextBlockSource)) {
        return;
      }

      const parsedBlocks = parseMarkdownFragmentToJSON(nextBlockSource);
      if (parsedBlocks.length !== 1) {
        return;
      }
      const [replacement] = $generateNodesFromSerializedNodes([...parsedBlocks]);
      if (!replacement || replacement.getType() !== topLevel.getType()) {
        return;
      }

      $setSelection(null);
      topLevel.replace(replacement);
      applied = true;
    }, {
      discrete: true,
      tag: options?.tag,
    });
  }, { category: "lexical", detail: `${nextDoc.length} chars` });

  return applied;
}
