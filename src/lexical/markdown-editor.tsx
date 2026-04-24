import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { SelectionAlwaysOnDisplay } from "@lexical/react/LexicalSelectionAlwaysOnDisplay";
import {
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
} from "lexical";
import {
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MutableRefObject,
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
import { useDevSettings } from "../state/dev-settings";
import {
  type FocusOwner,
  type FocusOwnerRole,
  focusSurface,
} from "../state/editor-focus";
import { ActiveEditorPlugin } from "./active-editor-plugin";
import { CursorRevealPlugin } from "./cursor-reveal-plugin";
import { publishLexicalDocumentSnapshot } from "./document-publication";
import { EditorFocusPlugin } from "./editor-focus-plugin";
import { LexicalEditorHandlePlugin } from "./editor-handle-plugin";
import {
  DestructiveKeySelectionSyncPlugin,
  EditableSyncPlugin,
  FormatEventPlugin,
  RootElementPlugin,
  repairBlankClickSelection,
  storeSelection,
} from "./editor-surface-shared";
import { InlineTokenBoundaryPlugin } from "./inline-token-boundary-plugin";
import {
  LexicalSourceBridgePlugin,
  sameSelection,
  shouldIgnoreMarkdownEditorChange,
  useLexicalDocumentSessionController,
} from "./lexical-document-session";
import {
  createLexicalInitialEditorState,
} from "./markdown";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "./markdown-editor-types";
import {
  CoflatLexicalComposerShell,
  CoflatRichComposerPlugins,
  createCoflatComposerConfig,
} from "./lexical-composer-shell";
import { type LexicalRenderContextValue } from "./render-context";
import type { RevealMode, RevealPresentation } from "./reveal-mode";
import { REVEAL_PRESENTATION } from "./reveal-mode";
import { useEditorScrollSurface } from "./runtime";
import { readSourcePositionFromElement } from "./source-position-plugin";
import { SET_SOURCE_SELECTION_COMMAND } from "./source-selection-command";
import {
  $readSourceTextSelectionFromLexicalRoot,
  getSourceText,
  writeSourceTextToLexicalRoot,
} from "./source-text";
import { TreeViewPlugin } from "./tree-view-plugin";

function SourceSelectionPlugin({
  editorMode,
  onSelectionChange,
  selectionRef,
}: {
  readonly editorMode: RevealMode;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
}) {
  const [editor] = useLexicalComposerContext();
  const latestSelectionRef = useRef(selectionRef.current);

  useEffect(() => {
    latestSelectionRef.current = selectionRef.current;
  }, [selectionRef]);

  useEffect(() => {
    if (editorMode !== "source") {
      return;
    }

    const syncSelection = (nextSelection: MarkdownEditorSelection) => {
      if (sameSelection(latestSelectionRef.current, nextSelection)) {
        return;
      }
      latestSelectionRef.current = nextSelection;
      selectionRef.current = nextSelection;
      onSelectionChange?.(nextSelection);
    };

    let cancelled = false;
    let ready = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      ready = true;
      syncSelection(editor.getEditorState().read(() => $readSourceTextSelectionFromLexicalRoot()));
    });
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      if (!ready) {
        return;
      }
      editorState.read(() => {
        syncSelection($readSourceTextSelectionFromLexicalRoot());
      });
    });
    return () => {
      cancelled = true;
      unregister();
    };
  }, [editor, editorMode, onSelectionChange, selectionRef]);

  return null;
}

function ExplicitSourceSelectionPlugin({
  editorMode,
  lastCommittedDocRef,
  onSelectionChange,
  selectionRef,
}: {
  readonly editorMode: RevealMode;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (editorMode === "source") {
      return;
    }

    return editor.registerCommand(
      SET_SOURCE_SELECTION_COMMAND,
      (sourcePosition) => {
        const anchor = typeof sourcePosition === "number"
          ? sourcePosition
          : sourcePosition.anchor;
        const focus = typeof sourcePosition === "number"
          ? sourcePosition
          : sourcePosition.focus;
        storeSelection(
          selectionRef,
          lastCommittedDocRef.current.length,
          onSelectionChange,
          anchor,
          focus,
        );
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, editorMode, lastCommittedDocRef, onSelectionChange, selectionRef]);

  return null;
}

export interface LexicalMarkdownEditorProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editorMode: RevealMode;
  readonly editable?: boolean;
  readonly editorClassName?: string;
  readonly focusOwnerRole?: FocusOwnerRole;
  readonly namespace?: string;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onBlurCapture?: FocusEventHandler<HTMLDivElement>;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onDirtyChange?: () => void;
  readonly onFocus?: FocusEventHandler<HTMLDivElement>;
  readonly onFocusOwnerChange?: (owner: FocusOwner) => void;
  readonly onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  readonly onRootElementChange?: (root: HTMLElement | null) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly onScrollChange?: (scrollTop: number) => void;
  readonly onViewportFromChange?: (from: number) => void;
  readonly renderContextValue?: LexicalRenderContextValue;
  readonly revealPresentation?: RevealPresentation;
  readonly spellCheck?: boolean;
  readonly testId?: string | null;
}

export function LexicalMarkdownEditor({
  doc,
  docPath,
  editorMode,
  editable = true,
  editorClassName,
  focusOwnerRole,
  namespace = "coflat-lexical-markdown",
  onDocChange,
  onBlurCapture,
  onEditorReady,
  onDirtyChange,
  onFocus,
  onFocusOwnerChange,
  onKeyDown,
  onRootElementChange,
  onSelectionChange,
  onTextChange,
  onScrollChange,
  onViewportFromChange,
  renderContextValue,
  revealPresentation = REVEAL_PRESENTATION.FLOATING,
  spellCheck = false,
  testId = DEBUG_EDITOR_TEST_ID,
}: LexicalMarkdownEditorProps) {
  const inheritedSurface = useEditorScrollSurface();
  const initialModeRef = useRef(editorMode);
  const editorModeRef = useRef(editorMode);
  const pendingModeSyncRef = useRef<(() => void) | null>(null);
  const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(null);
  const selectionAlwaysOn = useDevSettings((s) => s.selectionAlwaysOn);
  const isSourceMode = editorMode === "source";
  editorModeRef.current = editorMode;
  const focusOwner = useMemo(
    () => focusSurface(
      focusOwnerRole ?? (isSourceMode ? "source-surface" : "rich-surface"),
      namespace,
    ),
    [focusOwnerRole, isSourceMode, namespace],
  );
  const {
    initialDocRef,
    lastCommittedDocRef,
    pendingLocalEchoDocRef,
    canonicalBridgeEchoRef,
    sourceSelectionRef,
    userEditPendingRef,
    embeddedFieldFlushRegistry,
    focusOwnerRef,
    cancelRichDocumentSnapshot,
    flushRichDocumentSnapshot,
    handleRichChange,
  } = useLexicalDocumentSessionController({
    doc,
    focusOwner,
    onDocChange,
    onDirtyChange,
    onSelectionChange,
    onTextChange,
    richChangePolicy: "dirty",
  });

  const initialConfig = useMemo(() => createCoflatComposerConfig({
    editable,
    editorState: initialModeRef.current === "source"
      ? () => {
          writeSourceTextToLexicalRoot(initialDocRef.current);
        }
      : createLexicalInitialEditorState(initialDocRef.current),
    namespace,
  }), [editable, namespace]);

  useEffect(() => {
    editorModeRef.current = editorMode;
    userEditPendingRef.current = false;
  }, [editorMode]);

  const handleChange = useCallback((
    _editorState: unknown,
    editor: LexicalEditor,
    tags: Set<string>,
  ) => {
    if (shouldIgnoreMarkdownEditorChange(editor, tags)) {
      return;
    }

    if (editorModeRef.current === "source") {
      const nextDoc = getSourceText(editor);
      publishLexicalDocumentSnapshot({
        lastCommittedDocRef,
        onDocChange,
        onTextChange,
        pendingLocalEchoDocRef,
      }, nextDoc);
      return;
    }

    handleRichChange(editor, tags);
  }, [handleRichChange, lastCommittedDocRef, onDocChange, onTextChange, pendingLocalEchoDocRef]);

  const shellClassName = isSourceMode
    ? "cf-lexical-surface cf-lexical-surface--block"
    : documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.surface,
      DOCUMENT_SURFACE_CLASS.surfaceLexical,
      "cf-lexical-surface cf-lexical-surface--scroll",
    );
  const resolvedEditorClassName = [
    "cf-lexical-editor",
    editorClassName,
    isSourceMode
      ? "cf-lexical-editor--source"
      : documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.flow,
        DOCUMENT_SURFACE_CLASS.flowLexical,
        "cf-lexical-editor--rich",
      ),
  ].filter(Boolean).join(" ");
  const effectiveSurface = inheritedSurface ?? surfaceElement;
  const syncSelectionFromEventTarget = useCallback((target: EventTarget | null) => {
    if (editorModeRef.current === "source") {
      return;
    }

    const element = target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
    const sourcePosition = readSourcePositionFromElement(element);
    if (sourcePosition === null) {
      return;
    }

    storeSelection(
      sourceSelectionRef,
      Math.max(lastCommittedDocRef.current.length, sourcePosition),
      onSelectionChange,
      sourcePosition,
    );
  }, [onSelectionChange]);

  const sourceContentEditable = (
    <ContentEditable
      aria-label="Lexical source editor"
      className={resolvedEditorClassName}
      data-testid={testId ?? undefined}
      onBlurCapture={onBlurCapture}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onScroll={(event) => onScrollChange?.(event.currentTarget.scrollTop)}
      spellCheck={spellCheck}
    />
  );

  const richContentEditable = (
    <ContentEditable
      aria-label="Lexical rich editor"
      className={resolvedEditorClassName}
      data-testid={testId ?? undefined}
      onBlurCapture={onBlurCapture}
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
      onKeyDown={editable
        ? (event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented) {
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
        : onKeyDown}
      onMouseUp={editable
        ? (event: ReactMouseEvent<HTMLDivElement>) => {
            if (window.getSelection()?.isCollapsed !== false) {
              syncSelectionFromEventTarget(event.target);
            }
            repairBlankClickSelection(event.currentTarget, event);
          }
        : undefined}
      onFocus={onFocus}
      onPaste={editable
        ? () => {
            userEditPendingRef.current = true;
          }
        : undefined}
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
      onScroll={!isSourceMode
        ? (event) => onScrollChange?.(event.currentTarget.scrollTop)
        : undefined}
      onTextChange={onTextChange}
      pendingLocalEchoDocRef={pendingLocalEchoDocRef}
      renderContextValue={renderContextValue}
      revealPresentation={revealPresentation}
      setSurfaceElement={setSurfaceElement}
      shellClassName={shellClassName}
    >
      <EditorFocusPlugin onFocusOwnerChange={onFocusOwnerChange} owner={focusOwner} />
      <EditableSyncPlugin editable={editable} />
      {!isSourceMode && editable ? (
        <CursorRevealPlugin editorMode={editorMode} presentation={revealPresentation} />
      ) : null}
      <LexicalEditorHandlePlugin
        cancelRichDocumentSnapshot={cancelRichDocumentSnapshot}
        canonicalBridgeEchoRef={canonicalBridgeEchoRef}
        editorModeRef={editorModeRef}
        focusOwnerRef={focusOwnerRef}
        flushRichDocumentSnapshot={flushRichDocumentSnapshot}
        lastCommittedDocRef={lastCommittedDocRef}
        onEditorReady={onEditorReady}
        onDocChange={onDocChange}
        onSelectionChange={onSelectionChange}
        onTextChange={onTextChange}
        pendingModeSyncRef={pendingModeSyncRef}
        pendingLocalEchoDocRef={pendingLocalEchoDocRef}
        selectionRef={sourceSelectionRef}
        userEditPendingRef={userEditPendingRef}
      />
      <LexicalSourceBridgePlugin
        canonicalBridgeEchoRef={canonicalBridgeEchoRef}
        doc={doc}
        editorMode={editorMode}
        flushRichDocumentSnapshot={flushRichDocumentSnapshot}
        lastCommittedDocRef={lastCommittedDocRef}
        pendingModeSyncRef={pendingModeSyncRef}
        pendingLocalEchoDocRef={pendingLocalEchoDocRef}
        selectionRef={sourceSelectionRef}
        userEditPendingRef={userEditPendingRef}
      />
      <SourceSelectionPlugin
        editorMode={editorMode}
        onSelectionChange={onSelectionChange}
        selectionRef={sourceSelectionRef}
      />
      <ExplicitSourceSelectionPlugin
        editorMode={editorMode}
        lastCommittedDocRef={lastCommittedDocRef}
        onSelectionChange={onSelectionChange}
        selectionRef={sourceSelectionRef}
      />
      <RootElementPlugin onRootElementChange={onRootElementChange} />
      {editable ? <InlineTokenBoundaryPlugin /> : null}
      {!isSourceMode && editable ? <DestructiveKeySelectionSyncPlugin /> : null}
      {isSourceMode ? (
        <PlainTextPlugin
          contentEditable={sourceContentEditable}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
      ) : (
        <CoflatRichComposerPlugins
          contentEditable={richContentEditable}
          doc={doc}
          editable={editable}
          enableSourceNavigation
          hasOnChange
          historyPlugin={null}
          onChange={handleChange}
          onViewportFromChange={onViewportFromChange}
          selectionPlugin={selectionAlwaysOn ? <SelectionAlwaysOnDisplay /> : null}
          showBibliography
          showBlockKeyboardAccess
          showCodeBlockChrome
          showHeadingChrome
          showInteractionTrace={editable}
          showListMarkerStrip
          showMarkdownExpansion
          showReferenceTypeahead
          showSlashPicker
          showSourcePosition
          showTableChrome={false}
          showTabKey
          showViewportTracking
        />
      )}
      {editable ? <HistoryPlugin /> : null}
      {isSourceMode && editable ? <FormatEventPlugin /> : null}
      {isSourceMode && editable ? <OnChangePlugin onChange={handleChange} /> : null}
      {isSourceMode && selectionAlwaysOn ? <SelectionAlwaysOnDisplay /> : null}
      {isSourceMode ? <ActiveEditorPlugin /> : null}
      {isSourceMode ? <TreeViewPlugin /> : null}
    </CoflatLexicalComposerShell>
  );
}
