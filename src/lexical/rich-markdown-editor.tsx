import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import {
  createEmptyHistoryState,
  HistoryPlugin,
  type HistoryState,
} from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import type { LexicalEditor } from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEBUG_EDITOR_TEST_ID } from "../debug/debug-bridge-contract.js";
import type { EditorDocumentChange } from "../lib/editor-doc-change";
import {
  type FocusOwner,
  type FocusOwnerRole,
  focusSurface,
} from "../state/editor-focus";
import { ActiveEditorPlugin } from "./active-editor-plugin";
import { BibliographySection } from "./bibliography-section";
import { BlockKeyboardAccessPlugin } from "./block-keyboard-access-plugin";
import { CodeBlockChromePlugin } from "./code-block-chrome-plugin";
import { CursorRevealPlugin } from "./cursor-reveal-plugin";
import { DocumentChangeBridgeProvider } from "./document-change-bridge";
import { LexicalSurfaceEditableProvider } from "./editability-context";
import { EditorFocusPlugin } from "./editor-focus-plugin";
import {
  DestructiveKeySelectionSyncPlugin,
  EditableSyncPlugin,
  FormatEventPlugin,
  RootElementPlugin,
  repairBlankClickSelection,
  ViewportTrackingPlugin,
} from "./editor-surface-shared";
import {
  EmbeddedFieldFlushProvider,
} from "./embedded-field-flush-registry";
import { HeadingChromeAndIndexPlugin } from "./heading-chrome-index-plugin";
import { InlineTokenBoundaryPlugin } from "./inline-token-boundary-plugin";
import { InteractionTracePlugin } from "./interaction-trace-plugin";
import { ListMarkerStripPlugin } from "./list-marker-strip-plugin";
import {
  coflatMarkdownNodes,
  coflatMarkdownTransformers,
  createLexicalInitialEditorState,
  lexicalMarkdownTheme,
} from "./markdown";
import {
  LexicalDocumentSyncPlugin,
  RichLexicalEditorHandlePlugin,
  useLexicalDocumentSessionController,
} from "./lexical-document-session";
import type {
  MarkdownEditorHandle,
  MarkdownEditorSelection,
} from "./markdown-editor-types";
import { MarkdownExpansionPlugin } from "./markdown-expansion-plugin";
import { ReferenceTypeaheadPlugin } from "./reference-typeahead-plugin";
import {
  LexicalRenderContextProvider,
  type LexicalRenderContextValue,
} from "./render-context";
import { REVEAL_MODE, type RevealPresentation } from "./reveal-mode";
import {
  RevealPresentationProvider,
  useRevealPresentation,
} from "./reveal-presentation-context";
import {
  CodeFenceExitPlugin,
  CodeHighlightPlugin,
  CoflatClipboardPlugin,
  SelectionAlwaysOnPlugin,
} from "./rich-editor-plugins";
import { EditorScrollSurfaceProvider, useEditorScrollSurface } from "./runtime";
import { SlashPickerPlugin } from "./slash-picker-plugin";
import { SourcePositionPlugin } from "./source-position-plugin";
import { StructureEditProvider } from "./structure-edit-plugin";
import { TabKeyPlugin } from "./tab-key-plugin";
import { TableActionMenuPlugin } from "./table-action-menu-plugin";
import { TableScrollShadowPlugin } from "./table-scroll-shadow-plugin";
import { TreeViewPlugin } from "./tree-view-plugin";

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

  const initialConfig = useMemo(() => ({
    editable,
    editorState: createLexicalInitialEditorState(initialDocRef.current),
    namespace,
    nodes: [...coflatMarkdownNodes],
    onError(error: Error) {
      throw error;
    },
    theme: lexicalMarkdownTheme,
  }), [namespace]);

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
      ? "cf-lexical-surface cf-lexical-surface--scroll"
      : "cf-lexical-surface cf-lexical-surface--block";

  const resolvedEditorClassName = [
    editorClassName,
    layoutMode === "inline" ? "cf-lexical-editor--inline-surface" : "",
  ].filter(Boolean).join(" ");
  const effectiveSurface = inheritedSurface ?? surfaceElement;

  useEffect(() => {
    syncSelectionToDocLength(doc.length);
  }, [doc.length, syncSelectionToDocLength]);

  return (
    <EmbeddedFieldFlushProvider registry={embeddedFieldFlushRegistry}>
      <RevealPresentationProvider value={resolvedRevealPresentation}>
        <LexicalRenderContextProvider doc={doc} docPath={docPath} value={renderContextValue}>
          <LexicalSurfaceEditableProvider editable={editable}>
        <div
          className={shellClassName}
          onScroll={layoutMode === "block" && showBibliography
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
                {editable
                  ? <CursorRevealPlugin editorMode={REVEAL_MODE.LEXICAL} presentation={resolvedRevealPresentation} />
                  : <ClickableLinkPlugin />}
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
                <CoflatClipboardPlugin />
                <RichTextPlugin
                  contentEditable={(
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
                        ? (event: React.MouseEvent<HTMLDivElement>) => {
                          repairBlankClickSelection(event.currentTarget, event);
                        }
                        : undefined}
                      onScroll={(event) => onScrollChange?.(event.currentTarget.scrollTop)}
                      spellCheck={spellCheck}
                    />
                  )}
                  ErrorBoundary={LexicalErrorBoundary}
                  placeholder={null}
                />
                <CodeHighlightPlugin />
                <CodeFenceExitPlugin />
                {showCodeBlockChrome ? <CodeBlockChromePlugin /> : null}
                {editable ? <FormatEventPlugin /> : null}
                {editable || preserveLocalHistory ? (
                  <HistoryPlugin
                    externalHistoryState={nestedHistoryStateRef.current ?? undefined}
                  />
                ) : null}
                <ListPlugin />
                <CheckListPlugin />
                {editable ? <ListMarkerStripPlugin /> : null}
                <LinkPlugin />
                <TableScrollShadowPlugin />
                {editable ? <TableActionMenuPlugin /> : null}
                {editable ? <MarkdownExpansionPlugin /> : null}
                {editable ? <BlockKeyboardAccessPlugin /> : null}
                {editable ? <TabKeyPlugin /> : null}
                {editable ? <ReferenceTypeaheadPlugin /> : null}
                {editable ? <SlashPickerPlugin /> : null}
                {showHeadingChrome ? <HeadingChromeAndIndexPlugin doc={doc} /> : null}
                <SourcePositionPlugin doc={doc} enableNavigation={enableSourceNavigation} />
                {showViewportTracking ? <ViewportTrackingPlugin onViewportFromChange={onViewportFromChange} /> : null}
                {editable ? <MarkdownShortcutPlugin transformers={[...coflatMarkdownTransformers]} /> : null}
                {editable ? <OnChangePlugin onChange={handleChange} /> : null}
                <SelectionAlwaysOnPlugin />
                {showBibliography ? <BibliographySection /> : null}
                <ActiveEditorPlugin />
                <TreeViewPlugin />
                <InteractionTracePlugin />
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
