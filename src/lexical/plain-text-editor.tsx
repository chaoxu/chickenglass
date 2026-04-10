import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MutableRefObject,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { CLEAR_HISTORY_COMMAND, type LexicalEditor } from "lexical";

import {
  applyEditorDocumentChanges,
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../app/editor-doc-change";
import {
  getPlainText,
  getPlainTextSelection,
  insertPlainText,
  selectPlainTextOffsetsInLexicalRoot,
  setPlainText,
  writePlainTextToLexicalRoot,
} from "./plain-text";
import { FocusEdgePlugin } from "./focus-edge-plugin";

export interface MarkdownEditorSelection {
  readonly anchor: number;
  readonly focus: number;
  readonly from: number;
  readonly to: number;
}

export interface MarkdownEditorHandle {
  applyChanges: (changes: readonly EditorDocumentChange[]) => void;
  focus: () => void;
  getDoc: () => string;
  getSelection: () => MarkdownEditorSelection;
  insertText: (text: string) => void;
  setDoc: (doc: string) => void;
  setSelection: (anchor: number, focus?: number) => void;
}

interface DocumentSyncPluginProps {
  readonly doc: string;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly suppressedDocRef: MutableRefObject<string | null>;
}

function DocumentSyncPlugin({
  doc,
  lastCommittedDocRef,
  suppressedDocRef,
}: DocumentSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (doc === lastCommittedDocRef.current) {
      return;
    }

    suppressedDocRef.current = doc;
    setPlainText(editor, doc);
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    lastCommittedDocRef.current = doc;
  }, [doc, editor, lastCommittedDocRef, suppressedDocRef]);

  return null;
}

interface EditorHandlePluginProps {
  readonly onHandleReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
}

function EditorHandlePlugin({ onHandleReady }: EditorHandlePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onHandleReady) {
      return;
    }

    onHandleReady({
      applyChanges: (changes) => {
        const nextDoc = applyEditorDocumentChanges(getPlainText(editor), changes);
        setPlainText(editor, nextDoc);
      },
      focus: () => editor.focus(),
      getDoc: () => getPlainText(editor),
      getSelection: () => getPlainTextSelection(editor),
      insertText: (text) => insertPlainText(editor, text),
      setDoc: (doc) => {
        setPlainText(editor, doc);
      },
      setSelection: (anchor, focus = anchor) => {
        editor.update(() => {
          selectPlainTextOffsetsInLexicalRoot(anchor, focus);
        }, { discrete: true });
        editor.focus();
      },
    }, editor);
  }, [editor, onHandleReady]);

  return null;
}

export interface LexicalPlainTextEditorProps {
  readonly doc: string;
  readonly editable?: boolean;
  readonly editorClassName?: string;
  readonly namespace?: string;
  readonly onBlurCapture?: FocusEventHandler<HTMLDivElement>;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onFocus?: FocusEventHandler<HTMLDivElement>;
  readonly onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly onDocumentReady?: () => void;
  readonly onScrollChange?: (scrollTop: number) => void;
  readonly spellCheck?: boolean;
  readonly testId?: string | null;
}

export function LexicalPlainTextEditor({
  doc,
  editable = true,
  editorClassName,
  namespace = "coflat-lexical-plain-text",
  onBlurCapture,
  onDocChange,
  onEditorReady,
  onFocus,
  onKeyDown,
  onSelectionChange,
  onTextChange,
  onDocumentReady,
  onScrollChange,
  spellCheck = false,
  testId = "lexical-editor",
}: LexicalPlainTextEditorProps) {
  const initialDocRef = useRef(doc);
  const lastCommittedDocRef = useRef(doc);
  const suppressedDocRef = useRef<string | null>(null);

  const initialConfig = useMemo(() => ({
    editable,
    namespace,
    onError(error: Error) {
      throw error;
    },
    editorState: () => {
      writePlainTextToLexicalRoot(initialDocRef.current);
    },
    theme: {
      root: "cf-lexical-root h-full text-[var(--cf-fg)]",
      paragraph: "cf-lexical-paragraph m-0 min-h-[1.6em]",
    },
  }), [editable, namespace]);

  useEffect(() => {
    onDocumentReady?.();
    onTextChange?.(doc);
  }, [doc, onDocumentReady, onTextChange]);

  const handleChange = useCallback((
    _editorState: unknown,
    editor: LexicalEditor,
  ) => {
    const nextDoc = getPlainText(editor);
    const selection = getPlainTextSelection(editor);
    onSelectionChange?.(selection);

    if (suppressedDocRef.current === nextDoc) {
      suppressedDocRef.current = null;
      lastCommittedDocRef.current = nextDoc;
      onTextChange?.(nextDoc);
      return;
    }

    const changes = createMinimalEditorDocumentChanges(
      lastCommittedDocRef.current,
      nextDoc,
    );
    if (changes.length === 0) {
      return;
    }

    lastCommittedDocRef.current = nextDoc;
    onTextChange?.(nextDoc);
    onDocChange?.(changes);
  }, [onDocChange, onSelectionChange, onTextChange]);

  return (
    <div className="h-full overflow-hidden">
      <LexicalComposer initialConfig={initialConfig}>
        <EditorHandlePlugin onHandleReady={onEditorReady} />
        <DocumentSyncPlugin
          doc={doc}
          lastCommittedDocRef={lastCommittedDocRef}
          suppressedDocRef={suppressedDocRef}
        />
        <PlainTextPlugin
          contentEditable={(
            <ContentEditable
              aria-label="Lexical editor"
              className={editorClassName}
              data-testid={testId ?? undefined}
              onBlurCapture={onBlurCapture}
              onFocus={onFocus}
              onKeyDown={onKeyDown}
              onScroll={(event) => onScrollChange?.(event.currentTarget.scrollTop)}
              spellCheck={spellCheck}
            />
          )}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <FocusEdgePlugin />
        <HistoryPlugin />
        <OnChangePlugin onChange={handleChange} />
      </LexicalComposer>
    </div>
  );
}
