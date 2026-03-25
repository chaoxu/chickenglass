import { useRef, lazy, Suspense } from "react";
import { useEditor } from "../hooks/use-editor";
import type { UseEditorOptions, UseEditorReturn } from "../hooks/use-editor";
import { useEditorStateTracking } from "../hooks/use-editor-state-tracking";
import { useSidenotesAutoCollapse } from "../hooks/use-sidenotes-auto-collapse";
import { useFootnoteTooltip } from "../hooks/use-footnote-tooltip";
import { Breadcrumbs } from "./breadcrumbs";
import { SidenoteMargin } from "./sidenote-margin";
import { extractHeadings } from "../heading-ancestry";
import { bibDataField } from "../../citations/citation-render";
import { frontmatterField, type EditorMode } from "../../editor";

/** Lazy-loaded read-mode view — kept out of the startup bundle (read mode is deferred). */
const ReadModeView = lazy(() =>
  import("./read-mode-view").then((m) => ({ default: m.ReadModeView })),
);

export interface EditorPaneProps extends UseEditorOptions {
  sidenotesCollapsed?: boolean;
  onSidenotesCollapsedChange?: (collapsed: boolean) => void;
  onStateChange?: (state: UseEditorReturn) => void;
  /** Current editor mode — "read" shows the HTML renderer instead of CM6. */
  editorMode?: EditorMode;
}

export function EditorPane({
  onStateChange,
  sidenotesCollapsed,
  onSidenotesCollapsedChange,
  editorMode,
  ...editorOptions
}: EditorPaneProps) {
  const isReadMode = editorMode === "read";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorState = useEditor(containerRef, editorOptions);

  const { view, scrollTop, viewportFrom } = editorState;

  useEditorStateTracking(editorState, onStateChange);
  useSidenotesAutoCollapse(view, sidenotesCollapsed, onSidenotesCollapsedChange);
  useFootnoteTooltip(view, sidenotesCollapsed);

  // Extract headings for breadcrumbs and outline
  const headings = view ? extractHeadings(view.state) : [];

  // Get the live document content, frontmatter config, and bibliography for ReadModeView
  const readModeContent = view ? view.state.doc.toString() : editorOptions.doc;
  const fmState = view ? view.state.field(frontmatterField, false) : undefined;
  const frontmatterConfig = fmState?.config ?? {};
  const bibData = view ? view.state.field(bibDataField, false) : undefined;

  return (
    <div className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
      {!isReadMode && (
        <Breadcrumbs
          headings={headings}
          onSelect={(from) => {
            if (view) {
              view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
              view.focus();
            }
          }}
          scrollTop={scrollTop}
          viewportFrom={viewportFrom}
        />
      )}
      {/* CM6 editor — hidden (not unmounted) in read mode to preserve state */}
      <div ref={containerRef} className="h-full" style={isReadMode ? { display: "none" } : undefined} />
      {/* Read mode HTML renderer (lazy-loaded — read mode is deferred) */}
      {isReadMode && (
        <Suspense fallback={null}>
          <ReadModeView
            content={readModeContent}
            frontmatterConfig={frontmatterConfig}
            bibliography={bibData?.store}
            cslProcessor={bibData?.cslProcessor}
            scrollTop={scrollTop}
            fs={editorOptions.fs}
            docPath={editorOptions.docPath}
          />
        </Suspense>
      )}
      {/* Portal target — SidenoteMargin renders into the CM6 scroller via DOM portal */}
      {!isReadMode && !sidenotesCollapsed && <SidenoteMargin view={view} />}
    </div>
  );
}
