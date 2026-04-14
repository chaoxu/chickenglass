import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  createEmptyHistoryState,
  HistoryPlugin,
  type HistoryState,
} from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import type { LexicalEditor } from "lexical";

import {
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../lib/editor-doc-change";
import {
  focusSurface,
  type FocusOwner,
  type FocusOwnerRole,
} from "../state/editor-focus";
import {
  LexicalRenderContextProvider,
  type LexicalRenderContextValue,
} from "./render-context";
import { BibliographySection } from "./bibliography-section";
import { CodeBlockChromePlugin } from "./code-block-chrome-plugin";
import { LexicalSurfaceEditableProvider } from "./editability-context";
import { EditorFocusPlugin } from "./editor-focus-plugin";
import { HeadingChromeAndIndexPlugin } from "./heading-chrome-index-plugin";
import { IncludeRegionAffordancePlugin } from "./include-region-affordance-plugin";
import { InlineMathSourcePlugin } from "./inline-math-source-plugin";
import { LinkSourcePlugin } from "./link-source-plugin";
import { StructureEditProvider } from "./structure-edit-plugin";
import {
  coflatMarkdownNodes,
  coflatMarkdownTransformers,
  createLexicalInitialEditorState,
  getLexicalMarkdown,
  lexicalMarkdownTheme,
} from "./markdown";
import { BlockKeyboardAccessPlugin } from "./block-keyboard-access-plugin";
import { MarkdownExpansionPlugin } from "./markdown-expansion-plugin";
import { ReferenceTypeaheadPlugin } from "./reference-typeahead-plugin";
import { TableScrollShadowPlugin } from "./table-scroll-shadow-plugin";
import { TableActionMenuPlugin } from "./table-action-menu-plugin";
import { SlashPickerPlugin } from "./slash-picker-plugin";
import { SourcePositionPlugin } from "./source-position-plugin";
import { COFLAT_FORMAT_EVENT_TAG, COFLAT_NESTED_EDIT_TAG } from "./update-tags";
import { EditorScrollSurfaceProvider, useEditorScrollSurface } from "../lexical-next";
import type {
  MarkdownEditorHandle,
  MarkdownEditorSelection,
} from "./markdown-editor-types";
import { ActiveEditorPlugin } from "./active-editor-plugin";
import { TabKeyPlugin } from "./tab-key-plugin";
import { TreeViewPlugin } from "./tree-view-plugin";
import { InteractionTracePlugin } from "./interaction-trace-plugin";

import {
  CoflatClipboardPlugin,
  CodeHighlightPlugin,
  createMarkdownSelection,
  EditableSyncPlugin,
  EditorHandlePlugin,
  FormatEventPlugin,
  MarkdownSyncPlugin,
  repairBlankClickSelection,
  RootElementPlugin,
  SelectionAlwaysOnPlugin,
  ViewportTrackingPlugin,
} from "./rich-editor-plugins";

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
  readonly showBibliography?: boolean;
  readonly showCodeBlockChrome?: boolean;
  readonly showHeadingChrome?: boolean;
  readonly showIncludeAffordances?: boolean;
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
  showBibliography = false,
  showCodeBlockChrome = true,
  showHeadingChrome = true,
  showIncludeAffordances = false,
  showViewportTracking = true,
  singleLine = false,
  enableSourceNavigation = false,
  spellCheck = false,
  testId = "lexical-editor",
}: LexicalRichMarkdownEditorProps) {
  const inheritedSurface = useEditorScrollSurface();
  const initialDocRef = useRef(doc);
  const lastCommittedDocRef = useRef(doc);
  const nestedHistoryStateRef = useRef<HistoryState | null>(null);
  const pendingLocalEchoDocRef = useRef<string | null>(null);
  const sourceSelectionRef = useRef<MarkdownEditorSelection>(createMarkdownSelection(0));
  const userEditPendingRef = useRef(false);
  const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(null);
  const focusOwner = useMemo(
    () => focusSurface(focusOwnerRole, namespace),
    [focusOwnerRole, namespace],
  );

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
    const nextDoc = getLexicalMarkdown(editor);

    if (
      requireUserEditFlag
      && !userEditPendingRef.current
      && !tags.has(COFLAT_FORMAT_EVENT_TAG)
      && !tags.has(COFLAT_NESTED_EDIT_TAG)
    ) {
      return;
    }

    const changes = createMinimalEditorDocumentChanges(
      lastCommittedDocRef.current,
      nextDoc,
    );
    if (changes.length === 0) {
      userEditPendingRef.current = false;
      return;
    }

    userEditPendingRef.current = false;
    pendingLocalEchoDocRef.current = nextDoc;
    lastCommittedDocRef.current = nextDoc;
    onTextChange?.(nextDoc);
    onDocChange?.(changes);
  }, [onDocChange, onTextChange, requireUserEditFlag]);

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
    sourceSelectionRef.current = createMarkdownSelection(
      sourceSelectionRef.current.anchor,
      sourceSelectionRef.current.focus,
      doc.length,
    );
  }, [doc]);

  return (
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
            <LexicalComposer initialConfig={initialConfig}>
              <StructureEditProvider>
                <EditorFocusPlugin onFocusOwnerChange={onFocusOwnerChange} owner={focusOwner} />
                <EditableSyncPlugin editable={editable} />
                <EditorHandlePlugin
                  focusOwner={focusOwner}
                  onEditorReady={onEditorReady}
                  onSelectionChange={onSelectionChange}
                  selectionRef={sourceSelectionRef}
                  userEditPendingRef={userEditPendingRef}
                />
                <RootElementPlugin onRootElementChange={onRootElementChange} />
                <MarkdownSyncPlugin
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
                {showCodeBlockChrome ? <CodeBlockChromePlugin /> : null}
                {showIncludeAffordances ? <IncludeRegionAffordancePlugin editable={editable} /> : null}
                {editable ? <FormatEventPlugin /> : null}
                {editable || preserveLocalHistory ? (
                  <HistoryPlugin
                    externalHistoryState={nestedHistoryStateRef.current ?? undefined}
                  />
                ) : null}
                <ListPlugin />
                <CheckListPlugin />
                <LinkPlugin />
                <TableScrollShadowPlugin />
                {editable ? <TableActionMenuPlugin /> : null}
                {editable ? <LinkSourcePlugin /> : <ClickableLinkPlugin />}
                {editable ? <InlineMathSourcePlugin /> : null}
                {editable ? <MarkdownExpansionPlugin /> : null}
                {editable ? <BlockKeyboardAccessPlugin /> : null}
                {editable ? <TabKeyPlugin /> : null}
                {editable ? <ReferenceTypeaheadPlugin /> : null}
                {editable ? <SlashPickerPlugin /> : null}
                {showHeadingChrome ? <HeadingChromeAndIndexPlugin doc={renderContextValue?.doc ?? doc} /> : null}
                <SourcePositionPlugin doc={renderContextValue?.doc ?? doc} enableNavigation={enableSourceNavigation} />
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
          </EditorScrollSurfaceProvider>
        </div>
      </LexicalSurfaceEditableProvider>
    </LexicalRenderContextProvider>
  );
}
