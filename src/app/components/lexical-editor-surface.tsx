import { useCallback, useEffect, useRef } from "react";
import type { LexicalEditor } from "lexical";

import {
  LexicalPlainTextEditor,
  type MarkdownEditorHandle,
  type MarkdownEditorSelection,
} from "../../lexical/plain-text-editor";
import { LexicalRichMarkdownEditor } from "../../lexical/rich-markdown-editor";
import { FORMAT_EVENT, type FormatEventDetail } from "../../constants/events";
import type { EditorDocumentChange } from "../editor-doc-change";
import type { EditorMode } from "../editor-mode";
import { planMarkdownFormat } from "../format-markdown";

export interface LexicalEditorSurfaceProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editorMode: EditorMode;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onRichRootElementChange?: (root: HTMLElement | null) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly onDocumentReady?: () => void;
  readonly onScrollChange?: (scrollTop: number) => void;
  readonly onViewportFromChange?: (from: number) => void;
  readonly spellCheck?: boolean;
}

export function LexicalEditorSurface({
  doc,
  docPath,
  editorMode,
  onDocChange,
  onEditorReady,
  onRichRootElementChange,
  onSelectionChange,
  onTextChange,
  onDocumentReady,
  onScrollChange,
  onViewportFromChange,
  spellCheck = false,
}: LexicalEditorSurfaceProps) {
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const docRef = useRef(doc);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const handleEditorReady = useCallback((handle: MarkdownEditorHandle, editor: LexicalEditor) => {
    handleRef.current = handle;
    onEditorReady?.(handle, editor);
  }, [onEditorReady]);

  useEffect(() => {
    const handleFormat = (event: Event) => {
      const detail = (event as CustomEvent<FormatEventDetail>).detail;
      const handle = handleRef.current;
      if (!handle) {
        return;
      }
      const plan = planMarkdownFormat(docRef.current, handle.getSelection(), detail);
      handle.applyChanges(plan.changes);
      handle.setSelection(plan.selection.anchor, plan.selection.focus);
      handle.focus();
    };

    document.addEventListener(FORMAT_EVENT, handleFormat);
    return () => {
      document.removeEventListener(FORMAT_EVENT, handleFormat);
    };
  }, []);

  return (
    <>
      <div inert aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden opacity-0">
        <LexicalPlainTextEditor
          doc={doc}
          namespace="coflat-app-lexical-source-bridge"
          editorClassName="cf-lexical-editor cf-lexical-editor--hidden"
          onDocChange={onDocChange}
          onEditorReady={handleEditorReady}
          onSelectionChange={onSelectionChange}
          onTextChange={onTextChange}
          onDocumentReady={onDocumentReady}
          spellCheck={false}
          testId={null}
        />
      </div>
      {editorMode === "source" ? (
        <LexicalPlainTextEditor
          doc={doc}
          namespace="coflat-app-lexical-visible-source"
          editorClassName={[
            "cf-lexical-editor",
            "cf-lexical-editor--source",
            "h-full overflow-auto px-6 py-8 text-[var(--cf-fg)] outline-none font-mono whitespace-pre-wrap",
          ].join(" ")}
          onDocChange={onDocChange}
          onTextChange={onTextChange}
          onScrollChange={onScrollChange}
          spellCheck={spellCheck}
        />
      ) : (
        <LexicalRichMarkdownEditor
          doc={doc}
          docPath={docPath}
          editable
          editorClassName={[
            "cf-lexical-editor",
            "cf-lexical-editor--rich",
            "px-6 py-8 text-[var(--cf-fg)] outline-none",
          ].join(" ")}
          namespace="coflat-app-lexical-rich-surface"
          onDocChange={onDocChange}
          onRootElementChange={onRichRootElementChange}
          onScrollChange={onScrollChange}
          onTextChange={onTextChange}
          onViewportFromChange={onViewportFromChange}
          enableSourceNavigation
          showIncludeAffordances
          showBibliography
          spellCheck={spellCheck}
        />
      )}
    </>
  );
}
