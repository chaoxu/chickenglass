import type { EditorState, LexicalEditor } from "lexical";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { measureSync } from "../lib/perf";
import type { EditorDocumentChange } from "../lib/string-editor-document-change";
import { publishLexicalDocumentSnapshot } from "./document-publication";
import { getLexicalMarkdown } from "./markdown";

const DEFAULT_RICH_DOCUMENT_SNAPSHOT_DEBOUNCE_MS = 200;

export interface RichMarkdownSnapshot {
  readonly editorState: EditorState;
  readonly markdown: string;
}

interface UseRichDocumentSnapshotPublisherArgs {
  readonly delayMs?: number;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onTextChange?: (text: string) => void;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
}

interface RichDocumentSnapshotPublisher {
  readonly cancelRichDocumentSnapshot: () => void;
  readonly flushRichDocumentSnapshot: () => string | null;
  readonly scheduleRichDocumentSnapshot: (editor: LexicalEditor) => void;
}

export function useRichDocumentSnapshotPublisher({
  delayMs = DEFAULT_RICH_DOCUMENT_SNAPSHOT_DEBOUNCE_MS,
  lastCommittedDocRef,
  onDocChange,
  onTextChange,
  pendingLocalEchoDocRef,
}: UseRichDocumentSnapshotPublisherArgs): RichDocumentSnapshotPublisher {
  const richSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const richSnapshotEditorRef = useRef<LexicalEditor | null>(null);
  const richMarkdownSnapshotRef = useRef<RichMarkdownSnapshot | null>(null);

  const cancelRichDocumentSnapshot = useCallback(() => {
    const timer = richSnapshotTimerRef.current;
    if (timer !== null) {
      clearTimeout(timer);
      richSnapshotTimerRef.current = null;
    }
    richSnapshotEditorRef.current = null;
  }, []);

  const readRichDocumentSnapshot = useCallback((editor: LexicalEditor) => {
    const editorState = editor.getEditorState();
    const cached = richMarkdownSnapshotRef.current;
    if (cached?.editorState === editorState) {
      return cached.markdown;
    }

    const markdown = getLexicalMarkdown(editor);
    richMarkdownSnapshotRef.current = {
      editorState,
      markdown,
    };
    return markdown;
  }, []);

  const publishRichDocumentSnapshot = useCallback((editor: LexicalEditor) => {
    const nextDoc = measureSync(
      "lexical.publishRichDocumentSnapshot",
      () => readRichDocumentSnapshot(editor),
      { category: "lexical" },
    );
    publishLexicalDocumentSnapshot({
      lastCommittedDocRef,
      onDocChange,
      onTextChange,
      pendingLocalEchoDocRef,
    }, nextDoc);
    return nextDoc;
  }, [
    lastCommittedDocRef,
    onDocChange,
    onTextChange,
    pendingLocalEchoDocRef,
    readRichDocumentSnapshot,
  ]);

  const scheduleRichDocumentSnapshot = useCallback((editor: LexicalEditor) => {
    const timer = richSnapshotTimerRef.current;
    if (timer !== null) {
      clearTimeout(timer);
    }
    richSnapshotEditorRef.current = editor;
    richSnapshotTimerRef.current = setTimeout(() => {
      richSnapshotTimerRef.current = null;
      richSnapshotEditorRef.current = null;
      publishRichDocumentSnapshot(editor);
    }, delayMs);
  }, [delayMs, publishRichDocumentSnapshot]);

  const flushRichDocumentSnapshot = useCallback(() => {
    const editor = richSnapshotEditorRef.current;
    if (!editor) return null;
    cancelRichDocumentSnapshot();
    return measureSync(
      "lexical.flushRichDocumentSnapshot",
      () => publishRichDocumentSnapshot(editor),
      { category: "lexical" },
    );
  }, [cancelRichDocumentSnapshot, publishRichDocumentSnapshot]);

  useEffect(() => () => {
    flushRichDocumentSnapshot();
  }, [flushRichDocumentSnapshot]);

  return {
    cancelRichDocumentSnapshot,
    flushRichDocumentSnapshot,
    scheduleRichDocumentSnapshot,
  };
}
