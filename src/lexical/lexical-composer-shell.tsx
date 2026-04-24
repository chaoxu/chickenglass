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
import { Fragment } from "react";
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

interface CoflatRichPluginDefinition {
  readonly id: CoflatRichPluginId;
  readonly enabled: (options: CoflatRichPluginPlanOptions) => boolean;
}

const coflatRichPluginDefinitions: readonly CoflatRichPluginDefinition[] = [
  { id: "clipboard", enabled: ({ hasClipboardPlugin }) => hasClipboardPlugin },
  { id: "rich-text", enabled: () => true },
  { id: "code-highlight", enabled: () => true },
  { id: "code-fence-exit", enabled: () => true },
  { id: "code-block-chrome", enabled: ({ showCodeBlockChrome }) => showCodeBlockChrome },
  { id: "history", enabled: ({ hasHistoryPlugin }) => hasHistoryPlugin },
  { id: "list", enabled: () => true },
  { id: "check-list", enabled: () => true },
  {
    id: "list-marker-strip",
    enabled: ({ editable, showListMarkerStrip }) => editable && showListMarkerStrip,
  },
  { id: "link", enabled: () => true },
  { id: "table-scroll-shadow", enabled: ({ showTableChrome }) => showTableChrome },
  {
    id: "table-action-menu",
    enabled: ({ editable, showTableChrome }) => editable && showTableChrome,
  },
  { id: "format-event", enabled: ({ editable }) => editable },
  {
    id: "markdown-expansion",
    enabled: ({ editable, showMarkdownExpansion }) => editable && showMarkdownExpansion,
  },
  {
    id: "block-keyboard-access",
    enabled: ({ editable, showBlockKeyboardAccess }) => editable && showBlockKeyboardAccess,
  },
  { id: "tab-key", enabled: ({ editable, showTabKey }) => editable && showTabKey },
  {
    id: "reference-typeahead",
    enabled: ({ editable, showReferenceTypeahead }) => editable && showReferenceTypeahead,
  },
  {
    id: "slash-picker",
    enabled: ({ editable, showSlashPicker }) => editable && showSlashPicker,
  },
  { id: "heading-chrome-index", enabled: ({ showHeadingChrome }) => showHeadingChrome },
  { id: "source-position", enabled: ({ showSourcePosition }) => showSourcePosition },
  { id: "viewport-tracking", enabled: ({ showViewportTracking }) => showViewportTracking },
  { id: "markdown-shortcuts", enabled: ({ editable }) => editable },
  { id: "on-change", enabled: ({ editable, hasOnChange }) => editable && hasOnChange },
  { id: "selection", enabled: ({ hasSelectionPlugin }) => hasSelectionPlugin },
  { id: "interaction-trace", enabled: ({ showInteractionTrace }) => showInteractionTrace },
  { id: "bibliography", enabled: ({ showBibliography }) => showBibliography },
  { id: "active-editor", enabled: () => true },
  { id: "tree-view", enabled: () => true },
];

export function getCoflatRichPluginPlan(
  options: CoflatRichPluginPlanOptions,
): readonly CoflatRichPluginId[] {
  return coflatRichPluginDefinitions
    .filter((definition) => definition.enabled(options))
    .map((definition) => definition.id);
}

interface CoflatRichComposerPluginsProps {
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
}: CoflatRichComposerPluginsProps) {
  const props: CoflatRichComposerPluginsProps = {
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
  };
  const plan = getCoflatRichPluginPlan({
    editable,
    hasClipboardPlugin: clipboardPlugin != null,
    hasHistoryPlugin: historyPlugin != null,
    hasOnChange,
    hasSelectionPlugin: selectionPlugin != null,
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
  });

  return (
    <>
      {plan.map((pluginId) => (
        <Fragment key={pluginId}>
          {renderCoflatRichPlugin(pluginId, props)}
        </Fragment>
      ))}
    </>
  );
}

function renderCoflatRichPlugin(
  pluginId: CoflatRichPluginId,
  props: CoflatRichComposerPluginsProps,
): ReactNode {
  switch (pluginId) {
    case "clipboard":
      return props.clipboardPlugin;
    case "rich-text":
      return (
        <RichTextPlugin
          contentEditable={props.contentEditable}
          ErrorBoundary={LexicalErrorBoundary}
          placeholder={null}
        />
      );
    case "code-highlight":
      return <CodeHighlightPlugin />;
    case "code-fence-exit":
      return <CodeFenceExitPlugin />;
    case "code-block-chrome":
      return <CodeBlockChromePlugin />;
    case "history":
      return props.historyPlugin;
    case "list":
      return <ListPlugin />;
    case "check-list":
      return <CheckListPlugin />;
    case "list-marker-strip":
      return <ListMarkerStripPlugin />;
    case "link":
      return <LinkPlugin />;
    case "table-scroll-shadow":
      return <TableScrollShadowPlugin />;
    case "table-action-menu":
      return <TableActionMenuPlugin />;
    case "format-event":
      return <FormatEventPlugin />;
    case "markdown-expansion":
      return <MarkdownExpansionPlugin />;
    case "block-keyboard-access":
      return <BlockKeyboardAccessPlugin />;
    case "tab-key":
      return <TabKeyPlugin />;
    case "reference-typeahead":
      return <ReferenceTypeaheadPlugin />;
    case "slash-picker":
      return <SlashPickerPlugin />;
    case "heading-chrome-index":
      return <HeadingChromeAndIndexPlugin doc={props.doc} />;
    case "source-position":
      return (
        <SourcePositionPlugin
          doc={props.doc}
          enableNavigation={props.enableSourceNavigation}
        />
      );
    case "viewport-tracking":
      return <ViewportTrackingPlugin onViewportFromChange={props.onViewportFromChange} />;
    case "markdown-shortcuts":
      return <MarkdownShortcutPlugin transformers={[...coflatMarkdownTransformers]} />;
    case "on-change":
      return <OnChangePlugin onChange={props.onChange} />;
    case "selection":
      return props.selectionPlugin;
    case "interaction-trace":
      return <InteractionTracePlugin />;
    case "bibliography":
      return <BibliographySection />;
    case "active-editor":
      return <ActiveEditorPlugin />;
    case "tree-view":
      return <TreeViewPlugin />;
  }
}
