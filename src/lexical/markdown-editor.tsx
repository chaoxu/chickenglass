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
  HISTORY_MERGE_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
  SELECTION_CHANGE_COMMAND,
  mergeRegister,
  type EditorUpdateOptions,
  type LexicalEditor,
} from "lexical";

import type { EditorMode, RevealPresentation } from "../app/editor-mode";
import { REVEAL_PRESENTATION } from "../app/editor-mode";
import {
  applyEditorDocumentChanges,
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../lib/editor-doc-change";
import {
  focusSurface,
  type FocusOwner,
  type FocusOwnerRole,
  type SurfaceFocusOwner,
} from "../state/editor-focus";
import { EditorScrollSurfaceProvider, useEditorScrollSurface } from "../lexical-next";
import { BibliographySection } from "./bibliography-section";
import { BlockKeyboardAccessPlugin } from "./block-keyboard-access-plugin";
import { CodeBlockChromePlugin } from "./code-block-chrome-plugin";
import { CodeFenceExitPlugin, CodeHighlightPlugin } from "./rich-editor-plugins";
import {
  createEmbeddedFieldFlushRegistry,
  EmbeddedFieldFlushProvider,
  useEmbeddedFieldFlushRegistry,
} from "./embedded-field-flush-registry";
import { LexicalSurfaceEditableProvider } from "./editability-context";
import { dispatchSurfaceFocusRequest, EditorFocusPlugin } from "./editor-focus-plugin";
import {
  createMarkdownSelection,
  EditableSyncPlugin,
  FormatEventPlugin,
  repairBlankClickSelection,
  RootElementPlugin,
  storeSelection,
  ViewportTrackingPlugin,
} from "./editor-surface-shared";
import { HeadingChromeAndIndexPlugin } from "./heading-chrome-index-plugin";
import { IncludeRegionAffordancePlugin } from "./include-region-affordance-plugin";
import { InlineTokenBoundaryPlugin } from "./inline-token-boundary-plugin";
import { CursorRevealPlugin } from "./cursor-reveal-plugin";
import { RevealPresentationProvider } from "./reveal-presentation-context";
import { StructureEditProvider } from "./structure-edit-plugin";
import {
  coflatMarkdownNodes,
  coflatMarkdownTransformers,
  createLexicalInitialEditorState,
  getLexicalMarkdown,
  lexicalMarkdownTheme,
  setLexicalMarkdown,
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
  $readSourcePositionFromLexicalSelection,
  readSourcePositionFromLexicalSelection,
  readSourcePositionFromElement,
  scrollSourcePositionIntoView,
  SourcePositionPlugin,
} from "./source-position-plugin";
import {
  getSourceText,
  $readSourceTextSelectionFromLexicalRoot,
  selectSourceOffsetsInLexicalRoot,
  writeSourceTextToLexicalRoot,
} from "./source-text";
import { ActiveEditorPlugin } from "./active-editor-plugin";
import { getActiveEditor } from "./active-editor-tracker";
import { SET_SOURCE_SELECTION_COMMAND } from "./source-selection-command";
import { TreeViewPlugin } from "./tree-view-plugin";
import {
  COFLAT_DOCUMENT_SYNC_TAG,
  COFLAT_REVEAL_COMMIT_TAG,
  COFLAT_REVEAL_UI_TAG,
} from "./update-tags";
import { hasCursorRevealActive } from "./cursor-reveal-state";
import { useDevSettings } from "../state/dev-settings";

function sameSelection(left: MarkdownEditorSelection, right: MarkdownEditorSelection): boolean {
  return (
    left.anchor === right.anchor
    && left.focus === right.focus
    && left.from === right.from
    && left.to === right.to
  );
}

function canReadLiveSelectionFromEditor(editor: LexicalEditor): boolean {
  const activeEditor = getActiveEditor();
  return activeEditor === null || activeEditor === editor;
}

function replaceSourceText(
  editor: LexicalEditor,
  text: string,
  selection: MarkdownEditorSelection,
  options?: Pick<EditorUpdateOptions, "tag">,
): void {
  editor.update(() => {
    writeSourceTextToLexicalRoot(text);
    selectSourceOffsetsInLexicalRoot(selection.anchor, selection.focus);
  }, {
    discrete: true,
    tag: options?.tag,
  });
}

function readEditorDocument(editor: LexicalEditor, editorMode: EditorMode): string {
  return editorMode === "source"
    ? getSourceText(editor)
    : getLexicalMarkdown(editor);
}

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

    syncSelection(editor.getEditorState().read(() => $readSourceTextSelectionFromLexicalRoot()));
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        syncSelection($readSourceTextSelectionFromLexicalRoot());
      });
    });
  }, [editor, editorMode, onSelectionChange, selectionRef]);

  return null;
}

function RichSelectionPlugin({
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
    if (editorMode === "source") {
      return;
    }

    const syncSelection = (nextSelection: MarkdownEditorSelection | null) => {
      if (!nextSelection || sameSelection(latestSelectionRef.current, nextSelection)) {
        return;
      }
      latestSelectionRef.current = nextSelection;
      selectionRef.current = nextSelection;
      onSelectionChange?.(nextSelection);
    };

    const selectionFromLivePosition = (
      livePosition: number | null,
    ): MarkdownEditorSelection | null => {
      if (livePosition === null) {
        return null;
      }

      return {
        anchor: livePosition,
        focus: livePosition,
        from: livePosition,
        to: livePosition,
      };
    };

    const syncLiveSelection = (readLivePosition: () => number | null) => {
      if (!canReadLiveSelectionFromEditor(editor)) {
        return;
      }
      syncSelection(selectionFromLivePosition(readLivePosition()));
    };

    syncLiveSelection(() => readSourcePositionFromLexicalSelection(editor));
    return mergeRegister(
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          syncLiveSelection(() => readSourcePositionFromLexicalSelection(editor));
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerUpdateListener(({ editorState }) => {
        if (!canReadLiveSelectionFromEditor(editor)) {
          return;
        }

        editorState.read(() => {
          syncSelection(selectionFromLivePosition(
            $readSourcePositionFromLexicalSelection(editor),
          ));
        });
      }),
    );
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
        storeSelection(
          selectionRef,
          readEditorDocument(editor, editorMode).length,
          onSelectionChange,
          sourcePosition,
        );
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, editorMode, onSelectionChange, selectionRef]);

  return null;
}

function MarkdownModeSyncPlugin({
  doc,
  editorMode,
  lastCommittedDocRef,
  pendingLocalEchoDocRef,
  selectionRef,
  userEditPendingRef,
}: {
  readonly doc: string;
  readonly editorMode: EditorMode;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}) {
  const [editor] = useLexicalComposerContext();
  const appliedModeRef = useRef(editorMode);

  useEffect(() => {
    const pendingLocalEchoDoc = pendingLocalEchoDocRef.current;
    const previousMode = appliedModeRef.current;
    const modeChanged = previousMode !== editorMode;
    const docChanged = doc !== lastCommittedDocRef.current;
    if (!modeChanged && !docChanged) {
      if (pendingLocalEchoDoc === doc) {
        pendingLocalEchoDocRef.current = null;
      }
      return;
    }

    // On a pure mode toggle (docChanged is false, so `doc` already equals
    // `lastCommittedDocRef.current`), `doc` is the canonical text. Never
    // route through `readEditorDocument(editor, previousMode)` here:
    // `getLexicalMarkdown` is lossy for several Pandoc-flavored node shapes
    // (YAML frontmatter, some heading markers, bullet lists) and the re-
    // serialization silently destroyed large fractions of the document on
    // rich → source → rich round-trips (issue #99).
    const nextDoc = doc;
    const nextSelection = createMarkdownSelection(
      selectionRef.current.anchor,
      selectionRef.current.focus,
      nextDoc.length,
    );
    const mergeHistory = pendingLocalEchoDoc !== null || (modeChanged && !docChanged);
    const syncOptions = {
      tag: mergeHistory
        ? [HISTORY_MERGE_TAG, COFLAT_DOCUMENT_SYNC_TAG]
        : COFLAT_DOCUMENT_SYNC_TAG,
    };

    selectionRef.current = nextSelection;
    lastCommittedDocRef.current = nextDoc;
    userEditPendingRef.current = false;
    appliedModeRef.current = editorMode;
    pendingLocalEchoDocRef.current = null;

    // Defer the editor update to a microtask so the discrete commit (and the
    // `flushSync(setDecorators)` call inside Lexical's decorator listener) runs
    // AFTER React's current commit phase finishes. Committing during the
    // effect phase triggers React 19's "flushSync was called from inside a
    // lifecycle method" warning.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      if (editorMode === "source") {
        replaceSourceText(editor, nextDoc, nextSelection, syncOptions);
      } else {
        setLexicalMarkdown(editor, nextDoc, syncOptions);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc, editor, editorMode, lastCommittedDocRef, pendingLocalEchoDocRef, selectionRef, userEditPendingRef]);

  return null;
}

interface EditorHandlePluginProps {
  readonly editorModeRef: MutableRefObject<EditorMode>;
  readonly focusOwnerRef: MutableRefObject<SurfaceFocusOwner>;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}

function EditorHandlePlugin({
  editorModeRef,
  focusOwnerRef,
  onEditorReady,
  onSelectionChange,
  selectionRef,
  userEditPendingRef,
}: EditorHandlePluginProps) {
  const [editor] = useLexicalComposerContext();
  const embeddedFieldFlushRegistry = useEmbeddedFieldFlushRegistry();

  useEffect(() => {
    if (!onEditorReady) {
      return;
    }

    const flushPendingEdits = () => {
      embeddedFieldFlushRegistry?.flush();
    };

    const readFreshDocument = () => {
      flushPendingEdits();
      return readEditorDocument(editor, editorModeRef.current);
    };

    onEditorReady({
      applyChanges: (changes) => {
        if (changes.length === 0) {
          return;
        }

        const currentDoc = readFreshDocument();
        const nextDoc = applyEditorDocumentChanges(currentDoc, changes);
        if (nextDoc === currentDoc) {
          return;
        }

        if (editorModeRef.current === "source") {
          const nextSelection = storeSelection(
            selectionRef,
            nextDoc.length,
            onSelectionChange,
            selectionRef.current.anchor,
            selectionRef.current.focus,
          );
          replaceSourceText(editor, nextDoc, nextSelection);
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
        if (editorModeRef.current !== "source") {
          scrollSourcePositionIntoView(editor, editor.getRootElement(), selectionRef.current.from);
        }
        dispatchSurfaceFocusRequest(editor, { owner: focusOwnerRef.current });
      },
      flushPendingEdits,
      getDoc: readFreshDocument,
      getSelection: () => {
        flushPendingEdits();
        if (editorModeRef.current === "source") {
          return selectionRef.current;
        }

        if (!canReadLiveSelectionFromEditor(editor)) {
          return selectionRef.current;
        }

        const livePosition = readSourcePositionFromLexicalSelection(editor);
        if (livePosition === null) {
          return selectionRef.current;
        }

        const liveSelection = createMarkdownSelection(
          livePosition,
          livePosition,
          readEditorDocument(editor, editorModeRef.current).length,
        );
        selectionRef.current = liveSelection;
        return liveSelection;
      },
      insertText: (text) => {
        const currentDoc = readFreshDocument();
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

        const nextSelection = storeSelection(
          selectionRef,
          nextDoc.length,
          onSelectionChange,
          nextOffset,
        );
        if (editorModeRef.current === "source") {
          replaceSourceText(editor, nextDoc, nextSelection);
          return;
        }

        userEditPendingRef.current = true;
        setLexicalMarkdown(editor, nextDoc);
      },
      setDoc: (doc) => {
        const currentDoc = readFreshDocument();
        const nextSelection = storeSelection(
          selectionRef,
          doc.length,
          onSelectionChange,
          selectionRef.current.anchor,
          selectionRef.current.focus,
        );
        if (doc === currentDoc) {
          return;
        }

        if (editorModeRef.current === "source") {
          replaceSourceText(editor, doc, nextSelection);
          return;
        }

        userEditPendingRef.current = true;
        setLexicalMarkdown(editor, doc);
      },
      setSelection: (anchor, focus = anchor, options) => {
        flushPendingEdits();
        const nextSelection = storeSelection(
          selectionRef,
          readEditorDocument(editor, editorModeRef.current).length,
          onSelectionChange,
          anchor,
          focus,
        );

        if (editorModeRef.current === "source") {
          const tags: EditorUpdateOptions["tag"] = options?.skipScrollIntoView
            ? [SKIP_SCROLL_INTO_VIEW_TAG]
            : undefined;
          editor.update(() => {
            selectSourceOffsetsInLexicalRoot(nextSelection.anchor, nextSelection.focus);
          }, { discrete: true, tag: tags });
        } else {
          scrollSourcePositionIntoView(editor, editor.getRootElement(), nextSelection.from);
        }
        dispatchSurfaceFocusRequest(editor, { owner: focusOwnerRef.current });
      },
    }, editor);
  }, [
    editor,
    editorModeRef,
    embeddedFieldFlushRegistry,
    focusOwnerRef,
    onEditorReady,
    onSelectionChange,
    selectionRef,
    userEditPendingRef,
  ]);

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
  testId = "lexical-editor",
}: LexicalMarkdownEditorProps) {
  const inheritedSurface = useEditorScrollSurface();
  const initialDocRef = useRef(doc);
  const initialModeRef = useRef(editorMode);
  const editorModeRef = useRef(editorMode);
  const lastCommittedDocRef = useRef(doc);
  const pendingLocalEchoDocRef = useRef<string | null>(null);
  const sourceSelectionRef = useRef<MarkdownEditorSelection>(createMarkdownSelection(0));
  const userEditPendingRef = useRef(false);
  const embeddedFieldFlushRegistry = useMemo(createEmbeddedFieldFlushRegistry, []);
  const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(null);
  const selectionAlwaysOn = useDevSettings((s) => s.selectionAlwaysOn);
  const isSourceMode = editorMode === "source";
  const focusOwner = useMemo(
    () => focusSurface(
      focusOwnerRole ?? (isSourceMode ? "source-surface" : "rich-surface"),
      namespace,
    ),
    [focusOwnerRole, isSourceMode, namespace],
  );
  const focusOwnerRef = useRef(focusOwner);

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

  useEffect(() => {
    focusOwnerRef.current = focusOwner;
  }, [focusOwner]);

  const handleChange = useCallback((
    _editorState: unknown,
    editor: LexicalEditor,
    tags: Set<string>,
  ) => {
    if (tags.has(COFLAT_DOCUMENT_SYNC_TAG)) {
      return;
    }
    if (tags.has(COFLAT_REVEAL_UI_TAG) && !tags.has(COFLAT_REVEAL_COMMIT_TAG)) {
      return;
    }
    if (!tags.has(COFLAT_REVEAL_COMMIT_TAG) && hasCursorRevealActive(editor)) {
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

    const nextDoc = getLexicalMarkdown(editor);

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
  }, [onDocChange, onTextChange]);

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
            <LexicalComposer initialConfig={initialConfig}>
              <StructureEditProvider>
                <EditorFocusPlugin onFocusOwnerChange={onFocusOwnerChange} owner={focusOwner} />
                <EditableSyncPlugin editable={editable} />
                <EditorHandlePlugin
                  editorModeRef={editorModeRef}
                  focusOwnerRef={focusOwnerRef}
                  onEditorReady={onEditorReady}
                  onSelectionChange={onSelectionChange}
                  selectionRef={sourceSelectionRef}
                  userEditPendingRef={userEditPendingRef}
                />
                <SourceSelectionPlugin
                  editorMode={editorMode}
                  onSelectionChange={onSelectionChange}
                  selectionRef={sourceSelectionRef}
                />
                <RichSelectionPlugin
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
                <MarkdownModeSyncPlugin
                  doc={doc}
                  editorMode={editorMode}
                  lastCommittedDocRef={lastCommittedDocRef}
                  pendingLocalEchoDocRef={pendingLocalEchoDocRef}
                  selectionRef={sourceSelectionRef}
                  userEditPendingRef={userEditPendingRef}
                />
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
                {!isSourceMode ? <IncludeRegionAffordancePlugin editable={editable} /> : null}
                {editable ? <HistoryPlugin /> : null}
                {!isSourceMode ? <ListPlugin /> : null}
                {!isSourceMode ? <CheckListPlugin /> : null}
                {!isSourceMode && editable ? <ListMarkerStripPlugin /> : null}
                {!isSourceMode ? <LinkPlugin /> : null}
                {!isSourceMode && editable ? <TabKeyPlugin /> : null}
                {!isSourceMode && editable ? <CursorRevealPlugin editorMode={editorMode} presentation={revealPresentation} /> : null}
                {!isSourceMode && editable ? <FormatEventPlugin /> : null}
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
          </EditorScrollSurfaceProvider>
        </div>
          </LexicalSurfaceEditableProvider>
        </LexicalRenderContextProvider>
      </RevealPresentationProvider>
    </EmbeddedFieldFlushProvider>
  );
}
