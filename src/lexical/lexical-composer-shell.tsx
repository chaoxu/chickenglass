import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import type {
  InitialConfigType,
  InitialEditorStateType,
} from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import type { LexicalEditor } from "lexical";
import type { MutableRefObject, ReactElement, ReactNode, UIEventHandler } from "react";

import type { EditorDocumentChange } from "../lib/string-editor-document-change";
import { ActiveEditorPlugin } from "./active-editor-plugin";
import { BibliographySection } from "./bibliography-section";
import { BlockKeyboardAccessPlugin } from "./block-keyboard-access-plugin";
import { CodeBlockChromePlugin } from "./code-block-chrome-plugin";
import { DocumentChangeBridgeProvider } from "./document-change-bridge";
import { LexicalSurfaceEditableProvider } from "./editability-context";
import {
  FormatEventPlugin,
  ViewportTrackingPlugin,
} from "./editor-surface-shared";
import { InteractionTracePlugin } from "./interaction-trace-plugin";
import {
  type EmbeddedFieldFlushRegistry,
  EmbeddedFieldFlushProvider,
} from "./embedded-field-flush-registry";
import { HeadingChromeAndIndexPlugin } from "./heading-chrome-index-plugin";
import { ListMarkerStripPlugin } from "./list-marker-strip-plugin";
import { coflatMarkdownNodes, lexicalMarkdownTheme } from "./markdown-schema";
import { coflatMarkdownTransformers } from "./markdown-transformers";
import { MarkdownExpansionPlugin } from "./markdown-expansion-plugin";
import { ReferenceTypeaheadPlugin } from "./reference-typeahead-plugin";
import {
  LexicalRenderContextProvider,
  type LexicalRenderContextValue,
} from "./render-context";
import type { RevealPresentation } from "./reveal-mode";
import { RevealPresentationProvider } from "./reveal-presentation-context";
import {
  CodeFenceExitPlugin,
  CodeHighlightPlugin,
} from "./rich-editor-plugins";
import { EditorScrollSurfaceProvider } from "./runtime";
import { SlashPickerPlugin } from "./slash-picker-plugin";
import { SourcePositionPlugin } from "./source-position-plugin";
import { StructureEditProvider } from "./structure-edit-plugin";
import { TabKeyPlugin } from "./tab-key-plugin";
import { TableActionMenuPlugin } from "./table-action-menu-plugin";
import { TableScrollShadowPlugin } from "./table-scroll-shadow-plugin";
import { TreeViewPlugin } from "./tree-view-plugin";

export function createCoflatComposerConfig({
  editable,
  editorState,
  namespace,
}: {
  readonly editable: boolean;
  readonly editorState: InitialEditorStateType;
  readonly namespace: string;
}): InitialConfigType {
  return {
    editable,
    editorState,
    namespace,
    nodes: [...coflatMarkdownNodes],
    onError(error: Error) {
      throw error;
    },
    theme: lexicalMarkdownTheme,
  };
}

export function CoflatLexicalComposerShell({
  children,
  doc,
  docPath,
  editable,
  embeddedFieldFlushRegistry,
  effectiveSurface,
  initialConfig,
  lastCommittedDocRef,
  onDocChange,
  onScroll,
  onTextChange,
  pendingLocalEchoDocRef,
  renderContextValue,
  revealPresentation,
  setSurfaceElement,
  shellClassName,
}: {
  readonly children: ReactNode;
  readonly doc: string;
  readonly docPath?: string;
  readonly editable: boolean;
  readonly embeddedFieldFlushRegistry: EmbeddedFieldFlushRegistry;
  readonly effectiveSurface: HTMLElement | null;
  readonly initialConfig: InitialConfigType;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onScroll?: UIEventHandler<HTMLDivElement>;
  readonly onTextChange?: (text: string) => void;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly renderContextValue?: LexicalRenderContextValue;
  readonly revealPresentation: RevealPresentation;
  readonly setSurfaceElement: (element: HTMLElement | null) => void;
  readonly shellClassName: string;
}) {
  return (
    <EmbeddedFieldFlushProvider registry={embeddedFieldFlushRegistry}>
      <RevealPresentationProvider value={revealPresentation}>
        <LexicalRenderContextProvider doc={doc} docPath={docPath} value={renderContextValue}>
          <LexicalSurfaceEditableProvider editable={editable}>
            <div
              className={shellClassName}
              onScroll={onScroll}
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
                      {children}
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

export type CoflatRichPluginId =
  | "clipboard"
  | "rich-text"
  | "code-highlight"
  | "code-fence-exit"
  | "code-block-chrome"
  | "history"
  | "list"
  | "check-list"
  | "list-marker-strip"
  | "link"
  | "table-scroll-shadow"
  | "table-action-menu"
  | "format-event"
  | "markdown-expansion"
  | "block-keyboard-access"
  | "tab-key"
  | "reference-typeahead"
  | "slash-picker"
  | "heading-chrome-index"
  | "source-position"
  | "viewport-tracking"
  | "markdown-shortcuts"
  | "on-change"
  | "selection"
  | "interaction-trace"
  | "bibliography"
  | "active-editor"
  | "tree-view";

export interface CoflatRichPluginPlanOptions {
  readonly editable: boolean;
  readonly hasClipboardPlugin: boolean;
  readonly hasHistoryPlugin: boolean;
  readonly hasSelectionPlugin: boolean;
  readonly hasOnChange: boolean;
  readonly showBibliography: boolean;
  readonly showBlockKeyboardAccess: boolean;
  readonly showCodeBlockChrome: boolean;
  readonly showHeadingChrome: boolean;
  readonly showInteractionTrace: boolean;
  readonly showListMarkerStrip: boolean;
  readonly showMarkdownExpansion: boolean;
  readonly showReferenceTypeahead: boolean;
  readonly showSlashPicker: boolean;
  readonly showSourcePosition: boolean;
  readonly showTableChrome: boolean;
  readonly showTabKey: boolean;
  readonly showViewportTracking: boolean;
}

export function getCoflatRichPluginPlan({
  editable,
  hasClipboardPlugin,
  hasHistoryPlugin,
  hasOnChange,
  hasSelectionPlugin,
  showBibliography,
  showBlockKeyboardAccess,
  showCodeBlockChrome,
  showHeadingChrome,
  showInteractionTrace,
  showListMarkerStrip,
  showMarkdownExpansion,
  showReferenceTypeahead,
  showSlashPicker,
  showSourcePosition,
  showTableChrome,
  showTabKey,
  showViewportTracking,
}: CoflatRichPluginPlanOptions): readonly CoflatRichPluginId[] {
  const plan: CoflatRichPluginId[] = [];
  if (hasClipboardPlugin) plan.push("clipboard");
  plan.push("rich-text", "code-highlight", "code-fence-exit");
  if (showCodeBlockChrome) plan.push("code-block-chrome");
  if (hasHistoryPlugin) plan.push("history");
  plan.push("list", "check-list");
  if (editable && showListMarkerStrip) plan.push("list-marker-strip");
  plan.push("link");
  if (showTableChrome) plan.push("table-scroll-shadow");
  if (editable && showTableChrome) plan.push("table-action-menu");
  if (editable) plan.push("format-event");
  if (editable && showMarkdownExpansion) plan.push("markdown-expansion");
  if (editable && showBlockKeyboardAccess) plan.push("block-keyboard-access");
  if (editable && showTabKey) plan.push("tab-key");
  if (editable && showReferenceTypeahead) plan.push("reference-typeahead");
  if (editable && showSlashPicker) plan.push("slash-picker");
  if (showHeadingChrome) plan.push("heading-chrome-index");
  if (showSourcePosition) plan.push("source-position");
  if (showViewportTracking) plan.push("viewport-tracking");
  if (editable) plan.push("markdown-shortcuts");
  if (editable && hasOnChange) plan.push("on-change");
  if (hasSelectionPlugin) plan.push("selection");
  if (showInteractionTrace) plan.push("interaction-trace");
  if (showBibliography) plan.push("bibliography");
  plan.push("active-editor", "tree-view");
  return plan;
}

export function CoflatRichComposerPlugins({
  clipboardPlugin,
  contentEditable,
  doc,
  editable,
  enableSourceNavigation,
  hasOnChange,
  historyPlugin,
  onChange,
  onViewportFromChange,
  selectionPlugin,
  showBibliography,
  showBlockKeyboardAccess,
  showCodeBlockChrome,
  showHeadingChrome,
  showInteractionTrace,
  showListMarkerStrip,
  showMarkdownExpansion,
  showReferenceTypeahead,
  showSlashPicker,
  showSourcePosition,
  showTableChrome,
  showTabKey,
  showViewportTracking,
}: {
  readonly clipboardPlugin?: ReactNode;
  readonly contentEditable: ReactElement;
  readonly doc: string;
  readonly editable: boolean;
  readonly enableSourceNavigation: boolean;
  readonly hasOnChange: boolean;
  readonly historyPlugin: ReactNode;
  readonly onChange: (
    editorState: unknown,
    editor: LexicalEditor,
    tags: Set<string>,
  ) => void;
  readonly onViewportFromChange?: (from: number) => void;
  readonly selectionPlugin?: ReactNode;
  readonly showBibliography: boolean;
  readonly showBlockKeyboardAccess: boolean;
  readonly showCodeBlockChrome: boolean;
  readonly showHeadingChrome: boolean;
  readonly showInteractionTrace: boolean;
  readonly showListMarkerStrip: boolean;
  readonly showMarkdownExpansion: boolean;
  readonly showReferenceTypeahead: boolean;
  readonly showSlashPicker: boolean;
  readonly showSourcePosition: boolean;
  readonly showTableChrome: boolean;
  readonly showTabKey: boolean;
  readonly showViewportTracking: boolean;
}) {
  return (
    <>
      {clipboardPlugin}
      <RichTextPlugin
        contentEditable={contentEditable}
        ErrorBoundary={LexicalErrorBoundary}
        placeholder={null}
      />
      <CodeHighlightPlugin />
      <CodeFenceExitPlugin />
      {showCodeBlockChrome ? <CodeBlockChromePlugin /> : null}
      {historyPlugin}
      <ListPlugin />
      <CheckListPlugin />
      {editable && showListMarkerStrip ? <ListMarkerStripPlugin /> : null}
      <LinkPlugin />
      {showTableChrome ? <TableScrollShadowPlugin /> : null}
      {editable && showTableChrome ? <TableActionMenuPlugin /> : null}
      {editable ? <FormatEventPlugin /> : null}
      {editable && showMarkdownExpansion ? <MarkdownExpansionPlugin /> : null}
      {editable && showBlockKeyboardAccess ? <BlockKeyboardAccessPlugin /> : null}
      {editable && showTabKey ? <TabKeyPlugin /> : null}
      {editable && showReferenceTypeahead ? <ReferenceTypeaheadPlugin /> : null}
      {editable && showSlashPicker ? <SlashPickerPlugin /> : null}
      {showHeadingChrome ? <HeadingChromeAndIndexPlugin doc={doc} /> : null}
      {showSourcePosition ? (
        <SourcePositionPlugin
          doc={doc}
          enableNavigation={enableSourceNavigation}
        />
      ) : null}
      {showViewportTracking ? <ViewportTrackingPlugin onViewportFromChange={onViewportFromChange} /> : null}
      {editable ? <MarkdownShortcutPlugin transformers={[...coflatMarkdownTransformers]} /> : null}
      {editable && hasOnChange ? <OnChangePlugin onChange={onChange} /> : null}
      {selectionPlugin}
      {showInteractionTrace ? <InteractionTracePlugin /> : null}
      {showBibliography ? <BibliographySection /> : null}
      <ActiveEditorPlugin />
      <TreeViewPlugin />
    </>
  );
}
