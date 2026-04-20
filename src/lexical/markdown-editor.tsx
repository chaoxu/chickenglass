import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from "react";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { SelectionAlwaysOnDisplay } from "@lexical/react/LexicalSelectionAlwaysOnDisplay";
import {
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
} from "lexical";

import type { EditorMode, RevealPresentation } from "../app/editor-mode";
import { REVEAL_PRESENTATION } from "../app/editor-mode";
import { DEBUG_EDITOR_TEST_ID } from "../debug/debug-bridge-contract.js";
import {
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../lib/editor-doc-change";
import {
  focusSurface,
  type FocusOwner,
  type FocusOwnerRole,
} from "../state/editor-focus";
import { EditorScrollSurfaceProvider, useEditorScrollSurface } from "../lexical-next";
import { BibliographySection } from "./bibliography-section";
import { BlockKeyboardAccessPlugin } from "./block-keyboard-access-plugin";
import { CodeBlockChromePlugin } from "./code-block-chrome-plugin";
import { CodeFenceExitPlugin, CodeHighlightPlugin } from "./rich-editor-plugins";
import { EmbeddedFieldFlushProvider } from "./embedded-field-flush-registry";
import { LexicalSurfaceEditableProvider } from "./editability-context";
import { EditorFocusPlugin } from "./editor-focus-plugin";
import {
  EditableSyncPlugin,
  FormatEventPlugin,
  repairBlankClickSelection,
  RootElementPlugin,
  storeSelection,
  ViewportTrackingPlugin,
} from "./editor-surface-shared";
import { HeadingChromeAndIndexPlugin } from "./heading-chrome-index-plugin";
import { InlineTokenBoundaryPlugin } from "./inline-token-boundary-plugin";
import { CursorRevealPlugin } from "./cursor-reveal-plugin";
import { RevealPresentationProvider } from "./reveal-presentation-context";
import { StructureEditProvider } from "./structure-edit-plugin";
import {
  coflatMarkdownNodes,
  coflatMarkdownTransformers,
  createLexicalInitialEditorState,
  lexicalMarkdownTheme,
} from "./markdown";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "./markdown-editor-types";
import { ListMarkerStripPlugin } from "./list-marker-strip-plugin";
import { MarkdownExpansionPlugin } from "./markdown-expansion-plugin";
import { ReferenceTypeaheadPlugin } from "./reference-typeahead-plugin";
import { SlashPickerPlugin } from "./slash-picker-plugin";
import { TabKeyPlugin } from "./tab-key-plugin";
import {
  LexicalRenderContextProvider,
  type LexicalRenderContextValue,
} from "./render-context";
import {
  readSourcePositionFromElement,
  SourcePositionPlugin,
} from "./source-position-plugin";
import {
  getSourceText,
  $readSourceTextSelectionFromLexicalRoot,
  writeSourceTextToLexicalRoot,
} from "./source-text";
import { ActiveEditorPlugin } from "./active-editor-plugin";
import { DocumentChangeBridgeProvider } from "./document-change-bridge";
import { SET_SOURCE_SELECTION_COMMAND } from "./source-selection-command";
import { TreeViewPlugin } from "./tree-view-plugin";
import {
  MarkdownEditorHandlePlugin,
  MarkdownModeSyncPlugin,
  readEditorDocument,
  type RichChangePolicy,
  sameSelection,
  shouldIgnoreMarkdownEditorChange,
  useMarkdownEditorSessionController,
} from "./markdown-editor-session";
import { useDevSettings } from "../state/dev-settings";

function SourceSelectionPlugin({
  editorMode,
  onSelectionChange,
  selectionRef,
}: {
  readonly editorMode: EditorMode;
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
  onSelectionChange,
  selectionRef,
}: {
  readonly editorMode: EditorMode;
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
          readEditorDocument(editor, editorMode).length,
          onSelectionChange,
          anchor,
          focus,
        );
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, editorMode, onSelectionChange, selectionRef]);

  return null;
}

export interface LexicalMarkdownEditorProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editorMode: EditorMode;
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
  readonly richChangePolicy?: RichChangePolicy;
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
  richChangePolicy = "dirty",
  spellCheck = false,
  testId = DEBUG_EDITOR_TEST_ID,
}: LexicalMarkdownEditorProps) {
  const inheritedSurface = useEditorScrollSurface();
  const initialModeRef = useRef(editorMode);
  const editorModeRef = useRef(editorMode);
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
    sourceSelectionRef,
    userEditPendingRef,
    embeddedFieldFlushRegistry,
    focusOwnerRef,
    handleRichChange,
  } = useMarkdownEditorSessionController({
    doc,
    focusOwner,
    onDocChange,
    onDirtyChange,
    onSelectionChange,
    onTextChange,
    richChangePolicy,
  });

  const initialConfig = useMemo(() => ({
    editable,
    editorState: initialModeRef.current === "source"
      ? () => {
          writeSourceTextToLexicalRoot(initialDocRef.current);
        }
      : createLexicalInitialEditorState(initialDocRef.current),
    namespace,
    nodes: [...coflatMarkdownNodes],
    onError(error: Error) {
      throw error;
    },
    theme: lexicalMarkdownTheme,
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
      const changes = createMinimalEditorDocumentChanges(
        lastCommittedDocRef.current,
        nextDoc,
      );
      if (changes.length === 0) {
        return;
      }

      pendingLocalEchoDocRef.current = nextDoc;
      lastCommittedDocRef.current = nextDoc;
      onTextChange?.(nextDoc);
      onDocChange?.(changes);
      return;
    }

    handleRichChange(editor, tags);
  }, [handleRichChange, lastCommittedDocRef, onDocChange, onTextChange, pendingLocalEchoDocRef]);

  const shellClassName = isSourceMode
    ? "cf-lexical-surface cf-lexical-surface--block"
    : "cf-lexical-surface cf-lexical-surface--scroll";
  const resolvedEditorClassName = [
    editorClassName,
    isSourceMode ? "cf-lexical-editor--source" : "cf-lexical-editor--rich",
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

  return (
    <EmbeddedFieldFlushProvider registry={embeddedFieldFlushRegistry}>
      <RevealPresentationProvider value={revealPresentation}>
        <LexicalRenderContextProvider doc={doc} docPath={docPath} value={renderContextValue}>
          <LexicalSurfaceEditableProvider editable={editable}>
        <div
          className={shellClassName}
          onScroll={!isSourceMode
            ? (event) => onScrollChange?.(event.currentTarget.scrollTop)
            : undefined}
          ref={setSurfaceElement}
        >
          <EditorScrollSurfaceProvider surface={effectiveSurface}>
            <DocumentChangeBridgeProvider
              lastCommittedDocRef={lastCommittedDocRef}
              onDocChange={onDocChange}
              onTextChange={onTextChange}
              pendingLocalEchoDocRef={pendingLocalEchoDocRef}
            >
              <LexicalComposer initialConfig={initialConfig}>
                <StructureEditProvider>
                <EditorFocusPlugin onFocusOwnerChange={onFocusOwnerChange} owner={focusOwner} />
                <EditableSyncPlugin editable={editable} />
                {!isSourceMode && editable ? <CursorRevealPlugin editorMode={editorMode} presentation={revealPresentation} /> : null}
                <MarkdownEditorHandlePlugin
                  editorModeRef={editorModeRef}
                  focusOwnerRef={focusOwnerRef}
                  lastCommittedDocRef={lastCommittedDocRef}
                  onEditorReady={onEditorReady}
                  onDocChange={onDocChange}
                  onSelectionChange={onSelectionChange}
                  onTextChange={onTextChange}
                  pendingLocalEchoDocRef={pendingLocalEchoDocRef}
                  selectionRef={sourceSelectionRef}
                  userEditPendingRef={userEditPendingRef}
                />
                <MarkdownModeSyncPlugin
                  doc={doc}
                  editorMode={editorMode}
                  lastCommittedDocRef={lastCommittedDocRef}
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
                  onSelectionChange={onSelectionChange}
                  selectionRef={sourceSelectionRef}
                />
                <RootElementPlugin onRootElementChange={onRootElementChange} />
                {editable ? <InlineTokenBoundaryPlugin /> : null}
                {isSourceMode ? (
                  <PlainTextPlugin
                    contentEditable={(
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
                    )}
                    placeholder={null}
                    ErrorBoundary={LexicalErrorBoundary}
                  />
                ) : (
                  <RichTextPlugin
                    contentEditable={(
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
                              syncSelectionFromEventTarget(event.target);
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
                    )}
                    ErrorBoundary={LexicalErrorBoundary}
                    placeholder={null}
                  />
                )}
                {!isSourceMode ? <CodeHighlightPlugin /> : null}
                {!isSourceMode ? <CodeFenceExitPlugin /> : null}
                {!isSourceMode ? <CodeBlockChromePlugin /> : null}
                {editable ? <HistoryPlugin /> : null}
                {!isSourceMode ? <ListPlugin /> : null}
                {!isSourceMode ? <CheckListPlugin /> : null}
                {!isSourceMode && editable ? <ListMarkerStripPlugin /> : null}
                {!isSourceMode ? <LinkPlugin /> : null}
                {!isSourceMode && editable ? <TabKeyPlugin /> : null}
                {editable ? <FormatEventPlugin /> : null}
                {!isSourceMode && editable ? <MarkdownExpansionPlugin /> : null}
                {!isSourceMode && editable ? <BlockKeyboardAccessPlugin /> : null}
                {!isSourceMode && editable ? <ReferenceTypeaheadPlugin /> : null}
                {!isSourceMode && editable ? <SlashPickerPlugin /> : null}
                {!isSourceMode ? <HeadingChromeAndIndexPlugin doc={doc} /> : null}
                {!isSourceMode ? (
                <SourcePositionPlugin
                  doc={doc}
                  enableNavigation
                />
                ) : null}
                {!isSourceMode ? <ViewportTrackingPlugin onViewportFromChange={onViewportFromChange} /> : null}
                {!isSourceMode && editable ? (
                  <MarkdownShortcutPlugin transformers={[...coflatMarkdownTransformers]} />
                ) : null}
                {editable ? <OnChangePlugin onChange={handleChange} /> : null}
                {selectionAlwaysOn ? <SelectionAlwaysOnDisplay /> : null}
                {!isSourceMode ? <BibliographySection /> : null}
                <ActiveEditorPlugin />
                <TreeViewPlugin />
                </StructureEditProvider>
              </LexicalComposer>
            </DocumentChangeBridgeProvider>
          </EditorScrollSurfaceProvider>
        </div>
          </LexicalSurfaceEditableProvider>
        </LexicalRenderContextProvider>
      </RevealPresentationProvider>
    </EmbeddedFieldFlushProvider>
  );
}
