/**
 * structure-source-editor — Plain-text nested editor for structure metadata
 * fields (block openers, include paths, math source).
 *
 * Uses LexicalMarkdownEditor in source mode with draft/commit/revert
 * semantics. For rich inline/block content editing inside decorator nodes
 * (captions, titles, table cells), see EmbeddedFieldEditor instead — it
 * wraps LexicalRichMarkdownEditor with activation lifecycle.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { MarkdownEditorHandle } from "./markdown-editor-types";
import { LexicalMarkdownEditor } from "./markdown-editor";
import { consumePendingSurfaceFocus } from "./pending-surface-focus";

interface StructureSourceEditorProps {
  readonly className: string;
  readonly doc: string;
  readonly multiline?: boolean;
  readonly namespace: string;
  readonly onChange: (nextValue: string) => void;
  readonly onClose: () => void;
  readonly pendingFocusId?: string;
}

export function StructureSourceEditor({
  className,
  doc,
  multiline = false,
  namespace,
  onChange,
  onClose,
  pendingFocusId,
}: StructureSourceEditorProps) {
  const [draft, setDraft] = useState(() => doc);
  const originalDocRef = useRef(doc);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  // Resolve the requested initial caret edge exactly once, at mount, before
  // any onEditorReady/onFocus callback fires. Subsequent focus events fall
  // back to the default end-of-draft snap.
  const initialEdgeRef = useRef<"start" | "end">(
    pendingFocusId && consumePendingSurfaceFocus(pendingFocusId) === "start" ? "start" : "end",
  );
  const initialCaretAppliedRef = useRef(false);

  const focusEditor = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) {
      return;
    }

    if (!initialCaretAppliedRef.current) {
      if (initialEdgeRef.current === "start") {
        handle.setSelection(0, 0, { skipScrollIntoView: true });
      } else {
        const end = draft.length;
        handle.setSelection(end, end, { skipScrollIntoView: true });
      }
      initialCaretAppliedRef.current = true;
    }
    handle.focus();
  }, [draft.length]);

  useEffect(() => {
    if (doc === originalDocRef.current) {
      return;
    }

    originalDocRef.current = doc;
    setDraft(doc);
  }, [doc]);

  const closeWithRevert = useCallback(() => {
    if (draft !== originalDocRef.current) {
      onChange(originalDocRef.current);
      setDraft(originalDocRef.current);
    }
    onClose();
  }, [draft, onChange, onClose]);

  const handleKeyDown = useCallback((
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
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
    <LexicalMarkdownEditor
      doc={draft}
      editorClassName={className}
      editorMode="source"
      focusOwnerRole="embedded-field"
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
