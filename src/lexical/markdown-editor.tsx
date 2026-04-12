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
  $getRoot,
  HISTORY_MERGE_TAG,
  FORMAT_TEXT_COMMAND,
  type EditorUpdateOptions,
  type LexicalEditor,
} from "lexical";

import type { EditorMode } from "../app/editor-mode";
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
import { EditorScrollSurfaceProvider, useEditorScrollSurface } from "../lexical-next";
import { BibliographySection } from "./bibliography-section";
import { BlockKeyboardAccessPlugin } from "./block-keyboard-access-plugin";
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
  coflatMarkdownNodes,
  coflatMarkdownTransformers,
  createLexicalInitialEditorState,
  getLexicalMarkdown,
  lexicalMarkdownTheme,
  setLexicalMarkdown,
} from "./markdown";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "./markdown-editor-types";
import { MarkdownExpansionPlugin } from "./markdown-expansion-plugin";
import { ReferenceTypeaheadPlugin } from "./reference-typeahead-plugin";
import { SlashPickerPlugin } from "./slash-picker-plugin";
import {
  LexicalRenderContextProvider,
  type LexicalRenderContextValue,
} from "./render-context";
import {
  scrollSourcePositionIntoView,
  SourcePositionPlugin,
} from "./source-position-plugin";
import {
  getSourceText,
  readSourceTextSelectionFromLexicalRoot,
  selectSourceOffsetsInLexicalRoot,
  writeSourceTextToLexicalRoot,
} from "./source-text";
import { ActiveEditorPlugin } from "./active-editor-plugin";
import { TreeViewPlugin } from "./tree-view-plugin";
import { COFLAT_FORMAT_EVENT_TAG, COFLAT_NESTED_EDIT_TAG } from "./update-tags";
import { FORMAT_EVENT, type FormatEventDetail } from "../constants/events";
import { useDevSettings } from "../app/dev-settings";

const clickRepairHandlers = new WeakMap<HTMLElement, EventListener>();

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

function ClickCaretRepairPlugin({
  enabled,
}: {
  readonly enabled: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleMouseUp = (rootElement: HTMLElement) => {
      queueMicrotask(() => {
        if (document.activeElement !== rootElement) {
          return;
        }

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && rootElement.contains(selection.anchorNode)) {
          return;
        }

        editor.update(() => {
          $getRoot().selectEnd();
        }, { discrete: true });
      });
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      if (previousRootElement) {
        const previousListener = clickRepairHandlers.get(previousRootElement);
        if (previousListener) {
          previousRootElement.removeEventListener("mouseup", previousListener);
          clickRepairHandlers.delete(previousRootElement);
        }
      }

      if (!rootElement) {
        return;
      }

      const listener = () => handleMouseUp(rootElement);
      clickRepairHandlers.set(rootElement, listener);
      rootElement.addEventListener("mouseup", listener);
    });
  }, [editor, enabled]);

  return null;
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

function sameSelection(left: MarkdownEditorSelection, right: MarkdownEditorSelection): boolean {
  return (
    left.anchor === right.anchor
    && left.focus === right.focus
    && left.from === right.from
    && left.to === right.to
  );
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

    syncSelection(editor.getEditorState().read(() => readSourceTextSelectionFromLexicalRoot()));
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        syncSelection(readSourceTextSelectionFromLexicalRoot());
      });
    });
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
    const syncOptions = mergeHistory
      ? { tag: HISTORY_MERGE_TAG }
      : undefined;

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

  useEffect(() => {
    if (!onEditorReady) {
      return;
    }

    onEditorReady({
      applyChanges: (changes) => {
        if (changes.length === 0) {
          return;
        }

        const currentDoc = readEditorDocument(editor, editorModeRef.current);
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
      getDoc: () => readEditorDocument(editor, editorModeRef.current),
      getSelection: () => selectionRef.current,
      insertText: (text) => {
        const currentDoc = readEditorDocument(editor, editorModeRef.current);
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
        const currentDoc = readEditorDocument(editor, editorModeRef.current);
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
      setSelection: (anchor, focus = anchor) => {
        const nextSelection = storeSelection(
          selectionRef,
          readEditorDocument(editor, editorModeRef.current).length,
          onSelectionChange,
          anchor,
          focus,
        );

        if (editorModeRef.current === "source") {
          editor.update(() => {
            selectSourceOffsetsInLexicalRoot(nextSelection.anchor, nextSelection.focus);
          }, { discrete: true });
        } else {
          scrollSourcePositionIntoView(editor, editor.getRootElement(), nextSelection.from);
        }
        dispatchSurfaceFocusRequest(editor, { owner: focusOwnerRef.current });
      },
    }, editor);
  }, [editor, editorModeRef, focusOwnerRef, onEditorReady, onSelectionChange, selectionRef, userEditPendingRef]);

  return null;
}

function repairBlankClickSelection(root: HTMLElement, event: ReactMouseEvent): void {
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
    if (
      !userEditPendingRef.current
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
  }, [onDocChange, onTextChange]);

  const shellClassName = isSourceMode
    ? "cf-lexical-surface cf-lexical-surface--block"
    : "cf-lexical-surface cf-lexical-surface--scroll";
  const resolvedEditorClassName = [
    editorClassName,
    isSourceMode ? "cf-lexical-editor--source" : "cf-lexical-editor--rich",
  ].filter(Boolean).join(" ");
  const effectiveSurface = inheritedSurface ?? surfaceElement;

  return (
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
                <RootElementPlugin onRootElementChange={onRootElementChange} />
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
                {!isSourceMode ? <CodeBlockChromePlugin /> : null}
                {!isSourceMode ? <IncludeRegionAffordancePlugin editable={editable} /> : null}
                {!isSourceMode && editable ? <ClickCaretRepairPlugin enabled /> : null}
                {editable ? <HistoryPlugin /> : null}
                {!isSourceMode ? <ListPlugin /> : null}
                {!isSourceMode ? <CheckListPlugin /> : null}
                {!isSourceMode ? <LinkPlugin /> : null}
                {!isSourceMode && editable ? <LinkSourcePlugin /> : null}
                {!isSourceMode && editable ? <FormatEventPlugin /> : null}
                {!isSourceMode && editable ? <InlineMathSourcePlugin /> : null}
                {!isSourceMode && editable ? <MarkdownExpansionPlugin /> : null}
                {!isSourceMode && editable ? <BlockKeyboardAccessPlugin /> : null}
                {!isSourceMode && editable ? <ReferenceTypeaheadPlugin /> : null}
                {!isSourceMode && editable ? <SlashPickerPlugin /> : null}
                {!isSourceMode ? <HeadingChromePlugin doc={renderContextValue?.doc ?? doc} /> : null}
                {!isSourceMode ? <HeadingIndexPlugin /> : null}
                {!isSourceMode ? (
                  <SourcePositionPlugin
                    doc={renderContextValue?.doc ?? doc}
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
  );
}
