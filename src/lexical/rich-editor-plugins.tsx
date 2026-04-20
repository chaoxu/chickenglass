import { useEffect } from "react";
import { $isCodeNode, CodeNode, registerCodeHighlighting } from "@lexical/code";
import { copyToClipboard } from "@lexical/clipboard";
import { SelectionAlwaysOnDisplay } from "@lexical/react/LexicalSelectionAlwaysOnDisplay";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getSelection,
  $isLineBreakNode,
  $isNodeSelection,
  $isRangeSelection,
  $nodesOfType,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  CUT_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  PASTE_TAG,
  type LexicalNode,
  isDOMNode,
  isSelectionCapturedInDecoratorInput,
  mergeRegister,
} from "lexical";

import { useLexicalRenderContext } from "./render-context";
import {
  getCoflatClipboardData,
  getCoflatMarkdownFromDataTransfer,
  insertCoflatMarkdownAtSelection,
} from "./clipboard";
import { useDevSettings } from "../state/dev-settings";

export function SelectionAlwaysOnPlugin() {
  const open = useDevSettings((s) => s.selectionAlwaysOn);
  if (!open) return null;
  return <SelectionAlwaysOnDisplay />;
}

// @lexical/code-prism passes the raw fence language straight to Prism — `ts`,
// `js`, `py`, etc. miss because Prism registers them under their full names.
// Mirror the upstream CODE_LANGUAGE_MAP so common aliases tokenize.
const PRISM_LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  plaintext: "plain",
  py: "python",
  text: "plain",
  ts: "typescript",
  tsx: "typescript",
};

function ensurePrismAliases(): void {
  const prism = (globalThis as { Prism?: { languages: Record<string, unknown> } }).Prism;
  if (!prism?.languages) {
    return;
  }
  for (const [alias, target] of Object.entries(PRISM_LANGUAGE_ALIASES)) {
    if (!prism.languages[alias] && prism.languages[target]) {
      prism.languages[alias] = prism.languages[target];
    }
  }
}

export function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    ensurePrismAliases();
    const cleanup = registerCodeHighlighting(editor);
    // Initial state nodes aren't dirty, so the freshly registered transform
    // never sees pre-loaded code blocks. Touch each CodeNode once to schedule
    // tokenization without changing content.
    editor.update(() => {
      for (const node of $nodesOfType(CodeNode)) {
        node.markDirty();
      }
    });
    return cleanup;
  }, [editor]);

  return null;
}

const CLOSING_FENCE_RE = /^\s*```\s*$/;

function findCodeAncestor(node: LexicalNode): CodeNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isCodeNode(current)) return current;
    current = current.getParent();
  }
  return null;
}

export function CodeFenceExitPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        let shouldExit = false;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const codeNode = findCodeAncestor(selection.anchor.getNode());
          if (!codeNode) return;
          const text = codeNode.getTextContent();
          const lines = text.split("\n");
          if (lines.length === 0) return;
          const lastLine = lines[lines.length - 1];
          if (!CLOSING_FENCE_RE.test(lastLine)) return;
          const lastDescendant = codeNode.getLastDescendant();
          if (!lastDescendant) return;
          if (selection.anchor.key !== lastDescendant.getKey()) return;
          if (selection.anchor.offset !== lastDescendant.getTextContentSize()) return;
          shouldExit = true;
        });

        if (!shouldExit) return false;

        (event as KeyboardEvent | null)?.preventDefault();
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const codeNode = findCodeAncestor(selection.anchor.getNode());
          if (!codeNode) return;

          // Walk children backward, removing them until (and including) the
          // last LineBreakNode. That strips the closing-fence line plus the
          // newline that separated it from the preceding line.
          let child: LexicalNode | null = codeNode.getLastChild();
          while (child) {
            const prev: LexicalNode | null = child.getPreviousSibling();
            const isBreak = $isLineBreakNode(child);
            child.remove();
            if (isBreak) break;
            child = prev;
          }

          const paragraph = $createParagraphNode();
          codeNode.insertAfter(paragraph);
          if (codeNode.getChildrenSize() === 0) {
            codeNode.remove();
          }
          paragraph.selectStart();
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

function getClipboardEvent(
  event: ClipboardEvent | KeyboardEvent | null,
): ClipboardEvent | null {
  return event && "clipboardData" in event
    ? event as ClipboardEvent
    : null;
}

function getPasteClipboardData(
  event: ClipboardEvent | InputEvent | KeyboardEvent,
): DataTransfer | null {
  return "clipboardData" in event
    ? event.clipboardData ?? null
    : null;
}

export function CoflatClipboardPlugin() {
  const [editor] = useLexicalComposerContext();
  const renderContext = useLexicalRenderContext();

  useEffect(() => {
    const getClipboardData = () => editor.getEditorState().read(() =>
      getCoflatClipboardData(editor, renderContext, $getSelection())
    );

    return mergeRegister(
      editor.registerCommand(COPY_COMMAND, (event) => {
        const clipboardData = getClipboardData();
        if (!clipboardData) {
          return false;
        }

        void copyToClipboard(editor, getClipboardEvent(event), clipboardData);
        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(CUT_COMMAND, (event) => {
        const clipboardData = getClipboardData();
        if (!clipboardData) {
          return false;
        }

        void copyToClipboard(editor, getClipboardEvent(event), clipboardData).then((copied) => {
          if (!copied) {
            return;
          }

          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.removeText();
              return;
            }

            if ($isNodeSelection(selection)) {
              for (const node of selection.getNodes()) {
                node.remove();
              }
            }
          });
        });

        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(PASTE_COMMAND, (event) => {
        const clipboardData = getPasteClipboardData(event);
        if (!clipboardData) {
          return false;
        }

        if (isDOMNode(event.target) && isSelectionCapturedInDecoratorInput(event.target)) {
          return false;
        }

        const markdown = getCoflatMarkdownFromDataTransfer(clipboardData);
        if (!markdown) {
          return false;
        }

        const inserted = insertCoflatMarkdownAtSelection(editor, markdown, {
          tag: PASTE_TAG,
        });
        if (!inserted) {
          return false;
        }

        event.preventDefault();
        return true;
      }, COMMAND_PRIORITY_HIGH),
    );
  }, [editor, renderContext]);

  return null;
}
