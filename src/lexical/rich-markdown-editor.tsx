import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import {
  $getRoot,
  CLEAR_HISTORY_COMMAND,
  type LexicalEditor,
} from "lexical";

import {
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../app/editor-doc-change";
import {
  LexicalRenderContextProvider,
  type LexicalRenderContextValue,
} from "./render-context";
import { BibliographySection } from "./bibliography-section";
import { CodeBlockChromePlugin } from "./code-block-chrome-plugin";
import { FocusEdgePlugin } from "./focus-edge-plugin";
import { LexicalSurfaceEditableProvider } from "./editability-context";
import { HeadingChromePlugin } from "./heading-chrome-plugin";
import { IncludeRegionAffordancePlugin } from "./include-region-affordance-plugin";
import { InlineFormatSourcePlugin } from "./inline-format-source-plugin";
import { InlineMathSourcePlugin } from "./inline-math-source-plugin";
import { LinkSourcePlugin } from "./link-source-plugin";
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
import { SourcePositionPlugin } from "./source-position-plugin";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

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

interface DocumentSyncPluginProps {
  readonly doc: string;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly suppressedDocRef: MutableRefObject<string | null>;
}

function DocumentSyncPlugin({
  doc,
  lastCommittedDocRef,
  suppressedDocRef,
}: DocumentSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (doc === lastCommittedDocRef.current) {
      return;
    }

    suppressedDocRef.current = doc;
    setLexicalMarkdown(editor, doc);
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    lastCommittedDocRef.current = doc;
  }, [doc, editor, lastCommittedDocRef, suppressedDocRef]);

  return null;
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

        if (hasEditableTextSelection(rootElement)) {
          return;
        }

        editor.update(() => {
          const root = $getRoot();
          const textNodes = root.getAllTextNodes().filter((node) => node.getTextContentSize() > 0);
          const lastTextNode = textNodes[textNodes.length - 1];
          if (lastTextNode) {
            lastTextNode.selectEnd();
            return;
          }
          root.selectEnd();
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

function ViewportTrackingPlugin({
  onViewportFromChange,
}: {
  readonly onViewportFromChange?: (from: number) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onViewportFromChange || typeof window === "undefined") {
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

    const unregisterRoot = editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("scroll", sync);
      rootElement?.addEventListener("scroll", sync, { passive: true });
      sync();
    });

    const unregisterUpdate = editor.registerUpdateListener(() => {
      sync();
    });

    window.addEventListener("resize", sync);
    sync();

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", sync);
      const root = editor.getRootElement();
      root?.removeEventListener("scroll", sync);
      unregisterUpdate();
      unregisterRoot();
    };
  }, [editor, onViewportFromChange]);

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

function repairBlankClickSelection(root: HTMLElement): void {
  if (hasEditableTextSelection(root)) {
    return;
  }

  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const textLeaves = [...root.querySelectorAll("[data-lexical-text='true']")];
  const lastTextNode = textLeaves
    .map((leaf) => leaf.firstChild)
    .filter((node): node is Text => node instanceof Text && node.textContent !== null && node.textContent.length > 0)
    .at(-1) ?? null;

  if (!lastTextNode) {
    return;
  }

  const range = document.createRange();
  range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export interface LexicalRichMarkdownEditorProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editable?: boolean;
  readonly editorClassName?: string;
  readonly namespace?: string;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onRootElementChange?: (root: HTMLElement | null) => void;
  readonly onTextChange?: (text: string) => void;
  readonly onScrollChange?: (scrollTop: number) => void;
  readonly onViewportFromChange?: (from: number) => void;
  readonly repairBlankClickSelection?: boolean;
  readonly requireUserEditFlag?: boolean;
  readonly renderContextValue?: LexicalRenderContextValue;
  readonly showBibliography?: boolean;
  readonly showHeadingChrome?: boolean;
  readonly showIncludeAffordances?: boolean;
  readonly enableSourceNavigation?: boolean;
  readonly spellCheck?: boolean;
  readonly testId?: string | null;
}

export function LexicalRichMarkdownEditor({
  doc,
  docPath,
  editable = true,
  editorClassName,
  namespace = "coflat-lexical-rich-markdown",
  onDocChange,
  onRootElementChange,
  onTextChange,
  onScrollChange,
  onViewportFromChange,
  repairBlankClickSelection: shouldRepairBlankClickSelection = false,
  requireUserEditFlag = true,
  renderContextValue,
  showBibliography = false,
  showHeadingChrome = true,
  showIncludeAffordances = false,
  enableSourceNavigation = false,
  spellCheck = false,
  testId = "lexical-editor",
}: LexicalRichMarkdownEditorProps) {
  const initialDocRef = useRef(doc);
  const lastCommittedDocRef = useRef(doc);
  const suppressedDocRef = useRef<string | null>(null);
  const userEditPendingRef = useRef(false);

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

    if (suppressedDocRef.current === nextDoc) {
      suppressedDocRef.current = null;
      lastCommittedDocRef.current = nextDoc;
      onTextChange?.(nextDoc);
      return;
    }

    if (
      requireUserEditFlag
      && !userEditPendingRef.current
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
    lastCommittedDocRef.current = nextDoc;
    onTextChange?.(nextDoc);
    onDocChange?.(changes);
  }, [onDocChange, onTextChange, requireUserEditFlag]);

  return (
    <LexicalRenderContextProvider doc={doc} docPath={docPath} value={renderContextValue}>
      <LexicalSurfaceEditableProvider editable={editable}>
        <div
          className={showBibliography ? "h-full overflow-auto" : "h-full overflow-hidden"}
          onScroll={showBibliography
            ? (event) => onScrollChange?.(event.currentTarget.scrollTop)
            : undefined}
        >
          <LexicalComposer initialConfig={initialConfig}>
            <RootElementPlugin onRootElementChange={onRootElementChange} />
            <DocumentSyncPlugin
              doc={doc}
              lastCommittedDocRef={lastCommittedDocRef}
              suppressedDocRef={suppressedDocRef}
            />
            <RichTextPlugin
              contentEditable={(
                <ContentEditable
                  aria-label="Lexical rich editor"
                  className={editorClassName}
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
                    ? (event) => {
                      repairBlankClickSelection(event.currentTarget);
                    }
                    : undefined}
                  onScroll={(event) => onScrollChange?.(event.currentTarget.scrollTop)}
                  spellCheck={spellCheck}
                />
              )}
              ErrorBoundary={LexicalErrorBoundary}
              placeholder={null}
            />
            <FocusEdgePlugin />
            <CodeBlockChromePlugin />
            {showIncludeAffordances ? <IncludeRegionAffordancePlugin editable={editable} /> : null}
            {editable && shouldRepairBlankClickSelection ? <ClickCaretRepairPlugin enabled /> : null}
            {editable ? <HistoryPlugin /> : null}
            <ListPlugin />
            <CheckListPlugin />
            <LinkPlugin />
            {editable ? <LinkSourcePlugin /> : null}
            {editable ? <InlineFormatSourcePlugin /> : null}
            {editable ? <InlineMathSourcePlugin /> : null}
            {editable ? <MarkdownExpansionPlugin /> : null}
            {editable ? <BlockKeyboardAccessPlugin /> : null}
            {editable ? <ReferenceTypeaheadPlugin /> : null}
            {showHeadingChrome ? <HeadingChromePlugin doc={renderContextValue?.doc ?? doc} /> : null}
            <SourcePositionPlugin doc={renderContextValue?.doc ?? doc} enableNavigation={enableSourceNavigation} />
            <ViewportTrackingPlugin onViewportFromChange={onViewportFromChange} />
            {editable ? <MarkdownShortcutPlugin transformers={[...coflatMarkdownTransformers]} /> : null}
            {editable ? <OnChangePlugin onChange={handleChange} /> : null}
            {showBibliography ? <BibliographySection /> : null}
          </LexicalComposer>
        </div>
      </LexicalSurfaceEditableProvider>
    </LexicalRenderContextProvider>
  );
}
