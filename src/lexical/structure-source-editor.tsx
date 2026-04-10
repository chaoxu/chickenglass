import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { LexicalPlainTextEditor, type MarkdownEditorHandle } from "./plain-text-editor";

interface StructureSourceEditorProps {
  readonly className: string;
  readonly doc: string;
  readonly multiline?: boolean;
  readonly namespace: string;
  readonly onChange: (nextValue: string) => void;
  readonly onClose: () => void;
}

export function StructureSourceEditor({
  className,
  doc,
  multiline = false,
  namespace,
  onChange,
  onClose,
}: StructureSourceEditorProps) {
  const [draft, setDraft] = useState(() => doc);
  const originalDocRef = useRef(doc);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const focusedRef = useRef(false);

  const focusEditor = useCallback(() => {
    if (focusedRef.current) {
      return;
    }
    focusedRef.current = true;
    queueMicrotask(() => {
      const handle = handleRef.current;
      if (!handle) {
        focusedRef.current = false;
        return;
      }
      handle.focus();
      handle.setSelection(multiline ? draft.length : draft.length);
      focusedRef.current = false;
    });
  }, [draft.length, multiline]);

  const closeWithRevert = useCallback(() => {
    if (draft !== originalDocRef.current) {
      onChange(originalDocRef.current);
      setDraft(originalDocRef.current);
    }
    onClose();
  }, [draft, onChange, onClose]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWithRevert();
      return;
    }

    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      onClose();
    }
  }, [closeWithRevert, multiline, onClose]);

  return (
    <LexicalPlainTextEditor
      doc={draft}
      editorClassName={className}
      namespace={namespace}
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget;
        if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
          return;
        }
        onClose();
      }}
      onEditorReady={(handle) => {
        handleRef.current = handle;
        focusEditor();
      }}
      onFocus={focusEditor}
      onKeyDown={handleKeyDown}
      onTextChange={(nextValue) => {
        setDraft(nextValue);
        onChange(nextValue);
      }}
      spellCheck={false}
      testId={null}
    />
  );
}
