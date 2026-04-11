import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { registerCodeHighlighting } from "@lexical/code";
import { copyToClipboard } from "@lexical/clipboard";
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
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { SelectionAlwaysOnDisplay } from "@lexical/react/LexicalSelectionAlwaysOnDisplay";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import {
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  CUT_COMMAND,
  FORMAT_TEXT_COMMAND,
  HISTORY_MERGE_TAG,
  PASTE_COMMAND,
  PASTE_TAG,
  type LexicalEditor,
  isDOMNode,
  isSelectionCapturedInDecoratorInput,
  mergeRegister,
} from "lexical";

import {
  applyEditorDocumentChanges,
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../app/editor-doc-change";
import {
  focusSurface,
  type FocusOwner,
  type FocusOwnerRole,
  type SurfaceFocusOwner,
} from "../state/editor-focus";
import {
  LexicalRenderContextProvider,
  type LexicalRenderContextValue,
  useLexicalRenderContext,
} from "./render-context";
import { BibliographySection } from "./bibliography-section";
import { CodeBlockChromePlugin } from "./code-block-chrome-plugin";
import { LexicalSurfaceEditableProvider } from "./editability-context";
import { dispatchSurfaceFocusRequest, EditorFocusPlugin } from "./editor-focus-plugin";
import { HeadingChromePlugin } from "./heading-chrome-plugin";
import { HeadingIndexPlugin } from "./heading-index-plugin";
import { IncludeRegionAffordancePlugin } from "./include-region-affordance-plugin";
import { InlineMathSourcePlugin } from "./inline-math-source-plugin";
import { LinkSourcePlugin } from "./link-source-plugin";
import { StructureEditProvider } from "./structure-edit-plugin";
import {
  getCoflatClipboardData,
  getCoflatMarkdownFromDataTransfer,
  insertCoflatMarkdownAtSelection,
} from "./clipboard";
import {
  coflatMarkdownNodes,
  coflatMarkdownTransformers,
  createLexicalInitialEditorState,
  getLexicalMarkdown,
  lexicalMarkdownTheme,
  setLexicalMarkdown,
} from "./markdown";
import { BlockKeyboardAccessPlugin } from "./block-keyboard-access-plugin";
import { MarkdownExpansionPlugin } from "./markdown-expansion-plugin";
import { ReferenceTypeaheadPlugin } from "./reference-typeahead-plugin";
import { TableScrollShadowPlugin } from "./table-scroll-shadow-plugin";
import { TableActionMenuPlugin } from "./table-action-menu-plugin";
import { SlashPickerPlugin } from "./slash-picker-plugin";
import {
  scrollSourcePositionIntoView,
  SourcePositionPlugin,
} from "./source-position-plugin";
import { COFLAT_FORMAT_EVENT_TAG, COFLAT_NESTED_EDIT_TAG } from "./update-tags";
import { useDevSettings } from "../app/dev-settings";
import { EditorScrollSurfaceProvider, useEditorScrollSurface } from "../lexical-next";
import type {
  MarkdownEditorHandle,
  MarkdownEditorSelection,
} from "./markdown-editor-types";
import { FORMAT_EVENT, type FormatEventDetail } from "../constants/events";
import { TreeViewPlugin } from "./tree-view-plugin";


function getViewportFromRichSurface(root: HTMLElement): number {
  const headings = [...root.querySelectorAll<HTMLElement>(".cf-lexical-heading[data-coflat-heading-pos]")];
  if (headings.length === 0) {
    return 0;
  }

  const threshold = root.getBoundingClientRect().top + 24;
  let active = 0;

  for (const heading of headings) {
    const pos = Number(heading.dataset.coflatHeadingPos ?? "");
    if (!Number.isFinite(pos)) {
      continue;
    }

    if (heading.getBoundingClientRect().top <= threshold) {
      active = pos;
      continue;
    }

    break;
  }

  return active;
}

function hasEditableTextSelection(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed) {
    return false;
  }

  const anchorNode = selection.anchorNode;
  const anchorElement = anchorNode instanceof Element
    ? anchorNode
    : anchorNode?.parentElement;
  const textLeaf = anchorElement?.closest("[data-lexical-text='true']");
  return Boolean(textLeaf && root.contains(textLeaf));
}


function EditableSyncPlugin({
  editable,
}: {
  readonly editable: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editable, editor]);

  return null;
}

function isInlineTextFormatEvent(
  detail: FormatEventDetail,
): detail is Extract<FormatEventDetail, { type: "bold" | "code" | "highlight" | "italic" | "strikethrough" }> {
  return detail.type === "bold"
    || detail.type === "code"
    || detail.type === "highlight"
    || detail.type === "italic"
    || detail.type === "strikethrough";
}

function editorOwnsActiveSelection(root: HTMLElement | null): boolean {
  if (!root) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
    return false;
  }

  const activeElement = document.activeElement;
  return root.contains(selection.anchorNode)
    && root.contains(selection.focusNode)
    && !!activeElement
    && (activeElement === root || root.contains(activeElement));
}

function FormatEventPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const handleFormat = (event: Event) => {
      const detail = (event as CustomEvent<FormatEventDetail>).detail;
      if (!isInlineTextFormatEvent(detail)) {
        return;
      }

      const root = editor.getRootElement();
      if (!editorOwnsActiveSelection(root)) {
        return;
      }

      editor.update(() => {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, detail.type);
      }, {
        discrete: true,
        tag: COFLAT_FORMAT_EVENT_TAG,
      });
    };

    document.addEventListener(FORMAT_EVENT, handleFormat);
    return () => {
      document.removeEventListener(FORMAT_EVENT, handleFormat);
    };
  }, [editor]);

  return null;
}

function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => registerCodeHighlighting(editor), [editor]);

  return null;
}

function MarkdownSyncPlugin({
  doc,
  lastCommittedDocRef,
  pendingLocalEchoDocRef,
  preserveLocalHistory,
}: {
  readonly doc: string;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly preserveLocalHistory: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const pendingLocalEchoDoc = pendingLocalEchoDocRef.current;
    if (doc === lastCommittedDocRef.current) {
      if (pendingLocalEchoDoc === doc) {
        pendingLocalEchoDocRef.current = null;
      }
      return;
    }

    const preservePendingLocalHistory =
      preserveLocalHistory && pendingLocalEchoDoc !== null;
    setLexicalMarkdown(
      editor,
      doc,
      preservePendingLocalHistory
        ? { tag: HISTORY_MERGE_TAG }
        : undefined,
    );
    if (!preservePendingLocalHistory) {
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }
    pendingLocalEchoDocRef.current = null;
    lastCommittedDocRef.current = doc;
  }, [doc, editor, lastCommittedDocRef, pendingLocalEchoDocRef, preserveLocalHistory]);

  return null;
}

function clampOffset(offset: number, docLength: number): number {
  return Math.max(0, Math.min(offset, docLength));
}

function createMarkdownSelection(
  anchor: number,
  focus = anchor,
  docLength = Number.MAX_SAFE_INTEGER,
): MarkdownEditorSelection {
  const nextAnchor = clampOffset(anchor, docLength);
  const nextFocus = clampOffset(focus, docLength);
  return {
    anchor: nextAnchor,
    focus: nextFocus,
    from: Math.min(nextAnchor, nextFocus),
    to: Math.max(nextAnchor, nextFocus),
  };
}

function storeSelection(
  selectionRef: MutableRefObject<MarkdownEditorSelection>,
  docLength: number,
  onSelectionChange: ((selection: MarkdownEditorSelection) => void) | undefined,
  anchor: number,
  focus = anchor,
): MarkdownEditorSelection {
  const nextSelection = createMarkdownSelection(anchor, focus, docLength);
  selectionRef.current = nextSelection;
  onSelectionChange?.(nextSelection);
  return nextSelection;
}

interface EditorHandlePluginProps {
  readonly focusOwner: SurfaceFocusOwner;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}

function EditorHandlePlugin({
  focusOwner,
  onEditorReady,
  onSelectionChange,
  selectionRef,
  userEditPendingRef,
}: EditorHandlePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onEditorReady) {
      return;
    }

    onEditorReady({
      applyChanges: (changes) => {
        if (changes.length === 0) {
          return;
        }

        const currentDoc = getLexicalMarkdown(editor);
        const nextDoc = applyEditorDocumentChanges(currentDoc, changes);
        if (nextDoc === currentDoc) {
          storeSelection(
            selectionRef,
            currentDoc.length,
            onSelectionChange,
            selectionRef.current.anchor,
            selectionRef.current.focus,
          );
          return;
        }
        userEditPendingRef.current = true;
        storeSelection(
          selectionRef,
          nextDoc.length,
          onSelectionChange,
          selectionRef.current.anchor,
          selectionRef.current.focus,
        );
        setLexicalMarkdown(editor, nextDoc);
      },
      focus: () => {
        scrollSourcePositionIntoView(editor, editor.getRootElement(), selectionRef.current.from);
        dispatchSurfaceFocusRequest(editor, { owner: focusOwner });
      },
      getDoc: () => getLexicalMarkdown(editor),
      getSelection: () => selectionRef.current,
      insertText: (text) => {
        const currentDoc = getLexicalMarkdown(editor);
        const selection = createMarkdownSelection(
          selectionRef.current.anchor,
          selectionRef.current.focus,
          currentDoc.length,
        );
        const nextDoc = [
          currentDoc.slice(0, selection.from),
          text,
          currentDoc.slice(selection.to),
        ].join("");
        const nextOffset = selection.from + text.length;

        if (nextDoc === currentDoc) {
          storeSelection(selectionRef, currentDoc.length, onSelectionChange, nextOffset);
          return;
        }
        userEditPendingRef.current = true;
        storeSelection(selectionRef, nextDoc.length, onSelectionChange, nextOffset);
        setLexicalMarkdown(editor, nextDoc);
      },
      setDoc: (doc) => {
        const currentDoc = getLexicalMarkdown(editor);
        if (doc === currentDoc) {
          storeSelection(
            selectionRef,
            currentDoc.length,
            onSelectionChange,
            selectionRef.current.anchor,
            selectionRef.current.focus,
          );
          return;
        }
        userEditPendingRef.current = true;
        storeSelection(
          selectionRef,
          doc.length,
          onSelectionChange,
          selectionRef.current.anchor,
          selectionRef.current.focus,
        );
        setLexicalMarkdown(editor, doc);
      },
      setSelection: (anchor, focus = anchor) => {
        const nextSelection = storeSelection(
          selectionRef,
          getLexicalMarkdown(editor).length,
          onSelectionChange,
          anchor,
          focus,
        );
        scrollSourcePositionIntoView(editor, editor.getRootElement(), nextSelection.from);
        dispatchSurfaceFocusRequest(editor, { owner: focusOwner });
      },
    }, editor);
  }, [editor, focusOwner, onEditorReady, onSelectionChange, selectionRef, userEditPendingRef]);

  return null;
}

function getClipboardEvent(
  event: ClipboardEvent | KeyboardEvent | null,
): ClipboardEvent | null {
  return event && "clipboardData" in event
    ? event as ClipboardEvent
    : null;
}

function getPasteClipboardData(
  event: ClipboardEvent | InputEvent | KeyboardEvent,
): DataTransfer | null {
  return "clipboardData" in event
    ? event.clipboardData ?? null
    : null;
}

function CoflatClipboardPlugin() {
  const [editor] = useLexicalComposerContext();
  const renderContext = useLexicalRenderContext();

  useEffect(() => {
    const getClipboardData = () => editor.getEditorState().read(() =>
      getCoflatClipboardData(editor, renderContext, $getSelection())
    );

    return mergeRegister(
      editor.registerCommand(COPY_COMMAND, (event) => {
        const clipboardData = getClipboardData();
        if (!clipboardData) {
          return false;
        }

        void copyToClipboard(editor, getClipboardEvent(event), clipboardData);
        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(CUT_COMMAND, (event) => {
        const clipboardData = getClipboardData();
        if (!clipboardData) {
          return false;
        }

        void copyToClipboard(editor, getClipboardEvent(event), clipboardData).then((copied) => {
          if (!copied) {
            return;
          }

          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.removeText();
              return;
            }

            if ($isNodeSelection(selection)) {
              for (const node of selection.getNodes()) {
                node.remove();
              }
            }
          });
        });

        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(PASTE_COMMAND, (event) => {
        const clipboardData = getPasteClipboardData(event);
        if (!clipboardData) {
          return false;
        }

        if (isDOMNode(event.target) && isSelectionCapturedInDecoratorInput(event.target)) {
          return false;
        }

        const markdown = getCoflatMarkdownFromDataTransfer(clipboardData);
        if (!markdown) {
          return false;
        }

        const inserted = insertCoflatMarkdownAtSelection(editor, markdown, {
          tag: PASTE_TAG,
        });
        if (!inserted) {
          return false;
        }

        event.preventDefault();
        return true;
      }, COMMAND_PRIORITY_HIGH),
    );
  }, [editor, renderContext]);

  return null;
}

function ViewportTrackingPlugin({
  onViewportFromChange,
}: {
  readonly onViewportFromChange?: (from: number) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const surface = useEditorScrollSurface();

  useEffect(() => {
    if (!onViewportFromChange || !surface || typeof window === "undefined") {
      return;
    }

    let frame = 0;

    const sync = () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }

      frame = requestAnimationFrame(() => {
        frame = 0;
        const root = editor.getRootElement();
        if (!root) {
          return;
        }
        onViewportFromChange(getViewportFromRichSurface(root));
      });
    };

    const unregisterUpdate = editor.registerUpdateListener(() => {
      sync();
    });

    surface.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      surface.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      unregisterUpdate();
    };
  }, [editor, onViewportFromChange, surface]);

  return null;
}

function RootElementPlugin({
  onRootElementChange,
}: {
  readonly onRootElementChange?: (root: HTMLElement | null) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onRootElementChange) {
      return;
    }

    onRootElementChange(editor.getRootElement());
    return editor.registerRootListener((rootElement) => {
      onRootElementChange(rootElement);
    });
  }, [editor, onRootElementChange]);

  return null;
}

function repairBlankClickSelection(root: HTMLElement, event: React.MouseEvent): void {
  if (hasEditableTextSelection(root)) {
    return;
  }

  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.caretRangeFromPoint(event.clientX, event.clientY);
  if (range && root.contains(range.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

export interface LexicalRichMarkdownEditorProps {
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
  const selectionAlwaysOn = useDevSettings((s) => s.selectionAlwaysOn);
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
                {editable ? <ReferenceTypeaheadPlugin /> : null}
                {editable ? <SlashPickerPlugin /> : null}
                {showHeadingChrome ? <HeadingChromePlugin doc={renderContextValue?.doc ?? doc} /> : null}
                {showHeadingChrome ? <HeadingIndexPlugin /> : null}
                <SourcePositionPlugin doc={renderContextValue?.doc ?? doc} enableNavigation={enableSourceNavigation} />
                {showViewportTracking ? <ViewportTrackingPlugin onViewportFromChange={onViewportFromChange} /> : null}
                {editable ? <MarkdownShortcutPlugin transformers={[...coflatMarkdownTransformers]} /> : null}
                {editable ? <OnChangePlugin onChange={handleChange} /> : null}
                {selectionAlwaysOn ? <SelectionAlwaysOnDisplay /> : null}
                {showBibliography ? <BibliographySection /> : null}
                <TreeViewPlugin />
              </StructureEditProvider>
            </LexicalComposer>
          </EditorScrollSurfaceProvider>
        </div>
      </LexicalSurfaceEditableProvider>
    </LexicalRenderContextProvider>
  );
}
