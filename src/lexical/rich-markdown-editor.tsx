import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  createEmptyHistoryState,
  HistoryPlugin,
  type HistoryState,
} from "@lexical/react/LexicalHistoryPlugin";
import type { LexicalEditor } from "lexical";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEBUG_EDITOR_TEST_ID } from "../debug/debug-bridge-contract.js";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../document-surface-classes";
import type { EditorDocumentChange } from "../lib/string-editor-document-change";
import {
  type FocusOwner,
  type FocusOwnerRole,
  focusSurface,
} from "../state/editor-focus";
import { CursorRevealPlugin } from "./cursor-reveal-plugin";
import { EditorFocusPlugin } from "./editor-focus-plugin";
import { RichLexicalEditorHandlePlugin } from "./editor-handle-plugin";
import {
  DestructiveKeySelectionSyncPlugin,
  EditableSyncPlugin,
  RootElementPlugin,
  repairBlankClickSelection,
} from "./editor-surface-shared";
import { InlineTokenBoundaryPlugin } from "./inline-token-boundary-plugin";
import {
  LexicalDocumentSyncPlugin,
  useLexicalDocumentSessionController,
} from "./lexical-document-session";
import {
  createLexicalInitialEditorState,
} from "./markdown";
import type {
  MarkdownEditorHandle,
  MarkdownEditorSelection,
} from "./markdown-editor-types";
import {
  CoflatLexicalComposerShell,
  CoflatRichComposerPlugins,
  createCoflatComposerConfig,
} from "./lexical-composer-shell";
import {
  type LexicalRenderContextValue,
} from "./render-context";
import { REVEAL_MODE, type RevealPresentation } from "./reveal-mode";
import {
  useRevealPresentation,
} from "./reveal-presentation-context";
import {
  CoflatClipboardPlugin,
  SelectionAlwaysOnPlugin,
} from "./rich-editor-plugins";
import { useEditorScrollSurface } from "./runtime";

export type { LexicalRichMarkdownEditorProps };

interface LexicalRichMarkdownEditorProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editable?: boolean;
  readonly editorClassName?: string;
  readonly focusOwnerRole?: FocusOwnerRole;
  readonly layoutMode?: "block" | "inline";
  readonly namespace?: string;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onFocusOwnerChange?: (owner: FocusOwner) => void;
  readonly onRootElementChange?: (root: HTMLElement | null) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly onScrollChange?: (scrollTop: number) => void;
  readonly onViewportFromChange?: (from: number) => void;
  readonly preserveLocalHistory?: boolean;
  readonly repairBlankClickSelection?: boolean;
  readonly requireUserEditFlag?: boolean;
  readonly renderContextValue?: LexicalRenderContextValue;
  readonly revealPresentation?: RevealPresentation;
  readonly showBibliography?: boolean;
  readonly showCodeBlockChrome?: boolean;
  readonly showHeadingChrome?: boolean;
  readonly showViewportTracking?: boolean;
  readonly singleLine?: boolean;
  readonly enableSourceNavigation?: boolean;
  readonly spellCheck?: boolean;
  readonly testId?: string | null;
}

export function LexicalRichMarkdownEditor({
  doc,
  docPath,
  editable = true,
  editorClassName,
  focusOwnerRole = "rich-surface",
  layoutMode = "block",
  namespace = "coflat-lexical-rich-markdown",
  onDocChange,
  onEditorReady,
  onFocusOwnerChange,
  onRootElementChange,
  onSelectionChange,
  onTextChange,
  onScrollChange,
  onViewportFromChange,
  preserveLocalHistory = false,
  repairBlankClickSelection: shouldRepairBlankClickSelection = false,
  requireUserEditFlag = true,
  renderContextValue,
  revealPresentation,
  showBibliography = false,
  showCodeBlockChrome = true,
  showHeadingChrome = true,
  showViewportTracking = true,
  singleLine = false,
  enableSourceNavigation = false,
  spellCheck = false,
  testId = DEBUG_EDITOR_TEST_ID,
}: LexicalRichMarkdownEditorProps) {
  const inheritedRevealPresentation = useRevealPresentation();
  const resolvedRevealPresentation = revealPresentation ?? inheritedRevealPresentation;
  const inheritedSurface = useEditorScrollSurface();
  const nestedHistoryStateRef = useRef<HistoryState | null>(null);
  const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(null);
  const focusOwner = useMemo(
    () => focusSurface(focusOwnerRole, namespace),
    [focusOwnerRole, namespace],
  );
  const {
    initialDocRef,
    lastCommittedDocRef,
    pendingLocalEchoDocRef,
    canonicalBridgeEchoRef,
    sourceSelectionRef,
    userEditPendingRef,
    embeddedFieldFlushRegistry,
    cancelRichDocumentSnapshot,
    flushRichDocumentSnapshot,
    handleRichChange,
    syncSelectionToDocLength,
  } = useLexicalDocumentSessionController({
    doc,
    focusOwner,
    onDocChange,
    onSelectionChange,
    onTextChange,
    requireUserEditFlag,
  });

  if (preserveLocalHistory && nestedHistoryStateRef.current === null) {
    nestedHistoryStateRef.current = createEmptyHistoryState();
  }

  const initialConfig = useMemo(() => createCoflatComposerConfig({
    editable,
    editorState: createLexicalInitialEditorState(initialDocRef.current),
    namespace,
  }), [editable, namespace]);

  const handleChange = useCallback((
    _editorState: unknown,
    editor: LexicalEditor,
    tags: Set<string>,
  ) => {
    handleRichChange(editor, tags);
  }, [handleRichChange]);

  const shellClassName = layoutMode === "inline"
    ? "cf-lexical-surface cf-lexical-surface--inline"
    : showBibliography
      ? documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.surface,
        DOCUMENT_SURFACE_CLASS.surfaceLexical,
        "cf-lexical-surface cf-lexical-surface--scroll",
      )
      : documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.surface,
        DOCUMENT_SURFACE_CLASS.surfaceLexical,
        "cf-lexical-surface cf-lexical-surface--block",
      );

  const resolvedEditorClassName = [
    "cf-lexical-editor",
    editorClassName,
    layoutMode === "inline"
      ? "cf-lexical-editor--inline-surface"
      : documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.flow,
        DOCUMENT_SURFACE_CLASS.flowLexical,
        "cf-lexical-editor--rich",
      ),
  ].filter(Boolean).join(" ");
  const effectiveSurface = inheritedSurface ?? surfaceElement;

  useEffect(() => {
    syncSelectionToDocLength(doc.length);
  }, [doc.length, syncSelectionToDocLength]);

  const contentEditable = (
    <ContentEditable
      aria-label="Lexical rich editor"
      className={resolvedEditorClassName}
      data-testid={testId ?? undefined}
      onBeforeInput={editable
        ? () => {
            userEditPendingRef.current = true;
          }
        : undefined}
      onDrop={editable
        ? () => {
            userEditPendingRef.current = true;
          }
        : undefined}
      onCut={editable
        ? () => {
            userEditPendingRef.current = true;
          }
        : undefined}
      onKeyDown={editable
        ? (event) => {
            if (singleLine && event.key === "Enter") {
              event.preventDefault();
              return;
            }
            if (
              event.key === "Backspace"
              || event.key === "Delete"
              || event.key === "Enter"
            ) {
              userEditPendingRef.current = true;
            }
          }
        : undefined}
      onPaste={editable
        ? () => {
            userEditPendingRef.current = true;
          }
        : undefined}
      onMouseUp={editable && shouldRepairBlankClickSelection
        ? (event: ReactMouseEvent<HTMLDivElement>) => {
          repairBlankClickSelection(event.currentTarget, event);
        }
        : undefined}
      onScroll={(event) => onScrollChange?.(event.currentTarget.scrollTop)}
      spellCheck={spellCheck}
    />
  );

  return (
    <CoflatLexicalComposerShell
      doc={doc}
      docPath={docPath}
      editable={editable}
      embeddedFieldFlushRegistry={embeddedFieldFlushRegistry}
      effectiveSurface={effectiveSurface}
      initialConfig={initialConfig}
      lastCommittedDocRef={lastCommittedDocRef}
      onDocChange={onDocChange}
      onScroll={layoutMode === "block" && showBibliography
        ? (event) => onScrollChange?.(event.currentTarget.scrollTop)
        : undefined}
      onTextChange={onTextChange}
      pendingLocalEchoDocRef={pendingLocalEchoDocRef}
      renderContextValue={renderContextValue}
      revealPresentation={resolvedRevealPresentation}
      setSurfaceElement={setSurfaceElement}
      shellClassName={shellClassName}
    >
      <EditorFocusPlugin onFocusOwnerChange={onFocusOwnerChange} owner={focusOwner} />
      <EditableSyncPlugin editable={editable} />
      {editable ? (
        <CursorRevealPlugin
          editorMode={REVEAL_MODE.LEXICAL}
          presentation={resolvedRevealPresentation}
        />
      ) : (
        <ClickableLinkPlugin />
      )}
      <RichLexicalEditorHandlePlugin
        cancelRichDocumentSnapshot={cancelRichDocumentSnapshot}
        canonicalBridgeEchoRef={canonicalBridgeEchoRef}
        focusOwner={focusOwner}
        flushRichDocumentSnapshot={flushRichDocumentSnapshot}
        lastCommittedDocRef={lastCommittedDocRef}
        onEditorReady={onEditorReady}
        onDocChange={onDocChange}
        onSelectionChange={onSelectionChange}
        onTextChange={onTextChange}
        pendingLocalEchoDocRef={pendingLocalEchoDocRef}
        selectionRef={sourceSelectionRef}
        userEditPendingRef={userEditPendingRef}
      />
      <RootElementPlugin onRootElementChange={onRootElementChange} />
      {editable ? <InlineTokenBoundaryPlugin /> : null}
      {editable ? <DestructiveKeySelectionSyncPlugin /> : null}
      <LexicalDocumentSyncPlugin
        doc={doc}
        lastCommittedDocRef={lastCommittedDocRef}
        pendingLocalEchoDocRef={pendingLocalEchoDocRef}
        preserveLocalHistory={preserveLocalHistory}
      />
      <CoflatRichComposerPlugins
        clipboardPlugin={<CoflatClipboardPlugin />}
        contentEditable={contentEditable}
        doc={doc}
        editable={editable}
        enableSourceNavigation={enableSourceNavigation}
        hasOnChange
        historyPlugin={editable || preserveLocalHistory ? (
          <HistoryPlugin
            externalHistoryState={nestedHistoryStateRef.current ?? undefined}
          />
        ) : null}
        onChange={handleChange}
        onViewportFromChange={onViewportFromChange}
        selectionPlugin={<SelectionAlwaysOnPlugin />}
        showBibliography={showBibliography}
        showBlockKeyboardAccess
        showCodeBlockChrome={showCodeBlockChrome}
        showHeadingChrome={showHeadingChrome}
        showInteractionTrace
        showListMarkerStrip
        showMarkdownExpansion
        showReferenceTypeahead
        showSlashPicker
        showSourcePosition
        showTableChrome
        showTabKey
        showViewportTracking={showViewportTracking}
      />
    </CoflatLexicalComposerShell>
  );
}
