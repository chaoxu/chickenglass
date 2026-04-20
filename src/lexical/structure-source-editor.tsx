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
  type KeyboardEvent,
} from "react";

import { useEmbeddedFieldDraftController } from "./embedded-field-draft-controller";
import type { MarkdownEditorHandle } from "./markdown-editor-types";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import { LexicalMarkdownEditor } from "./markdown-editor";
import { consumePendingSurfaceFocus } from "./pending-surface-focus";

type InitialCaretRequest = "start" | "end" | { readonly offset: number };

function computeInitialCaretOffset(
  request: InitialCaretRequest,
  draft: string,
  multiline: boolean,
): number {
  if (typeof request === "object") {
    return Math.max(0, Math.min(request.offset, draft.length));
  }
  if (request === "end") {
    return draft.length;
  }
  if (!multiline) {
    return 0;
  }
  // For fenced templates (display math, frontmatter) land inside the body —
  // just before the closing fence's newline, preserving any pre-filled line.
  const firstNewline = draft.indexOf("\n");
  const lastNewline = draft.lastIndexOf("\n");
  if (firstNewline > 0 && lastNewline > firstNewline) {
    return lastNewline;
  }
  return 0;
}

interface StructureSourceEditorProps {
  readonly className: string;
  readonly doc: string;
  readonly multiline?: boolean;
  readonly namespace: string;
  readonly onChange: (nextValue: string) => void;
  readonly onClose: () => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly pendingFocusId?: string;
}

export function StructureSourceEditor({
  className,
  doc,
  multiline = false,
  namespace,
  onChange,
  onClose,
  onSelectionChange,
  pendingFocusId,
}: StructureSourceEditorProps) {
  const originalDocRef = useRef(doc);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const draft = useEmbeddedFieldDraftController({
    onPublish: onChange,
    publishPolicy: "immediate",
    value: doc,
  });
  // Resolve the requested initial caret position exactly once, at mount,
  // before any onEditorReady/onFocus callback fires. Subsequent focus events
  // fall back to the default end-of-draft snap.
  const initialCaretRequestRef = useRef<InitialCaretRequest>((() => {
    if (!pendingFocusId) {
      return "end";
    }
    const request = consumePendingSurfaceFocus(pendingFocusId);
    if (request === "start" || (request && typeof request === "object" && "offset" in request)) {
      return request;
    }
    return "end";
  })());
  const initialCaretAppliedRef = useRef(false);

  const focusEditor = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) {
      rootRef.current?.focus({ preventScroll: true });
      return;
    }

    if (!initialCaretAppliedRef.current) {
      const offset = computeInitialCaretOffset(
        initialCaretRequestRef.current,
        draft.draft,
        multiline,
      );
      handle.setSelection(offset, offset, { skipScrollIntoView: true });
      initialCaretAppliedRef.current = true;
    }
    handle.focus();
    rootRef.current?.focus({ preventScroll: true });
  }, [draft.draft, multiline]);

  useEffect(() => {
    if (doc === originalDocRef.current) {
      return;
    }

    originalDocRef.current = doc;
    draft.resetDraft(doc, { clearPending: true });
  }, [doc, draft]);

  const closeWithRevert = useCallback(() => {
    if (draft.draft !== originalDocRef.current) {
      draft.revertDraft(originalDocRef.current, { publish: true });
    }
    onClose();
  }, [draft, onClose]);

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
      doc={draft.draft}
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
      onRootElementChange={(root) => {
        rootRef.current = root;
      }}
      onSelectionChange={onSelectionChange}
      onTextChange={(nextValue) => {
        draft.updateDraft(nextValue);
        queueMicrotask(focusEditor);
        window.setTimeout(focusEditor, 0);
      }}
      spellCheck={false}
      testId={null}
    />
  );
}
